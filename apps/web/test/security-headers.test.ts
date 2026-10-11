import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

const EXPECTED = {
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
};

describe("security headers (next.config.ts)", () => {
  it("sends anti-framing, referrer and nosniff headers on every path", async () => {
    expect(nextConfig.headers).toBeTypeOf("function");
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*");
    expect(all).toBeDefined();
    expect(Object.fromEntries(all!.headers.map((h) => [h.key, h.value]))).toEqual(EXPECTED);
  });
});

describe("logo route headers (next.config.ts)", () => {
  it("replaces the page CSP with a sandboxing one on /logo/{id}, after the every-path rule so it wins", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.findIndex((r) => r.source === "/:path*");
    const logo = rules.findIndex((r) => r.source === "/logo/:projectId");
    expect(logo).toBeGreaterThan(all);
    expect(Object.fromEntries(rules[logo]!.headers.map((h) => [h.key, h.value]))).toEqual({
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
  });
});
