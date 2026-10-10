import { cleanUrl } from "@saf/core";
import type { SpeculativeCandidate } from "./collectors/defillama.js";
import type { Http } from "./collectors/types.js";
import type { PipelineConfig } from "./config.js";
import type { ChatFn } from "./llm/extract.js";
import { collectSources } from "./steps/collect.js";
import type { SpeculativeItem } from "./steps/collect.js";
import { extractPending } from "./steps/extract.js";
import type { ExtractedDocument } from "./steps/extract.js";
import { mergeDocument } from "./steps/merge.js";
import type { ProjectInput } from "./steps/merge.js";
import { purgeOldText } from "./steps/purge.js";
import { scoreProjects } from "./steps/score.js";
import { emptyStats } from "./stats.js";
import type { DailyStats } from "./stats.js";
import type { PipelineRepo, StoredDocument } from "./store/repo.js";

export type { PipelineConfig } from "./config.js";

export interface PipelineDeps {
  repo: PipelineRepo;
  http: Http;
  /** `streamChat` with its transport deps bound. */
  chat: ChatFn;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
}

/** Stage numbers reported in `failed_step` for the first stage-level error. */
const STEP = { collect: 1, extract: 2, merge: 3, speculative: 4, score: 5, purge: 6 } as const;

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
    tasks: [],
    deadlines: [],
    urls,
    websiteUrl,
    source: "defillama",
  };
}

/**
 * One daily pipeline run: collect, extract, merge, DefiLlama speculative merge, score, purge.
 *
 * Item-level failures (one document's merge, one project's assessment, one extraction) are counted
 * (`merge_failed`, `score_failed`, `extract_failed`) and never stop the run. A stage-level failure is
 * recorded as `run_error: 1` plus `failed_step` (the first failing stage); the remaining stages still run,
 * so scoring and purging always happen. The run row is always finished, and a stage-level error is
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
      await mergeDocument(repo, document, inputs, now, stats);
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

  const speculative = await stage(STEP.collect, [] as SpeculativeItem[], () =>
    collectSources(deps, config, now, stats),
  );
  const extracted = await stage(STEP.extract, [] as ExtractedDocument[], () => extractPending(deps, config, stats));

  await stage(STEP.merge, undefined, async () => {
    for (const { document, result } of extracted) {
      const inputs: ProjectInput[] = result.projects.map((p) => ({
        name: p.name,
        tokenSymbol: p.token_symbol,
        chains: p.chains,
        status: p.status,
        quote: p.status_evidence,
        tasks: p.tasks,
        deadlines: p.deadlines,
        urls: p.official_urls,
        websiteUrl: null,
        source: "extraction",
      }));
      await mergeOne(document, inputs, true);
    }
  });

  await stage(STEP.speculative, undefined, async () => {
    for (const { document, candidate } of speculative) {
      await mergeOne(document, [speculativeInput(candidate)], false);
    }
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
