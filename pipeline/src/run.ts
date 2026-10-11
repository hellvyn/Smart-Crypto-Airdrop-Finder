import { cleanUrl } from "@saf/core";
import type { DefillamaProtocol, SpeculativeCandidate } from "./collectors/defillama.js";
import type { Http } from "./collectors/types.js";
import type { PipelineConfig } from "./config.js";
import { countAlphaDropsRequests, loadRaises } from "./enrich/alphadrops-raises.js";
import { refreshPortfolios } from "./enrich/vc-portfolios.js";
import type { ChatFn } from "./llm/extract.js";
import { ANALYZERS, runAnalyses } from "./steps/analyze.js";
import type { Analyzer } from "./steps/analyze.js";
import { collectSources } from "./steps/collect.js";
import type { SpeculativeItem } from "./steps/collect.js";
import type { ExtractionResult } from "@saf/core";
import { extractPending } from "./steps/extract.js";
import { mergeDocument } from "./steps/merge.js";
import type { ProjectInput } from "./steps/merge.js";
import { purgeOldText } from "./steps/purge.js";
import { scoreProjects } from "./steps/score.js";
import { refreshSignals } from "./steps/signals.js";
import { emptyStats } from "./stats.js";
import type { DailyStats } from "./stats.js";
import type { Fact, PipelineRepo, StoredDocument } from "./store/repo.js";

export type { PipelineConfig } from "./config.js";

export interface PipelineDeps {
  repo: PipelineRepo;
  http: Http;
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
 * runs between `speculative` and `analyze`, and `analyze` (9) runs after `signals` and before `score`.
 */
const STEP = { collect: 1, extract: 2, speculative: 4, score: 5, purge: 6, signals: 8, analyze: 9 } as const;

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
 * speculative merge, signals, AI analyses, score, purge.
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
 * rethrown at the end. Stats are numeric counters only.
 */
export async function runDaily(deps: PipelineDeps, config: PipelineConfig): Promise<DailyStats> {
  const { repo } = deps;
  const now = deps.now();
  const stats = emptyStats();
  const runId = await repo.startRun(now);
  const failure: { failed: boolean; error?: unknown } = { failed: false };

  const stage = async <T>(step: number, fallback: T, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      if (!failure.failed) {
        failure.failed = true;
        failure.error = error;
        stats.run_error = 1;
        stats.failed_step = step;
      }
      return fallback;
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
    STEP.collect,
    { speculative: [] as SpeculativeItem[], protocols: null as DefillamaProtocol[] | null },
    () => collectSources({ ...deps, http: alphaDrops.http }, config, now, stats),
  );
  // Single-slot merge queue: each merge starts after the previous one settled. mergeOne never rejects.
  let mergeTail: Promise<void> = Promise.resolve();
  const enqueueMerge = (document: StoredDocument, result: ExtractionResult): void => {
    mergeTail = mergeTail.then(() => mergeOne(document, extractionInputs(result), true));
  };
  await stage(STEP.extract, undefined, async () => {
    try {
      await extractPending(deps, config, stats, enqueueMerge);
    } finally {
      await mergeTail;
    }
  });

  await stage(STEP.speculative, undefined, async () => {
    for (const { document, candidate } of collected.speculative) {
      await mergeOne(document, [speculativeInput(candidate)], false);
    }
  });

  await stage(STEP.signals, undefined, async () => {
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
    await refreshSignals(deps, config, now, stats, { protocols: collected.protocols, vc, raises }, projects);
  });
  const analyzers = deps.analyzers ?? ANALYZERS;
  await stage(STEP.analyze, undefined, async () => {
    if (analyzers.length === 0) return;
    const projects = await repo.listProjectsForScoring(config.scoreActiveSinceDays, now);
    await runAnalyses({ ...deps, analyzers }, config, projects, stats);
  });

  await stage(STEP.score, undefined, () => scoreProjects(deps, config, now, stats));
  await stage(STEP.purge, undefined, () => purgeOldText(repo, config.textRetentionDays, now, stats));

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
