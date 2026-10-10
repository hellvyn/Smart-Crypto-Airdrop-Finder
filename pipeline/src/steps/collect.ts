import { createHash } from "node:crypto";
import { collectAirdropsIo } from "../collectors/airdrops-io.js";
import { selectSpeculativeCandidates } from "../collectors/defillama.js";
import type { SpeculativeCandidate } from "../collectors/defillama.js";
import { collectTelegram } from "../collectors/telegram.js";
import type { CollectedDocument, CollectorResult, Http } from "../collectors/types.js";
import type { PipelineConfig } from "../config.js";
import type { DailyStats } from "../stats.js";
import type { PipelineRepo, StoredDocument } from "../store/repo.js";

const PROTOCOLS_URL = "https://api.llama.fi/protocols";
const DEFILLAMA_KEY = "defillama";

export interface SpeculativeItem {
  document: StoredDocument;
  candidate: SpeculativeCandidate;
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Document for a DefiLlama candidate. Only stable fields go into the text (and so the hash), so daily TVL
 * moves do not count as a change; TVL and the 7-day change appear only in the evidence quote.
 */
export function defillamaDocument(candidate: SpeculativeCandidate, now: Date): CollectedDocument {
  const text = [
    candidate.name,
    `Category: ${candidate.category}`,
    `Chains: ${candidate.chains.length > 0 ? candidate.chains.join(", ") : "n/a"}`,
    `Website: ${candidate.url ?? "n/a"}`,
    "No token listed on DefiLlama.",
  ].join("\n");
  return {
    sourceKind: "defillama",
    sourceKey: DEFILLAMA_KEY,
    url: `https://defillama.com/protocol/${encodeURIComponent(candidate.slug)}`,
    text,
    publishedAt: null,
    pageUpdatedAt: null,
    fetchedAt: now,
  };
}

/** Fetches DefiLlama protocols and keeps the speculative candidates. `failed` on HTTP, JSON or shape errors. */
async function collectDefillama(
  http: Http,
  config: PipelineConfig,
): Promise<{ failed: boolean; candidates: SpeculativeCandidate[] }> {
  const res = await http.get(PROTOCOLS_URL);
  if (res.status !== 200) return { failed: true, candidates: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(res.body);
  } catch {
    return { failed: true, candidates: [] };
  }
  // An empty list means the API changed or broke, not that there are no protocols.
  if (!Array.isArray(raw) || raw.length === 0) return { failed: true, candidates: [] };
  return { failed: false, candidates: selectSpeculativeCandidates(raw, config.defillama) };
}

/** Stores a collected document when its hash is new or changed. */
async function ingest(repo: PipelineRepo, doc: CollectedDocument, stats: DailyStats): Promise<void> {
  stats.docs_collected += 1;
  const hash = contentHash(doc.text);
  if ((await repo.getDocumentHash(doc.url)) === hash) return;
  await repo.upsertDocument(doc, hash);
  stats.docs_changed += 1;
}

/**
 * Collects every source. A source that throws or reports `failed` counts toward `source_failed`;
 * any documents it still returned are ingested. DefiLlama documents are stored as `done` (never
 * sent to the LLM) and returned for the speculative merge.
 */
export async function collectSources(
  deps: { repo: PipelineRepo; http: Http },
  config: PipelineConfig,
  now: Date,
  stats: DailyStats,
): Promise<SpeculativeItem[]> {
  const { repo, http } = deps;

  const runCollector = async (collect: () => Promise<CollectorResult>): Promise<void> => {
    let result: CollectorResult;
    try {
      result = await collect();
    } catch {
      stats.source_failed += 1;
      return;
    }
    if (result.failed) stats.source_failed += 1;
    for (const doc of result.documents) await ingest(repo, doc, stats);
  };

  await runCollector(() => collectAirdropsIo(http, now));
  for (const channel of config.telegramChannels) {
    await runCollector(async () => collectTelegram(http, channel, await repo.lastTelegramMessageId(channel), now));
  }

  let llama: { failed: boolean; candidates: SpeculativeCandidate[] };
  try {
    llama = await collectDefillama(http, config);
  } catch {
    llama = { failed: true, candidates: [] };
  }
  if (llama.failed) stats.source_failed += 1;

  const items: SpeculativeItem[] = [];
  for (const candidate of llama.candidates) {
    const doc = defillamaDocument(candidate, now);
    stats.docs_collected += 1;
    const hash = contentHash(doc.text);
    if ((await repo.getDocumentHash(doc.url)) !== hash) stats.docs_changed += 1;
    // Always upserted: the speculative merge needs the stored id, and it refreshes fetched_at.
    const stored = await repo.upsertDocument(doc, hash);
    if (stored.extractionStatus !== "done") await repo.setExtractionStatus(stored.id, "done");
    items.push({ document: { ...stored, extractionStatus: "done" }, candidate });
  }
  return items;
}
