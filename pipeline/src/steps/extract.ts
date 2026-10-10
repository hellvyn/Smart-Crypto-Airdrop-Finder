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

type DocOutcome =
  | { kind: "skipped" }
  | { kind: "failed" }
  | { kind: "not_airdrop" }
  | { kind: "airdrop"; result: ExtractionResult };

/**
 * Extracts up to `maxDocumentsPerRun` pending documents, `llmConcurrency` at a time, and stores every attempt.
 * Not-airdrop documents are marked `not_airdrop`. A document whose models all fail, or whose bookkeeping
 * throws, stays `pending` for the next run and counts as `extract_failed`; it never stops the other documents.
 * Pending documents with empty (purged) text are left as they are. Returns the airdrop documents in pending
 * order; the caller merges them and marks them `done`.
 */
export async function extractPending(
  deps: { repo: PipelineRepo; chat: ChatFn; sleep: (ms: number) => Promise<void> },
  config: PipelineConfig,
  stats: DailyStats,
): Promise<ExtractedDocument[]> {
  const { repo } = deps;
  const pending = await repo.listPendingDocuments(config.maxDocumentsPerRun);
  const limit = pLimit(config.llmConcurrency);

  const extractOne = async (document: StoredDocument): Promise<DocOutcome> => {
    try {
      // DefiLlama documents carry no prose to extract; they are never sent to the LLM.
      if (document.sourceKind === "defillama") {
        await repo.setExtractionStatus(document.id, "done");
        return { kind: "skipped" };
      }
      if (document.text === "") return { kind: "skipped" };
      const outcome = await extractWithFallback(document, config.models, { chat: deps.chat, sleep: deps.sleep });
      for (const attempt of outcome.attempts) await repo.saveExtraction(document.id, attempt, PROMPT_VERSION);
      if (!outcome.ok) return { kind: "failed" };
      if (!outcome.result.is_airdrop_content) {
        await repo.setExtractionStatus(document.id, "not_airdrop");
        return { kind: "not_airdrop" };
      }
      return { kind: "airdrop", result: outcome.result };
    } catch {
      return { kind: "failed" };
    }
  };

  const outcomes = await Promise.all(pending.map((document) => limit(() => extractOne(document))));

  const extracted: ExtractedDocument[] = [];
  for (const [i, document] of pending.entries()) {
    const outcome = outcomes[i];
    if (outcome === undefined || outcome.kind === "skipped") continue;
    if (outcome.kind === "failed") {
      stats.extract_failed += 1;
      continue;
    }
    stats.extract_ok += 1;
    if (outcome.kind === "not_airdrop") {
      stats.not_airdrop += 1;
      continue;
    }
    extracted.push({ document, result: outcome.result });
  }
  return extracted;
}
