import { describe, expect, it } from "vitest";
import { worth } from "../src/index.js";
import type { NewSignal, WorthInput, WorthLevel } from "../src/index.js";

const vc = (tier: number, verified = true): NewSignal => ({
  kind: "vc_backer",
  value: { investor: "Fund", tier },
  source: "vc_portfolio",
  verified,
});
const tvl = (tvl_usd: number, verified = true): NewSignal => ({
  kind: "tvl",
  value: { tvl_usd },
  source: "defillama",
  verified,
});
const gecko: NewSignal = { kind: "coingecko_listed", value: { gecko_id: "x" }, source: "defillama", verified: true };
const curated: NewSignal = {
  kind: "curated_source",
  value: { source_kind: "airdrops_io" },
  source: "airdrops_io",
  verified: false,
};
const reported = (amount_usd: unknown): NewSignal => ({
  kind: "reported_backer",
  value: { investor: "Fund", lead: true, amount_usd },
  source: "alphadrops",
  verified: false,
});

// Baseline: token already traded (tgePassed), one source, no capital, few tasks -> 0 points.
const base: WorthInput = {
  signals: [curated],
  tgePassed: true,
  sourceCount: 1,
  capitalRequired: "none",
  taskCount: 3,
  aiVerdict: null,
};
const w = (over: Partial<WorthInput>) => worth({ ...base, ...over });
const rank = (l: WorthLevel) => ({ insufficient_data: 0, low: 1, medium: 2, high: 3 })[l];
const codes = (r: ReturnType<typeof worth>) => r.reasons.map((x) => x.code);

describe("worth: factors", () => {
  it("scores the baseline at zero", () => {
    expect(w({})).toMatchObject({ points: 0, level: "low" });
  });

  it("gives +3 for a verified tier 1 VC and +2 for any other tier", () => {
    expect(w({ signals: [vc(1)] }).points).toBe(3);
    expect(w({ signals: [vc(2)] }).points).toBe(2);
    expect(w({ signals: [vc(3)] }).points).toBe(2);
  });

  it("ignores an unverified vc_backer", () => {
    expect(w({ signals: [vc(1, false), curated] }).points).toBe(0);
  });

  it("takes the highest VC tier and does not add VCs together", () => {
    expect(w({ signals: [vc(2), vc(1), vc(2)] }).points).toBe(3);
  });

  it("gives +1 for TVL >= $10M, +2 for >= $100M, 0 below", () => {
    expect(w({ signals: [tvl(9_999_999)] }).points).toBe(0);
    expect(w({ signals: [tvl(10_000_000)] }).points).toBe(1);
    expect(w({ signals: [tvl(99_999_999)] }).points).toBe(1);
    expect(w({ signals: [tvl(100_000_000)] }).points).toBe(2);
  });

  it("ignores unverified TVL", () => {
    expect(w({ signals: [tvl(500_000_000, false), curated] }).points).toBe(0);
  });

  it("gives +2 when no token trades: not coingecko_listed and TGE not passed", () => {
    expect(w({ tgePassed: false }).points).toBe(2);
  });

  it("gives no 'no token yet' points when TGE passed or the token is listed", () => {
    expect(w({ tgePassed: true }).points).toBe(0);
    expect(w({ tgePassed: false, signals: [gecko] }).points).toBe(0);
  });

  it("gives +1 for more than one independent source", () => {
    expect(w({ sourceCount: 1 }).points).toBe(0);
    expect(w({ sourceCount: 2 }).points).toBe(1);
  });

  it("gives +1 for reported funding of $5M or more, nothing below or malformed", () => {
    expect(w({ signals: [reported(5_000_000)] }).points).toBe(1);
    expect(w({ signals: [reported(4_999_999)] }).points).toBe(0);
    expect(w({ signals: [reported(null)] }).points).toBe(0);
    expect(w({ signals: [reported("9000000")] }).points).toBe(0);
  });

  it("does not add reported funding on top of a verified tier 1 VC", () => {
    expect(w({ signals: [vc(1), reported(50_000_000)] }).points).toBe(3);
  });

  it("does not add reported funding on top of a verified tier 2 VC", () => {
    expect(w({ signals: [vc(2), reported(50_000_000)] }).points).toBe(2);
  });

  it("subtracts for capital: high -2, low -1, none and unknown 0", () => {
    expect(w({ capitalRequired: "high" }).points).toBe(-2);
    expect(w({ capitalRequired: "low" }).points).toBe(-1);
    expect(w({ capitalRequired: "none" }).points).toBe(0);
    expect(w({ capitalRequired: "unknown" }).points).toBe(0);
  });

  it("subtracts 1 for more than 8 tasks", () => {
    expect(w({ taskCount: 8 }).points).toBe(0);
    expect(w({ taskCount: 9 }).points).toBe(-1);
  });

  it("adds the factors up", () => {
    // vc tier 1 (+3) + tvl 100M (+2) + no token (+2) + 2 sources (+1) - high capital (-2) - 9 tasks (-1)
    const r = w({
      signals: [vc(1), tvl(100_000_000)],
      tgePassed: false,
      sourceCount: 2,
      capitalRequired: "high",
      taskCount: 9,
    });
    expect(r.points).toBe(5);
  });

  it("explains each factor with a worth reason", () => {
    const r = w({
      signals: [vc(1), tvl(100_000_000)],
      tgePassed: false,
      sourceCount: 2,
      capitalRequired: "high",
      taskCount: 9,
    });
    expect(r.reasons.every((x) => x.kind === "worth" && x.message.length > 0)).toBe(true);
    expect(codes(r).sort()).toEqual(
      ["capital_high", "many_tasks", "multiple_sources", "no_token_yet", "tvl_very_high", "vc_backer"].sort(),
    );
  });

  it("says when capital is unknown", () => {
    expect(codes(w({ capitalRequired: "unknown", signals: [vc(2)] }))).toContain("capital_unknown");
  });
});

