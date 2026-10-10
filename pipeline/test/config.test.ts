import { describe, expect, it } from "vitest";
import { defaultConfig, loadEmailEnv, parseEmailFrom } from "../src/config.js";

describe("email config", () => {
  it("defaults to disabled with the Brevo Free quota and a 20% reserve", () => {
    expect(defaultConfig.email).toEqual({ enabled: false, dailyLimit: 300, reserveRatio: 0.2, siteUrl: "" });
  });

  it("is disabled without BREVO_API_KEY, whatever else is set", () => {
    expect(loadEmailEnv({})).toEqual({ ok: true, email: defaultConfig.email, brevo: null });
    expect(loadEmailEnv({ BREVO_API_KEY: "  ", SITE_URL: "https://saf.test" })).toEqual({
      ok: true,
      email: defaultConfig.email,
      brevo: null,
    });
  });

  it("is enabled with BREVO_API_KEY, EMAIL_FROM and SITE_URL (trailing slashes dropped)", () => {
    expect(
      loadEmailEnv({ BREVO_API_KEY: "xkeysib-1", EMAIL_FROM: "Airdrop Bot <bot@saf.test>", SITE_URL: "https://saf.test/" }),
    ).toEqual({
      ok: true,
      email: { enabled: true, dailyLimit: 300, reserveRatio: 0.2, siteUrl: "https://saf.test" },
      brevo: { apiKey: "xkeysib-1", from: { name: "Airdrop Bot", email: "bot@saf.test" } },
    });
  });

  it.each([
    [{ BREVO_API_KEY: "k", EMAIL_FROM: "bot@saf.test" }],
    [{ BREVO_API_KEY: "k", EMAIL_FROM: "bot@saf.test", SITE_URL: "" }],
    [{ BREVO_API_KEY: "k", EMAIL_FROM: "bot@saf.test", SITE_URL: "saf.test" }],
    [{ BREVO_API_KEY: "k", EMAIL_FROM: "bot@saf.test", SITE_URL: "javascript:alert(1)" }],
    [{ BREVO_API_KEY: "k", EMAIL_FROM: "bot@saf.test", SITE_URL: "https://saf.test/?x=1" }],
    [{ BREVO_API_KEY: "k", SITE_URL: "https://saf.test" }],
    [{ BREVO_API_KEY: "k", EMAIL_FROM: "not an address", SITE_URL: "https://saf.test" }],
  ])("is a config error when email is enabled but %j is incomplete or invalid", (env) => {
    expect(loadEmailEnv(env)).toEqual({ ok: false });
  });
});

describe("parseEmailFrom", () => {
  it.each([
    ["bot@saf.test", { name: "Smart Airdrop Finder", email: "bot@saf.test" }],
    ["  bot@saf.test  ", { name: "Smart Airdrop Finder", email: "bot@saf.test" }],
    ["Airdrop Bot <bot@saf.test>", { name: "Airdrop Bot", email: "bot@saf.test" }],
    ['"Airdrop Bot" <bot@saf.test>', { name: "Airdrop Bot", email: "bot@saf.test" }],
    ["<bot@saf.test>", { name: "Smart Airdrop Finder", email: "bot@saf.test" }],
  ])("parses %j", (value, expected) => {
    expect(parseEmailFrom(value)).toEqual(expected);
  });

  it.each(["", "bot", "bot@", "@saf.test", "Bot <bot@saf.test", "a b@saf.test", "Bot <x@y.z> trailing"])(
    "rejects %j",
    (value) => {
      expect(parseEmailFrom(value)).toBeNull();
    },
  );
});
