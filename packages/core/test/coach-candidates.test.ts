import { describe, expect, it } from "vitest";
import { askedProject, selectCandidates, unfitReason, type Candidate } from "../src/coach/candidates.js";
import { coachProfileSchema, type CoachProfile } from "../src/coach/profile.js";

function cand(over: Partial<Candidate> & { id: string }): Candidate {
  return {
    slug: over.id,
    name: over.id,
    risk: "low",
    worthLevel: "medium",
    tab: "live_now",
    capital: "free",
    capitalMinUsd: null,
    chains: [],
    minutesPerDay: null,
    nextDeadline: null,
    points: [],
    steps: [],
    signalRank: null,
    ...over,
  };
}

function profile(over: Partial<CoachProfile> = {}): CoachProfile {
  return coachProfileSchema.parse({
    level: "intermediate",
    capital_band: "over_1000",
    has_wallet: true,
    wallet_count: 1,
    minutes_per_day: 60,
    goal: "long_term",
    chains: [],
    ...over,
  });
}

const ids = (list: Candidate[]): string[] => list.map((c) => c.id);

describe("selectCandidates capital table", () => {
  const all = [
    cand({ id: "free", capital: "free" }),
    cand({ id: "d5", capital: "deposit", capitalMinUsd: 5 }),
    cand({ id: "d10", capital: "deposit", capitalMinUsd: 10 }),
    cand({ id: "d50", capital: "deposit", capitalMinUsd: 50 }),
    cand({ id: "d100", capital: "deposit", capitalMinUsd: 100 }),
    cand({ id: "d500", capital: "deposit", capitalMinUsd: 500 }),
    cand({ id: "d1000", capital: "deposit", capitalMinUsd: 1000 }),
    cand({ id: "d5000", capital: "deposit", capitalMinUsd: 5000 }),
    cand({ id: "dnull", capital: "deposit", capitalMinUsd: null }),
    cand({ id: "unk", capital: "unknown" }),
  ];
  const pick = (capital_band: CoachProfile["capital_band"], level: CoachProfile["level"] = "intermediate"): string[] =>
    ids(selectCandidates(all, profile({ capital_band, level }))).sort();

  it("free: only the Gratis tag", () => {
    expect(pick("free")).toEqual(["free"]);
  });
  it("gas_only: free plus a stated minimum of at most $10", () => {
    expect(pick("gas_only")).toEqual(["d10", "d5", "free", "unk"]);
  });
  it("up_to_100: free plus a stated minimum of at most $100", () => {
    expect(pick("up_to_100")).toEqual(["d10", "d100", "d5", "d50", "free", "unk"]);
  });
  it("up_to_1000: free plus a stated minimum of at most $1000", () => {
    expect(pick("up_to_1000")).toEqual(["d10", "d100", "d1000", "d5", "d50", "d500", "free", "unk"]);
  });
  it("over_1000: free plus any stated minimum", () => {
    expect(pick("over_1000")).toEqual(["d10", "d100", "d1000", "d5", "d50", "d500", "d5000", "free", "unk"]);
  });
  it("a deposit project with no stated minimum is never picked", () => {
    for (const band of ["gas_only", "up_to_100", "up_to_1000", "over_1000"] as const) {
      expect(pick(band)).not.toContain("dnull");
    }
  });
  it("unknown capital reaches Menengah and Pro (bands above free) but never Pemula", () => {
    expect(pick("up_to_100", "pro")).toContain("unk");
    expect(pick("up_to_100", "intermediate")).toContain("unk");
    expect(pick("up_to_100", "beginner")).not.toContain("unk");
    expect(pick("free", "pro")).not.toContain("unk");
  });
});

describe("selectCandidates level and tab", () => {
  it("a Pemula never gets high or critical risk", () => {
    const all = [
      cand({ id: "low", risk: "low" }),
      cand({ id: "med", risk: "medium" }),
      cand({ id: "hi", risk: "high" }),
      cand({ id: "crit", risk: "critical" }),
      cand({ id: "none", risk: null }),
      cand({ id: "ins", risk: "insufficient_data" }),
    ];
    const got = ids(selectCandidates(all, profile({ level: "beginner" })));
    expect(got).not.toContain("hi");
    expect(got).not.toContain("crit");
    expect(got).toContain("low");
    expect(got).toContain("med");
  });
  it("Menengah and Pro keep high risk", () => {
    const all = [cand({ id: "hi", risk: "high" })];
    expect(ids(selectCandidates(all, profile({ level: "pro" })))).toEqual(["hi"]);
    expect(ids(selectCandidates(all, profile({ level: "intermediate" })))).toEqual(["hi"]);
  });
  it("a Pemula with capital free gets only free", () => {
    const all = [
      cand({ id: "free", capital: "free" }),
      cand({ id: "dep", capital: "deposit", capitalMinUsd: 1 }),
      cand({ id: "unk", capital: "unknown" }),
    ];
    expect(ids(selectCandidates(all, profile({ level: "beginner", capital_band: "free" })))).toEqual(["free"]);
  });
  it("a Pemula never gets unknown capital even with a large budget", () => {
    const all = [cand({ id: "unk", capital: "unknown" }), cand({ id: "ok", capital: "free" })];
    expect(ids(selectCandidates(all, profile({ level: "beginner", capital_band: "over_1000" })))).toEqual(["ok"]);
  });
  it("keeps only live_now and early_bets", () => {
    const all = [cand({ id: "a", tab: "live_now" }), cand({ id: "b", tab: "early_bets" }), cand({ id: "c", tab: "ended" })];
    expect(ids(selectCandidates(all, profile())).sort()).toEqual(["a", "b"]);
  });
});

