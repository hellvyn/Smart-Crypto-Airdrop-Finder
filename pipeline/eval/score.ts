import { filterUrlsInSource, normalizeName } from "@saf/core";
import type { ExtractionResult, Status } from "@saf/core";

type Project = ExtractionResult["projects"][number];

export type CaseTruth =
  | { kind: "project"; project: string; status: Status; token: string | null; chain: string | null }
  | { kind: "negative" }
  | { kind: "radar"; slugs: string[]; minRecall: number };

export interface GroundTruth {
  /** Minimum number of status-scored cases that must have the right status. */
  baselineStatusAccuracy: number;
  cases: Record<string, CaseTruth>;
}

export interface CaseScore {
  caseId: string;
  /** Null when the case is not status-scored. */
  statusOk: boolean | null;
  /** True when the case expects no token check (not a project case). */
  tokenOk: boolean;
  /** True when no chain is expected (or the case is not a project case). */
  chainOk: boolean;
  /** `official_urls` that do not appear verbatim in the case text. */
  hallucinatedUrls: number;
  /** Null unless the case is the negative one. */
  negativeOk: boolean | null;
  /** Distinct expected slugs matched by an extracted project; null unless the case is the radar. */
  radarRecall: number | null;
}

/** Name key for comparing an extracted project name with an expected key or slug. */
function key(value: string): string {
  return normalizeName(value.replace(/-/g, " "));
}

function namesMatch(a: string, b: string): boolean {
  return a !== "" && b !== "" && (a.includes(b) || b.includes(a));
}

/** Finds the extracted project for `expected`; with several matches, one with `status` wins. */
function findProject(projects: Project[], expected: string, status?: Status): Project | null {
  const expectedKey = key(expected);
  const matches = projects.filter((p) => namesMatch(normalizeName(p.name), expectedKey));
  return matches.find((p) => p.status === status) ?? matches[0] ?? null;
}

function normalizeToken(token: string): string {
  return token.replace(/\$/g, "").trim().toLowerCase();
}

function tokenMatches(expected: string | null, actual: string | null): boolean {
  if (expected === null) return actual === null || normalizeToken(actual) === "";
  return actual !== null && normalizeToken(actual) === normalizeToken(expected);
}

function chainMatches(expected: string | null, chains: string[]): boolean {
  if (expected === null) return true;
  const wanted = expected.toLowerCase();
  return chains.some((c) => c.trim().toLowerCase() === wanted);
}

/**
 * Scores one extraction against the ground truth. `text` is the case text, used to find
 * URLs the model made up. A null `result` (every model failed) fails every applicable check.
 */
export function scoreCase(
  caseId: string,
  result: ExtractionResult | null,
  truth: GroundTruth,
  text: string,
): CaseScore {
  const expected = truth.cases[caseId];
  const projects = result?.projects ?? [];

  let hallucinatedUrls = 0;
  for (const project of projects) {
    hallucinatedUrls += project.official_urls.length - filterUrlsInSource(project.official_urls, text).length;
  }

  const score: CaseScore = {
    caseId,
    statusOk: null,
    tokenOk: true,
    chainOk: true,
    hallucinatedUrls,
    negativeOk: null,
    radarRecall: null,
  };
  if (!expected) return score;

  if (expected.kind === "project") {
    const found = findProject(projects, expected.project, expected.status);
    score.statusOk = found !== null && found.status === expected.status;
    score.tokenOk = found !== null && tokenMatches(expected.token, found.token_symbol);
    score.chainOk = found !== null && chainMatches(expected.chain, found.chains);
  } else if (expected.kind === "negative") {
    score.negativeOk = result !== null && !result.is_airdrop_content;
  } else {
    score.radarRecall = expected.slugs.filter((slug) => findProject(projects, slug) !== null).length;
  }
  return score;
}

export interface PassCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/** The pass conditions of spec §11, evaluated over all case scores. */
export function evaluatePass(scores: CaseScore[], truth: GroundTruth): PassCheck[] {
  const byId = new Map(scores.map((s) => [s.caseId, s]));
  const hallucinated = scores.reduce((sum, s) => sum + s.hallucinatedUrls, 0);
  const statusScored = scores.filter((s) => s.statusOk !== null);
  const statusCorrect = statusScored.filter((s) => s.statusOk === true).length;

  const checks: PassCheck[] = [
    { name: "no hallucinated URLs", ok: hallucinated === 0, detail: `${hallucinated} found` },
    {
      name: "tg_ledger_negative rejected",
      ok: byId.get("tg_ledger_negative")?.negativeOk === true,
      detail: String(byId.get("tg_ledger_negative")?.negativeOk ?? "not run"),
    },
    {
      name: "aio_abstract is ended",
      ok: byId.get("aio_abstract")?.statusOk === true,
      detail: String(byId.get("aio_abstract")?.statusOk ?? "not run"),
    },
    {
      name: "status accuracy >= baseline",
      ok: statusCorrect >= truth.baselineStatusAccuracy,
      detail: `${statusCorrect}/${statusScored.length} (baseline ${truth.baselineStatusAccuracy})`,
    },
  ];

  for (const [id, expected] of Object.entries(truth.cases)) {
    if (expected.kind !== "radar") continue;
    const recall = byId.get(id)?.radarRecall ?? 0;
    checks.push({
      name: `${id} recall >= ${expected.minRecall}`,
      ok: recall >= expected.minRecall,
      detail: `${recall}/${expected.slugs.length}`,
    });
  }
  return checks;
}
