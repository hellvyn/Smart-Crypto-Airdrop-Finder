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
import { firstCertificateAgeDays } from "../enrich/crtsh.js";
import { GOPLUS_MIN_INTERVAL_MS, checkPhishingSite, defaultSleep } from "../enrich/goplus.js";
import { countHacks, fetchHacks } from "../enrich/hacks.js";
import { domainAgeDays } from "../enrich/rdap.js";
import type { DailyStats } from "../stats.js";
import type { PipelineRepo, ProjectForScoring } from "../store/repo.js";
import { checkClaimLinks, saveLinkChecks } from "./link-checks.js";
import { LINK_KINDS } from "./merge.js";
import type { LinkKind } from "./merge.js";
import type { SignalCoverage } from "./signals.js";

/** Maximum parallel enrichment requests (RDAP and crt.sh domain age, DefiLlama hacks). */
const ENRICH_CONCURRENCY = 4;
/** GoPlus rate-limits hard, so it has its own limiter and runs one request at a time. */
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
 * The project's curation (curation spec §5.3, §6.2-6.3): `curate()` on the assessment just made, and `worth()`, which
 * is computed for a failing project too (for its detail page). The AI can only lower either. An `ended` project's end
 * date is the deadline that expired it, else the one its latest curation carries, else `today`.
 * `curate()` gets the assessment's checks with `domain_age` and `phishing_list` counted as run only when an official
 * domain got an answer (rule 5): the assessment counts an answer for any link domain, a claim portal's included.
 */
async function curation(
  repo: PipelineRepo,
  project: ProjectForScoring,
  state: { status: Status; expiredOn: string | null; today: string; now: Date },
  assessment: RiskAssessment,
  aiFlags: RiskInput["aiFlags"],
  runCoverage: SignalCoverage,
  official: OfficialDomainChecks,
): Promise<CurationRecord> {
  const { status, today } = state;
  const ended = status === "ended";
  const { signals, coverage } = currentSignals(project, runCoverage, state.now);
  const analyst = STORED_VERDICT.safeParse((await repo.latestAiAnalysis(project.id, "analyst"))?.result);
  const curated = curate({
    status,
    riskLevel: assessment.level,
    checks: assessment.checks.map((c) =>
      c.id === "domain_age" || c.id === "phishing_list" ? { ...c, ran: official[c.id] } : c,
    ),
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
 * Domain age comes from RDAP, and from the first crt.sh certificate when RDAP has no answer.
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

  const limit = pLimit(ENRICH_CONCURRENCY);
  const goplusLimit = pLimit(GOPLUS_CONCURRENCY);
  const phishing = new Map<string, boolean | null>();
  let goplusStarted = false;
  const goplusDeadline = deps.now().getTime() + config.goplusBudgetMinutes * MINUTE_MS;
  let goplusFailuresInARow = 0;
  const goplusStopped = (): boolean =>
    deps.now().getTime() >= goplusDeadline || goplusFailuresInARow >= config.goplusMaxConsecutiveFailures;
  const ages = new Map<string, number | null>();
  const agesFromCrtsh = new Set<string>();
  const [hacks] = await Promise.all([
    limit(() => fetchHacks(http)),
    ...domains.flatMap((domain) => [
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
      limit(async () => {
        let age = await domainAgeDays(http, domain, now);
        if (age === null) {
          age = await firstCertificateAgeDays(http, domain, now);
          if (age !== null) agesFromCrtsh.add(domain);
        }
        ages.set(domain, age);
      }),
    ]),
  ]);

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
      };
      const assessment = assessRisk(input);
      await repo.saveRiskAssessment(project.id, assessment, now);
      stats.assessed += 1;
      const state = { status, expiredOn: basis?.date ?? null, today, now };
      const runCoverage = coverage.get(project.id) ?? NOT_CHECKED;
      const official = officialDomainChecks(project, ages, phishing);
      const record = await curation(repo, project, state, assessment, input.aiFlags, runCoverage, official);
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
