import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DeadlineKind, ExtractionResult } from "@saf/core";
import { evaluatePass, rawOfficialUrls, rawOfficialUrlsOfOutcome, scoreCase } from "../eval/score.js";
import type { CaseScore, GroundTruth } from "../eval/score.js";

const truth = JSON.parse(readFileSync(new URL("../eval/ground-truth.json", import.meta.url), "utf8")) as GroundTruth;

type Project = ExtractionResult["projects"][number];

function project(overrides: Partial<Project> = {}): Project {
  return {
    name: "Abstract",
    token_symbol: null,
    chains: [],
    status: "ended",
    status_evidence: "",
    tasks: [],
    deadlines: [],
    official_urls: [],
    confidence: 0.9,
    steps: [],
    key_parameters: [],
    source_ratings: [],
    latest_update: null,
    claimed_backers: [],
    capital_required: "unknown",
    capital_min_usd: null,
    ...overrides,
  };
}

function result(projects: Project[], isAirdrop = true): ExtractionResult {
  return { is_airdrop_content: isAirdrop, projects };
}

const TEXT = "Zeta airdrop. Claim opens Oct 5. Official site https://zeta.xyz/ and https://app.zeta.xyz/claim and https://zeta.io/ .";

/** Ground truth with one extra project case "c_zeta" (project "Zeta"). */
function truthWith(extra: { deadlines?: { kind: DeadlineKind; date: string | null }[]; officialDomains?: string[] }): GroundTruth {
  return {
    cases: { c_zeta: { kind: "project", project: "zeta", status: "live", token: null, chain: null, ...extra } },
  };
}

