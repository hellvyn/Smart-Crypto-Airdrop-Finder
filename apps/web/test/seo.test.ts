import { afterEach, describe, expect, it } from "vitest";
import robots from "@/app/robots";
import { projectSeoDescription } from "@/lib/copy";
import { siteUrl } from "@/lib/site-url";

const original = process.env.VERCEL_PROJECT_PRODUCTION_URL;
afterEach(() => {
  if (original === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  else process.env.VERCEL_PROJECT_PRODUCTION_URL = original;
});

describe("siteUrl", () => {
  it("uses the Vercel production host and adds https", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "example.vercel.app";
    expect(siteUrl().toString()).toBe("https://example.vercel.app/");
  });
  it("falls back to the .vercel.app address and tolerates a scheme or trailing slash", () => {
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    expect(siteUrl().host).toBe("smart-airdrop-finder.vercel.app");
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "https://site.test/";
    expect(siteUrl().toString()).toBe("https://site.test/");
  });
});

describe("robots", () => {
  it("keeps crawlers out of the signed-in app and the API, and points at the sitemap", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "site.test";
    const r = robots();
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rule?.disallow).toEqual(expect.arrayContaining(["/api/", "/garapan", "/settings", "/login"]));
    expect(r.sitemap).toBe("https://site.test/sitemap.xml");
  });
});

describe("projectSeoDescription", () => {
  it("names the project and at most three chains", () => {
    const text = projectSeoDescription("Polymarket", ["polygon", "ethereum", "base", "arbitrum"]);
    expect(text).toContain("Polymarket");
    expect(text).toContain("polygon, ethereum, base");
    expect(text).not.toContain("arbitrum");
  });
  it("works without chains", () => {
    expect(projectSeoDescription("X", [])).not.toContain(" di ");
  });
});
