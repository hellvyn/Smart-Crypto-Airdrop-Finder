import { cleanUrl } from "@saf/core";
import type { DefillamaProtocol, SpeculativeCandidate } from "./collectors/defillama.js";
import type { Http } from "./collectors/types.js";
import type { PipelineConfig } from "./config.js";
import { countAlphaDropsRequests, loadRaises } from "./enrich/alphadrops-raises.js";
import { refreshPortfolios } from "./enrich/vc-portfolios.js";
import type { ChatFn } from "./llm/extract.js";
import type { FetchImage, FetchUntrusted } from "./http.js";
import { ANALYZERS, claimPageSources, listedFirst, runAnalyses } from "./steps/analyze.js";
import type { Analyzer, SourceText } from "./steps/analyze.js";
import { collectSources } from "./steps/collect.js";
import type { SpeculativeItem } from "./steps/collect.js";
import type { ExtractionResult } from "@saf/core";
import { extractPending } from "./steps/extract.js";
import { readClaimPages } from "./steps/link-checks.js";
import { mergeDocument } from "./steps/merge.js";
import type { ProjectInput } from "./steps/merge.js";
import { purgeCoach, purgeOldText } from "./steps/purge.js";
import { runBriefing } from "./steps/briefing.js";
import { refreshLogos } from "./steps/logos.js";
import { scoreProjects } from "./steps/score.js";
import { refreshSignals } from "./steps/signals.js";
import type { SignalCoverage } from "./steps/signals.js";
import { emptyStats } from "./stats.js";
import type { DailyStats } from "./stats.js";
import type { Fact, PipelineRepo, StoredDocument } from "./store/repo.js";

export type { PipelineConfig } from "./config.js";

export interface PipelineDeps {
  repo: PipelineRepo;
  http: Http;
  /** Fetch for pages an unknown party wrote: the claim portals the AI Scam Analyst reads (`createFetchUntrusted`). */
  fetchUntrusted: FetchUntrusted;
  /** Download of project logos (`createFetchImage`): https, 5 s, 64 KB, magic bytes, allowed hosts only. */
  fetchImage: FetchImage;
  /** `streamChat` with its transport deps bound. */
  chat: ChatFn;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  /** The AI analyses of the `analyze` stage; defaults to `ANALYZERS`. */
  analyzers?: Analyzer[];
  /** Where a failed AI analysis is reported (project id and kind only); defaults to console.warn. */
  warn?: (line: string) => void;
}

/**
 * Stage numbers reported in `failed_step` for the first stage-level error. Merging runs inside the extract
 * stage (each document is merged as soon as it is extracted), so 3 is no longer reported. 7 was a stage that
 * no longer exists; the numbers of the other stages stay as they were. New stages get new numbers: `signals` (8)
 * runs between `speculative` and `analyze`, `analyze` (9) runs after `signals` and before `score`, and `logos` (10)
 * runs after `score` (it needs that run's phishing answers) and before `purge`, and `briefing` (11) runs after `score`
 * (it reads the changes and curations that run wrote) and before `logos`.
 */
const STEP = {
  collect: 1,
  extract: 2,
  speculative: 4,
  score: 5,
  purge: 6,
  signals: 8,
  analyze: 9,
  logos: 10,
  briefing: 11,
  analyze_listed: 12,
} as const;

type ExtractedProject = ExtractionResult["projects"][number];

/**
 * The v3 facts of one extracted project as evidence (see `FACT_FIELDS`). Entries whose quote was not in the
 * source were already dropped by extraction; a `capital_required` of `unknown` and a null `capital_min_usd`
 * are not facts.
 */
function extractedFacts(p: ExtractedProject): Fact[] {
  const facts: Fact[] = [
    ...p.key_parameters.map((k) => ({ field: `key_parameter:${k.name}`, value: k.value, quote: k.quote })),
    ...p.source_ratings.map((r) => ({ field: `source_rating:${r.name}`, value: r.value, quote: r.quote })),
  ];
  if (p.latest_update !== null) {
    facts.push({ field: "latest_update", value: p.latest_update.date ?? "", quote: p.latest_update.text });
  }
  facts.push(...p.claimed_backers.map((b) => ({ field: "claimed_backer", value: b.investor, quote: b.quote })));
  if (p.capital_required !== "unknown") facts.push({ field: "capital_required", value: p.capital_required, quote: "" });
  if (p.capital_min_usd !== null) facts.push({ field: "capital_min_usd", value: String(p.capital_min_usd), quote: "" });
  return facts;
}

