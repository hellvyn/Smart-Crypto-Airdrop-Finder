import { describe, expect, it } from "vitest";
import { parseProtocols, selectSpeculativeCandidates } from "../src/collectors/defillama.js";

const base = {
  url: "https://example.org",
  chains: ["Ethereum"],
  tvl: 50_000_000,
  change_7d: 1,
  category: "Dexs",
  gecko_id: null,
  symbol: "-",
};

const NOW = new Date("2026-10-10T00:00:00Z");
const DAY_S = 86_400;
const daysAgo = (n: number): number => NOW.getTime() / 1000 - n * DAY_S;

const opts = { minTvl: 10_000_000, excludedCategories: ["CEX"], limit: 10, newWithinDays: 180, now: NOW };
/** The production defaults (spec 15.1). */
const v2 = { minTvl: 1_000_000, excludedCategories: ["CEX"], limit: 80, newWithinDays: 180, now: NOW };
const proto = (name: string, extra: Record<string, unknown> = {}) => ({
  ...base,
  name,
  slug: name.toLowerCase(),
  ...extra,
});

describe("selectSpeculativeCandidates", () => {
  it("drops tokened, low-TVL and excluded-category protocols and sorts the rest", () => {
    const protocols = [
      { ...base, name: "HasToken", slug: "has-token", gecko_id: "has-token" },
      { ...base, name: "LowTvl", slug: "low-tvl", tvl: 5_000_000 },
      { ...base, name: "Exchange", slug: "exchange", category: "CEX" },
      { ...base, name: "NullChange", slug: "null-change", change_7d: null },
      { ...base, name: "Low", slug: "low", change_7d: 2 },
      { ...base, name: "High", slug: "high", change_7d: 40 },
    ];
    const result = selectSpeculativeCandidates(protocols, opts);
    expect(result.map((c) => c.slug)).toEqual(["high", "low", "null-change"]);
    expect(result[0]).toEqual({
      name: "High",
      slug: "high",
      url: "https://example.org",
      twitter: null,
      chains: ["Ethereum"],
      tvl: 50_000_000,
      change7d: 40,
      category: "Dexs",
      listedAt: null,
    });
    expect(result[2]?.change7d).toBeNull();
  });

  it("drops protocols with a real symbol or empty-string gecko_id handling", () => {
    const protocols = [
      { ...base, name: "Sym", slug: "sym", symbol: "SYM" },
      { ...base, name: "EmptyGecko", slug: "empty-gecko", gecko_id: "" },
    ];
    expect(selectSpeculativeCandidates(protocols, opts).map((c) => c.slug)).toEqual(["empty-gecko"]);
  });

  it("requires tvl of at least minTvl and a numeric tvl", () => {
    const protocols = [
      { ...base, name: "Below", slug: "below", tvl: 9_999_999 },
      { ...base, name: "Edge", slug: "edge", tvl: 10_000_000 },
      { ...base, name: "NullTvl", slug: "null-tvl", tvl: null },
    ];
    expect(selectSpeculativeCandidates(protocols, opts).map((c) => c.slug)).toEqual(["edge"]);
  });

  it("compares excluded categories case-insensitively", () => {
    const protocols = [{ ...base, name: "Exchange", slug: "exchange", category: "cex" }];
    expect(selectSpeculativeCandidates(protocols, opts)).toEqual([]);
  });

  it("normalizes empty url to null and missing or non-finite change to null", () => {
    const { change_7d: _omit, ...noChange } = base;
    const protocols = [
      { ...base, name: "A", slug: "a", url: "" },
      { ...noChange, name: "B", slug: "b", url: null },
      { ...base, name: "C", slug: "c", change_7d: null },
    ];
    const result = selectSpeculativeCandidates(protocols, opts);
    const a = result.find((c) => c.slug === "a");
    expect(a?.url).toBeNull();
    expect(a?.change7d).toBe(1);
    expect(result.find((c) => c.slug === "b")?.change7d).toBeNull();
    expect(result.find((c) => c.slug === "c")?.change7d).toBeNull();
  });

  it("keeps a valid twitter handle without '@' and drops invalid ones", () => {
    const protocols = [
      { ...base, name: "A", slug: "a", twitter: "hyperdrive_fi" },
      { ...base, name: "B", slug: "b", twitter: "@HyperDrive" },
      { ...base, name: "C", slug: "c", twitter: "https://x.com/evil" },
      { ...base, name: "D", slug: "d", twitter: "" },
      { ...base, name: "E", slug: "e" },
    ];
    const handles = Object.fromEntries(selectSpeculativeCandidates(protocols, opts).map((c) => [c.slug, c.twitter]));
    expect(handles).toEqual({ a: "hyperdrive_fi", b: "HyperDrive", c: null, d: null, e: null });
  });

  it("breaks change7d ties by tvl desc and applies limit after sorting", () => {
    const protocols = [
      { ...base, name: "Small", slug: "small", tvl: 20_000_000, change_7d: 5 },
      { ...base, name: "Big", slug: "big", tvl: 90_000_000, change_7d: 5 },
      { ...base, name: "Top", slug: "top", tvl: 11_000_000, change_7d: 30 },
    ];
    const result = selectSpeculativeCandidates(protocols, { ...opts, limit: 2 });
    expect(result.map((c) => c.slug)).toEqual(["top", "big"]);
  });

  it("silently skips malformed items", () => {
    const protocols: unknown[] = [
      null,
      "nope",
      42,
      { name: "NoSlug", chains: [], tvl: 50_000_000, category: "Dexs", symbol: "-" },
      { ...base, name: "Bad", slug: "bad", chains: "Ethereum" },
      { ...base, name: "Good", slug: "good" },
    ];
    expect(selectSpeculativeCandidates(protocols, opts).map((c) => c.slug)).toEqual(["good"]);
  });

  it("keeps young protocols above $1M and drops rugged, dead and misrepresented ones", () => {
    const out = selectSpeculativeCandidates(
      [
        proto("Young", { tvl: 2e6, listedAt: daysAgo(30) }),
        proto("Old", { tvl: 5e7, listedAt: daysAgo(900), change_7d: 50 }),
        proto("Rug", { tvl: 9e6, rugged: true }),
        proto("Dead", { tvl: 9e6, deadFrom: "2026-01-01" }),
        proto("Mis", { tvl: 9e6, misrepresentedTokens: true }),
        proto("Tiny", { tvl: 9e5 }),
      ],
      v2,
    );
    expect(out.map((c) => c.name)).toEqual(["Young", "Old"]);
  });

  it("keeps protocols whose rugged, deadFrom and misrepresentedTokens are false or null", () => {
    const out = selectSpeculativeCandidates(
      [proto("Clean", { rugged: false, deadFrom: null, misrepresentedTokens: false })],
      v2,
    );
    expect(out.map((c) => c.name)).toEqual(["Clean"]);
  });

  it("puts protocols listed within newWithinDays first, then change7d desc (nulls last), then tvl desc", () => {
    const out = selectSpeculativeCandidates(
      [
        proto("OldHot", { listedAt: daysAgo(400), change_7d: 90 }),
        proto("NewFlat", { listedAt: daysAgo(10), change_7d: 1, tvl: 2e6 }),
        proto("NewNull", { listedAt: daysAgo(10), change_7d: null }),
        proto("NewHot", { listedAt: daysAgo(100), change_7d: 30 }),
        proto("NewTie", { listedAt: daysAgo(5), change_7d: 1, tvl: 8e6 }),
        proto("NoDate", { change_7d: 60 }),
      ],
      v2,
    );
    expect(out.map((c) => c.name)).toEqual(["NewHot", "NewTie", "NewFlat", "NewNull", "OldHot", "NoDate"]);
  });

  it("treats the newWithinDays boundary as young and one day beyond as old", () => {
    const out = selectSpeculativeCandidates(
      [
        proto("Beyond", { listedAt: daysAgo(181), change_7d: 99 }),
        proto("Edge", { listedAt: daysAgo(180), change_7d: 1 }),
      ],
      v2,
    );
    expect(out.map((c) => c.name)).toEqual(["Edge", "Beyond"]);
  });

  it("exposes listedAt as a Date, or null when DefiLlama gives no usable listing time", () => {
    const out = selectSpeculativeCandidates(
      [
        proto("Dated", { listedAt: 1_760_000_000 }),
        proto("Missing"),
        proto("Zero", { listedAt: 0 }),
        proto("OutOfRange", { listedAt: 1e20 }),
      ],
      v2,
    );
    const byName = Object.fromEntries(out.map((c) => [c.name, c.listedAt]));
    expect(byName).toEqual({ Dated: new Date("2025-10-09T08:53:20Z"), Missing: null, Zero: null, OutOfRange: null });
  });

  it("caps at the limit", () => {
    const protocols = Array.from({ length: 100 }, (_, i) => proto(`P${i}`, { change_7d: i }));
    const out = selectSpeculativeCandidates(protocols, v2);
    expect(out).toHaveLength(80);
    expect(out[0]?.name).toBe("P99");
  });
});

