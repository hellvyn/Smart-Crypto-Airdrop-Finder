import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pLimit from "p-limit";
import { assessRisk, curate } from "@saf/core";
import type { CurateResult, RiskAssessment, RiskInput, RiskLevel } from "@saf/core";
import { CRTSH_MIN_INTERVAL_MS, firstCertificateAgeDays } from "../../src/enrich/crtsh.js";
import { checkPhishingSite } from "../../src/enrich/goplus.js";
import { pacedHttp } from "../../src/enrich/paced.js";
import { RDAP_MIN_INTERVAL_MS, rdapDomainAge } from "../../src/enrich/rdap.js";
import type { Http } from "../../src/collectors/types.js";
import { createHttp } from "../../src/http.js";
import { indexLegit, readLegit, toRiskInput } from "./build.js";
import type { EvalCase, Enrichment, ScamCase } from "./build.js";

const SCAM_PATH = join(fileURLToPath(new URL(".", import.meta.url)), "cases", "scam.json");
/** GoPlus runs one at a time like the pipeline. RDAP also runs one at a time here: with 4 in parallel RDAP answered 429 for most domains, which would leave the age check mostly empty in this report. */
const ENRICH_CONCURRENCY = 1;
const GOPLUS_CONCURRENCY = 1;
/**
 * GoPlus rate-limits by answering HTTP 200 with `{"code":4029,"message":"too many requests"}` after about 30
 * requests, and `checkPhishingSite` only retries on HTTP 429/5xx, so that answer becomes null. This runner asks
 * again after a pause so the phishing check has data to measure; the first-try failures are counted and printed.
 */
const GOPLUS_ATTEMPTS = 4;
const GOPLUS_WAIT_MS = 15_000;

export interface Result {
  kind: "scam" | "legit";
  level: RiskLevel;
}

export interface Summary {
  /** `passedRisk`: low or medium, so the scam would not be hidden by risk. `caught`: high or critical. */
  scam: { total: number; passedRisk: number; insufficientData: number; caught: number };
  /** `hidden`: high or critical, so a legit airdrop the engine would hide. */
  legit: { total: number; hidden: number; insufficientData: number };
}

export function summarize(results: readonly Result[]): Summary {
  const count = (kind: Result["kind"], levels: readonly RiskLevel[]): number =>
    results.filter((r) => r.kind === kind && levels.includes(r.level)).length;
  return {
    scam: {
      total: results.filter((r) => r.kind === "scam").length,
      passedRisk: count("scam", ["low", "medium"]),
      insufficientData: count("scam", ["insufficient_data"]),
      caught: count("scam", ["high", "critical"]),
    },
    legit: {
      total: results.filter((r) => r.kind === "legit").length,
      hidden: count("legit", ["high", "critical"]),
      insufficientData: count("legit", ["insufficient_data"]),
    },
  };
}

/** One case after `curate()`: `failCodes` are the codes of its `fail` reasons (empty when it passed). */
export interface CuratedResult {
  kind: "scam" | "legit";
  passed: boolean;
  failCodes: string[];
}

export interface CurationSummary {
  /** G7: `passed` is the number of scams on the curated list. `stoppedOnlyByMissingChecks`: failed on `insufficient_checks` and nothing else, so held back by a check that did not run, not by detection. */
  scam: { total: number; passed: number; stoppedOnlyByMissingChecks: number };
  /**
   * G8: `hidden` legit cases are not on the list. `hiddenWithMissingChecks` have `insufficient_checks` among their
   * reasons (a check did not run: data, not judgement); `hiddenByOtherRules` have some other failed rule (risk,
   * lookalike, ...). A case can be in both.
   */
  legit: { total: number; hidden: number; hiddenWithMissingChecks: number; hiddenByOtherRules: number };
}

/**
 * `curate()` (curation spec 6.2) on a case the risk engine has assessed. Everything else is held neutral like in
 * `toRiskInput`: status `live`, no lookalike project, no AI scam flag. Every case gets one legit signal,
 * `curated_source`, the weakest the rules accept and the one a listing on a source site would give a scam as well (a
 * VC, TVL or CoinGecko signal needs a matching domain, which a scam does not have). So the signal rule never stops a
 * scam here, and G7 measures the risk and key-check rules alone. A scam has a known official domain only when its
 * brand is in `legit.json`.
 */
export function curateAssessed(input: RiskInput, assessment: RiskAssessment): CurateResult {
  return curate({
    status: "live",
    riskLevel: assessment.level,
    checks: assessment.checks,
    lookalikeOf: null,
    hasOfficialDomain: input.project.officialDomains.length > 0,
    signals: [{ kind: "curated_source", value: {}, source: "airdrops_io", verified: false }],
    passedBeforeEnd: false,
    aiScamPatterns: [],
  });
}

