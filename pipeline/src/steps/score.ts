import pLimit from "p-limit";
import {
  aiFlagsFromAnalyses,
  analystSchema,
  assessRisk,
  curate,
  expireStatus,
  registrableDomain,
  trackRecord,
  worth,
} from "@saf/core";
import type { CurationRecord, NewSignal, RiskAssessment, RiskInput, SignalSource, Status, WorthInput } from "@saf/core";
import type { Http } from "../collectors/types.js";
import type { PipelineConfig } from "../config.js";
import { CRTSH_MIN_INTERVAL_MS, firstCertificateAgeDays } from "../enrich/crtsh.js";
import { GOPLUS_MIN_INTERVAL_MS, checkPhishingSite } from "../enrich/goplus.js";
import { defaultSleep } from "../enrich/time.js";
import { countHacks, fetchHacks } from "../enrich/hacks.js";
import { pacedHttp } from "../enrich/paced.js";
import { RDAP_MIN_INTERVAL_MS, rdapDomainAge } from "../enrich/rdap.js";
import type { DailyStats } from "../stats.js";
import type { PipelineRepo, ProjectForScoring } from "../store/repo.js";
import { checkClaimLinks, saveLinkChecks } from "./link-checks.js";
import { LINK_KINDS } from "./merge.js";
import type { LinkKind } from "./merge.js";
import type { SignalCoverage } from "./signals.js";

/**
 * GoPlus rate-limits hard, so it has its own limiter and runs one request at a time. RDAP and crt.sh have their own
 * one-at-a-time queues too (`scoreProjects`).
 */
const GOPLUS_CONCURRENCY = 1;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** A stored signal last checked longer ago than this (kept through a source outage) counts as not checked. */
const SIGNAL_MAX_AGE_MS = 14 * DAY_MS;
/** Coverage of a project the `signals` stage did not store signals for this run. */
const NOT_CHECKED: SignalCoverage = { defillama: false, vc: false, alphadrops_raises: false };
/** The coverage entry of each source whose signals can be kept through an outage (curation spec §5.2, §9). */
const COVERAGE_OF: Partial<Record<SignalSource, keyof SignalCoverage>> = {
  defillama: "defillama",
  vc_portfolio: "vc",
  alphadrops: "alphadrops_raises",
};
/**
 * The verdict of a stored Analyst result. Only the verdict is checked: post-processing may leave no points, which the
 * answer schema (at least one point) would refuse.
 */
const STORED_VERDICT = analystSchema.pick({ verdict: true });
/** `capital_required` fact values, least demanding first. */
const CAPITAL_LEVELS = ["none", "low", "high"] as const;