describe("scoreCase", () => {
  it("fails the status check when Abstract is answered as speculative", () => {
    const score = scoreCase("aio_abstract", result([project({ status: "speculative" })]), truth, "", []);
    expect(score.statusOk).toBe(false);
  });

  it("passes the status check when Abstract is answered as ended", () => {
    const score = scoreCase("aio_abstract", result([project()]), truth, "", []);
    expect(score.statusOk).toBe(true);
    expect(score.tokenOk).toBe(true);
    expect(score.chainOk).toBe(true);
  });

  it("counts raw URLs that are not in the case text", () => {
    const text = "Claim at https://abs.xyz/claim now";
    const raw = ["https://abs.xyz/claim", "https://abstract-fake.xyz/"];
    const score = scoreCase("aio_abstract", result([project({ official_urls: ["https://abs.xyz/claim"] })]), truth, text, raw);
    // The post-processed result dropped the fake URL already; the raw output still counts it.
    expect(score.hallucinatedUrls).toBe(1);
  });

  it("does not count a referral URL that cleanup shortened", () => {
    const text = "Join at https://www.raycash.xyz/r/V8P3TX today";
    const score = scoreCase(
      "aio_raycash",
      result([project({ name: "RayCash", status: "speculative", chains: ["Polygon"], official_urls: ["https://www.raycash.xyz/"] })]),
      truth,
      text,
      ["https://www.raycash.xyz/r/V8P3TX"],
    );
    expect(score.hallucinatedUrls).toBe(0);
  });

  it("compares the token case-insensitively and ignores a leading $", () => {
    const ok = scoreCase(
      "aio_deepbook",
      result([project({ name: "DeepBook", token_symbol: "$deep", status: "live", chains: ["Sui"] })]),
      truth,
      "",
      [],
    );
    expect(ok.statusOk).toBe(true);
    expect(ok.tokenOk).toBe(true);
    expect(ok.chainOk).toBe(true);

    const bad = scoreCase(
      "aio_deepbook",
      result([project({ name: "DeepBook", token_symbol: "DBK", status: "live", chains: ["Ethereum"] })]),
      truth,
      "",
      [],
    );
    expect(bad.tokenOk).toBe(false);
    expect(bad.chainOk).toBe(false);
  });

  it("scores a missing extraction as failed", () => {
    const score = scoreCase("aio_deepbook", null, truth, "", []);
    expect(score.statusOk).toBe(false);
    expect(score.tokenOk).toBe(false);
    expect(score.chainOk).toBe(false);
    expect(score.hallucinatedUrls).toBe(0);
  });

  it("matches the Ink variants and prefers the project with the expected status", () => {
    const score = scoreCase(
      "tg_ink",
      result([
        project({ name: "Ink Chain", status: "live", token_symbol: "INK" }),
        project({ name: "$INK", status: "speculative", token_symbol: "INK" }),
      ]),
      truth,
      "",
      [],
    );
    expect(score.statusOk).toBe(true);
    expect(score.tokenOk).toBe(true);
  });

  it("does not score status for the negative and radar cases", () => {
    expect(scoreCase("tg_ledger_negative", result([], false), truth, "", []).statusOk).toBeNull();
    expect(scoreCase("tg_weekly_radar", result([]), truth, "", []).statusOk).toBeNull();
    expect(scoreCase("tg_weekly_radar", result([]), truth, "", []).tokenOk).toBeNull();
    expect(scoreCase("tg_ledger_negative", result([], false), truth, "", []).chainOk).toBeNull();
  });

  it("accepts the negative case only when the text is rejected", () => {
    expect(scoreCase("tg_ledger_negative", result([], false), truth, "", []).negativeOk).toBe(true);
    expect(scoreCase("tg_ledger_negative", result([project()], true), truth, "", []).negativeOk).toBe(false);
    expect(scoreCase("tg_ledger_negative", null, truth, "", []).negativeOk).toBe(false);
    expect(scoreCase("aio_abstract", result([project()]), truth, "", []).negativeOk).toBeNull();
  });

  it("counts radar recall as distinct expected slugs matched by an extracted project", () => {
    const names = ["Abstract", "Arcus", "Aster", "Ink", "Jumper", "Jumper Exchange", "Kryvora", "Unrelated Thing"];
    const score = scoreCase("tg_weekly_radar", result(names.map((name) => project({ name }))), truth, "", []);
    // abstract, arcus, aster, ink-chain, jumper-exchange, kryvora-network
    expect(score.radarRecall).toBe(6);
    expect(scoreCase("tg_weekly_radar", null, truth, "", []).radarRecall).toBe(0);
    expect(scoreCase("aio_abstract", result([project()]), truth, "", []).radarRecall).toBeNull();
  });

  it("scores deadlines by kind and date", () => {
    const t = truthWith({
      deadlines: [
        { kind: "claim", date: "2026-10-05" },
        { kind: "tge", date: "2026-10-01" },
      ],
    });
    const found = result([
      project({
        name: "Zeta",
        deadlines: [
          { kind: "claim", date: "2026-10-05", precision: "exact", text: "Oct 5" },
          { kind: "tge", date: "2026-10-02", precision: "exact", text: "Oct 2" },
        ],
      }),
    ]);
    const s = scoreCase("c_zeta", found, t, TEXT, []);
    expect([s.deadlinesMatched, s.deadlinesExpected]).toEqual([1, 2]);
  });

  it("matches a deadline with an unknown date only to a deadline of the same kind with a null date", () => {
    const t = truthWith({ deadlines: [{ kind: "snapshot", date: null }] });
    const nullDate = result([
      project({ name: "Zeta", deadlines: [{ kind: "snapshot", date: null, precision: "approximate", text: "soon" }] }),
    ]);
    const withDate = result([
      project({ name: "Zeta", deadlines: [{ kind: "snapshot", date: "2026-10-05", precision: "exact", text: "Oct 5" }] }),
    ]);
    expect(scoreCase("c_zeta", nullDate, t, TEXT, []).deadlinesMatched).toBe(1);
    expect(scoreCase("c_zeta", withDate, t, TEXT, []).deadlinesMatched).toBe(0);
  });

  it("counts every expected deadline as missed when extraction failed or the project was not found", () => {
    const t = truthWith({ deadlines: [{ kind: "claim", date: "2026-10-05" }] });
    expect(scoreCase("c_zeta", null, t, TEXT, []).deadlinesMatched).toBe(0);
    expect(scoreCase("c_zeta", null, t, TEXT, []).deadlinesExpected).toBe(1);
    expect(scoreCase("c_zeta", result([project({ name: "Other" })]), t, TEXT, []).deadlinesMatched).toBe(0);
  });

  it("does not score deadlines or domains for a project case without those labels", () => {
    const s = scoreCase("aio_abstract", result([project()]), truth, "", []);
    expect([s.deadlinesExpected, s.deadlinesMatched, s.officialDomainsExpected, s.officialDomainsMatched]).toEqual([0, 0, 0, 0]);
  });

  it("scores official domains by registrable domain", () => {
    const t = truthWith({ officialDomains: ["zeta.xyz", "zeta.io"] });
    const found = result([project({ name: "Zeta", official_urls: ["https://app.zeta.xyz/claim", "https://zeta.io/"] })]);
    const s = scoreCase("c_zeta", found, t, TEXT, []);
    expect([s.officialDomainsMatched, s.officialDomainsExpected]).toEqual([2, 2]);
  });

  it("scores official domains from source-verified URLs only", () => {
    const t = truthWith({ officialDomains: ["zeta.xyz", "zeta-fake.xyz"] });
    const found = result([project({ name: "Zeta", official_urls: ["https://zeta.xyz/", "https://zeta-fake.xyz/"] })]);
    // TEXT contains zeta.xyz but not zeta-fake.xyz
    const s = scoreCase("c_zeta", found, t, TEXT, []);
    expect([s.officialDomainsMatched, s.officialDomainsExpected]).toEqual([1, 2]);
  });

  it("does not match an official domain that only shares a name with the expected one", () => {
    const t = truthWith({ officialDomains: ["zeta.xyz"] });
    const text = `${TEXT} Fake at https://zeta.xyz.evil.com/ and https://zeta-xyz.com/`;
    const found = result([project({ name: "Zeta", official_urls: ["https://zeta.xyz.evil.com/", "https://zeta-xyz.com/"] })]);
    expect(scoreCase("c_zeta", found, t, text, []).officialDomainsMatched).toBe(0);
  });

  it("keeps the radar threshold and all 28 slugs in the ground truth", () => {
    const radar = truth.cases["tg_weekly_radar"];
    expect(radar?.kind).toBe("radar");
    if (radar?.kind === "radar") {
      expect(radar.slugs).toHaveLength(28);
      expect(radar.minRecall).toBe(22);
    }
  });
});

