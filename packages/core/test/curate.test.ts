import { describe, expect, it } from "vitest";
import { curate, STRONG_SCAM_PATTERNS } from "../src/index.js";
import type { CheckId, CurateInput, NewSignal, RiskCheck } from "../src/index.js";

const ALL_CHECKS: CheckId[] = [
  "dangerous_asks",
  "phishing_list",
  "domain_age",
  "lookalike",
  "token_security",
  "contract_verified",
  "hack_history",
  "corroboration",
];
const checksWithout = (...skipped: CheckId[]): RiskCheck[] =>
  ALL_CHECKS.map((id) => ({ id, ran: !skipped.includes(id) }));

const tvl = (tvl_usd: number, verified = true): NewSignal => ({
  kind: "tvl",
  value: { tvl_usd },
  source: "defillama",
  verified,
});

const passing: CurateInput = {
  status: "live",
  riskLevel: "low",
  checks: checksWithout(),
  lookalikeOf: null,
  hasOfficialDomain: true,
  signals: [tvl(25_000_000)],
  passedBeforeEnd: false,
  aiScamPatterns: [],
};

const codes = (r: ReturnType<typeof curate>) => r.reasons.map((x) => x.code);

describe("curate: passing", () => {
  it("passes a live project that meets every condition, in live_now", () => {
    const r = curate(passing);
    expect(r).toMatchObject({ passed: true, tab: "live_now" });
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.reasons.every((x) => x.kind === "pass")).toBe(true);
  });

  it("puts announced projects in live_now", () => {
    expect(curate({ ...passing, status: "announced" }).tab).toBe("live_now");
  });

  it("puts speculative projects in early_bets", () => {
    expect(curate({ ...passing, status: "speculative" }).tab).toBe("early_bets");
  });

  it("accepts medium risk", () => {
    expect(curate({ ...passing, riskLevel: "medium" }).passed).toBe(true);
  });
});

describe("curate: each failing condition on its own", () => {
  it.each(["ended", "unknown"] as const)("fails with status_not_open for status %s (not passed before)", (status) => {
    expect(curate({ ...passing, status })).toMatchObject({
      passed: false,
      tab: null,
      reasons: [expect.objectContaining({ code: "status_not_open", kind: "fail" })],
    });
  });

  it.each(["high", "critical", "insufficient_data", null] as const)(
    "fails with risk_too_high for risk %s",
    (riskLevel) => {
      expect(curate({ ...passing, riskLevel })).toMatchObject({
        passed: false,
        tab: null,
        reasons: [expect.objectContaining({ code: "risk_too_high" })],
      });
    },
  );

  it("fails with no_legit_signal when there are no signals", () => {
    expect(curate({ ...passing, signals: [] })).toMatchObject({
      passed: false,
      reasons: [expect.objectContaining({ code: "no_legit_signal" })],
    });
  });

  it("fails with no_legit_signal when TVL is under $10M", () => {
    expect(codes(curate({ ...passing, signals: [tvl(9_999_999)] }))).toEqual(["no_legit_signal"]);
  });

  it("passes with TVL of exactly $10M", () => {
    expect(curate({ ...passing, signals: [tvl(10_000_000)] }).passed).toBe(true);
  });

  it("does not accept unverified signals or reported/claimed backers as legit", () => {
    const signals: NewSignal[] = [
      tvl(500_000_000, false),
      { kind: "claimed_backer", value: { investor: "X" }, source: "llm_text", verified: false },
      { kind: "reported_backer", value: { investor: "X", amount_usd: 50_000_000 }, source: "alphadrops", verified: false },
      { kind: "vc_backer", value: { investor: "X", tier: 1 }, source: "vc_portfolio", verified: false },
    ];
    expect(codes(curate({ ...passing, signals }))).toEqual(["no_legit_signal"]);
  });

  it.each<[string, NewSignal]>([
    ["verified vc_backer", { kind: "vc_backer", value: { investor: "X", tier: 2 }, source: "vc_portfolio", verified: true }],
    ["coingecko_listed", { kind: "coingecko_listed", value: { gecko_id: "x" }, source: "defillama", verified: true }],
    ["curated_source", { kind: "curated_source", value: { source_kind: "airdrops_io" }, source: "airdrops_io", verified: false }],
  ])("accepts %s as the legit signal", (_name, signal) => {
    expect(curate({ ...passing, signals: [signal] }).passed).toBe(true);
  });

  it("fails with lookalike when lookalikeOf is set", () => {
    expect(curate({ ...passing, lookalikeOf: "proj-1" })).toMatchObject({
      passed: false,
      reasons: [expect.objectContaining({ code: "lookalike" })],
    });
  });

  it.each<CheckId>(["dangerous_asks", "lookalike", "domain_age", "phishing_list"])(
    "fails with insufficient_checks when %s did not run",
    (id) => {
      expect(curate({ ...passing, checks: checksWithout(id) })).toMatchObject({
        passed: false,
        reasons: [expect.objectContaining({ code: "insufficient_checks" })],
      });
    },
  );

  it("fails with insufficient_checks when key checks are missing from the list", () => {
    expect(codes(curate({ ...passing, checks: [] }))).toEqual(["insufficient_checks"]);
  });

  it("does not need non-key checks to have run", () => {
    const checks = checksWithout("token_security", "contract_verified", "hack_history", "corroboration");
    expect(curate({ ...passing, checks }).passed).toBe(true);
  });

  it("fails with a single insufficient_checks when the project has no official domain", () => {
    expect(codes(curate({ ...passing, hasOfficialDomain: false, checks: checksWithout("domain_age", "phishing_list") }))).toEqual([
      "insufficient_checks",
    ]);
  });

  it("fails with insufficient_checks when there is no official domain even if every check ran", () => {
    expect(codes(curate({ ...passing, hasOfficialDomain: false }))).toEqual(["insufficient_checks"]);
  });

  it("fails with scam_pattern on a strong AI scam pattern even when risk is medium", () => {
    expect(curate({ ...passing, riskLevel: "medium", aiScamPatterns: ["impersonation"] })).toMatchObject({
      passed: false,
      tab: null,
      reasons: [expect.objectContaining({ code: "scam_pattern" })],
    });
  });

  it.each(["secret_request", "payment_request", "impersonation", "fake_support"])(
    "treats %s as a strong scam pattern",
    (pattern) => {
      expect(codes(curate({ ...passing, aiScamPatterns: [pattern] }))).toEqual(["scam_pattern"]);
    },
  );

  it("exports exactly the four strong patterns", () => {
    expect([...STRONG_SCAM_PATTERNS].sort()).toEqual(["fake_support", "impersonation", "payment_request", "secret_request"]);
  });

  it("does not fail on weak AI scam patterns alone", () => {
    expect(curate({ ...passing, aiScamPatterns: ["urgency", "connect_wallet_to_check", "other"] }).passed).toBe(true);
  });

  it("fails on a strong pattern mixed with weak ones", () => {
    expect(codes(curate({ ...passing, aiScamPatterns: ["urgency", "fake_support"] }))).toEqual(["scam_pattern"]);
  });
});

