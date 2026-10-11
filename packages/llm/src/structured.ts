import type { z } from "zod";
import type { CircuitBreaker } from "./circuit-breaker.js";
import { modelKey } from "./nvidia.js";
import type { ChatMessage, ChatResult, ModelConfig } from "./nvidia.js";

/** `streamChat` with its transport deps (fetch, API key, base URL) already bound. */
export type ChatFn = (model: ModelConfig, messages: ChatMessage[]) => Promise<ChatResult>;

/** One model call made by `callStructured`. */
export interface LlmAttempt {
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

export type StructuredOutcome<T> =
  /** `model`: `"<provider>:<id>"` of the model whose answer was used; `servedModel`: the model that answered it. */
  | { ok: true; value: T; model: string; servedModel: string | null; attempts: LlmAttempt[] }
  /**
   * `stopped`: `shouldStop` ended the chain before every model was tried, or every model's circuit was open
   * so no call was made. Either way the work is left for the next run.
   */
  | { ok: false; stopped: boolean; attempts: LlmAttempt[] };

/** Waits before the 1st and 2nd retry of a rate-limited (429) model. */
export const RATE_LIMIT_BACKOFF_MS = [2000, 4000] as const;

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

/**
 * Sends `messages` to each model in order until one returns a complete JSON answer that `schema` accepts.
 * A 429 is retried on the same model after 2 s and then 4 s; any other failure moves on.
 * `shouldStop` is checked before every model call; once it returns true no further call starts.
 * A model whose `breaker` circuit (keyed `"<provider>:<id>"`) is open is skipped; every final non-200 reply counts
 * against its model. An HTTP 200 with an unusable answer (bad JSON, schema, truncated) moves on to the next model
 * at once and is not an endpoint failure.
 */
export async function callStructured<T>(
  messages: ChatMessage[],
  schema: z.ZodType<T>,
  models: ModelConfig[],
  deps: {
    chat: ChatFn;
    sleep: (ms: number) => Promise<void>;
    breaker?: CircuitBreaker;
    shouldStop?: () => boolean;
  },
): Promise<StructuredOutcome<T>> {
  const attempts: LlmAttempt[] = [];

  let skipped = 0;
  for (const model of models) {
    const key = modelKey(model);
    if (deps.breaker?.isOpen(key) === true) {
      skipped += 1;
      continue;
    }
    for (let retry = 0; retry <= RATE_LIMIT_BACKOFF_MS.length; retry++) {
      if (deps.shouldStop?.() === true) return { ok: false, stopped: true, attempts };
      const chat = await deps.chat(model, messages);
      const record = (error: string | null, raw: string): void => {
        attempts.push({
          model: key,
          servedModel: chat.servedModel,
          httpStatus: chat.httpStatus,
          finishReason: chat.finishReason,
          latencyMs: chat.latencyMs,
          error,
          raw,
        });
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
      const validated = schema.safeParse(parsed.value);
      if (!validated.success) {
        record("schema", chat.content);
        break;
      }
      record(null, chat.content);
      return { ok: true, value: validated.data, model: key, servedModel: chat.servedModel, attempts };
    }
  }

  return { ok: false, stopped: skipped === models.length, attempts };
}
