import { AuthApiError, AuthRetryableFetchError, AuthUnknownError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signInWithPassword = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ auth: { signInWithPassword } }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
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
    log = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns the Indonesian message for wrong credentials", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: invalid() });
    await expect(logIn(null, form({ email: EMAIL, password: "x" }))).resolves.toEqual({ error: "Email atau password salah." });
  });

  it("never returns or logs the raw Supabase message or the email for an unknown error", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: unknown() });
    const state = await logIn(null, form({ email: EMAIL, password: "x" }));
    expect(state).toEqual({ error: "Terjadi kesalahan. Coba lagi." });
    expect(JSON.stringify(state)).not.toContain(RAW);
    expect(JSON.stringify(state)).not.toContain(EMAIL);
    for (const spy of log) expect(spy).not.toHaveBeenCalled();
  });

  it("shows the generic message when the client call itself throws", async () => {
    signInWithPassword.mockRejectedValue(new TypeError(RAW));
    await expect(logIn(null, form({ email: EMAIL, password: "x" }))).resolves.toEqual({ error: "Terjadi kesalahan. Coba lagi." });
  });

  it("maps a network failure returned by the client", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: offline() });
    await expect(logIn(null, form({ email: EMAIL, password: "x" }))).resolves.toEqual({
      error: "Gak bisa nyambung ke server login. Cek koneksi kamu, lalu coba lagi.",
    });
  });

  it("goes to the safe next page after a successful login", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: { id: "u1" }, session: {} }, error: null });
    await expect(logIn(null, form({ email: EMAIL, password: "x", next: "/settings" }))).rejects.toThrow("REDIRECT /settings");
  });
});