function linkDomains(project: ProjectForScoring): RiskInput["linkDomains"] {
  const seen = new Set<string>();
  const out: RiskInput["linkDomains"] = [];
  for (const link of project.links) {
    const domain = registrableDomain(link.url);
    if (domain === null) continue;
    const kind: LinkKind = (LINK_KINDS as readonly string[]).includes(link.kind) ? (link.kind as LinkKind) : "website";
    const key = `${domain} ${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ domain, kind });
  }
  return out;
}

/**
 * The project's signals checked within the last 14 days, and the run's coverage with every source that had an older
 * signal set to "not checked": an older signal was kept through an outage and is given to neither `curate()` nor
 * `worth()`.
 */
function currentSignals(
  project: ProjectForScoring,
  runCoverage: SignalCoverage,
  now: Date,
): { signals: NewSignal[]; coverage: SignalCoverage } {
  const coverage = { ...runCoverage };
  const signals: NewSignal[] = [];
  for (const s of project.signals) {
    if (now.getTime() - s.observedAt.getTime() > SIGNAL_MAX_AGE_MS) {
      const key = COVERAGE_OF[s.source];
      if (key !== undefined) coverage[key] = false;
      continue;
    }
    signals.push({ kind: s.kind, value: s.value, source: s.source, verified: s.verified });
  }
  return { signals, coverage };
}

/** The most demanding `capital_required` fact among the project's sources; `unknown` when none states one. */
function capitalRequired(project: ProjectForScoring): WorthInput["capitalRequired"] {
  let index = -1;
  for (const fact of project.facts) {
    if (fact.field === "capital_required") {
      index = Math.max(index, (CAPITAL_LEVELS as readonly string[]).indexOf(fact.value));
    }
  }
  return CAPITAL_LEVELS[index] ?? "unknown";
}

/** A `tge` deadline with an exact or approximate date before `today`; month/quarter precision never counts. */
function tgePassed(project: ProjectForScoring, today: string): boolean {
  return project.deadlines.some(
    (d) => d.kind === "tge" && d.date !== null && (d.precision === "exact" || d.precision === "approximate") && d.date < today,
  );
}

/**
 * Whether the project's token traded on this run (#43): true with a current verified `coingecko_listed` signal, false
 * without one when DefiLlama was checked, null (unknown) when it was not.
 */
function coingeckoListed(signals: NewSignal[], coverage: SignalCoverage): boolean | null {
  if (signals.some((s) => s.kind === "coingecko_listed" && s.verified)) return true;
  return coverage.defillama ? false : null;
}

/** Which key domain checks (curation spec §6.2 rule 5) got an answer for at least one of the project's official domains. */
interface OfficialDomainChecks {
  domain_age: boolean;
  phishing_list: boolean;
}

function officialDomainChecks(
  project: ProjectForScoring,
  ages: ReadonlyMap<string, number | null>,
  phishing: ReadonlyMap<string, boolean | null>,
): OfficialDomainChecks {
  return {
    domain_age: project.officialDomains.some((d) => ages.get(d) != null),
    phishing_list: project.officialDomains.some((d) => phishing.get(d) != null),
  };
}

/**
 * The assessment with `domain_age` and `phishing_list` counted as run only when an official domain got an answer
 * (curation rule 5): `assessRisk` counts an answer for any link domain, a claim portal's included. Their `detail` is
 * kept. This is the assessment that is stored and that `curate()` reads, so the pipeline, the SQL
 * (`key_checks_ran()`, `public_risk_checks`) and the web share one meaning of "ran" (G5 I1).
 */
function withOfficialDomainChecks(assessment: RiskAssessment, official: OfficialDomainChecks): RiskAssessment {
  return {
    ...assessment,
    checks: assessment.checks.map((c) =>
      c.id === "domain_age" || c.id === "phishing_list" ? { ...c, ran: official[c.id] } : c,
    ),
  };
}

/**
 * The project's curation (curation spec §5.3, §6.2-6.3): `curate()` on the assessment just made (official-domain
 * checks already applied by `withOfficialDomainChecks`), and `worth()`, which is computed for a failing project too
 * (for its detail page). The AI can only lower either. An `ended` project's end date is the deadline that expired it,
 * else the one its latest curation carries, else `today`.
 */
async function curation(
  repo: PipelineRepo,
  project: ProjectForScoring,
  state: { status: Status; expiredOn: string | null; today: string; now: Date },
  assessment: RiskAssessment,
  aiFlags: RiskInput["aiFlags"],
  runCoverage: SignalCoverage,
): Promise<CurationRecord> {
  const { status, today } = state;
  const ended = status === "ended";
  const { signals, coverage } = currentSignals(project, runCoverage, state.now);
  const analyst = STORED_VERDICT.safeParse((await repo.latestAiAnalysis(project.id, "analyst"))?.result);
  const curated = curate({
    status,
    riskLevel: assessment.level,
    checks: assessment.checks,
    lookalikeOf: project.lookalikeOf,
    hasOfficialDomain: project.officialDomains.length > 0,
    signals,
    passedBeforeEnd: ended ? await repo.passedBeforeEnd(project.id) : false,
    // Stored scam analyses are post-processed: each flag left has a quote that passed quoteInSource. No analysis: [].
    aiScamPatterns: (aiFlags?.scam ?? []).filter((f) => f.quote.trim() !== "").map((f) => f.pattern),
  });
  const worthResult = worth({
    signals,
    tgePassed: tgePassed(project, today),
    sourceCount: project.sourceCount,
    capitalRequired: capitalRequired(project),
    taskCount: project.tasks.length,
    aiVerdict: analyst.success ? analyst.data.verdict : null,
  });
  return {
    passed: curated.passed,
    worthLevel: worthResult.level,
    worthPoints: worthResult.points,
    tab: curated.passed ? curated.tab : null,
    statusAt: status,
    endedOn: ended ? (state.expiredOn ?? (await repo.latestCuration(project.id))?.endedOn ?? today) : null,
    reasons: [...curated.reasons, ...worthResult.reasons],
    coverage: { ...coverage },
    coingeckoListed: coingeckoListed(signals, coverage),
  };
}

/** Rethrows the reason of the first rejected result, if any. */
function throwFirstRejection(results: readonly PromiseSettledResult<unknown>[]): void {
  const rejected = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (rejected) throw rejected.reason;
}

/** The track record (#43) from the whole curation history, ended projects no longer scored included. */
async function countTrackRecord(repo: PipelineRepo, stats: DailyStats): Promise<void> {
  const record = trackRecord(await repo.listCurationHistoryForTrackRecord());
  stats.track_record_total = record.total;
  stats.track_record_listed = record.listed;
  stats.track_record_no_token = record.noToken;
  stats.track_record_risk_raised = record.riskRaised;
}

function countCuration(stats: DailyStats, c: CurationRecord): void {
  stats.curation_checked += 1;
  if (c.passed) {
    stats.curation_passed += 1;
    if (c.tab === "live_now") stats.curation_passed_live_now += 1;
    else if (c.tab === "early_bets") stats.curation_passed_early_bets += 1;
    else if (c.tab === "ended") stats.curation_passed_ended += 1;
  } else if (c.reasons.some((r) => r.kind === "fail" && r.code === "insufficient_checks")) {
    stats.curation_hidden_insufficient_checks += 1;
  }
}

/**
 * Scores every project `listProjectsForScoring` returns (seen within `scoreActiveSinceDays`, still listed and open, or
 * ended after passing curation at most 90 days ago): expiry, risk assessment, then curation (`curations`). Enrichment
 * is fetched once per registrable domain per run (the job is daily, so this replaces a longer-lived cache), and hacks
 * once per run.
 * Domain age comes from RDAP, and from the first crt.sh certificate when RDAP has no RDAP service for the TLD (404) or
 * answers without a registration date; a rate-limited or failed RDAP lookup is not sent to crt.sh (the next run asks
 * RDAP again). RDAP runs one request at a time, `RDAP_MIN_INTERVAL_MS` apart, alongside GoPlus, and starts no request
 * after `rdapBudgetMinutes` (from the start of this step). crt.sh runs one at a time, `CRTSH_MIN_INTERVAL_MS` apart,
 * until it has been busy for `crtshBudgetMinutes`. Both take official domains first. Domains not asked count as not run.
 * GoPlus stops starting requests after `goplusBudgetMinutes` (by `deps.now()`, from the start of this step) or after
 * `goplusMaxConsecutiveFailures` domains in a row without an answer; the domains not asked count as not run.
 * The latest `scam` and `contradictions` analyses (from the `analyze` stage, earlier in the same run) go into
 * `RiskInput.aiFlags`; they can only add reasons and raise the level. Every claim/app link is classified from the
 * same per-domain GoPlus answers (`checkClaimLinks`), goes into `RiskInput.claimLinks` (a phishing one adds
 * `phishing_claim_link`, high) and, once every project is scored, into `link_checks`. Curation takes the signals the
 * `signals` stage stored and its `coverage` (by project id; a project missing from it had no source checked this run).
 * One project failing to save, whose analyses cannot be read, or whose curation throws, counts as `score_failed` and
 * does not stop the others. Last, the track record stats (#43) are counted from the curation history, also when no
 * project was scored; a failed read of that history is a stage error.
 */
export async function scoreProjects(
  deps: { repo: PipelineRepo; http: Http; sleep?: (ms: number) => Promise<void>; now: () => Date },
  config: PipelineConfig,
  now: Date,
  stats: DailyStats,
  coverage: ReadonlyMap<string, SignalCoverage> = new Map(),
): Promise<void> {
  const { repo, http } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const projects = await repo.listProjectsForScoring(config.scoreActiveSinceDays, now);
  if (projects.length === 0) {
    await countTrackRecord(repo, stats);
    return;
  }

  const domainsByProject = new Map(projects.map((p) => [p.id, linkDomains(p)]));
  // Social platforms (x.com, t.me, ...) are not the project's own domains: no phishing or age lookups.
  const enrichDomains = (links: RiskInput["linkDomains"]): string[] =>
    [...new Set(links.filter((l) => l.kind !== "social").map((l) => l.domain))];
  const domains = [...new Set([...domainsByProject.values()].flatMap(enrichDomains))];

  const goplusLimit = pLimit(GOPLUS_CONCURRENCY);
  const phishing = new Map<string, boolean | null>();
  let goplusStarted = false;
  const goplusDeadline = deps.now().getTime() + config.goplusBudgetMinutes * MINUTE_MS;
  let goplusFailuresInARow = 0;
  const goplusStopped = (): boolean =>
    deps.now().getTime() >= goplusDeadline || goplusFailuresInARow >= config.goplusMaxConsecutiveFailures;
  const ages = new Map<string, number | null>();
  const agesFromCrtsh = new Set<string>();
  const clock = (): number => deps.now().getTime();

  // Official domains first (stable within each group): a budget cut then skips the domains curation does not need.
  const officialSet = new Set(projects.flatMap((p) => p.officialDomains));
  const officialFirst = [...domains.filter((d) => officialSet.has(d)), ...domains.filter((d) => !officialSet.has(d))];

  // RDAP: one request at a time, at least RDAP_MIN_INTERVAL_MS between starts (retries included), until its budget.
  const rdapLimit = pLimit(1);
  const rdapHttp = pacedHttp(http, RDAP_MIN_INTERVAL_MS, clock, sleep);
  const rdapDeadline = clock() + config.rdapBudgetMinutes * MINUTE_MS;
  // crt.sh: only the domains RDAP has no date for, as RDAP finds them; one at a time, CRTSH_MIN_INTERVAL_MS apart.
  // Its budget counts only the time crt.sh is busy (pacing wait plus request), not the time it waits for RDAP to find
  // a domain, so a no-RDAP domain found late in the RDAP run still gets its turn. Each turn takes the next waiting
  // official domain before any other.
  const crtshLimit = pLimit(1);
  const crtshHttp = pacedHttp(http, CRTSH_MIN_INTERVAL_MS, clock, sleep);
  const crtshBudgetMs = config.crtshBudgetMinutes * MINUTE_MS;
  let crtshBusyMs = 0;
  const crtshWaiting = { official: [] as string[], other: [] as string[] };
  // Each crt.sh task gets its rejection handler when it is queued (its error is kept in `crtshErrors`), so a crt.sh
  // throw is never an unhandled rejection while RDAP is still running.
  const crtshTasks: Promise<void>[] = [];
  const crtshErrors: unknown[] = [];
  const askCrtsh = (domain: string): Promise<void> => {
    (officialSet.has(domain) ? crtshWaiting.official : crtshWaiting.other).push(domain);
    // One turn per queued domain; the turn takes whichever domain is first in line when it runs.
    return crtshLimit(async () => {
      const next = crtshWaiting.official.shift() ?? crtshWaiting.other.shift();
      if (next === undefined) return;
      if (crtshBusyMs >= crtshBudgetMs) {
        stats.domain_age_crtsh_skipped += 1;
        stats.domain_age_crtsh_failed += 1;
        return;
      }
      const startedAt = clock();
      try {
        const age = await firstCertificateAgeDays(crtshHttp, next, now);
        if (age === null) {
          stats.domain_age_crtsh_failed += 1;
          return;
        }
        ages.set(next, age);
        agesFromCrtsh.add(next);
      } finally {
        crtshBusyMs += clock() - startedAt;
      }
    });
  };
  const askRdap = (domain: string): Promise<void> =>
    rdapLimit(async () => {
      ages.set(domain, null);
      if (clock() >= rdapDeadline) {
        stats.domain_age_rdap_skipped += 1;
        stats.domain_age_rdap_failed += 1;
        return;
      }
      const { outcome, days } = await rdapDomainAge(rdapHttp, domain, now, sleep, clock);
      if (outcome === "age") {
        ages.set(domain, days);
        return;
      }
      stats.domain_age_rdap_failed += 1;
      if (outcome === "rate_limited") stats.domain_age_rdap_rate_limited += 1;
      if (outcome === "no_rdap") stats.domain_age_no_rdap += 1;
      // Rate-limited or failed domains are not sent to crt.sh: the next run asks RDAP again.
      if (outcome === "no_rdap" || outcome === "no_date") {
        crtshTasks.push(askCrtsh(domain).then(undefined, (error: unknown) => void crtshErrors.push(error)));
      }
    });

  /** RDAP for every domain, then the crt.sh lookups it queued; settles only when all of them have. */
  const domainAge = async (): Promise<void> => {
    const rdap = await Promise.allSettled(officialFirst.map(askRdap));
    // Every crt.sh task was queued by an RDAP task, all of which have settled.
    await Promise.all(crtshTasks);
    throwFirstRejection(rdap);
    if (crtshErrors.length > 0) throw crtshErrors[0];
  };

  // GoPlus, RDAP (and crt.sh behind it) and the hacks list run alongside each other, each on its own queue. Everything
  // settles before a failure is rethrown, so no rejection goes unhandled and no request outlives the stage.
  const settled = await Promise.allSettled([
    fetchHacks(http),
    domainAge(),
    ...domains.map((domain) =>
      goplusLimit(async () => {
        if (goplusStopped()) {
          phishing.set(domain, null);
          stats.phishing_list_skipped += 1;
          return;
        }
        // The limiter runs these one at a time; leave a pause between consecutive requests (GoPlus rate-limits bursts).
        if (goplusStarted) await sleep(GOPLUS_MIN_INTERVAL_MS);
        goplusStarted = true;
        const onRateLimited = (): void => void (stats.phishing_list_rate_limited += 1);
        const flag = await checkPhishingSite(http, `https://${domain}`, sleep, onRateLimited);
        goplusFailuresInARow = flag === null ? goplusFailuresInARow + 1 : 0;
        phishing.set(domain, flag);
      }),
    ),
  ]);
  throwFirstRejection(settled);
  const hacks = (settled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof fetchHacks>>>).value;

  stats.domain_age_from_crtsh = agesFromCrtsh.size;
  stats.phishing_list_failed = domains.filter((d) => phishing.get(d) === null).length;
  // Claim/app links (#42): classified from the per-domain GoPlus answers above; GoPlus is never asked again here.
  const claimLinks = checkClaimLinks(projects, phishing);
  for (const project of projects) {
    if (project.officialDomains.length === 0) continue;
    stats.projects_with_official_domain += 1;
    const official = officialDomainChecks(project, ages, phishing);
    if (official.domain_age) stats.domain_age_ran += 1;
    if (official.phishing_list) stats.phishing_list_ran += 1;
  }

  // What the lookalike check compared against (#53). Only shown on the project page, so a failed count is left unknown
  // instead of stopping the scoring.
  const officialDomainCount = await repo.countOfficialDomains().catch(() => null);

  const today = now.toISOString().slice(0, 10);
  for (const project of projects) {
    const projectLinks = domainsByProject.get(project.id) ?? [];
    const projectDomains = enrichDomains(projectLinks);
    try {
      // A passed claim/campaign_end with nothing ahead ends the project; the status change is logged by updateProject.
      const { status, expired, basis } = expireStatus(project.status, project.deadlines, today);
      if (expired) await repo.updateProject(project.id, { status }, now);
      // A failed read throws (score_failed, previous assessment kept): assessing without the AI flags would drop them.
      const [scam, contradictions] = await Promise.all([
        repo.latestAiAnalysis(project.id, "scam"),
        repo.latestAiAnalysis(project.id, "contradictions"),
      ]);
      const input: RiskInput = {
        project: {
          name: project.name,
          officialDomains: project.officialDomains,
          status,
          tokenSymbol: project.tokenSymbol,
          conflict: project.conflict,
          sourceCount: project.sourceCount,
          hasOfficialSocial: projectLinks.some((l) => l.kind === "social"),
          lookalikeOf: project.lookalikeOf,
          lookalikeOfName: project.lookalikeOfName,
          lookalikeOfDomains: project.lookalikeOfDomains,
        },
        tasks: project.tasks,
        sourceAsks: project.sourceAsks,
        linkDomains: projectLinks,
        domainAgeDays: Object.fromEntries(projectDomains.map((d) => [d, ages.get(d) ?? null])),
        phishingFlags: Object.fromEntries(projectDomains.map((d) => [d, phishing.get(d) ?? null])),
        token: null,
        contractVerified: null,
        hackCount: hacks ? countHacks(hacks, project.name) : null,
        aiFlags: aiFlagsFromAnalyses(scam?.result ?? null, contradictions?.result ?? null),
        claimLinks: claimLinks.byProject.get(project.id) ?? [],
        officialDomainCount,
      };
      const official = officialDomainChecks(project, ages, phishing);
      const assessment = withOfficialDomainChecks(assessRisk(input), official);
      await repo.saveRiskAssessment(project.id, assessment, now);
      stats.assessed += 1;
      const state = { status, expiredOn: basis?.date ?? null, today, now };
      const runCoverage = coverage.get(project.id) ?? NOT_CHECKED;
      const record = await curation(repo, project, state, assessment, input.aiFlags, runCoverage);
      await repo.saveCuration(project.id, record, now);
      countCuration(stats, record);
    } catch {
      stats.score_failed += 1;
    }
  }
  // After every project is scored, so a link_checks write that fails (a stage error) never keeps a project unscored.
  await saveLinkChecks(repo, claimLinks.byUrl, now, stats);
  await countTrackRecord(repo, stats);
}
