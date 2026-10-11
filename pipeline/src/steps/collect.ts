import { createHash } from "node:crypto";
import { collectAirdropsIo } from "../collectors/airdrops-io.js";
import { collectAlphaDrops } from "../collectors/alphadrops.js";
import { parseProtocols, selectSpeculativeCandidates } from "../collectors/defillama.js";
import type { DefillamaProtocol, SpeculativeCandidate } from "../collectors/defillama.js";
import { collectTelegram } from "../collectors/telegram.js";
import type { CollectedDocument, CollectorResult, Http } from "../collectors/types.js";
import type { PipelineConfig } from "../config.js";
import { defaultSleep } from "../enrich/time.js";
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
 * moves do not count as a change; TVL and the 7-day change appear only in the evidence quote. The listing
 * date (day precision) is stable and tells the reader how new the protocol is.
 */
export function defillamaDocument(candidate: SpeculativeCandidate, now: Date): CollectedDocument {
  const text = [
    candidate.name,
    `Category: ${candidate.category}`,
    `Chains: ${candidate.chains.length > 0 ? candidate.chains.join(", ") : "n/a"}`,
    `Website: ${candidate.url ?? "n/a"}`,
    `Listed on DefiLlama: ${candidate.listedAt ? candidate.listedAt.toISOString().slice(0, 10) : "n/a"}`,
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

interface DefillamaResult {
  /** The full protocol list for the `signals` stage, or null when it could not be fetched. */
  protocols: DefillamaProtocol[] | null;
  candidates: SpeculativeCandidate[];
}

const DEFILLAMA_FAILED: DefillamaResult = { protocols: null, candidates: [] };

/**
 * Fetches DefiLlama protocols once: the full list (for signals) and the speculative candidates. `protocols` is null
 * on HTTP, JSON or shape errors.
 */
async function collectDefillama(http: Http, config: PipelineConfig, now: Date): Promise<DefillamaResult> {
  const res = await http.get(PROTOCOLS_URL);
  if (res.status !== 200) return DEFILLAMA_FAILED;
  let raw: unknown;
  try {
    raw = JSON.parse(res.body);
  } catch {
    return DEFILLAMA_FAILED;
  }
  // An empty list means the API changed or broke, not that there are no protocols.
  if (!Array.isArray(raw) || raw.length === 0) return DEFILLAMA_FAILED;
  return {
    protocols: parseProtocols(raw),
    candidates: selectSpeculativeCandidates(raw, { ...config.defillama, now }),
  };
}

/** Stores a collected document when its hash is new or changed. */
async function ingest(repo: PipelineRepo, doc: CollectedDocument, stats: DailyStats): Promise<void> {
  stats.docs_collected += 1;
  const hash = contentHash(doc.text);
  if ((await repo.getDocumentHash(doc.url)) === hash) return;
  await repo.upsertDocument(doc, hash);
  stats.docs_changed += 1;
}

/** Ingests one document; a throw (database error) counts as `ingest_failed` and never stops the others. */
async function ingestSafely(repo: PipelineRepo, doc: CollectedDocument, stats: DailyStats): Promise<void> {
  try {
    await ingest(repo, doc, stats);
  } catch {
    stats.ingest_failed += 1;
  }
}

/**
 * Collects every source. A source that throws or reports `failed` counts toward `source_failed`;
 * any documents it still returned are ingested. Each document is ingested on its own: one that cannot be
 * stored counts as `ingest_failed` and the rest (and the other sources) continue. DefiLlama documents are
 * stored as `done` (never sent to the LLM) and returned for the speculative merge, together with the full DefiLlama
 * protocol list for the `signals` stage (null when it could not be fetched). `sleep` paces the AlphaDrops detail
 * pages.
 */
export async function collectSources(
  deps: { repo: PipelineRepo; http: Http; sleep?: (ms: number) => Promise<void> },
  config: PipelineConfig,
  now: Date,
  stats: DailyStats,
): Promise<{ speculative: SpeculativeItem[]; protocols: DefillamaProtocol[] | null }> {
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
    for (const doc of result.documents) await ingestSafely(repo, doc, stats);
  };

  await runCollector(() => collectAirdropsIo(http, now));
  for (const channel of config.telegramChannels) {
    await runCollector(async () => collectTelegram(http, channel, await repo.lastTelegramMessageId(channel), now));
  }
  if (config.alphadrops.enabled) {
    await runCollector(() => collectAlphaDrops(http, now, config.alphadrops, deps.sleep ?? defaultSleep));
  }

  let llama: DefillamaResult;
  try {
    llama = await collectDefillama(http, config, now);
  } catch {
    llama = DEFILLAMA_FAILED;
  }
  if (llama.protocols === null) stats.source_failed += 1;

  const items: SpeculativeItem[] = [];
  for (const candidate of llama.candidates) {
    const doc = defillamaDocument(candidate, now);
    stats.docs_collected += 1;
    try {
      const hash = contentHash(doc.text);
      const changed = (await repo.getDocumentHash(doc.url)) !== hash;
      // Always upserted: the speculative merge needs the stored id, and it refreshes fetched_at.
      const stored = await repo.upsertDocument(doc, hash);
      if (changed) stats.docs_changed += 1;
      if (stored.extractionStatus !== "done") await repo.setExtractionStatus(stored.id, "done");
      items.push({ document: { ...stored, extractionStatus: "done" }, candidate });
    } catch {
      stats.ingest_failed += 1;
    }
  }
  return { speculative: items, protocols: llama.protocols };
}