export function summarizeCuration(results: readonly CuratedResult[]): CurationSummary {
  const of = (kind: CuratedResult["kind"]): CuratedResult[] => results.filter((r) => r.kind === kind);
  const scams = of("scam");
  const legit = of("legit");
  return {
    scam: {
      total: scams.length,
      passed: scams.filter((r) => r.passed).length,
      stoppedOnlyByMissingChecks: scams.filter((r) => !r.passed && r.failCodes.length === 1 && r.failCodes[0] === "insufficient_checks").length,
    },
    legit: {
      total: legit.length,
      hidden: legit.filter((r) => !r.passed).length,
      hiddenWithMissingChecks: legit.filter((r) => !r.passed && r.failCodes.includes("insufficient_checks")).length,
      hiddenByOtherRules: legit.filter((r) => !r.passed && r.failCodes.some((code) => code !== "insufficient_checks")).length,
    },
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function phishingWithBackoff(http: Http, domain: string, firstTryFailed: Set<string>): Promise<boolean | null> {
  for (let attempt = 1; attempt <= GOPLUS_ATTEMPTS; attempt++) {
    const flag = await checkPhishingSite(http, `https://${domain}`);
    if (flag !== null) return flag;
    if (attempt === 1) firstTryFailed.add(domain);
    if (attempt < GOPLUS_ATTEMPTS) await sleep(GOPLUS_WAIT_MS);
  }
  return null;
}

const caseDomains = (c: EvalCase): string[] =>
  c.kind === "scam" ? [c.domain] : [...new Set([c.officialDomain, c.claimDomain ?? c.officialDomain])];

const caseLabel = (c: EvalCase): string => (c.kind === "scam" ? `${c.domain} (imitates ${c.brand})` : c.name);

const pct = (n: number, total: number): string => (total === 0 ? "n/a" : `${((100 * n) / total).toFixed(1)}%`);

async function run(): Promise<void> {
  if (!existsSync(SCAM_PATH)) {
    console.log("No cases/scam.json. Run build.ts first (see README.md).");
    return;
  }
  const scams = JSON.parse(readFileSync(SCAM_PATH, "utf8")) as ScamCase[];
  const legit = readLegit();
  const legitIndex = indexLegit(legit);
  const cases: EvalCase[] = [...scams, ...legit.map((l) => ({ kind: "legit" as const, ...l }))];

  const http = createHttp();
  const rdapHttp = pacedHttp(http, RDAP_MIN_INTERVAL_MS, Date.now, sleep);
  const crtshHttp = pacedHttp(http, CRTSH_MIN_INTERVAL_MS, Date.now, sleep);
  const domains = [...new Set(cases.flatMap(caseDomains))];
  const enrich: Enrichment = { domainAgeDays: {}, phishingFlags: {} };
  const fromCrtsh = new Set<string>();
  const goplusFirstTryFailed = new Set<string>();
  const limit = pLimit(ENRICH_CONCURRENCY);
  const goplusLimit = pLimit(GOPLUS_CONCURRENCY);
  await Promise.all(
    domains.flatMap((domain) => [
      goplusLimit(async () => {
        enrich.phishingFlags[domain] = await phishingWithBackoff(http, domain, goplusFirstTryFailed);
      }),
      limit(async () => {
        const rdap = await rdapDomainAge(rdapHttp, domain, new Date(), sleep);
        let age = rdap.days;
        // Like the pipeline: crt.sh only when the TLD has no RDAP service or RDAP has no registration date.
        if (rdap.outcome === "no_rdap" || rdap.outcome === "no_date") {
          age = await firstCertificateAgeDays(crtshHttp, domain, new Date());
          if (age !== null) fromCrtsh.add(domain);
        }
        enrich.domainAgeDays[domain] = age;
      }),
    ]),
  );

  const assessed = cases.map((c) => {
    const input = toRiskInput(c, legitIndex, enrich);
    // The same case without the GoPlus answer: public phishing lists overlap, so the catch rate with GoPlus
    // is optimistic for a set built from them. This shows what the other checks catch alone.
    const withoutPhishing = assessRisk({
      ...input,
      phishingFlags: Object.fromEntries(Object.keys(input.phishingFlags).map((d) => [d, null])),
    });
    const assessment = assessRisk(input);
    const codes = [...new Set(assessment.reasons.filter((r) => r.severity !== "info").map((r) => r.code))];
    const curated = curateAssessed(input, assessment);
    const failCodes = curated.reasons.filter((r) => r.kind === "fail").map((r) => r.code);
    return { c, level: assessment.level, codes, levelWithoutPhishing: withoutPhishing.level, passed: curated.passed, failCodes };
  });

  const all = summarize(assessed.map((a) => ({ kind: a.c.kind, level: a.level })));
  const noGoplus = summarize(assessed.map((a) => ({ kind: a.c.kind, level: a.levelWithoutPhishing })));

  console.log(`Scam cases: ${all.scam.total}; legit cases: ${all.legit.total}`);
  console.log("\nScam that passed risk (low or medium):");
  for (const a of assessed.filter((x) => x.c.kind === "scam" && (x.level === "low" || x.level === "medium"))) {
    console.log(`  ${a.level.padEnd(7)} ${caseLabel(a.c)}  [${a.codes.join(", ")}]`);
  }
  console.log("\nScam with too little data (insufficient_data):");
  for (const a of assessed.filter((x) => x.c.kind === "scam" && x.level === "insufficient_data")) {
    console.log(`  ${caseLabel(a.c)}`);
  }
  console.log("\nLegit that the engine would hide (high or critical):");
  for (const a of assessed.filter((x) => x.c.kind === "legit" && (x.level === "high" || x.level === "critical"))) {
    console.log(`  ${a.level.padEnd(8)} ${caseLabel(a.c)}  [${a.codes.join(", ")}]`);
  }

  console.log("\nScam that passed curation (G7):");
  for (const a of assessed.filter((x) => x.c.kind === "scam" && x.passed)) console.log(`  ${caseLabel(a.c)}`);
  console.log("\nLegit that curation hides (G8):");
  for (const a of assessed.filter((x) => x.c.kind === "legit" && !x.passed)) {
    console.log(`  ${caseLabel(a.c)}  [${a.failCodes.join(", ")}]`);
  }

  console.log("\nReasons found (number of cases that have each)");
  for (const kind of ["scam", "legit"] as const) {
    const tally = new Map<string, number>();
    for (const a of assessed.filter((x) => x.c.kind === kind)) for (const code of a.codes) tally.set(code, (tally.get(code) ?? 0) + 1);
    const line = [...tally].sort((x, y) => y[1] - x[1]).map(([code, n]) => `${code} ${n}`);
    console.log(`  ${kind}: ${line.length === 0 ? "none" : line.join(", ")}`);
  }

  console.log("\nSummary");
  console.log(
    `  scam passed risk:   ${all.scam.passedRisk}/${all.scam.total} (${pct(all.scam.passedRisk, all.scam.total)})` +
      `; insufficient_data: ${all.scam.insufficientData}; caught: ${all.scam.caught}`,
  );
  console.log(
    `  legit hidden:       ${all.legit.hidden}/${all.legit.total} (${pct(all.legit.hidden, all.legit.total)})` +
      `; insufficient_data: ${all.legit.insufficientData}`,
  );
  console.log(
    `  without GoPlus:     scam passed risk ${noGoplus.scam.passedRisk}/${noGoplus.scam.total}` +
      `; insufficient_data ${noGoplus.scam.insufficientData}; legit hidden ${noGoplus.legit.hidden}/${noGoplus.legit.total}`,
  );

  const curation = summarizeCuration(assessed.map((a) => ({ kind: a.c.kind, passed: a.passed, failCodes: a.failCodes })));
  console.log("\nCuration (curate() with a curated_source signal on every case)");
  console.log(
    `  G7 scam passed curation: ${curation.scam.passed}/${curation.scam.total} (target 0 of at least 30)` +
      `; stopped only by a key check that did not run: ${curation.scam.stoppedOnlyByMissingChecks}`,
  );
  console.log(
    `  G8 legit hidden:         ${curation.legit.hidden}/${curation.legit.total} (${pct(curation.legit.hidden, curation.legit.total)}, target <= 20%)` +
      `; a key check did not run: ${curation.legit.hiddenWithMissingChecks}; another rule failed: ${curation.legit.hiddenByOtherRules}`,
  );

  const coverage = (kind: EvalCase["kind"]): string => {
    const own = [...new Set(cases.filter((c) => c.kind === kind).flatMap(caseDomains))];
    const ran = (map: Record<string, unknown>): string => `${own.filter((d) => map[d] != null).length}/${own.length}`;
    return `phishing check ran ${ran(enrich.phishingFlags)}, domain age ran ${ran(enrich.domainAgeDays)}`;
  };
  console.log("\nCoverage (domains with an answer)");
  console.log(`  scam:  ${coverage("scam")}`);
  console.log(`  legit: ${coverage("legit")}`);
  console.log(`  domain age taken from crt.sh: ${fromCrtsh.size}`);
  console.log(`  GoPlus failed on the first try (before the runner's own retries): ${goplusFirstTryFailed.size}/${domains.length}`);

  console.log("\nRead G7 and G8 with these limits (see eval/scam-set/README.md)");
  console.log("  - Scam domains come from public phishing lists and GoPlus reads similar lists, so the phishing catch is close to circular.");
  console.log("  - Every scam names a project of legit.json, which is also what the lookalike check looks for, and brandOf matches by substring: the lookalike catch is optimistic.");
  console.log("  - Where the domain age lookup got no answer (RDAP rate limits, unsupported TLDs, crt.sh blocked), curation fails the case on insufficient_checks. That inflates both the scam catch and the legit hiding.");
  console.log("  - G8 also counts only the legit domains written in legit.json from memory, with neutral inputs (no signals, two sources, an official social account).");
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  await run();
}
