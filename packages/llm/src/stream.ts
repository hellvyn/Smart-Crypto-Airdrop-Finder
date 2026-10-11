import Anthropic from "@anthropic-ai/sdk";
import type { CircuitBreaker } from "./circuit-breaker.js";
import { buildClaudeBody } from "./claude.js";
import type { ClaudeStreamClient } from "./claude.js";
import { chatCompletionsRequest, modelKey, readSseChunks, REQUEST_TIMEOUT_MS } from "./nvidia.js";
import type { ChatMessage, ModelConfig } from "./nvidia.js";
import type { Providers } from "./providers.js";

/**
 * One event of `streamText`: a piece of the answer, the end of a complete answer, or a failure that ends the stream.
 * In `done`, `model` is the configured `"<provider>:<id>"` that gave the answer. The token counts are null when the
 * provider reported none: `inputTokens` is the uncached input only (Claude's `input_tokens`), the cache counts are
 * the tokens written to and read from the prompt cache, so the total input is the sum of the three. OpenAI-compatible
 * providers report no cache split: both cache counts are null.
 */
export type StreamTextEvent =
  | { delta: string }
  | {
      done: {
        model: string;
        inputTokens: number | null;
        outputTokens: number | null;
        cacheReadTokens: number | null;
        cacheCreationTokens: number | null;
      };
    }
  | { failed: true };

export interface StreamTextDeps {
  providers: Providers;
  fetch: typeof fetch;
  /** The SDK client (`createClaudeClient`), or null without `ANTHROPIC_API_KEY`: Claude models are then skipped. */
  claude: ClaudeStreamClient | null;
  /** Same semantics as in `callStructured`: an open circuit skips the model; every final non-200 counts against it. */
  breaker?: CircuitBreaker;
  /**
   * Aborts the request in flight and ends the stream with `failed` (e.g. the client closed the connection). An abort
   * is the caller's doing: no model is tried after it and the circuit breaker is not touched.
   */
  signal?: AbortSignal;
  /**
   * Prompt-cache layout of a Claude request (default false, the body `claudeChat` sends). True: every `system`
   * message is its own cached block and the conversation turns are cached too (see `buildClaudeBody`). The
   * OpenAI-compatible request is the same either way.
   */
  cache?: boolean;
}

/** How one model's attempt ended. `status` is the HTTP status, 200 for a reachable model, 0 for anything else. */
type AttemptEnd =
  | {
      ok: true;
      inputTokens: number | null;
      outputTokens: number | null;
      cacheReadTokens: number | null;
      cacheCreationTokens: number | null;
    }
  | { ok: false; status: number };

/** Whether any text was already handed to the caller: from then on there is no fallback. */
interface Progress {
  emitted: boolean;
}

/**
 * Streams the answer to `messages` (a chat history: `system`, `user` and `assistant` turns) from the first model of
 * `models` that works.
 *
 * - A model that fails before its first delta (HTTP error, network error, timeout, an answer that ends with
 *   `refusal`, `max_tokens` or no text at all) moves on to the next model at once; a 429 is not retried, because a
 *   waiting chat user matters more than the same model's next answer.
 * - A model that fails after its first delta ends the stream with `failed`: the text already sent cannot be taken
 *   back, so there is no fallback. An answer that ends abnormally after text (`refusal`, `max_tokens`, `length`)
 *   counts as such a failure.
 * - When `deps.signal` is aborted the stream ends with `failed` at once: no further model is tried and the circuit
 *   breaker records nothing.
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
  // A function, not a value: the signal can flip while an attempt runs.
  const aborted = (): boolean => deps.signal?.aborted === true;

  for (const model of models) {
    const key = modelKey(model);
    if (deps.breaker?.isOpen(key) === true) continue;
    if (model.provider === "anthropic" && (deps.claude === null || deps.providers.anthropic.apiKey === "")) continue;

    if (aborted()) {
      yield { failed: true };
      return;
    }
    const end = yield* attempt(model, messages, deps, progress);

    if (end.ok) {
      deps.breaker?.recordSuccess(key);
      yield {
        done: {
          model: key,
          inputTokens: end.inputTokens,
          outputTokens: end.outputTokens,
          cacheReadTokens: end.cacheReadTokens,
          cacheCreationTokens: end.cacheCreationTokens,
        },
      };
      return;
    }
    if (aborted()) {
      yield { failed: true };
      return;
    }
    if (end.status === 200) deps.breaker?.recordSuccess(key);
    else deps.breaker?.recordFailure(key);
    if (progress.emitted) {
      yield { failed: true };
      return;
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
    const stream = (deps.claude as ClaudeStreamClient).messages.stream(buildClaudeBody(model, messages, { cache: deps.cache === true }), {
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
    const usage = message.usage;
    return {
      ok: true,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens,
      cacheCreationTokens: usage.cache_creation_input_tokens,
    };
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
    return { ok: true, inputTokens, outputTokens, cacheReadTokens: null, cacheCreationTokens: null };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    own.abort();
  }
}
