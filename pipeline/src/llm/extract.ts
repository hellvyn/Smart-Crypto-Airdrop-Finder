import { cleanUrl, extractionSchema, filterUrlsInSource, normalizeDeadline } from "@saf/core";
import type { ExtractionResult } from "@saf/core";
import type { CollectedDocument } from "../collectors/types.js";
import type { ChatMessage, ChatResult, ModelConfig } from "./nvidia.js";
import { buildMessages } from "./prompt.js";

export interface ExtractionAttempt {
  model: string;
  httpStatus: number;
  finishReason: string | null;
  latencyMs: number;
  /** Short failure code (`http_<status>`, `finish_<reason|null>`, `empty_content`, `json_parse`, `schema`), or null on success. */
  error: string | null;
  /** Model output, or the error body of a failed request. */
  raw: string;
}

export type ExtractOutcome =
  | { ok: true; result: ExtractionResult; model: string; attempts: ExtractionAttempt[] }
  | { ok: false; attempts: ExtractionAttempt[] };

/** `streamChat` with its transport deps (fetch, API key, base URL) already bound. */
export type ChatFn = (model: ModelConfig, messages: ChatMessage[]) => Promise<ChatResult>;

/** Waits before the 1st and 2nd retry of a rate-limited (429) model. */
const RATE_LIMIT_BACKOFF_MS = [2000, 4000] as const;

/** Parses model output: straight JSON first, then the first `{` .. last `}` after removing code fences. */
function parseJson(content: string): { ok: true; value: unknown } | { ok: false } {
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

function postProcess(result: ExtractionResult, doc: CollectedDocument): ExtractionResult {
  return {
    ...result,
    projects: result.projects.map((project) => {
      const urls = new Set<string>();
      for (const url of filterUrlsInSource(project.official_urls, doc.text)) {
        try {
          urls.add(cleanUrl(url).url);
        } catch {
          // Not a valid absolute URL: drop it.
        }
      }
      return {
        ...project,
        official_urls: [...urls],
        deadlines: project.deadlines.map((d) => normalizeDeadline(d, doc.publishedAt)),
      };
    }),
  };
}

/**
 * Tries each model in order until one returns a complete, schema-valid extraction.
 * A 429 is retried on the same model after 2 s and then 4 s; any other failure moves on.
 */
export async function extractWithFallback(
  doc: CollectedDocument,
  models: ModelConfig[],
  deps: { chat: ChatFn; sleep: (ms: number) => Promise<void> },
): Promise<ExtractOutcome> {
  const messages = buildMessages(doc);
  const attempts: ExtractionAttempt[] = [];

  for (const model of models) {
    for (let retry = 0; retry <= RATE_LIMIT_BACKOFF_MS.length; retry++) {
      const chat = await deps.chat(model, messages);
      const record = (error: string | null, raw: string): ExtractionAttempt => {
        const attempt: ExtractionAttempt = {
          model: model.id,
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
        break;
      }
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
      return { ok: true, result: postProcess(validated.data, doc), model: model.id, attempts };
    }
  }

  return { ok: false, attempts };
}
