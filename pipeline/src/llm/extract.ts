import { cleanUrl, extractionSchema, filterUrlsInSource, normalizeDeadline, quoteInSource } from "@saf/core";
import type { ExtractionResult } from "@saf/core";
import { isNonProjectHost } from "../collectors/html-text.js";
import type { CollectedDocument } from "../collectors/types.js";
import { callStructured } from "@saf/llm";
import type { ChatFn, CircuitBreaker, LlmAttempt, ModelConfig } from "@saf/llm";
import { buildMessages } from "./prompt.js";

/** One extraction call, stored as an `extractions` row. */
export type ExtractionAttempt = LlmAttempt;

export type ExtractOutcome =
  /** `model`: `"<provider>:<id>"` of the model whose answer was used. */
  | { ok: true; result: ExtractionResult; model: string; attempts: ExtractionAttempt[] }
  /**
   * `stopped`: `shouldStop` ended the chain before every model was tried, or every model's circuit was open
   * so no call was made. Either way the document is left for the next run.
   */
  | { ok: false; attempts: ExtractionAttempt[]; stopped: boolean };

export type { ChatFn } from "@saf/llm";
export { parseJson } from "@saf/llm";

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
 * Tries each model in order until one returns a complete, schema-valid extraction (`callStructured`: 429 retries,
 * circuit breaker keyed `"<provider>:<id>"`, `shouldStop` checked before every call, and an HTTP 200 with an
 * unusable answer moving the same document on to the next model without counting as an endpoint failure).
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
  const outcome = await callStructured(buildMessages(doc), extractionSchema, models, deps);
  if (!outcome.ok) return { ok: false, attempts: outcome.attempts, stopped: outcome.stopped };
  return {
    ok: true,
    result: postProcess(outcome.value, doc, deps.intermediaryHosts ?? []),
    model: outcome.model,
    attempts: outcome.attempts,
  };
}
