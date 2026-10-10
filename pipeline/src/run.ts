import { cleanUrl } from "@saf/core";
import type { SpeculativeCandidate } from "./collectors/defillama.js";
import type { Http } from "./collectors/types.js";
import type { PipelineConfig } from "./config.js";
import type { ChatFn } from "./llm/extract.js";
import { collectSources } from "./steps/collect.js";
import { extractPending } from "./steps/extract.js";
import { mergeDocument } from "./steps/merge.js";
import type { ProjectInput } from "./steps/merge.js";
import { purgeOldText } from "./steps/purge.js";
import { scoreProjects } from "./steps/score.js";
import { emptyStats } from "./stats.js";
import type { DailyStats } from "./stats.js";
import type { PipelineRepo } from "./store/repo.js";

export type { PipelineConfig } from "./config.js";

export interface PipelineDeps {
  repo: PipelineRepo;
  http: Http;
  /** `streamChat` with its transport deps bound. */
  chat: ChatFn;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
}

/** Step numbers reported in `failed_step` when a run aborts. */
const STEP = { collect: 1, extract: 2, merge: 3, speculative: 4, score: 5, purge: 6 } as const;

function speculativeInput(c: SpeculativeCandidate): ProjectInput {
  const urls: string[] = [];
  if (c.url) {
    try {
      urls.push(cleanUrl(c.url).url);
    } catch {
      // Not an absolute URL: no link.
    }
  }
  return {
    name: c.name,
    tokenSymbol: null,
    chains: c.chains,
    status: "speculative",
    quote: `No token listed; TVL $${Math.round(c.tvl)} (DefiLlama)`,
    tasks: [],
    deadlines: [],
    urls,
  };
}

/**
 * One daily pipeline run: collect, extract, merge, DefiLlama speculative merge, score, purge.
 * The run row is always finished; on an unexpected error it records `run_error: 1` and the
 * failing step, then rethrows. Stats are numeric counters only.
 */
export async function runDaily(deps: PipelineDeps, config: PipelineConfig): Promise<DailyStats> {
  const { repo } = deps;
  const now = deps.now();
  const stats = emptyStats();
  const runId = await repo.startRun(now);
  let step: number = STEP.collect;

  try {
    const speculative = await collectSources(deps, config, now, stats);

    step = STEP.extract;
    const extracted = await extractPending(deps, config, stats);

    step = STEP.merge;
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
      }));
      await mergeDocument(repo, document, inputs, now, stats);
      await repo.setExtractionStatus(document.id, "done");
    }

    step = STEP.speculative;
    for (const { document, candidate } of speculative) {
      await mergeDocument(repo, document, [speculativeInput(candidate)], now, stats);
    }

    step = STEP.score;
    await scoreProjects(deps, config, now, stats);

    step = STEP.purge;
    await purgeOldText(repo, config.textRetentionDays, now, stats);
  } catch (error) {
    stats.run_error = 1;
    stats.failed_step = step;
    try {
      await repo.finishRun(runId, { ...stats }, deps.now());
    } catch {
      // Keep the original error.
    }
    throw error;
  }

  await repo.finishRun(runId, { ...stats }, deps.now());
  return stats;
}