describe("selectCandidates order", () => {
  it("sorts by worth, then signal rank (lower first, null last), then favourite chain", () => {
    const all = [
      cand({ id: "low", worthLevel: "low" }),
      cand({ id: "ins", worthLevel: "insufficient_data" }),
      cand({ id: "med-s2", worthLevel: "medium", signalRank: 2 }),
      cand({ id: "med-s1", worthLevel: "medium", signalRank: 1 }),
      cand({ id: "med-null", worthLevel: "medium", signalRank: null }),
      cand({ id: "hi-other", worthLevel: "high", signalRank: 1, chains: ["Solana"] }),
      cand({ id: "hi-fav", worthLevel: "high", signalRank: 1, chains: ["base"] }),
    ];
    expect(ids(selectCandidates(all, profile({ chains: ["Base"] })))).toEqual([
      "hi-fav", "hi-other", "med-s1", "med-s2", "med-null", "low", "ins",
    ]);
  });
  it("a favourite chain does not remove the others", () => {
    const all = [cand({ id: "a", chains: ["Solana"] }), cand({ id: "b", chains: ["Base"] })];
    expect(ids(selectCandidates(all, profile({ chains: ["Base"] })))).toEqual(["b", "a"]);
  });
  it("the quick goal puts the nearest deadline first within equal rank; other goals do not", () => {
    const all = [
      cand({ id: "far", nextDeadline: "2026-12-01" }),
      cand({ id: "none", nextDeadline: null }),
      cand({ id: "near", nextDeadline: "2026-10-20" }),
    ];
    expect(ids(selectCandidates(all, profile({ goal: "quick" })))).toEqual(["near", "far", "none"]);
    expect(ids(selectCandidates(all, profile({ goal: "long_term" })))).toEqual(["far", "near", "none"]);
  });
  it("is deterministic whatever the input order", () => {
    const all = [cand({ id: "b" }), cand({ id: "a" }), cand({ id: "c" })];
    expect(ids(selectCandidates([...all].reverse(), profile()))).toEqual(ids(selectCandidates(all, profile())));
  });
  it("caps at 25", () => {
    const all = Array.from({ length: 40 }, (_, i) => cand({ id: `p${String(i).padStart(2, "0")}` }));
    expect(selectCandidates(all, profile())).toHaveLength(25);
  });
});

describe("selectCandidates onlyProjectId", () => {
  it("returns just that project when it passes the filters", () => {
    const all = [cand({ id: "a" }), cand({ id: "b" })];
    expect(ids(selectCandidates(all, profile(), "b"))).toEqual(["b"]);
  });
  it("returns nothing for a project that is not listed or does not pass the member's filters", () => {
    const all = [cand({ id: "a" }), cand({ id: "hi", risk: "high" }), cand({ id: "end", tab: "ended" })];
    expect(selectCandidates(all, profile(), "zzz")).toEqual([]);
    expect(selectCandidates(all, profile({ level: "beginner" }), "hi")).toEqual([]);
    expect(selectCandidates(all, profile(), "end")).toEqual([]);
  });
});

describe("unfitReason and askedProject (Tanya AI about one project)", () => {
  it("names why a listed project is not one to farm for this member, or null when it fits", () => {
    expect(unfitReason(cand({ id: "a" }), profile())).toBeNull();
    expect(unfitReason(cand({ id: "a", tab: "ended" }), profile())).toBe("ended");
    expect(unfitReason(cand({ id: "a", risk: "high" }), profile({ level: "beginner" }))).toBe("beginner_risk");
    expect(unfitReason(cand({ id: "a", capital: "unknown" }), profile({ level: "beginner" }))).toBe("capital_unknown");
    expect(unfitReason(cand({ id: "a", capital: "deposit", capitalMinUsd: 5 }), profile({ capital_band: "free" }))).toBe("deposit_over");
    expect(unfitReason(cand({ id: "a", capital: "deposit", capitalMinUsd: 500 }), profile({ capital_band: "up_to_100" }))).toBe("deposit_over");
    expect(unfitReason(cand({ id: "a", capital: "deposit", capitalMinUsd: null }), profile())).toBe("deposit_unstated");
  });

  it("returns the asked project with its reason even when the profile filters it out, and null for an unknown id", () => {
    const all = [cand({ id: "poly", capital: "unknown" }), cand({ id: "other" })];
    const beginner = profile({ level: "beginner", capital_band: "up_to_100" });
    expect(selectCandidates(all, beginner, "poly")).toEqual([]);
    expect(askedProject(all, beginner, "poly")).toEqual({ candidate: all[0], unfit: "capital_unknown" });
    expect(askedProject(all, beginner, "other")).toEqual({ candidate: all[1], unfit: null });
    expect(askedProject(all, beginner, "missing")).toBeNull();
    // No profile ("Tanya AI" before the form): the project is still answered about; only an ended one is flagged.
    expect(askedProject(all, null, "poly")).toEqual({ candidate: all[0], unfit: null });
    expect(unfitReason(cand({ id: "e", tab: "ended" }), null)).toBe("ended");
  });
});
