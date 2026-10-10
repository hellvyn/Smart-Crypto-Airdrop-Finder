import pLimit from "p-limit";
import type { ExtractionResult } from "@saf/core";
import type { PipelineConfig } from "../config.js";
import { createCircuitBreaker } from "../llm/circuit-breaker.js";
import { extractWithFallback } from "../llm/extract.js";
import type { ChatFn } from "../llm/extract.js";
import { PROMPT_VERSION } from "../llm/prompt.js";
import type { DailyStats } from "../stats.js";
import type { PipelineRepo, StoredDocument } from "../store/repo.js";

const MINUTE_MS = 60_000;

/** Consecutive failures after which a model is skipped for the rest of the run. */
export const CIRCUIT_BREAKER_THRESHOLD = 3;

/**
 * Extracts up to `maxDocumentsPerRun` pending documents, `llmConcurrency` at a time, and stores every attempt.
 *
 * - An airdrop document is handed to `onExtracted` as soon as its extraction succeeds (the caller merges it
 *   and marks it `done`). `onExtracted` must not throw.
 * - Not-airdrop documents are marked `not_airdrop`.
 * - A document whose models all fail, or whose bookkeeping throws, stays `pending` and counts as
 *   `extract_failed`; it never stops the other documents.
 * - Time budget: `extractBudgetMinutes` after the stage starts (by `deps.now()`), no new LLM call starts. Documents
 *   not started yet, or stopped between fallback models, stay `pending` and count as `extract_deferred`.
 * - Circuit breaker: a model that fails `CIRCUIT_BREAKER_THRESHOLD` times in a row is skipped for the rest of
 *   the run (counted in `llm_models_tripped`). When every model is skipped, documents count as deferred.
 */
export async function extractPending(
  deps: { repo: PipelineRepo; chat: ChatFn; sleep: (ms: number) => Promise<void>; now: () => Date },
  config: PipelineConfig,
  stats: DailyStats,
  onExtracted: (document: StoredDocument, result: ExtractionResult) => void,
): Promise<void> {
  const { repo } = deps;
  const deadline = deps.now().getTime() + config.extractBudgetMinutes * MINUTE_MS;
  const budgetSpent = (): boolean => deps.now().getTime() >= deadline;
  const pending = await repo.listPendingDocuments(config.maxDocumentsPerRun);
  const limit = pLimit(config.llmConcurrency);
  const breaker = createCircuitBreaker(CIRCUIT_BREAKER_THRESHOLD);

  const extractOne = async (document: StoredDocument): Promise<void> => {
    try {
      // DefiLlama documents carry no prose to extract; they are never sent to the LLM.
      if (document.sourceKind === "defillama") {
        await repo.setExtractionStatus(document.id, "done");
        return;
      }
      // Purged text: the repo no longer lists these, but never send an empty prompt.
      if (document.text === "") return;
      if (budgetSpent()) {
        stats.extract_deferred += 1;
        return;
      }
      const outcome = await extractWithFallback(document, config.models, {
        chat: deps.chat,
        sleep: deps.sleep,
        shouldStop: budgetSpent,
        breaker,
        intermediaryHosts: config.alphadrops.intermediaryHosts,
      });
      for (const attempt of outcome.attempts) await repo.saveExtraction(document.id, attempt, PROMPT_VERSION);
      if (!outcome.ok) {
        if (outcome.stopped) stats.extract_deferred += 1;
        else stats.extract_failed += 1;
        return;
      }
      if (!outcome.result.is_airdrop_content) {
        await repo.setExtractionStatus(document.id, "not_airdrop");
        stats.extract_ok += 1;
        stats.not_airdrop += 1;
        return;
      }
      stats.extract_ok += 1;
      onExtracted(document, outcome.result);
    } catch {
      stats.extract_failed += 1;
    }
  };

  await Promise.all(pending.map((document) => limit(() => extractOne(document))));
  stats.llm_models_tripped = breaker.opened().length;
}