describe("worth: levels", () => {
  it("is high at 4 points", () => {
    expect(w({ signals: [vc(1)], sourceCount: 2 })).toMatchObject({ points: 4, level: "high" });
  });

  it("is medium at 3 points", () => {
    expect(w({ signals: [vc(1)] })).toMatchObject({ points: 3, level: "medium" });
  });

  it("is medium at 2 points", () => {
    expect(w({ signals: [vc(2)] })).toMatchObject({ points: 2, level: "medium" });
  });

  it("is low at 1 point and below", () => {
    expect(w({ signals: [tvl(10_000_000)] })).toMatchObject({ points: 1, level: "low" });
    expect(w({ signals: [vc(2)], capitalRequired: "high" })).toMatchObject({ points: 0, level: "low" });
  });

  it("is insufficient_data when the only potential signal is curated_source and capital is unknown", () => {
    expect(w({ signals: [curated], capitalRequired: "unknown", tgePassed: false }).level).toBe("insufficient_data");
  });

  it("is insufficient_data with no signals and unknown capital", () => {
    expect(w({ signals: [], capitalRequired: "unknown" }).level).toBe("insufficient_data");
  });

  it("is not insufficient_data once capital is known", () => {
    expect(w({ signals: [curated], capitalRequired: "none", tgePassed: false }).level).toBe("medium");
  });

  it("is not insufficient_data when a real potential signal exists", () => {
    expect(w({ signals: [curated, tvl(50_000_000)], capitalRequired: "unknown" }).level).toBe("low");
    expect(w({ signals: [gecko], capitalRequired: "unknown" }).level).not.toBe("insufficient_data");
    expect(w({ signals: [curated, reported(6_000_000)], capitalRequired: "unknown" }).level).not.toBe(
      "insufficient_data",
    );
  });

  it("does not count an unverified vc_backer as a potential signal", () => {
    expect(w({ signals: [curated, vc(1, false)], capitalRequired: "unknown" }).level).toBe("insufficient_data");
  });
});

describe("worth: AI verdict can only lower the level", () => {
  const medium: Partial<WorthInput> = { signals: [vc(1)] }; // 3 points
  const high: Partial<WorthInput> = { signals: [vc(1)], sourceCount: 2, tgePassed: false }; // 6 points
  const low: Partial<WorthInput> = { signals: [tvl(10_000_000)] }; // 1 point

  it("garap and null leave points unchanged", () => {
    expect(w({ ...medium, aiVerdict: "garap" })).toMatchObject({ points: 3, level: "medium" });
    expect(w({ ...medium, aiVerdict: null })).toMatchObject({ points: 3, level: "medium" });
  });

  it("pantau subtracts 1", () => {
    expect(w({ ...medium, aiVerdict: "pantau" })).toMatchObject({ points: 2, level: "medium" });
    expect(w({ signals: [vc(1)], sourceCount: 2, aiVerdict: "pantau" })).toMatchObject({ points: 3, level: "medium" });
  });

  it("skip subtracts 2 and can lower the level", () => {
    expect(w({ ...medium, aiVerdict: "skip" })).toMatchObject({ points: 1, level: "low" });
    expect(w({ ...high, aiVerdict: "skip" })).toMatchObject({ points: 4, level: "high" });
  });

  it("explains a lowering verdict and stays silent for garap and null", () => {
    expect(codes(w({ ...medium, aiVerdict: "skip" }))).toContain("ai_skip");
    expect(codes(w({ ...medium, aiVerdict: "pantau" }))).toContain("ai_pantau");
    expect(codes(w({ ...medium, aiVerdict: "garap" })).some((c) => c.startsWith("ai_"))).toBe(false);
    expect(codes(w({ ...medium, aiVerdict: null })).some((c) => c.startsWith("ai_"))).toBe(false);
  });

  it("never raises the level or the points because of the AI verdict, for any input", () => {
    const inputs: Partial<WorthInput>[] = [
      low,
      medium,
      high,
      { signals: [], capitalRequired: "unknown" },
      { capitalRequired: "high", taskCount: 12 },
    ];
    for (const input of inputs) {
      const without = w({ ...input, aiVerdict: null });
      for (const verdict of ["garap", "pantau", "skip"] as const) {
        const withAi = w({ ...input, aiVerdict: verdict });
        expect(rank(withAi.level)).toBeLessThanOrEqual(rank(without.level));
        expect(withAi.points).toBeLessThanOrEqual(without.points);
      }
    }
  });

  it("keeps insufficient_data regardless of the verdict", () => {
    expect(w({ signals: [curated], capitalRequired: "unknown", aiVerdict: "skip" }).level).toBe("insufficient_data");
    expect(w({ signals: [curated], capitalRequired: "unknown", aiVerdict: "garap" }).level).toBe("insufficient_data");
  });
});
