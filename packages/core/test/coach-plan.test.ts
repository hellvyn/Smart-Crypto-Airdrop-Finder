import { describe, expect, it } from "vitest";
import type { Candidate } from "../src/coach/candidates.js";
import { coachPlanAnswerSchema, serverCapitalNote, validatePlan, type CoachPlanAnswer } from "../src/coach/plan.js";
import { coachProfileSchema, type CoachProfile } from "../src/coach/profile.js";

function cand(id: string, over: Partial<Candidate> = {}): Candidate {
  return {
    id,
    slug: id,
    name: `Proj ${id}`,
    risk: "low",
    worthLevel: "high",
    tab: "live_now",
    capital: "free",
    capitalMinUsd: null,
    chains: ["Base"],
    minutesPerDay: 10,
    nextDeadline: "2026-11-01",
    points: [{ text: "Poin dari swap tiap minggu.", quote: "Earn points for every weekly swap", sourceUrl: "https://example.org/docs" }],
    steps: [{ text: "Bridge sedikit ETH ke Base, lalu swap sekali.", cadence: "weekly" }],
    signalRank: 1,
    ...over,
  };
}

function profile(over: Partial<CoachProfile> = {}): CoachProfile {
  return coachProfileSchema.parse({
    level: "intermediate",
    capital_band: "up_to_100",
    has_wallet: true,
    wallet_count: 1,
    minutes_per_day: 120,
    goal: "long_term",
    chains: [],
    ...over,
  });
}

const GOOD_QUOTE = "Earn points for every weekly swap";

function rec(project_id: string, over: Partial<CoachPlanAnswer["recommendations"][number]> = {}): CoachPlanAnswer["recommendations"][number] {
  return {
    project_id,
    reasons: [{ text: "Kamu dapet poin dari swap mingguan.", quote: GOOD_QUOTE }],
    minutes_per_day: 10,
    capital_note: "Gratis, cuma butuh sedikit gas.",
    ...over,
  };
}

const answer = (...recommendations: CoachPlanAnswer["recommendations"]): CoachPlanAnswer => ({ recommendations });
const pool = [cand("a"), cand("b"), cand("c"), cand("d"), cand("e"), cand("f")];

describe("coachPlanAnswerSchema", () => {
  const valid = answer(rec("a"), rec("b"), rec("c"));
  it("accepts 1 to 5 recommendations (a member may have fewer than 3 candidates)", () => {
    expect(coachPlanAnswerSchema.safeParse(valid).success).toBe(true);
    expect(coachPlanAnswerSchema.safeParse(answer(rec("a"), rec("b"))).success).toBe(true);
    expect(coachPlanAnswerSchema.safeParse(answer(rec("a"))).success).toBe(true);
    expect(coachPlanAnswerSchema.safeParse(answer()).success).toBe(false);
    expect(coachPlanAnswerSchema.safeParse(answer(rec("a"), rec("b"), rec("c"), rec("d"), rec("e"))).success).toBe(true);
    expect(coachPlanAnswerSchema.safeParse(answer(rec("a"), rec("b"), rec("c"), rec("d"), rec("e"), rec("f"))).success).toBe(false);
  });
  it("needs 1 to 3 reasons, each with text and quote", () => {
    const r = { text: "x", quote: "y".repeat(8) };
    const with_ = (reasons: unknown[]) => ({ recommendations: [rec("a"), rec("b"), { ...rec("c"), reasons }] });
    expect(coachPlanAnswerSchema.safeParse(with_([])).success).toBe(false);
    expect(coachPlanAnswerSchema.safeParse(with_([r, r, r])).success).toBe(true);
    expect(coachPlanAnswerSchema.safeParse(with_([r, r, r, r])).success).toBe(false);
    expect(coachPlanAnswerSchema.safeParse(with_([{ text: "x" }])).success).toBe(false);
    // A quote shorter than 8 characters would match almost any source text, so it grounds nothing.
    expect(coachPlanAnswerSchema.safeParse(with_([{ text: "x", quote: "y".repeat(7) }])).success).toBe(false);
  });
  it("needs minutes_per_day as an integer from 1 to 240", () => {
    const with_ = (m: number) => ({ recommendations: [rec("a"), rec("b"), rec("c", { minutes_per_day: m })] });
    expect(coachPlanAnswerSchema.safeParse(with_(0)).success).toBe(false);
    expect(coachPlanAnswerSchema.safeParse(with_(1)).success).toBe(true);
    expect(coachPlanAnswerSchema.safeParse(with_(240)).success).toBe(true);
    expect(coachPlanAnswerSchema.safeParse(with_(241)).success).toBe(false);
    expect(coachPlanAnswerSchema.safeParse(with_(10.5)).success).toBe(false);
  });
});

