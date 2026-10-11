// Anthropic Claude through the official SDK (`@anthropic-ai/sdk`), with the same `ChatResult` as `streamChat`, so
// `callStructured` (429 retries, circuit breaker, attempts) treats it like any other model.
import Anthropic from "@anthropic-ai/sdk";
import { REQUEST_TIMEOUT_MS } from "./nvidia.js";
import type { ChatMessage, ChatResult, ModelConfig } from "./nvidia.js";

/** The part of the SDK client `claudeChat` uses; tests pass a fake. */
export interface ClaudeClient {
  messages: {
    stream(
      body: Anthropic.MessageStreamParams,
      options?: { signal?: AbortSignal | null; timeout?: number },
    ): { finalMessage(): Promise<Anthropic.Message> };
  };
}

/**
 * Output budget of one Claude call. With adaptive thinking the thinking tokens count toward it as well; the JSON
 * answers of the analyses are far shorter. A call that still hits it ends with `max_tokens` and falls through.
 */
export const CLAUDE_MAX_TOKENS = 16_000;
/** Thinking depth (`output_config.effort`): `low` keeps thinking short; the answer is a JSON summary of given text. */
export const CLAUDE_EFFORT = "low";
const ERROR_BODY_MAX_CHARS = 500;
const ANTHROPIC_BASE_URL = "https://api.anthropic.com";

/**
 * The real SDK client for `apiKey`. `maxRetries: 0`: `callStructured` already retries a 429 (2 s, 4 s) and then moves
 * on, so the SDK's own retries would only spend the analysis time budget twice. Each request is also cut off after
 * `REQUEST_TIMEOUT_MS` (see `claudeChat`). `authToken` and `baseURL` are fixed so that `ANTHROPIC_AUTH_TOKEN` or
 * `ANTHROPIC_BASE_URL` in the environment can neither add a second credential nor send the key elsewhere.
 */
export function createClaudeClient(apiKey: string, fetchFn: typeof fetch): ClaudeClient {
  return new Anthropic({
    apiKey,
    authToken: null,
    baseURL: ANTHROPIC_BASE_URL,
    fetch: fetchFn,
    maxRetries: 0,
    timeout: REQUEST_TIMEOUT_MS,
  });
}

/**
 * Sends `messages` to Claude as one streamed request and returns the text of the final message. The `system`
 * messages become the top-level system prompt, marked for prompt caching (it is the same for every project of an
 * analysis kind), and the `user` messages the conversation. No `temperature`: current Claude models reject
 * non-default sampling parameters.
 *
 * - `finishReason`: `stop` for `end_turn` (a complete answer); any other `stop_reason` (`refusal`, `max_tokens`, ...)
 *   is passed on as it is, so `callStructured` moves on to the next model.
 * - `httpStatus`: 200 on an answer, the SDK error's status on an HTTP error (400 for an exhausted credit), 0 for a
 *   network error, a timeout or anything else thrown. Never throws.
 * - `errorBody`: the SDK error message (it carries the API's error JSON), cut at 500 characters, with the API key
 *   removed should it ever appear there.
 */
export async function claudeChat(
  model: ModelConfig,
  messages: ChatMessage[],
  deps: { client: ClaudeClient; apiKey: string },
): Promise<ChatResult> {
  const started = Date.now();
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const body: Anthropic.MessageStreamParams = {
    model: model.id,
    max_tokens: CLAUDE_MAX_TOKENS,
    ...(system === "" ? {} : { system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] }),
    messages: messages.filter((m) => m.role === "user").map((m) => ({ role: "user", content: m.content })),
    output_config: { effort: CLAUDE_EFFORT },
    ...model.extraBody,
  };

  try {
    const stream = deps.client.messages.stream(body, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      timeout: REQUEST_TIMEOUT_MS,
    });
    const message = await stream.finalMessage();
    const content = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    return {
      content,
      finishReason: message.stop_reason === "end_turn" ? "stop" : message.stop_reason,
      latencyMs: Date.now() - started,
      httpStatus: 200,
      servedModel: message.model,
    };
  } catch (error) {
    const failed: ChatResult = { content: "", finishReason: null, latencyMs: Date.now() - started, httpStatus: 0, servedModel: null };
    if (error instanceof Anthropic.APIError && typeof error.status === "number") {
      failed.httpStatus = error.status;
      failed.errorBody = redact(error.message, deps.apiKey).slice(0, ERROR_BODY_MAX_CHARS);
    }
    return failed;
  }
}

function redact(text: string, secret: string): string {
  return secret === "" ? text : text.split(secret).join("[redacted]");
}
