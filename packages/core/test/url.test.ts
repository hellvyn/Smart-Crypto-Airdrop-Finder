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

  it("also strips /r/<code>/ with a trailing slash", () => {
    expect(cleanUrl("https://www.raycash.xyz/r/V8P3TX/")).toEqual({
      url: "https://www.raycash.xyz/",
      referralStripped: true,
    });
  });

  it("preserves the fragment while still removing ref from the query", () => {
    expect(cleanUrl("https://a.io/p?ref=1&x=2#section")).toEqual({
      url: "https://a.io/p?x=2#section",
      referralStripped: true,
    });
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

  it("keeps private suffixes so different projects stay distinct", () => {
    expect(registrableDomain("https://phish.vercel.app/x")).toBe("phish.vercel.app");
    expect(registrableDomain("https://evil.github.io/")).toBe("evil.github.io");
    expect(registrableDomain("https://x.pages.dev/")).toBe("x.pages.dev");
    expect(registrableDomain("https://waitlist.deepbook.tech/x")).toBe("deepbook.tech");
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

  it("rejects a URL that is only a prefix of a longer path", () => {
    expect(filterUrlsInSource(["https://a.io/x"], "go to https://a.io/xyz now")).toEqual([]);
  });

  it("rejects a URL that is only a prefix of a longer host", () => {
    expect(
      filterUrlsInSource(["https://uniswap.org"], "claim at https://uniswap.org.evil.xyz/claim"),
    ).toEqual([]);
  });

  it("rejects a bare-host URL matching a different path on that host", () => {
    expect(filterUrlsInSource(["https://a.io/"], "see https://a.io/anything-else")).toEqual([]);
    expect(filterUrlsInSource(["https://a.io"], "see https://a.io/anything-else")).toEqual([]);
  });

  it("rejects a URL followed by more query params", () => {
    expect(filterUrlsInSource(["https://a.io/p?a=1"], "https://a.io/p?a=1&amp;b=2")).toEqual([]);
  });

  it("accepts a trailing-slash occurrence followed by a boundary", () => {
    expect(filterUrlsInSource(["https://a.io/x"], "(https://a.io/x/)")).toEqual(["https://a.io/x"]);
    expect(filterUrlsInSource(["https://a.io/x"], "[https://a.io/x/] ok")).toEqual(["https://a.io/x"]);
  });

  it("accepts a URL followed by ] or whitespace or end of text", () => {
    expect(filterUrlsInSource(["https://a.io/x"], "[https://a.io/x]")).toEqual(["https://a.io/x"]);
    expect(filterUrlsInSource(["https://a.io/x"], "https://a.io/x\nnext")).toEqual(["https://a.io/x"]);
    expect(filterUrlsInSource(["https://a.io/x"], "end https://a.io/x")).toEqual(["https://a.io/x"]);
  });

  it("finds a later valid occurrence after an invalid prefix occurrence", () => {
    expect(
      filterUrlsInSource(["https://a.io/x"], "https://a.io/xyz and https://a.io/x, done"),
    ).toEqual(["https://a.io/x"]);
  });
});