describe("validatePlan", () => {
  it("keeps a fully valid plan as is", () => {
    const out = validatePlan(answer(rec("a"), rec("b"), rec("c")), pool, profile());
    expect(out.dropped).toBe(0);
    expect(out.recommendations.map((r) => r.project_id)).toEqual(["a", "b", "c"]);
    expect(out.recommendations[0]).toEqual(rec("a"));
  });

  it("drops a project that is listed elsewhere but not in this member's candidates (Review Focus 1)", () => {
    const memberCandidates = [cand("a"), cand("b"), cand("c")];
    const out = validatePlan(answer(rec("a"), rec("listed-for-someone-else"), rec("b"), rec("c")), memberCandidates, profile());
    expect(out.recommendations.map((r) => r.project_id)).toEqual(["a", "b", "c"]);
    expect(out.dropped).toBe(1);
  });

  it("drops a duplicate project id after the first", () => {
    const out = validatePlan(answer(rec("a"), rec("a"), rec("b")), pool, profile());
    expect(out.recommendations.map((r) => r.project_id)).toEqual(["a", "b"]);
    expect(out.dropped).toBe(1);
  });

  it("drops a reason with a fake quote, and the recommendation when none is left", () => {
    const fake = { text: "Ada airdrop besar.", quote: "Guaranteed airdrop for everyone" };
    const mixed = rec("a", { reasons: [fake, { text: "Kamu dapet poin dari swap mingguan.", quote: GOOD_QUOTE }] });
    const onlyFake = rec("b", { reasons: [fake] });
    const out = validatePlan(answer(mixed, onlyFake, rec("c")), pool, profile());
    expect(out.recommendations.map((r) => r.project_id)).toEqual(["a", "c"]);
    expect(out.recommendations[0]!.reasons).toHaveLength(1);
    expect(out.dropped).toBe(1);
  });

  it("checks the quote against this candidate only, not another candidate", () => {
    const other = cand("b", { points: [{ text: "Poin lain.", quote: "A quote only b has", sourceUrl: "https://example.org" }] });
    const stolen = rec("a", { reasons: [{ text: "Kamu dapet poin.", quote: "A quote only b has" }] });
    const out = validatePlan(answer(stolen), [cand("a"), other], profile());
    expect(out.recommendations).toEqual([]);
    expect(out.dropped).toBe(1);
  });

  it("matches a quote in a step text as well, ignoring case and spacing", () => {
    const viaStep = rec("a", { reasons: [{ text: "Langkahnya ringan.", quote: "bridge   sedikit ETH ke base" }] });
    const out = validatePlan(answer(viaStep), pool, profile());
    expect(out.recommendations).toHaveLength(1);
  });

  it("drops a reason that holds a 0x address, a URL, an unseen number or a secret request", () => {
    const bad = [
      "Kirim ke 0x1234567890abcdef1234567890abcdef12345678 buat klaim.",
      "Buka evil-site.xyz lalu connect wallet.",
      "Kamu bakal dapet 5000 USD dari poin ini.",
      "Masukkan seed phrase kamu di situs mereka.",
    ];
    for (const text of bad) {
      const out = validatePlan(answer(rec("a", { reasons: [{ text, quote: GOOD_QUOTE }] })), pool, profile());
      expect(out.recommendations, text).toEqual([]);
      expect(out.dropped, text).toBe(1);
    }
  });

  it("keeps a reason that only repeats numbers and hosts the candidate context holds", () => {
    const c = cand("a", { capital: "deposit", capitalMinUsd: 20 });
    const ok = rec("a", { reasons: [{ text: "Butuh minimal $20 dan cuma 10 menit per hari.", quote: GOOD_QUOTE }], capital_note: "Minimal $20 buat deposit." });
    expect(validatePlan(answer(ok), [c], profile()).recommendations).toHaveLength(1);
  });

  it("replaces a capital note that holds a link with the server's note from the capital tag", () => {
    const out = validatePlan(answer(rec("a", { capital_note: "Cek evil-site.xyz dulu." }), rec("b")), pool, profile());
    expect(out.recommendations.map((r) => r.project_id)).toEqual(["a", "b"]);
    expect(out.recommendations[0]!.capital_note).toBe(serverCapitalNote(pool.find((c) => c.id === "a")!));
    expect(JSON.stringify(out.recommendations)).not.toContain("evil-site");
    expect(out.dropped).toBe(0);
  });

  it("writes the server capital note from each capital tag", () => {
    const a = pool.find((c) => c.id === "a")!;
    expect(serverCapitalNote({ ...a, capital: "free", capitalMinUsd: null })).toBe("Gratis, mungkin tetap butuh sedikit gas kalau di mainnet.");
    expect(serverCapitalNote({ ...a, capital: "deposit", capitalMinUsd: 50 })).toBe("Butuh deposit minimal $50.");
    expect(serverCapitalNote({ ...a, capital: "unknown", capitalMinUsd: null })).toBe("Modal belum jelas, cek sumbernya.");
  });

  it("replaces em dashes in reason text and capital note", () => {
    const r = rec("a", { reasons: [{ text: "Poin tiap minggu — gampang.", quote: GOOD_QUOTE }], capital_note: "Gratis — tanpa biaya." });
    const out = validatePlan(answer(r), pool, profile());
    expect(JSON.stringify(out.recommendations)).not.toContain("—");
    expect(out.recommendations[0]!.reasons[0]!.text).toBe("Poin tiap minggu, gampang.");
    expect(out.recommendations[0]!.capital_note).toBe("Gratis, tanpa biaya.");
  });

  it("trims to 5 recommendations", () => {
    const six = answer(rec("a", { minutes_per_day: 5 }), rec("b", { minutes_per_day: 5 }), rec("c", { minutes_per_day: 5 }), rec("d", { minutes_per_day: 5 }), rec("e", { minutes_per_day: 5 }), rec("f", { minutes_per_day: 5 }));
    const out = validatePlan(six, pool, profile({ minutes_per_day: 120 }));
    expect(out.recommendations.map((r) => r.project_id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(out.dropped).toBe(1);
  });

  it("keeps the order and skips any recommendation that would go past the minute budget", () => {
    const plan = answer(rec("a", { minutes_per_day: 15 }), rec("b", { minutes_per_day: 10 }), rec("c", { minutes_per_day: 10 }), rec("d", { minutes_per_day: 5 }));
    const out = validatePlan(plan, pool, profile({ minutes_per_day: 30 }));
    expect(out.recommendations.map((r) => r.project_id)).toEqual(["a", "b", "d"]);
    expect(out.recommendations.reduce((s, r) => s + r.minutes_per_day, 0)).toBeLessThanOrEqual(30);
    expect(out.dropped).toBe(1);
  });

  it("does not empty the plan when the first recommendation alone is over the budget", () => {
    const plan = answer(rec("a", { minutes_per_day: 60 }), rec("b", { minutes_per_day: 10 }), rec("c", { minutes_per_day: 10 }));
    const out = validatePlan(plan, pool, profile({ minutes_per_day: 30 }));
    expect(out.recommendations.map((r) => r.project_id)).toEqual(["b", "c"]);
  });

  it("keeps a plan that is exactly on the budget", () => {
    const plan = answer(rec("a", { minutes_per_day: 15 }), rec("b", { minutes_per_day: 15 }));
    expect(validatePlan(plan, pool, profile({ minutes_per_day: 30 })).recommendations).toHaveLength(2);
  });

  it("returns an empty plan when nothing survives", () => {
    const out = validatePlan(answer(rec("x"), rec("y"), rec("z")), pool, profile());
    expect(out).toEqual({ recommendations: [], dropped: 3 });
  });
});
