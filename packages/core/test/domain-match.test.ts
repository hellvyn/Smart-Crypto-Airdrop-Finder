import { describe, expect, it } from "vitest";
import { domainMatches } from "../src/index.js";

describe("domainMatches", () => {
  it("matches by registrable domain only", () => {
    expect(domainMatches(["arcus.xyz"], "https://app.arcus.xyz/trade")).toBe(true);
    expect(domainMatches(["arcus.xyz"], "https://arcus-airdrop.xyz")).toBe(false);
    expect(domainMatches([], "https://arcus.xyz")).toBe(false);
  });

  it("accepts a bare domain or host as the candidate", () => {
    expect(domainMatches(["arcus.xyz"], "arcus.xyz")).toBe(true);
    expect(domainMatches(["arcus.xyz"], "www.arcus.xyz/app")).toBe(true);
    expect(domainMatches(["arcus.xyz"], "ARCUS.XYZ")).toBe(true);
  });

  it("compares the registrable domain of the project's domains too", () => {
    expect(domainMatches(["App.Arcus.xyz"], "https://arcus.xyz")).toBe(true);
  });

  it("never matches a substring, a suffix trick or a different registrable domain", () => {
    expect(domainMatches(["arcus.xyz"], "https://arcus.xyz.evil.com/")).toBe(false);
    expect(domainMatches(["arcus.xyz"], "https://notarcus.xyz/")).toBe(false);
    expect(domainMatches(["arcus.xyz"], "https://evil.com/?r=arcus.xyz")).toBe(false);
    expect(domainMatches(["arcus.xyz"], "https://arcus.xyz@evil.com/")).toBe(false);
    expect(domainMatches(["arcus.xyz"], "https://arcus.io/")).toBe(false);
  });

  it("keeps tenants of a public-suffix host apart", () => {
    expect(domainMatches(["arcus.vercel.app"], "https://arcus.vercel.app/")).toBe(true);
    expect(domainMatches(["arcus.vercel.app"], "https://arcus-claim.vercel.app/")).toBe(false);
  });

  it("never matches a platform, social or aggregator host, even when the project lists it", () => {
    for (const url of [
      "https://x.com/arcus",
      "https://t.me/arcus",
      "https://medium.com/@arcus",
      "https://arcus.medium.com/",
      "https://github.com/arcus",
      "https://linktr.ee/arcus",
      "https://galxe.com/arcus",
      "https://forms.gle/abc",
      "https://docs.google.com/forms/d/abc",
      "https://arcus.notion.site/",
      "https://mirror.xyz/arcus.eth",
      "https://airdrops.io/arcus/",
      "https://alphadrops.net/airdrops/arcus",
      "https://defillama.com/protocol/arcus",
      "https://www.coingecko.com/en/coins/arcus",
    ]) {
      const host = new URL(url).hostname;
      expect(domainMatches([host, "arcus.xyz"], url), url).toBe(false);
    }
  });

  it("never matches an unparseable candidate, an IP address or a non-web scheme", () => {
    expect(domainMatches(["arcus.xyz"], "")).toBe(false);
    expect(domainMatches(["arcus.xyz"], "not a url")).toBe(false);
    expect(domainMatches(["127.0.0.1"], "http://127.0.0.1/")).toBe(false);
    expect(domainMatches(["arcus.xyz"], "mailto:team@arcus.xyz")).toBe(false);
    expect(domainMatches(["arcus.xyz"], "javascript:alert(1)//arcus.xyz")).toBe(false);
  });

  it("ignores project domains that have no registrable domain", () => {
    expect(domainMatches(["", "localhost"], "http://localhost/")).toBe(false);
  });
});
