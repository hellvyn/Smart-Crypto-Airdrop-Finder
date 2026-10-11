import Anthropic from "@anthropic-ai/sdk";
import type { CircuitBreaker } from "./circuit-breaker.js";
import { buildClaudeBody } from "./claude.js";
import type { ClaudeStreamClient } from "./claude.js";
import { chatCompletionsRequest, modelKey, readSseChunks, REQUEST_TIMEOUT_MS } from "./nvidia.js";
import type { ChatMessage, ModelConfig } from "./nvidia.js";
import type { Providers } from "./providers.js";
import { RATE_LIMIT_BACKOFF_MS } from "./structured.js";

/**
 * One event of `streamText`: a piece of the answer, the end of a complete answer (`model` is the configured
 * `"<provider>:<id>"` that gave it; the token counts are null when the provider reported none), or a failure
 * that ends the stream.
 */
export type StreamTextEvent =
  | { delta: string }
  | { done: { model: string; inputTokens: number | null; outputTokens: number | null } }
  | { failed: true };

export interface StreamTextDeps {
  providers: Providers;
  fetch: typeof fetch;
  /** The SDK client (`createClaudeClient`), or null without `ANTHROPIC_API_KEY`: Claude models are then skipped. */
  claude: ClaudeStreamClient | null;
  sleep: (ms: number) => Promise<void>;
  /** Same semantics as in `callStructured`: an open circuit skips the model; every final non-200 counts against it. */
  breaker?: CircuitBreaker;
  /** Aborts the request in flight and ends the stream with `failed` (e.g. the client closed the connection). */
  signal?: AbortSignal;
}

/** How one model's attempt ended. `status` is the HTTP status, 200 for a reachable model, 0 for anything else. */
type AttemptEnd = { ok: true; inputTokens: number | null; outputTokens: number | null } | { ok: false; status: number };

/** Whether any text was already handed to the caller: from then on there is no fallback. */
interface Progress {
  emitted: boolean;
}

/**
 * Streams the answer to `messages` (a chat history: `system`, `user` and `assistant` turns) from the first model of
 * `models` that works.
 *
 * - A model that fails before its first delta (HTTP error, network error, timeout, an answer that ends with
 *   `refusal`, `max_tokens` or no text at all) moves on to the next model. A 429 is first retried on the same model
 *   after 2 s and then 4 s, as in `callStructured`.
 * - A model that fails after its first delta ends the stream with `failed`: the text already sent cannot be taken
 *   back, so there is no fallback. An answer that ends abnormally after text (`refusal`, `max_tokens`, `length`)
 *   counts as such a failure.
 * - Without a usable model (none left, all circuits open, Claude without a key) the stream is just `failed`.
 *
 * Claude goes through the SDK (`messages.stream()`), every other model through its OpenAI-compatible endpoint.
 * Never throws and never logs; message content stays out of every error path.
 */
export async function* streamText(
  models: ModelConfig[],
  messages: ChatMessage[],
  deps: StreamTextDeps,
): AsyncGenerator<StreamTextEvent, void, undefined> {
  const progress: Progress = { emitted: false };

  for (const model of models) {
    const key = modelKey(model);
    if (deps.breaker?.isOpen(key) === true) continue;
    if (model.provider === "anthropic" && (deps.claude === null || deps.providers.anthropic.apiKey === "")) continue;

    for (let retry = 0; retry <= RATE_LIMIT_BACKOFF_MS.length; retry++) {
      if (deps.signal?.aborted === true) {
        yield { failed: true };
        return;
      }
      const end = yield* attempt(model, messages, deps, progress);

      if (end.ok) {
        deps.breaker?.recordSuccess(key);
        yield { done: { model: key, inputTokens: end.inputTokens, outputTokens: end.outputTokens } };
        return;
      }
      const backoff = RATE_LIMIT_BACKOFF_MS[retry];
      if (end.status === 429 && backoff !== undefined) {
        await deps.sleep(backoff);
        continue;
      }
      if (end.status === 200) deps.breaker?.recordSuccess(key);
      else deps.breaker?.recordFailure(key);
      if (progress.emitted) {
        yield { failed: true };
        return;
      }
      break;
    }
  }

  yield { failed: true };
}

