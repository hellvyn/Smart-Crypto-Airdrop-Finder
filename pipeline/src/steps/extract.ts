import pLimit from "p-limit";
import type { ExtractionResult } from "@saf/core";
import type { PipelineConfig } from "../config.js";
import { extractWithFallback } from "../llm/extract.js";
import type { ChatFn } from "../llm/extract.js";
import { PROMPT_VERSION } from "../llm/prompt.js";
import type { DailyStats } from "../stats.js";
import type { PipelineRepo, StoredDocument } from "../store/repo.js";

export interface ExtractedDocument {
  document: StoredDocument;
  result: ExtractionResult;
}

/**
 * Extracts up to `maxDocumentsPerRun` pending documents, `llmConcurrency` at a time, and stores every attempt.
 * Not-airdrop documents are marked `not_airdrop`; failed ones stay `pending` for the next run.
 * Returns the airdrop documents in pending order; the caller merges them and marks them `done`.
 */
export async function extractPending(
  deps: { repo: PipelineRepo; chat: ChatFn; sleep: (ms: number) => Promise<void> },
  config: PipelineConfig,
  stats: DailyStats,
): Promise<ExtractedDocument[]> {
  const { repo } = deps;
  const pending = await repo.listPendingDocuments(config.maxDocumentsPerRun);
  const limit = pLimit(config.llmConcurrency);

  const outcomes = await Promise.all(
    pending.map((document) =>
      limit(async () => {
        // DefiLlama documents carry no prose to extract; they are never sent to the LLM.
        if (document.sourceKind === "defillama") return null;
        const outcome = await extractWithFallback(document, config.models, { chat: deps.chat, sleep: deps.sleep });
        for (const attempt of outcome.attempts) await repo.saveExtraction(document.id, attempt, PROMPT_VERSION);
        return outcome;
      }),
    ),
  );

  const extracted: ExtractedDocument[] = [];
  for (const [i, document] of pending.entries()) {
    const outcome = outcomes[i];
    if (outcome === undefined) continue;
    if (outcome === null) {
      await repo.setExtractionStatus(document.id, "done");
      continue;
    }
    if (!outcome.ok) {
      stats.extract_failed += 1;
      continue;
    }
    stats.extract_ok += 1;
    if (!outcome.result.is_airdrop_content) {
      stats.not_airdrop += 1;
      await repo.setExtractionStatus(document.id, "not_airdrop");
      continue;
    }
    extracted.push({ document, result: outcome.result });
  }
  return extracted;
}
