import { cleanUrl, extractionSchema, filterUrlsInSource, normalizeDeadline, quoteInSource } from "@saf/core";
import type { ExtractionResult } from "@saf/core";
import { isNonProjectHost } from "../collectors/html-text.js";
import type { CollectedDocument } from "../collectors/types.js";
import type { CircuitBreaker } from "./circuit-breaker.js";
import { modelKey } from "./nvidia.js";
import type { ChatMessage, ChatResult, ModelConfig } from "./nvidia.js";
import { buildMessages } from "./prompt.js";

export interface ExtractionAttempt {
  /** `"<provider>:<id>"` of the configured model, e.g. `freellm:auto`. */
  model: string;
  /** The model that actually answered (from the stream), or null when the reply named none. */
  servedModel: string | null;
  httpStatus: number;
  finishReason: string | null;
  latencyMs: number;
  /** Short failure code (`http_<status>`, `finish_<reason|null>`, `empty_content`, `json_parse`, `schema`), or null on success. */
  error: string | null;
  /** Model output, or the error body of a failed request. */
  raw: string;
}

export type ExtractOutcome =
  /** `model`: `"<provider>:<id>"` of the model whose answer was used. */
  | { ok: true; result: ExtractionResult; model: string; attempts: ExtractionAttempt[] }
  /**
   * `stopped`: `shouldStop` ended the chain before every model was tried, or every model's circuit was open
   * so no call was made. Either way the document is left for the next run.
   */
  | { ok: false; attempts: ExtractionAttempt[]; stopped: boolean };

/** `streamChat` with its transport deps (fetch, API key, base URL) already bound. */
export type ChatFn = (model: ModelConfig, messages: ChatMessage[]) => Promise<ChatResult>;

/** Waits before the 1st and 2nd retry of a rate-limited (429) model. */
const RATE_LIMIT_BACKOFF_MS = [2000, 4000] as const;

/** Parses model output: straight JSON first, then the first `{` .. last `}` after removing code fences. */
export function parseJson(content: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(content) };
  } catch {
    // Fall through to the lenient path.
  }
  const stripped = content.replace(/```[a-zA-Z]*/g, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(stripped.slice(start, end + 1)) };
  } catch {
    return { ok: false };
  }
}

// A URL inside free text: stops at whitespace, quotes, angle brackets and brackets/parentheses.
const URL_IN_TEXT_RE = /https?:\/\/[^\s<>"'`()[\]{}]+/g;
const TRAILING_PUNCTUATION_RE = /[.,;:!?]+$/;

/**
 * Removes referral parts from URLs embedded in free text (tasks, quotes, deadline wording). A URL is
 * replaced only when `cleanUrl` actually stripped something; other and unparsable URLs stay as written.
 * Sentence punctuation right after a URL is kept outside it.
 */
export function cleanUrlsInText(text: string): string {
  return text.replace(URL_IN_TEXT_RE, (match) => {
    const trailing = TRAILING_PUNCTUATION_RE.exec(match)?.[0] ?? "";
    const url = match.slice(0, match.length - trailing.length);
    try {
      const cleaned = cleanUrl(url);
      return cleaned.referralStripped ? `${cleaned.url}${trailing}` : match;
    } catch {
      return match;
    }
  });
}

/** Whether a cleaned official URL is on a host that is never a project's own (see `isNonProjectHost`). */
function onNonProjectHost(url: string, intermediaryHosts: readonly string[]): boolean {
  try {
    return isNonProjectHost(new URL(url).hostname, intermediaryHosts);
  } catch {
    return true;
  }
}

/**
 * Applies the source-text rules to a schema-valid extraction: official URLs must appear in the source, lose
 * their referral parts and are dropped on aggregator and intermediary hosts (`isNonProjectHost`); quoted v3
 * entries (`key_parameters`, `source_ratings`, `claimed_backers`, and
 * `latest_update` by its `text`) are dropped when the quote is not in the source (a backer also when its `investor` is not in its own quote), while the rest of the project
 * stays. The quote check runs on the model's wording before referral parts are removed from URLs in free text.
 * `tasks` is filled from `steps` when the model left it empty.
 */
