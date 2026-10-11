import { createHash } from "node:crypto";
import { collectAirdropsIo } from "../collectors/airdrops-io.js";
import { collectAlphaDrops } from "../collectors/alphadrops.js";
import {
  detailLines,
  listCarriesDetails,
  mergeDetails,
  parseProtocolDetail,
  parseProtocols,
  selectSpeculativeCandidates,
} from "../collectors/defillama.js";
import type { DefillamaProtocol, SpeculativeCandidate } from "../collectors/defillama.js";
import { collectTelegram } from "../collectors/telegram.js";
import type { CollectedDocument, CollectorResult, Http } from "../collectors/types.js";
import type { PipelineConfig } from "../config.js";
import { defaultSleep } from "../enrich/time.js";
import type { DailyStats } from "../stats.js";
import type { ClaimPage, PipelineRepo, StoredDocument } from "../store/repo.js";
import type { AnalyzeDeps } from "./analyze.js";

const PROTOCOLS_URL = "https://api.llama.fi/protocols";
const PROTOCOL_URL = "https://api.llama.fi/protocol/";
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** A cached detail younger than this is not asked again. */
const DETAIL_FRESH_MS = 7 * DAY_MS;
/** A cached detail whose refresh failed or was skipped is still used up to this age (then the list's fields alone). */
const DETAIL_MAX_AGE_MS = 14 * DAY_MS;
/** `claim_pages` key of a protocol's detail lines. */
const detailKey = (slug: string): string => `defillama-detail://${slug}`;
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
 * date (day precision) is stable and tells the reader how new the protocol is. The description, audits, raises and the
 * other detail lines are NOT in this text: every analysis reads it, and marketing wording could trigger a false
 * scam flag. They reach the AI Analyst alone, as the extra source `defillamaDetailSources`.
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
  /** The list entries already carry `methodology`, `raises` or `github`: no detail request is needed. */
  listHasDetails: boolean;
}

const DEFILLAMA_FAILED: DefillamaResult = { protocols: null, candidates: [], listHasDetails: false };

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
    listHasDetails: listCarriesDetails(raw),
  };
}

/**
 * The text the AI Analyst reads about each candidate's DefiLlama listing (`Description:`, `Methodology:`, ... lines),
 * by slug, and the `/protocol/{slug}` requests behind it. Per candidate, in order:
 * - the list carries the fields (`listHasDetails`): the list's lines, no request;
 * - a cached detail (`claim_pages`, key `defillama-detail://<slug>`) under 7 days old: its text, no request;
 * - otherwise one request (one at a time, `delayMs` apart, at most `maxRequests`, none after `budgetMinutes`, none when
 *   `cutoffMinutes` have passed since the run started at `startedAt`): on success the merged lines, which are cached;
 * - a request not made or failed: the cached text if it is at most 14 days old, else the list's own lines. So a skipped
 *   or failed day does not change the text (and with it the analysis input), as long as the cache is usable.
 * Not asked counts in `defillama_details_skipped`, an unusable answer in `defillama_details_failed`. Never throws.
 */