describe("curate: failure reporting", () => {
  it("reports every failing condition and leaves tab null", () => {
    const r = curate({ ...passing, riskLevel: "high", signals: [], lookalikeOf: "p", aiScamPatterns: ["secret_request"] });
    expect(r.passed).toBe(false);
    expect(r.tab).toBeNull();
    expect(codes(r).sort()).toEqual(["lookalike", "no_legit_signal", "risk_too_high", "scam_pattern"]);
    expect(r.reasons.every((x) => x.kind === "fail" && x.message.length > 0)).toBe(true);
  });

  it("never gives a failed speculative project a tab", () => {
    expect(curate({ ...passing, status: "speculative", riskLevel: "critical" }).tab).toBeNull();
  });

  it("never gives a failed live project a tab", () => {
    expect(curate({ ...passing, status: "live", lookalikeOf: "p" }).tab).toBeNull();
  });
});

describe("curate: ended projects (#40)", () => {
  const ended: CurateInput = { ...passing, status: "ended", passedBeforeEnd: true };

  it("keeps an ended project that passed before it ended, in the ended tab", () => {
    const r = curate({
      ...ended,
      checks: checksWithout("domain_age"),
      riskLevel: "insufficient_data",
      signals: [],
      hasOfficialDomain: false,
    });
    expect(r).toMatchObject({
      passed: true,
      tab: "ended",
      reasons: [expect.objectContaining({ code: "ended_after_curation", kind: "pass" })],
    });
  });

  it("hides an ended project that never passed", () => {
    expect(curate({ ...ended, passedBeforeEnd: false })).toMatchObject({
      passed: false,
      tab: null,
      reasons: [expect.objectContaining({ code: "status_not_open" })],
    });
  });

  it.each(["high", "critical"] as const)("hides an ended project whose risk became %s", (riskLevel) => {
    expect(curate({ ...ended, riskLevel })).toMatchObject({
      passed: false,
      tab: null,
      reasons: [expect.objectContaining({ code: "risk_too_high" })],
    });
  });

  it("keeps an ended project at medium risk", () => {
    expect(curate({ ...ended, riskLevel: "medium" }).passed).toBe(true);
  });

  it("hides an ended project that became a lookalike", () => {
    expect(codes(curate({ ...ended, lookalikeOf: "p" }))).toEqual(["lookalike"]);
  });

  it("hides an ended project with a strong AI scam pattern", () => {
    expect(curate({ ...ended, aiScamPatterns: ["payment_request"] })).toMatchObject({
      passed: false,
      tab: null,
      reasons: [expect.objectContaining({ code: "scam_pattern" })],
    });
  });

  it("keeps an ended project with a weak AI scam pattern", () => {
    expect(curate({ ...ended, aiScamPatterns: ["urgency"] }).passed).toBe(true);
  });

  it("ignores passedBeforeEnd for open projects", () => {
    expect(curate({ ...passing, passedBeforeEnd: true }).tab).toBe("live_now");
  });

  it("does not let passedBeforeEnd rescue an unknown status", () => {
    expect(curate({ ...passing, status: "unknown", passedBeforeEnd: true }).passed).toBe(false);
  });
});