describe("evaluatePass", () => {
  const blank = (caseId: string): CaseScore => scoreCase(caseId, null, truth, "", []);
  /** Ten status-scored project cases with 10 deadlines and 10 official domains, all correct; plus the v1 special cases. */
  const good = (): CaseScore[] => [
    ...Array.from({ length: 10 }, (_, i) => ({
      ...blank(`p${i}`),
      statusOk: true,
      deadlinesExpected: 1,
      deadlinesMatched: 1,
      officialDomainsExpected: 1,
      officialDomainsMatched: 1,
    })),
    { ...blank("aio_abstract"), statusOk: true },
    { ...blank("tg_ledger_negative"), negativeOk: true },
    { ...blank("tg_weekly_radar"), radarRecall: 22 },
  ];
  const withCase = (scores: CaseScore[], caseId: string, over: Partial<CaseScore>): CaseScore[] =>
    scores.map((s) => (s.caseId === caseId ? { ...s, ...over } : s));
  const check = (scores: CaseScore[], prefix: string) => evaluatePass(scores, truth).find((c) => c.name.startsWith(prefix));

  it("passes when every condition holds", () => {
    const checks = evaluatePass(good(), truth);
    expect(checks.filter((c) => !c.ok)).toEqual([]);
  });

  it("fails the run when deadline accuracy is below 90%", () => {
    const scores = good().map((s, i) => (i < 2 ? { ...s, deadlinesMatched: 0 } : s)); // 8 of 10
    expect(check(scores, "deadline accuracy")?.ok).toBe(false);
    expect(check(scores, "deadline accuracy")?.detail).toContain("8/10");
  });

  it("passes deadline accuracy at exactly 90%", () => {
    const scores = good().map((s, i) => (i === 0 ? { ...s, deadlinesMatched: 0 } : s)); // 9 of 10
    expect(check(scores, "deadline accuracy")?.ok).toBe(true);
  });

  it("fails status accuracy below 90% of the status-scored cases and passes at 90%", () => {
    // good() has 11 status-scored cases (10 + aio_abstract); 10/11 = 90.9% passes, 9/11 = 81.8% fails.
    const oneWrong = withCase(good(), "p0", { statusOk: false });
    expect(check(oneWrong, "status accuracy")?.ok).toBe(true);
    const twoWrong = withCase(oneWrong, "p1", { statusOk: false });
    expect(check(twoWrong, "status accuracy")?.ok).toBe(false);
  });

  it("fails official-domain accuracy below 80% and passes at 80%", () => {
    const mark = (misses: number) => good().map((s, i) => (i < misses ? { ...s, officialDomainsMatched: 0 } : s));
    expect(check(mark(2), "official domain accuracy")?.ok).toBe(true); // 8/10
    expect(check(mark(3), "official domain accuracy")?.ok).toBe(false); // 7/10
  });

  it("fails a gate that nothing was labelled for instead of passing it", () => {
    const unlabelled = good().map((s) => ({ ...s, deadlinesExpected: 0, deadlinesMatched: 0, officialDomainsExpected: 0, officialDomainsMatched: 0 }));
    expect(check(unlabelled, "deadline accuracy")?.ok).toBe(false);
    expect(check(unlabelled, "official domain accuracy")?.ok).toBe(false);
    expect(check([], "status accuracy")?.ok).toBe(false);
  });

  it("keeps the v1 conditions: hallucinated URLs, rejected negative, ended Abstract and radar recall", () => {
    expect(check(withCase(good(), "p3", { hallucinatedUrls: 1 }), "no hallucinated URLs")?.ok).toBe(false);
    expect(check(withCase(good(), "tg_ledger_negative", { negativeOk: false }), "tg_ledger_negative")?.ok).toBe(false);
    expect(check(withCase(good(), "aio_abstract", { statusOk: false }), "aio_abstract")?.ok).toBe(false);
    expect(check(withCase(good(), "tg_weekly_radar", { radarRecall: 21 }), "tg_weekly_radar")?.ok).toBe(false);
  });
});

describe("raw official URLs", () => {
  const answer = JSON.stringify({
    is_airdrop_content: true,
    projects: [project({ official_urls: ["https://a.io/", "https://b.io/"] }), project({ official_urls: ["https://c.io/"] })],
  });

  it("reads them from a plain or fenced answer", () => {
    expect(rawOfficialUrls(answer)).toEqual(["https://a.io/", "https://b.io/", "https://c.io/"]);
    expect(rawOfficialUrls("```json\n" + answer + "\n```")).toHaveLength(3);
    expect(rawOfficialUrls("not json")).toEqual([]);
    expect(rawOfficialUrls('{"is_airdrop_content":"yes"}')).toEqual([]);
  });

  it("uses the last successful attempt", () => {
    const attempt = (error: string | null, raw: string) => ({
      model: "m",
      servedModel: null,
      httpStatus: 200,
      finishReason: "stop",
      latencyMs: 1,
      error,
      raw,
    });
    expect(rawOfficialUrlsOfOutcome([attempt("schema", answer), attempt(null, answer)])).toHaveLength(3);
    expect(rawOfficialUrlsOfOutcome([attempt("schema", answer)])).toEqual([]);
  });
});
