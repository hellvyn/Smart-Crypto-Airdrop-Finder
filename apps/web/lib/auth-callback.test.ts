import { describe, expect, it } from "vitest";
import { callbackDestination, parseEmailOtpType } from "./auth-callback";

describe("parseEmailOtpType", () => {
  it("accepts the email OTP types Supabase links use", () => {
    for (const t of ["signup", "invite", "magiclink", "recovery", "email_change", "email"]) {
      expect(parseEmailOtpType(t)).toBe(t);
    }
  });

  it("rejects anything else", () => {
    expect(parseEmailOtpType(null)).toBeNull();
    expect(parseEmailOtpType("")).toBeNull();
    expect(parseEmailOtpType("sms")).toBeNull();
    expect(parseEmailOtpType("SIGNUP")).toBeNull();
  });
});

describe("callbackDestination", () => {
  it("always sends recovery links to the set-new-password page", () => {
    expect(callbackDestination("recovery", "/settings")).toBe("/update-password");
    expect(callbackDestination("recovery", null)).toBe("/update-password");
  });

  it("uses a safe next path for other links", () => {
    expect(callbackDestination("signup", "/settings")).toBe("/settings");
    expect(callbackDestination(null, "/update-password")).toBe("/update-password");
    expect(callbackDestination("email", null)).toBe("/watchlist");
    expect(callbackDestination("signup", "https://evil.example")).toBe("/watchlist");
    expect(callbackDestination(null, "//evil.example")).toBe("/watchlist");
  });
});