async function detailTexts(
  deps: { repo: PipelineRepo; http: Http; sleep: (ms: number) => Promise<void>; clock: () => Date },
  candidates: SpeculativeCandidate[],
  listHasDetails: boolean,
  limits: PipelineConfig["defillamaDetails"],
  cutoffMinutes: number,
  startedAt: Date,
  stats: DailyStats,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const textOf = (c: SpeculativeCandidate): string => detailLines(c.details).join("\n");
  if (listHasDetails || candidates.length === 0) {
    for (const c of candidates) out.set(c.slug, textOf(c));
    return out;
  }
  let cache = new Map<string, ClaimPage>();
  try {
    cache = new Map((await deps.repo.listClaimPages(candidates.map((c) => detailKey(c.slug)))).map((p) => [p.url, p]));
  } catch {
    // No cache this run: the list's own lines, and a request for each candidate.
  }
  const deadline = deps.clock().getTime() + limits.budgetMinutes * MINUTE_MS;
  let asked = 0;
  for (const candidate of candidates) {
    const cached = cache.get(detailKey(candidate.slug));
    const age = cached === undefined ? Infinity : startedAt.getTime() - cached.fetchedAt.getTime();
    const usable = cached !== undefined && cached.text !== "" && age <= DETAIL_MAX_AGE_MS;
    const fallback = usable ? cached.text : textOf(candidate);
    if (usable && age < DETAIL_FRESH_MS) {
      out.set(candidate.slug, cached.text);
      continue;
    }
    const clock = deps.clock().getTime();
    if (asked >= limits.maxRequests || clock >= deadline || clock - startedAt.getTime() > cutoffMinutes * MINUTE_MS) {
      stats.defillama_details_skipped += 1;
      out.set(candidate.slug, fallback);
      continue;
    }
    if (asked > 0) await deps.sleep(limits.delayMs);
    asked += 1;
    try {
      const res = await deps.http.get(`${PROTOCOL_URL}${encodeURIComponent(candidate.slug)}`);
      if (res.status !== 200) throw new Error("status");
      const merged = mergeDetails(candidate.details, parseProtocolDetail(JSON.parse(res.body)));
      stats.defillama_details_fetched += 1;
      const text = detailLines(merged).join("\n");
      out.set(candidate.slug, text);
      if (text !== "") await deps.repo.saveClaimPage(detailKey(candidate.slug), text, startedAt).catch(() => undefined);
    } catch {
      stats.defillama_details_failed += 1;
      out.set(candidate.slug, fallback);
    }
  }
  return out;
}

/**
 * The AI Analyst's extra source about a DefiLlama listing (`Description:`, `Audits:`, `Raises:` ... lines): for a
 * project that has a DefiLlama document, the lines of this run (`texts`, by slug) or else its cached detail up to 14
 * days old. Its URL is `defillama-detail://<slug>`, never a stored source document, so it is never shown as a link. The
 * Scam Analyst and the public contradiction check do not get it: wording written by a protocol could trigger a false
 * scam flag or a false contradiction.
 */
export function defillamaDetailSources(
  repo: PipelineRepo,
  texts: ReadonlyMap<string, string>,
  now: Date,
): NonNullable<AnalyzeDeps["extraSources"]> {
  return async (_project, kind, own) => {
    if (kind !== "analyst") return [];
    let slug: string | null = null;
    for (const source of own) {
      const match = /^https:\/\/defillama\.com\/protocol\/([^/?#]+)$/.exec(source.url);
      if (match?.[1] === undefined) continue;
      try {
        slug = decodeURIComponent(match[1]);
      } catch {
        continue;
      }
      break;
    }
    if (slug === null) return [];
    let text = texts.get(slug);
    if (text === undefined) {
      try {
        const [page] = await repo.listClaimPages([detailKey(slug)]);
        if (page !== undefined && now.getTime() - page.fetchedAt.getTime() <= DETAIL_MAX_AGE_MS) text = page.text;
      } catch {
        return [];
      }
    }
    return text === undefined || text === "" ? [] : [{ url: `defillama-detail://${slug}`, text }];
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
  deps: { repo: PipelineRepo; http: Http; sleep?: (ms: number) => Promise<void>; now?: () => Date },
  config: PipelineConfig,
  now: Date,
  stats: DailyStats,
): Promise<{ speculative: SpeculativeItem[]; protocols: DefillamaProtocol[] | null; detailTexts: Map<string, string> }> {
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
  const detailTextsBySlug = await detailTexts(
    { repo, http, sleep: deps.sleep ?? defaultSleep, clock: deps.now ?? (() => new Date()) },
    llama.candidates,
    llama.listHasDetails,
    config.defillamaDetails,
    config.enrichmentCutoffMinutes,
    now,
    stats,
  );

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
  return { speculative: items, protocols: llama.protocols, detailTexts: detailTextsBySlug };
}