function postProcess(
  result: ExtractionResult,
  doc: CollectedDocument,
  intermediaryHosts: readonly string[],
): ExtractionResult {
  const inSource = (quote: string): boolean => quoteInSource(quote, doc.text);
  return {
    ...result,
    projects: result.projects.map((project) => {
      const urls = new Set<string>();
      for (const url of filterUrlsInSource(project.official_urls, doc.text)) {
        try {
          const clean = cleanUrl(url).url;
          if (!onNonProjectHost(clean, intermediaryHosts)) urls.add(clean);
        } catch {
          // Not a valid absolute URL: drop it.
        }
      }
      const steps = project.steps.map((step) => ({ ...step, text: cleanUrlsInText(step.text) }));
      const tasks = project.tasks.length > 0 ? project.tasks.map(cleanUrlsInText) : steps.map((step) => step.text);
      const latest = project.latest_update;
      return {
        ...project,
        status_evidence: cleanUrlsInText(project.status_evidence),
        tasks,
        steps,
        official_urls: [...urls],
        deadlines: project.deadlines.map((d) => {
          const normalized = normalizeDeadline(d, doc.publishedAt);
          return { ...normalized, text: cleanUrlsInText(normalized.text) };
        }),
        key_parameters: project.key_parameters
          .filter((k) => inSource(k.quote))
          .map((k) => ({ ...k, value: cleanUrlsInText(k.value), quote: cleanUrlsInText(k.quote) })),
        source_ratings: project.source_ratings
          .filter((r) => inSource(r.quote))
          .map((r) => ({ ...r, value: cleanUrlsInText(r.value), quote: cleanUrlsInText(r.quote) })),
        latest_update: latest !== null && inSource(latest.text) ? { ...latest, text: cleanUrlsInText(latest.text) } : null,
        claimed_backers: project.claimed_backers
          .filter((b) => inSource(b.quote) && quoteInSource(b.investor, b.quote))
          .map((b) => ({ ...b, quote: cleanUrlsInText(b.quote) })),
      };
    }),
  };
}

/**
 * Tries each model in order until one returns a complete, schema-valid extraction.
 * A 429 is retried on the same model after 2 s and then 4 s; any other failure moves on.
 * `shouldStop` is checked before every model call; once it returns true no further call starts.
 * A model whose `breaker` circuit (keyed `"<provider>:<id>"`) is open is skipped; every final non-200 reply counts
 * against its model. An HTTP 200 with an unusable answer (bad JSON, schema, truncated) moves the same document on
 * to the next model at once and is not an endpoint failure.
 * `intermediaryHosts` (the config's `alphadrops.intermediaryHosts`) are refused as official URL hosts, next to the
 * aggregator hosts, which are always refused.
 */
export async function extractWithFallback(
  doc: CollectedDocument,
  models: ModelConfig[],
  deps: {
    chat: ChatFn;
    sleep: (ms: number) => Promise<void>;
    shouldStop?: () => boolean;
    breaker?: CircuitBreaker;
    intermediaryHosts?: readonly string[];
  },
): Promise<ExtractOutcome> {
  const messages = buildMessages(doc);
  const attempts: ExtractionAttempt[] = [];

  let skipped = 0;
  for (const model of models) {
    const key = modelKey(model);
    if (deps.breaker?.isOpen(key) === true) {
      skipped += 1;
      continue;
    }
    for (let retry = 0; retry <= RATE_LIMIT_BACKOFF_MS.length; retry++) {
      if (deps.shouldStop?.() === true) return { ok: false, attempts, stopped: true };
      const chat = await deps.chat(model, messages);
      const record = (error: string | null, raw: string): ExtractionAttempt => {
        const attempt: ExtractionAttempt = {
          model: key,
          servedModel: chat.servedModel,
          httpStatus: chat.httpStatus,
          finishReason: chat.finishReason,
          latencyMs: chat.latencyMs,
          error,
          raw,
        };
        attempts.push(attempt);
        return attempt;
      };

      if (chat.httpStatus !== 200) {
        record(`http_${chat.httpStatus}`, chat.errorBody ?? chat.content);
        const backoff = RATE_LIMIT_BACKOFF_MS[retry];
        if (chat.httpStatus === 429 && backoff !== undefined) {
          await deps.sleep(backoff);
          continue;
        }
        deps.breaker?.recordFailure(key);
        break;
      }
      deps.breaker?.recordSuccess(key);
      if (chat.finishReason !== "stop") {
        record(`finish_${chat.finishReason}`, chat.content);
        break;
      }
      if (chat.content.trim() === "") {
        record("empty_content", chat.content);
        break;
      }
      const parsed = parseJson(chat.content);
      if (!parsed.ok) {
        record("json_parse", chat.content);
        break;
      }
      const validated = extractionSchema.safeParse(parsed.value);
      if (!validated.success) {
        record("schema", chat.content);
        break;
      }
      record(null, chat.content);
      return { ok: true, result: postProcess(validated.data, doc, deps.intermediaryHosts ?? []), model: key, attempts };
    }
  }

  return { ok: false, attempts, stopped: skipped === models.length };
}
