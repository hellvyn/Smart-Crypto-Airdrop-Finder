import { AuthApiError, AuthRetryableFetchError, AuthUnknownError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signInWithPassword = vi.fn();
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ auth: { signInWithPassword }, rpc }) }));
let requestHeaders = new Headers();
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

import { logIn } from "@/app/(auth)/actions";
import { loginErrorMessage } from "@/lib/auth";

const EMAIL = "member@example.test";
const RAW = "Database error querying schema";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const invalid = () => new AuthApiError("Invalid login credentials", 400, "invalid_credentials");
const rateLimited = () => new AuthApiError("Request rate limit reached", 429, "over_request_rate_limit");
const offline = () => new AuthRetryableFetchError("Failed to fetch", 0);
const unknown = () => new AuthApiError(RAW, 500, "unexpected_failure");

describe("loginErrorMessage", () => {
  it("maps wrong credentials", () => {
    expect(loginErrorMessage(invalid())).toBe("Email atau password salah.");
  });

  it("maps a rate limit, by code or by HTTP 429 alone", () => {
    expect(loginErrorMessage(rateLimited())).toBe("Terlalu banyak percobaan login. Tunggu sebentar, lalu coba lagi.");
    expect(loginErrorMessage(new AuthApiError("Too many requests", 429, undefined))).toBe(
      "Terlalu banyak percobaan login. Tunggu sebentar, lalu coba lagi.",
    );
  });

  it("maps a network failure", () => {
    expect(loginErrorMessage(offline())).toBe("Gak bisa nyambung ke server login. Cek koneksi kamu, lalu coba lagi.");
  });

  it("maps anything else to the generic message, never the raw text", () => {
    for (const error of [unknown(), new AuthUnknownError(RAW, new Error(RAW)), new Error(RAW), { message: RAW }]) {
      const text = loginErrorMessage(error);
      expect(text).toBe("Terjadi kesalahan. Coba lagi.");
      expect(text).not.toContain(RAW);
    }
  });
});

describe("logIn", () => {
  let log: ReturnType<typeof vi.spyOn>[];
  beforeEach(() => {
    signInWithPassword.mockReset();
    rpc.mockReset();
    rpc.mockResolvedValue({ data: true, error: null });
    requestHeaders = new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test-key";
    log = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns the Indonesian message for wrong credentials", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: invalid() });
    await expect(logIn(null, form({ email: EMAIL, password: "x" }))).resolves.toMatchObject({ error: "Email atau password salah." });
  });

  it("never returns or logs the raw Supabase message or the email for an unknown error", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: unknown() });
    const state = await logIn(null, form({ email: EMAIL, password: "x" }));
    expect(state).toMatchObject({ error: "Terjadi kesalahan. Coba lagi." });
    expect(JSON.stringify(state)).not.toContain(RAW);
    expect(JSON.stringify(state)).not.toContain(EMAIL);
    for (const spy of log) expect(spy).not.toHaveBeenCalled();
  });

  it("shows the generic message when the client call itself throws", async () => {
    signInWithPassword.mockRejectedValue(new TypeError(RAW));
    await expect(logIn(null, form({ email: EMAIL, password: "x" }))).resolves.toMatchObject({ error: "Terjadi kesalahan. Coba lagi." });
  });

  it("maps a network failure returned by the client", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: offline() });
    await expect(logIn(null, form({ email: EMAIL, password: "x" }))).resolves.toMatchObject({
      error: "Gak bisa nyambung ke server login. Cek koneksi kamu, lalu coba lagi.",
    });
  });

  it("goes to the safe next page after a successful login", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: { id: "u1" }, session: {} }, error: null });
    await expect(logIn(null, form({ email: EMAIL, password: "x", next: "/settings" }))).rejects.toThrow("REDIRECT /settings");
  });

  it("counts a wrong password under the hashed email and address, never the raw ones", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: invalid() });
    await logIn(null, form({ email: EMAIL, password: "x" }));
    const fail = rpc.mock.calls.find(([name]) => name === "login_throttle_fail");
    expect(fail).toBeDefined();
    const args = fail![1] as { p_email_key: string; p_ip_key: string };
    for (const key of [args.p_email_key, args.p_ip_key]) expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(args.p_email_key).not.toBe(args.p_ip_key);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(EMAIL);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("203.0.113.9");
  });

  it("does not count a rate limit, a network failure or a success as a wrong password", async () => {
    for (const result of [{ error: rateLimited() }, { error: offline() }, { error: unknown() }]) {
      rpc.mockClear();
      signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, ...result });
      await logIn(null, form({ email: EMAIL, password: "x" }));
      expect(rpc.mock.calls.some(([name]) => name === "login_throttle_fail")).toBe(false);
    }
  });

  it("refuses with the 5-attempts message, without asking Supabase Auth, once the throttle says no", async () => {
    rpc.mockImplementation(async (name: string) => ({ data: name === "login_throttle_allowed" ? false : null, error: null }));
    const state = await logIn(null, form({ email: EMAIL, password: "right" }));
    expect(state).toMatchObject({ error: "Udah 5 kali salah login. Coba lagi 15 menit lagi." });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("lets the login through when the throttle itself is down", async () => {
    rpc.mockRejectedValue(new Error("down"));
    signInWithPassword.mockResolvedValue({ data: { user: { id: "u1" }, session: {} }, error: null });
    await expect(logIn(null, form({ email: EMAIL, password: "x" }))).rejects.toThrow("REDIRECT /watchlist");
  });

  it("needs the captcha token when a site key is set, and passes it on to Supabase Auth", async () => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "site-key";
    const missing = await logIn(null, form({ email: EMAIL, password: "x" }));
    expect(missing).toMatchObject({ error: expect.stringContaining("verifikasi") });
    expect(signInWithPassword).not.toHaveBeenCalled();
    signInWithPassword.mockResolvedValue({ data: { user: { id: "u1" }, session: {} }, error: null });
    await expect(logIn(null, form({ email: EMAIL, password: "x", captchaToken: "tok" }))).rejects.toThrow("REDIRECT");
    expect(signInWithPassword).toHaveBeenCalledWith(expect.objectContaining({ options: { captchaToken: "tok" } }));
  });
});
