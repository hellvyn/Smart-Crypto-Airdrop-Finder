import { describe, expect, it } from "vitest";
import { selectSpeculativeCandidates } from "../src/collectors/defillama.js";

const base = {
  url: "https://example.org",
  chains: ["Ethereum"],
  tvl: 50_000_000,
  change_7d: 1,
  category: "Dexs",
  gecko_id: null,
  symbol: "-",
};

const opts = { minTvl: 10_000_000, excludedCategories: ["CEX"], limit: 10 };

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
      chains: ["Ethereum"],
      tvl: 50_000_000,
      change7d: 40,
      category: "Dexs",
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

  it("requires tvl strictly above minTvl and a numeric tvl", () => {
    const protocols = [
      { ...base, name: "Edge", slug: "edge", tvl: 10_000_000 },
      { ...base, name: "NullTvl", slug: "null-tvl", tvl: null },
      { ...base, name: "Ok", slug: "ok", tvl: 10_000_001 },
    ];
    expect(selectSpeculativeCandidates(protocols, opts).map((c) => c.slug)).toEqual(["ok"]);
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
});
