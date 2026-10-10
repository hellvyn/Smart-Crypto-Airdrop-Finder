import { extractionSchema, filterUrlsInSource, normalizeName, registrableDomain } from "@saf/core";
import type { DeadlineKind, ExtractionResult, Status } from "@saf/core";
import type { ExtractionAttempt } from "../src/llm/extract.js";
import { parseJson } from "../src/llm/extract.js";

type Project = ExtractionResult["projects"][number];

/** A labelled deadline. `date` is `YYYY-MM-DD`, or null when the text gives none. */
export interface TruthDeadline {
  kind: DeadlineKind;
  date: string | null;
}

export type CaseTruth =
  | {
      kind: "project";
      project: string;
      status: Status;
      token: string | null;
      chain: string | null;
      /** Every deadline the text states; omitted when the case is not labelled for deadlines. */
      deadlines?: TruthDeadline[];
      /** Registrable domains of the project's own site, app and docs as the text links them; omitted when not labelled. */
      officialDomains?: string[];
    }
  | { kind: "negative" }
  | { kind: "radar"; slugs: string[]; minRecall: number };

export interface GroundTruth {
  cases: Record<string, CaseTruth>;
}

export interface CaseScore {
  caseId: string;
  /** Null when the case is not status-scored. */
  statusOk: boolean | null;
  /** Null when the case is not a project case. */
  tokenOk: boolean | null;
  /** Null when the case is not a project case; true when no chain is expected. */
  chainOk: boolean | null;
  /** Raw model `official_urls` (before cleanup) that do not appear verbatim in the case text. */
  hallucinatedUrls: number;
  /** Null unless the case is the negative one. */
  negativeOk: boolean | null;
  /** Distinct expected slugs matched by an extracted project; null unless the case is the radar. */
  radarRecall: number | null;
  /** Labelled deadlines (0 when the case has none labelled). */
  deadlinesExpected: number;
  /** Labelled deadlines for which the extracted project has a deadline with the same kind and date. */
  deadlinesMatched: number;
  /** Labelled official domains (0 when the case has none labelled). */
  officialDomainsExpected: number;
  /** Labelled official domains that an `official_urls` entry found in the case text belongs to. */
  officialDomainsMatched: number;
}

/** Minimum share of correct answers per gate (spec section 12: G4 status, G5 deadlines, official domains). */
const MIN_STATUS_ACCURACY = 0.9;
const MIN_DEADLINE_ACCURACY = 0.9;
const MIN_OFFICIAL_DOMAIN_ACCURACY = 0.8;

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

function deadlinesMatched(expected: TruthDeadline[], found: Project | null): number {
  if (found === null) return 0;
  return expected.filter((e) => found.deadlines.some((d) => d.kind === e.kind && d.date === e.date)).length;
}

/** Counts expected domains that some `official_urls` entry belongs to, after dropping URLs missing from `text`. */
function officialDomainsMatched(expected: string[], found: Project | null, text: string): number {
  if (found === null) return 0;
  const domains = new Set(filterUrlsInSource(found.official_urls, text).map((u) => registrableDomain(u)?.toLowerCase()));
  return expected.filter((d) => domains.has(d.toLowerCase())).length;
}

/** All `official_urls` of a raw model answer; [] if it is not a schema-valid extraction. */
export function rawOfficialUrls(raw: string): string[] {
  const parsed = parseJson(raw);
  if (!parsed.ok) return [];
  const validated = extractionSchema.safeParse(parsed.value);
  return validated.success ? validated.data.projects.flatMap((p) => p.official_urls) : [];
}

/** Raw `official_urls` of the last successful attempt, i.e. the answer before URL cleanup. */
export function rawOfficialUrlsOfOutcome(attempts: ExtractionAttempt[]): string[] {
  const last = [...attempts].reverse().find((a) => a.error === null);
  return last ? rawOfficialUrls(last.raw) : [];
}

/**
 * Scores one extraction against the ground truth. Status, token, chain, negative and radar
 * come from the post-processed `result`; a null `result` (every model failed) fails every
 * applicable check. Deadlines match on kind and date; official domains count only for
 * `official_urls` entries that appear in the case `text`. `hallucinatedUrls` counts `rawUrls` (the model's `official_urls` before
 * cleanup) that are not in the case `text`.
 */
export function scoreCase(
  caseId: string,
  result: ExtractionResult | null,
  truth: GroundTruth,
  text: string,
  rawUrls: string[],
): CaseScore {
  const expected = truth.cases[caseId];
  const projects = result?.projects ?? [];
  const hallucinatedUrls = rawUrls.length - filterUrlsInSource(rawUrls, text).length;

  const score: CaseScore = {
    caseId,
    statusOk: null,
    tokenOk: null,
    chainOk: null,
    hallucinatedUrls,
    negativeOk: null,
    radarRecall: null,
    deadlinesExpected: 0,
    deadlinesMatched: 0,
    officialDomainsExpected: 0,
    officialDomainsMatched: 0,
  };
  if (!expected) return score;

  if (expected.kind === "project") {
    const found = findProject(projects, expected.project, expected.status);
    score.statusOk = found !== null && found.status === expected.status;
    score.tokenOk = found !== null && tokenMatches(expected.token, found.token_symbol);
    score.chainOk = found !== null && chainMatches(expected.chain, found.chains);
    score.deadlinesExpected = expected.deadlines?.length ?? 0;
    score.deadlinesMatched = deadlinesMatched(expected.deadlines ?? [], found);
    score.officialDomainsExpected = expected.officialDomains?.length ?? 0;
    score.officialDomainsMatched = officialDomainsMatched(expected.officialDomains ?? [], found, text);
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

/** `matched / expected >= min`. With nothing labelled the gate cannot be measured, so it fails instead of passing. */
function ratioCheck(label: string, matched: number, expected: number, min: number): PassCheck {
  const name = `${label} >= ${Math.round(min * 100)}%`;
  if (expected === 0) return { name, ok: false, detail: "nothing labelled, cannot be measured" };
  return { name, ok: matched / expected >= min, detail: `${matched}/${expected} (${((matched / expected) * 100).toFixed(1)}%)` };
}

/** The pass conditions of spec section 12 (G4 to G6), evaluated over all case scores. */
export function evaluatePass(scores: CaseScore[], truth: GroundTruth): PassCheck[] {
  const byId = new Map(scores.map((s) => [s.caseId, s]));
  const hallucinated = scores.reduce((sum, s) => sum + s.hallucinatedUrls, 0);
  const statusScored = scores.filter((s) => s.statusOk !== null);
  const statusCorrect = statusScored.filter((s) => s.statusOk === true).length;
  const sum = (pick: (s: CaseScore) => number): number => scores.reduce((total, s) => total + pick(s), 0);

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
    ratioCheck("status accuracy", statusCorrect, statusScored.length, MIN_STATUS_ACCURACY),
    ratioCheck("deadline accuracy", sum((s) => s.deadlinesMatched), sum((s) => s.deadlinesExpected), MIN_DEADLINE_ACCURACY),
    ratioCheck(
      "official domain accuracy",
      sum((s) => s.officialDomainsMatched),
      sum((s) => s.officialDomainsExpected),
      MIN_OFFICIAL_DOMAIN_ACCURACY,
    ),
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
