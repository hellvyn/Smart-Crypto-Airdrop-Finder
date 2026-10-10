import { describe, expect, it } from "vitest";
import { callbackDestination, parseEmailOtpType } from "./auth-callback";

describe("parseEmailOtpType", () => {
  it("accepts only the link types the app's email templates use", () => {
    expect(parseEmailOtpType("email")).toBe("email");
    expect(parseEmailOtpType("recovery")).toBe("recovery");
  });

  it("rejects link types the app does not use", () => {
    for (const t of ["magiclink", "invite", "email_change", "signup"]) {
      expect(parseEmailOtpType(t)).toBeNull();
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
    expect(callbackDestination("email", "/settings")).toBe("/settings");
    expect(callbackDestination(null, "/update-password")).toBe("/update-password");
    expect(callbackDestination("email", null)).toBe("/watchlist");
    expect(callbackDestination("email", "https://evil.example")).toBe("/watchlist");
    expect(callbackDestination("email", "/%2e//evil.example")).toBe("/watchlist");
    expect(callbackDestination(null, "//evil.example")).toBe("/watchlist");
  });
});