function extractionInputs(result: ExtractionResult): ProjectInput[] {
  return result.projects.map((p) => ({
    name: p.name,
    tokenSymbol: p.token_symbol,
    chains: p.chains,
    status: p.status,
    quote: p.status_evidence,
    // An answer without steps (v2 shape) keeps its flat task list, as one-time steps.
    steps: p.steps.length > 0 ? p.steps : p.tasks.map((text) => ({ text, cadence: "once" as const })),
    facts: extractedFacts(p),
    deadlines: p.deadlines,
    urls: p.official_urls,
    websiteUrl: null,
    source: "extraction",
  }));
}

function speculativeInput(c: SpeculativeCandidate): ProjectInput {
  let websiteUrl: string | null = null;
  if (c.url) {
    try {
      websiteUrl = cleanUrl(c.url).url;
    } catch {
      // Not an absolute URL: no link.
    }
  }
  const urls = c.twitter === null ? [] : [`https://x.com/${c.twitter}`];
  return {
    name: c.name,
    tokenSymbol: null,
    chains: c.chains,
    status: "speculative",
    quote: `No token listed; TVL $${Math.round(c.tvl)}, 7d change ${c.change7d === null ? "n/a" : `${c.change7d.toFixed(2)}%`} (DefiLlama)`,
    steps: [],
    facts: [],
    deadlines: [],
    urls,
    websiteUrl,
    source: "defillama",
  };
}

/**
 * One daily pipeline run: collect, extract (each document merged right after its extraction), DefiLlama
 * speculative merge, signals, AI analyses, score, briefing, logos, purge.
 *
 * Merges go through a single-slot queue: they run one at a time, in the order extractions finish, while
 * other extractions continue. The extract stage waits for the queue to drain, even when it fails.
 * Extraction stops starting LLM calls after `extractBudgetMinutes`, and AI analyses after `analyzeBudgetMinutes`,
 * so score and purge always get their turn within the job's time limit.
 *
 * Item-level failures (one document's merge, one project's signals, one project's assessment, one extraction, one AI
 * analysis) are counted (`merge_failed`, `signals_failed`, `score_failed`, `extract_failed`, `ai_analyses_failed`)
 * and never stop the run. A stage-level failure is recorded as `run_error: 1` plus `failed_step` (the first failing
 * stage); the remaining stages still run, so scoring and purging always happen. The run row is always finished, and a stage-level error is
 * rethrown at the end. Stats are numeric counters only; `stage_seconds_<stage>` gives each stage's duration on
 * `deps.now()`.
 */
