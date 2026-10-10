import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REQUEST_PATH_HEADER } from "@/lib/routes";

const getUser = vi.fn();
const requestHeaders = new Headers();
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ auth: { getUser: () => getUser() } }) }));
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

import { requireUser } from "@/lib/auth";

const SIGNED_OUT = { data: { user: null }, error: { name: "AuthSessionMissingError", message: "Auth session missing!" } };

beforeEach(() => {
  getUser.mockReset();
  for (const key of [...requestHeaders.keys()]) requestHeaders.delete(key);
});
afterEach(() => vi.clearAllMocks());

describe("requireUser", () => {
  it("returns the signed-in user", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    await expect(requireUser()).resolves.toEqual({ id: "u1" });
  });

  it("sends a request whose session ended back to /login with the page it was on", async () => {
    getUser.mockResolvedValue(SIGNED_OUT);
    requestHeaders.set(REQUEST_PATH_HEADER, "/wallets?chain=base");
    await expect(requireUser()).rejects.toThrow("REDIRECT /login?next=%2Fwallets%3Fchain%3Dbase");
  });

  it("falls back to plain /login when the page is unknown or not a safe local path", async () => {
    getUser.mockResolvedValue(SIGNED_OUT);
    await expect(requireUser()).rejects.toThrow(/^REDIRECT \/login$/);
    requestHeaders.set(REQUEST_PATH_HEADER, "//evil.example");
    await expect(requireUser()).rejects.toThrow(/^REDIRECT \/login$/);
  });
});
