import { afterEach, describe, expect, it } from "vitest";
import { sessionCookieOptions } from "../lib/supabase/cookie-options";

const ORIGINAL = process.env.NEXT_PUBLIC_SITE_URL;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL;
});

describe("sessionCookieOptions", () => {
  it("is HttpOnly and Lax, and Secure only for an https site", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://smart-airdrop-finder.vercel.app";
    expect(sessionCookieOptions()).toEqual({ httpOnly: true, sameSite: "lax", secure: true, path: "/" });
    process.env.NEXT_PUBLIC_SITE_URL = "http://127.0.0.1:3000";
    expect(sessionCookieOptions().secure).toBe(false);
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(sessionCookieOptions().secure).toBe(false);
    expect(sessionCookieOptions().httpOnly).toBe(true);
  });
});