export async function runDaily(deps: PipelineDeps, config: PipelineConfig): Promise<DailyStats> {
  const { repo } = deps;
  const now = deps.now();
  const stats = emptyStats();
  const runId = await repo.startRun(now);
  const failure: { failed: boolean; error?: unknown } = { failed: false };

  /** Runs one stage, records its duration in `stage_seconds_<name>` (also when it throws) and catches its error. */
  const stage = async <T>(name: keyof typeof STEP, fallback: T, fn: () => Promise<T>): Promise<T> => {
    const startedAt = deps.now().getTime();
    try {
      return await fn();
    } catch (error) {
      if (!failure.failed) {
        failure.failed = true;
        failure.error = error;
        stats.run_error = 1;
        stats.failed_step = STEP[name];
      }
      return fallback;
    } finally {
      stats[`stage_seconds_${name}`] = Math.round((deps.now().getTime() - startedAt) / 100) / 10;
    }
  };

  /** Merges one document; a throw marks it `merge_failed` (retried only when its content changes). */
  const mergeOne = async (document: StoredDocument, inputs: ProjectInput[], markDone: boolean): Promise<void> => {
    try {
      await mergeDocument(repo, document, inputs, now, stats, config.alphadrops.intermediaryHosts);
      if (markDone) await repo.setExtractionStatus(document.id, "done");
    } catch {
      stats.merge_failed += 1;
      try {
        await repo.setExtractionStatus(document.id, "merge_failed");
      } catch {
        // The document stays in its previous state; the counter still records the failure.
      }
    }
  };

  // Every AlphaDrops request of the run goes through this counter (collector and raise pages share one budget).
  const alphaDrops = countAlphaDropsRequests(deps.http);
  const collected = await stage(
    "collect",
    { speculative: [] as SpeculativeItem[], protocols: null as DefillamaProtocol[] | null },
    () => collectSources({ ...deps, http: alphaDrops.http }, config, now, stats),
  );
  // Single-slot merge queue: each merge starts after the previous one settled. mergeOne never rejects.
  let mergeTail: Promise<void> = Promise.resolve();
  const enqueueMerge = (document: StoredDocument, result: ExtractionResult): void => {
    mergeTail = mergeTail.then(() => mergeOne(document, extractionInputs(result), true));
  };
  await stage("extract", undefined, async () => {
    try {
      await extractPending(deps, config, stats, enqueueMerge);
    } finally {
      await mergeTail;
    }
  });

  await stage("speculative", undefined, async () => {
    for (const { document, candidate } of collected.speculative) {
      await mergeOne(document, [speculativeInput(candidate)], false);
    }
  });

  // Which signal sources each project had checked this run; a project missing here had none checked.
  let coverage = new Map<string, SignalCoverage>();
  await stage("signals", undefined, async () => {
    // A failed VC page only leaves that VC "not checked"; refreshPortfolios does not throw for one VC.
    const vc = await refreshPortfolios(deps, config.vcs, now);
    stats.vc_portfolios_failed += vc.failed.size;
    const projects = await repo.listProjectsForScoring(config.scoreActiveSinceDays, now);
    // The raise pages get the AlphaDrops requests the collector left (maxRequestsPerRun is for both together).
    const raises = config.alphadrops.enabled
      ? await loadRaises(
          { repo, http: alphaDrops.http, sleep: deps.sleep },
          projects,
          {
            maxPages: config.alphadrops.maxRaisePages,
            maxRequests: config.alphadrops.maxRequestsPerRun - alphaDrops.count(),
            delayMs: config.alphadrops.delayMs,
          },
          now,
          stats,
        )
      : null;
    coverage = await refreshSignals(deps, config, now, stats, { protocols: collected.protocols, vc, raises }, projects);
  });
  const analyzers = deps.analyzers ?? ANALYZERS;
  let claimPages = new Map<string, SourceText[]>();
  // The projects the analyze stage already treated as listed (uncapped); analyze_listed takes only the others.
  let analyzedAsListed = new Set<string>();
  await stage("analyze", undefined, async () => {
    if (analyzers.length === 0) return;
    // Listed projects first and past the per-run cap: members see them, so their AI section must not stay empty.
    const all = await repo.listProjectsForScoring(config.scoreActiveSinceDays, now);
    const listedIds = await repo.listListedProjects(all.map((p) => p.id));
    analyzedAsListed = new Set(listedIds);
    const projects = listedFirst(all, listedIds);
    // Claim portal pages are read here, before the scam analyst, so it sees them in this run (#56).
    if (analyzers.some((a) => a.kind === "scam")) {
      claimPages = await readClaimPages({ repo, fetchUntrusted: deps.fetchUntrusted }, projects, now, stats);
    }
    await runAnalyses(
      { ...deps, analyzers, extraSources: claimPageSources(claimPages), uncapped: new Set(listedIds) },
      config,
      projects,
      stats,
    );
  });

  // A failed `score` leaves no phishing answer, so the logos stage then asks no favicon.
  const phishing = await stage("score", new Map<string, boolean | null>(), () =>
    scoreProjects(deps, config, now, stats, coverage),
  );
  // Projects this run put on the list get their AI analyses now, not the next day (an unchanged input reuses the
  // stored analysis without a call, so projects already analysed cost only reads).
  await stage("analyze_listed", undefined, async () => {
    if (analyzers.length === 0) return;
    const all = await repo.listProjectsForScoring(config.scoreActiveSinceDays, now);
    const listed = new Set(await repo.listListedProjects(all.map((p) => p.id)));
    const newlyListed = all.filter((p) => listed.has(p.id) && !analyzedAsListed.has(p.id));
    if (newlyListed.length === 0) return;
    // Counted apart and then merged: the analyze stage already counted each of these analyses once (deferred, failed
    // or cached), so only the ones that now ran are added, and they leave the deferred count. A model failure here is
    // not counted again. (If one that failed there runs here, deferred goes down instead of failed: a rare,
    // count-only inaccuracy.)
    const catchUp = emptyStats();
    await runAnalyses(
      { ...deps, analyzers, extraSources: claimPageSources(claimPages), uncapped: listed },
      { ...config, analyzeBudgetMinutes: config.analyzeListedBudgetMinutes },
      newlyListed,
      catchUp,
    );
    stats.ai_analyses_run += catchUp.ai_analyses_run;
    stats.ai_style_violations += catchUp.ai_style_violations;
    stats.ai_analyses_deferred = Math.max(0, stats.ai_analyses_deferred - catchUp.ai_analyses_run);
    stats.ai_models_tripped = Math.max(stats.ai_models_tripped, catchUp.ai_models_tripped);
  });
  await stage("briefing", undefined, () => runBriefing(deps, config, stats));
  await stage("logos", undefined, async () => {
    const projects = await repo.listProjectsForScoring(config.scoreActiveSinceDays, now);
    await refreshLogos(deps, config, projects, { protocols: collected.protocols, phishing }, now, stats);
  });
  await stage("purge", undefined, async () => {
    await purgeOldText(repo, config.textRetentionDays, now, stats);
    await purgeCoach(repo, now, stats);
  });

  if (failure.failed) {
    try {
      await repo.finishRun(runId, { ...stats }, deps.now());
    } catch {
      // Keep the original error.
    }
    throw failure.error;
  }
  await repo.finishRun(runId, { ...stats }, deps.now());
  return stats;
}