describe("parseProtocols", () => {
  it("keeps every protocol, tokened ones included, with url, TVL, CoinGecko id and logo URL", () => {
    const raw = [
      { ...base, name: "Speculative", slug: "speculative", url: "https://spec.xyz", tvl: 2_000_000, logo: "https://icons.llama.fi/speculative.png" },
      { ...base, name: "Tokened", slug: "tokened", url: "https://tok.xyz", tvl: 9e8, gecko_id: "tokened", symbol: "TOK" },
      { ...base, name: "Exchange", slug: "exchange", category: "CEX", url: "https://cex.com", rugged: true },
    ];
    expect(parseProtocols(raw)).toEqual([
      { name: "Speculative", url: "https://spec.xyz", tvl: 2_000_000, geckoId: null, logo: "https://icons.llama.fi/speculative.png" },
      { name: "Tokened", url: "https://tok.xyz", tvl: 9e8, geckoId: "tokened", logo: null },
      { name: "Exchange", url: "https://cex.com", tvl: 50_000_000, geckoId: null, logo: null },
    ]);
  });

  it("turns missing, empty or non-finite fields into null", () => {
    const raw = [
      { name: "NoUrl", url: "", tvl: null, gecko_id: "", logo: "" },
      { name: "Missing" },
      { name: "WrongTypes", url: 7, tvl: "12", gecko_id: 3, logo: 5 },
      { name: "Infinite", url: "https://inf.xyz", tvl: Number.POSITIVE_INFINITY, gecko_id: null },
    ];
    expect(parseProtocols(raw)).toEqual([
      { name: "NoUrl", url: null, tvl: null, geckoId: null, logo: null },
      { name: "Missing", url: null, tvl: null, geckoId: null, logo: null },
      { name: "WrongTypes", url: null, tvl: null, geckoId: null, logo: null },
      { name: "Infinite", url: "https://inf.xyz", tvl: null, geckoId: null, logo: null },
    ]);
  });

  it("skips entries without a name, and returns [] for anything but an array", () => {
    expect(parseProtocols([null, "x", { url: "https://a.xyz" }, { name: "" }, { name: "Ok" }])).toEqual([
      { name: "Ok", url: null, tvl: null, geckoId: null, logo: null },
    ]);
    expect(parseProtocols({ protocols: [] })).toEqual([]);
    expect(parseProtocols(null)).toEqual([]);
  });
});
