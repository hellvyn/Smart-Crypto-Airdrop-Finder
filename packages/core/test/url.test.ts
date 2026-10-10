import { describe, expect, it } from "vitest";
import { cleanUrl, filterUrlsInSource, registrableDomain, toUnicodeDomain } from "../src/index.js";

describe("cleanUrl", () => {
  it("strips a ref query param", () => {
    expect(cleanUrl("https://omni.variational.io/?ref=OMNISHUKOC2R")).toEqual({
      url: "https://omni.variational.io/",
      referralStripped: true,
    });
  });

  it("replaces a /r/<code> path with /", () => {
    expect(cleanUrl("https://www.raycash.xyz/r/V8P3TX")).toEqual({
      url: "https://www.raycash.xyz/",
      referralStripped: true,
    });
  });

  it("keeps legitimate params while dropping ref and utm_*", () => {
    expect(cleanUrl("https://app.x.io/swap?chain=arb&ref=X&utm_source=tg").url).toBe(
      "https://app.x.io/swap?chain=arb",
    );
  });

  it("matches param names case-insensitively and drops referral", () => {
    const r = cleanUrl("https://a.io/?REF=1&Referral=2&UTM_Medium=x&keep=1");
    expect(r).toEqual({ url: "https://a.io/?keep=1", referralStripped: true });
  });

  it("keeps remaining params in original order", () => {
    expect(cleanUrl("https://a.io/p?b=2&ref=1&a=1").url).toBe("https://a.io/p?b=2&a=1");
  });

  it("leaves clean URLs untouched", () => {
    expect(cleanUrl("https://claim.deepbook.tech/")).toEqual({
      url: "https://claim.deepbook.tech/",
      referralStripped: false,
    });
  });

  it("only rewrites /r/<code> when it is exactly two segments", () => {
    expect(cleanUrl("https://a.io/r").referralStripped).toBe(false);
    expect(cleanUrl("https://a.io/r/abc/def").referralStripped).toBe(false);
    expect(cleanUrl("https://a.io/rewards/abc").referralStripped).toBe(false);
  });

  it("throws on invalid URLs", () => {
    expect(() => cleanUrl("not a url")).toThrow();
  });
});

describe("registrableDomain", () => {
  it("returns the registrable domain", () => {
    expect(registrableDomain("https://waitlist.deepbook.tech/x")).toBe("deepbook.tech");
    expect(registrableDomain("https://foo.bar.example.co.uk/")).toBe("example.co.uk");
  });

  it("returns punycode for IDN hosts", () => {
    expect(registrableDomain("https://www.xn--bcher-kva.example/")).toBe("xn--bcher-kva.example");
  });

  it("returns null for invalid URLs, IPs and localhost", () => {
    expect(registrableDomain("nonsense")).toBeNull();
    expect(registrableDomain("http://127.0.0.1:3000/")).toBeNull();
    expect(registrableDomain("http://localhost/")).toBeNull();
  });
});

describe("toUnicodeDomain", () => {
  it("decodes punycode labels", () => {
    expect(toUnicodeDomain("xn--bcher-kva.example")).toBe("bücher.example");
    expect(toUnicodeDomain("xn--80ak6aa92e.com")).toBe("аррӏе.com");
  });

  it("leaves ASCII domains unchanged", () => {
    expect(toUnicodeDomain("deepbook.tech")).toBe("deepbook.tech");
  });
});

describe("filterUrlsInSource", () => {
  it("keeps only URLs present in the source (case-insensitive, trailing slash ignored)", () => {
    expect(
      filterUrlsInSource(["https://a.io/x", "https://b.io"], "see [https://a.io/x/] and &amp;"),
    ).toEqual(["https://a.io/x"]);
  });

  it("decodes &amp; in the source and compares case-insensitively", () => {
    expect(
      filterUrlsInSource(["https://A.io/p?a=1&b=2"], "href=https://a.io/P?a=1&amp;b=2"),
    ).toEqual(["https://A.io/p?a=1&b=2"]);
  });

  it("ignores a trailing slash on the input URL too", () => {
    expect(filterUrlsInSource(["https://b.io/"], "visit https://b.io now")).toEqual(["https://b.io/"]);
  });
});