function attempt(
  model: ModelConfig,
  messages: ChatMessage[],
  deps: StreamTextDeps,
  progress: Progress,
): AsyncGenerator<{ delta: string }, AttemptEnd, undefined> {
  if (model.provider === "anthropic") return attemptClaude(model, messages, deps, progress);
  return attemptOpenAi(model, messages, deps, progress);
}

/** The request timeout, the caller's signal and `own` (aborted when the attempt is over or abandoned) in one signal. */
function requestSignal(own: AbortController, caller: AbortSignal | undefined): AbortSignal {
  const signals = [AbortSignal.timeout(REQUEST_TIMEOUT_MS), own.signal];
  if (caller !== undefined) signals.push(caller);
  return AbortSignal.any(signals);
}

async function* attemptClaude(
  model: ModelConfig,
  messages: ChatMessage[],
  deps: StreamTextDeps,
  progress: Progress,
): AsyncGenerator<{ delta: string }, AttemptEnd, undefined> {
  const own = new AbortController();
  try {
    const stream = (deps.claude as ClaudeStreamClient).messages.stream(buildClaudeBody(model, messages), {
      signal: requestSignal(own, deps.signal),
      timeout: REQUEST_TIMEOUT_MS,
    });
    for await (const event of stream) {
      if (event.type !== "content_block_delta" || event.delta.type !== "text_delta" || event.delta.text === "") continue;
      progress.emitted = true;
      yield { delta: event.delta.text };
    }
    const message = await stream.finalMessage();
    // A refusal or a cut-off answer is not a usable one; the model itself was reachable.
    if (!progress.emitted || (message.stop_reason !== "end_turn" && message.stop_reason !== "stop_sequence")) {
      return { ok: false, status: 200 };
    }
    // Everything the model read: the uncached input plus the cache writes and reads.
    const usage = message.usage;
    const inputTokens = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
    return { ok: true, inputTokens, outputTokens: usage.output_tokens };
  } catch (error) {
    return { ok: false, status: error instanceof Anthropic.APIError && typeof error.status === "number" ? error.status : 0 };
  } finally {
    own.abort();
  }
}

async function* attemptOpenAi(
  model: ModelConfig,
  messages: ChatMessage[],
  deps: StreamTextDeps,
  progress: Progress,
): AsyncGenerator<{ delta: string }, AttemptEnd, undefined> {
  const own = new AbortController();
  try {
    const provider = deps.providers[model.provider as "freellm" | "nvidia"];
    const request = chatCompletionsRequest(model, messages, provider, requestSignal(own, deps.signal));
    const response = await deps.fetch(request.url, request.init);
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { ok: false, status: response.status };
    }
    if (!response.body) return { ok: false, status: 0 };

    let finishReason: string | null = null;
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    for await (const chunk of readSseChunks(response.body)) {
      const prompt = chunk.usage?.prompt_tokens;
      const completion = chunk.usage?.completion_tokens;
      if (typeof prompt === "number") inputTokens = prompt;
      if (typeof completion === "number") outputTokens = completion;
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason;
      const piece = choice.delta?.content;
      if (typeof piece === "string" && piece !== "") {
        progress.emitted = true;
        yield { delta: piece };
      }
    }
    // No `finish_reason` at all is tolerated when text came (some endpoints omit it); any other value than `stop`
    // (`length`, `content_filter`) is a cut-off answer.
    if (!progress.emitted || (finishReason !== null && finishReason !== "stop")) return { ok: false, status: 200 };
    return { ok: true, inputTokens, outputTokens };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    own.abort();
  }
}
