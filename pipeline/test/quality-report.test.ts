import { describe, expect, it } from "vitest";
import { computeGates, formatGateTable, keyChecksRan } from "../eval/quality-report.js";
import type { GateResult } from "../eval/quality-report.js";

const run = (over: Record<string, number> = {}): Record<string, number> => ({
  assessed: 100,
  projects_with_official_domain: 90,
  domain_age_ran: 90,
  phishing_list_ran: 90,
  curation_passed_live_now: 2,
  ...over,
});
const threeRuns = [run({ curation_passed_live_now: 2 }), run({ curation_passed_live_now: 3 }), run({ curation_passed_live_now: 4 })];
const gate = (gates: GateResult[], id: string): GateResult => {
  const found = gates.find((g) => g.id === id);
  if (found === undefined) throw new Error(`no gate ${id}`);
  return found;
};

describe("computeGates", () => {
  const cleanCurations = [
    { passed: true, keyChecksRan: true, tab: "live_now" as const },
    { passed: false, keyChecksRan: false, tab: null },
  ];

  it("computes G1, G2, G3 and G9 from run stats and curations", () => {
    const g = computeGates(threeRuns, cleanCurations);
    expect(gate(g, "G3")).toMatchObject({ value: 0, pass: true });
    expect(gate(g, "G9")).toMatchObject({ value: 3, pass: false }); // average 3 live_now passed, needs 5
    expect(gate(g, "G1")).toMatchObject({ value: 0.9, pass: true });
    expect(gate(g, "G2")).toMatchObject({ value: 1, pass: true });
  });

  it("passes G9 at an average of 5 live_now passes and fails it just under", () => {
    const at5 = [5, 5, 5].map((n) => run({ curation_passed_live_now: n }));
    const under = [5, 5, 4].map((n) => run({ curation_passed_live_now: n }));
    expect(gate(computeGates(at5, cleanCurations), "G9").pass).toBe(true);
    expect(gate(computeGates(under, cleanCurations), "G9").pass).toBe(false);
  });

  it("averages the per-run ratios for G1 and fails below 80%", () => {
    const runs = [run({ projects_with_official_domain: 70 }), run({ projects_with_official_domain: 80 }), run({ projects_with_official_domain: 90 })];
    expect(gate(computeGates(runs, cleanCurations), "G1")).toMatchObject({ value: 0.8, pass: true });
    const lower = [run({ projects_with_official_domain: 70 }), run({ projects_with_official_domain: 70 }), run({ projects_with_official_domain: 70 })];
    expect(gate(computeGates(lower, cleanCurations), "G1")).toMatchObject({ value: 0.7, pass: false });
  });

  it("takes the weaker of the domain-age and phishing-list coverage for G2", () => {
    const runs = [1, 2, 3].map(() => run({ domain_age_ran: 90, phishing_list_ran: 80 })); // 100% vs 88.9%
    const g2 = gate(computeGates(runs, cleanCurations), "G2");
    expect(g2.pass).toBe(false);
    expect(g2.value).toBeCloseTo(80 / 90, 5);
    const ok = [1, 2, 3].map(() => run({ domain_age_ran: 86, phishing_list_ran: 90 })); // 95.6%
    expect(gate(computeGates(ok, cleanCurations), "G2").pass).toBe(true);
  });

  it("fails G3 for each passing curation, outside the ended tab, whose key checks did not all run", () => {
    const curations = [
      { passed: true, keyChecksRan: false, tab: "live_now" as const },
      { passed: true, keyChecksRan: false, tab: "early_bets" as const },
      { passed: true, keyChecksRan: false, tab: "ended" as const }, // ended projects are exempt (decision #40)
      { passed: false, keyChecksRan: false, tab: null }, // hidden anyway
      { passed: true, keyChecksRan: true, tab: "live_now" as const },
    ];
    expect(gate(computeGates(threeRuns, curations), "G3")).toMatchObject({ value: 2, pass: false });
  });

  it("does not let an empty set of curations pass G3", () => {
    expect(gate(computeGates(threeRuns, []), "G3").pass).toBe(false);
  });

  it("fails the run-based gates when fewer than 3 runs exist, since the target is an average of 3", () => {
    const g = computeGates(threeRuns.slice(0, 2), cleanCurations);
    for (const id of ["G1", "G2", "G9"]) expect(gate(g, id).pass).toBe(false);
    expect(gate(g, "G3").pass).toBe(true); // G3 does not depend on runs
  });

  it("leaves G1 and G2 without a value when no run assessed a project with a domain", () => {
    const empty = [1, 2, 3].map(() => run({ assessed: 0, projects_with_official_domain: 0, domain_age_ran: 0, phishing_list_ran: 0 }));
    const g = computeGates(empty, cleanCurations);
    expect(gate(g, "G1")).toMatchObject({ value: null, pass: false });
    expect(gate(g, "G2")).toMatchObject({ value: null, pass: false });
  });

  it("counts a counter a run does not have as 0", () => {
    const old = [1, 2, 3].map(() => ({ assessed: 10, projects_with_official_domain: 9, domain_age_ran: 9, phishing_list_ran: 9 }));
    expect(gate(computeGates(old, cleanCurations), "G9")).toMatchObject({ value: 0, pass: false });
  });
});

describe("keyChecksRan", () => {
  const ids = ["dangerous_asks", "lookalike", "domain_age", "phishing_list"];
  it("is true only when all four key checks ran", () => {
    const all = ids.map((id) => ({ id, ran: true }));
    expect(keyChecksRan(all)).toBe(true);
    expect(keyChecksRan(all.map((c) => (c.id === "domain_age" ? { ...c, ran: false } : c)))).toBe(false);
    expect(keyChecksRan(all.filter((c) => c.id !== "phishing_list"))).toBe(false);
  });
  it("ignores other checks", () => {
    expect(keyChecksRan([...ids.map((id) => ({ id, ran: true })), { id: "token_security", ran: false }])).toBe(true);
  });
});

describe("formatGateTable", () => {
  it("lists every gate once with its target and result, and marks manual gates as not measured here", () => {
    const text = formatGateTable(computeGates(threeRuns, [{ passed: true, keyChecksRan: true, tab: "live_now" }]));
    for (const id of ["G1", "G2", "G3", "G9", "G4", "G7", "G10", "G11", "G13"]) {
      expect(text.match(new RegExp(`^${id}\\b`, "gm"))?.length).toBe(1);
    }
    expect(text).toMatch(/^G9\b.*≥ 5.*FAIL/m);
    expect(text).toMatch(/^G3\b.*PASS/m);
    expect(text).toMatch(/^G4\b.*manual/m);
  });
});
