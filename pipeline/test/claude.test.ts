import { APIConnectionError, APIConnectionTimeoutError, APIError } from "@anthropic-ai/sdk";
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createChat } from "../src/llm/chat.js";
import { claudeChat, createClaudeClient } from "../src/llm/claude.js";
import type { ClaudeClient } from "../src/llm/claude.js";
import type { ChatMessage, ModelConfig } from "../src/llm/nvidia.js";
import { callStructured } from "../src/llm/structured.js";
import type { ChatFn } from "../src/llm/structured.js";

type Message = Anthropic.Message;

const KEY = "sk-ant-test-0123456789";
const SONNET: ModelConfig = { provider: "anthropic", id: "claude-sonnet-5-5", extraBody: {} };
const NEXT: ModelConfig = { provider: "nvidia", id: "z-ai/glm-5.3-flash", extraBody: {} };
const MESSAGES: ChatMessage[] = [
  { role: "system", content: "Jawab HANYA dengan satu objek JSON." },
  { role: "user", content: "PROJECT: Ink" },
];
const schema = z.object({ verdict: z.string() });

/** A complete `Message` as the SDK's `finalMessage()` resolves it. */
function message(over: Partial<Message> = {}): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    container: null,
    diagnostics: null,
    content: [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: '{"verdict":', citations: null },
      { type: "text", text: '"garap"}', citations: null },
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      inference_geo: null,
      input_tokens: 1200,
      output_tokens: 80,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: "standard",
    },
    ...over,
  };
}

interface StreamCall {
  body: Anthropic.MessageStreamParams;
  options: { signal?: AbortSignal | null; timeout?: number } | undefined;
}

/** A fake SDK client: each `messages.stream()` call is recorded and its `finalMessage()` gives the next outcome. */
function fakeClient(...outcomes: (Message | Error)[]): { client: ClaudeClient; calls: StreamCall[] } {
  const calls: StreamCall[] = [];
  const client: ClaudeClient = {
    messages: {
      stream: (body, options) => {
        calls.push({ body, options });
        const outcome = outcomes[Math.min(calls.length - 1, outcomes.length - 1)];
        return {
          finalMessage: () => (outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome as Message)),
        };
      },
    },
  };
  return { client, calls };
}

/** An SDK status error, built the way the SDK builds it from an HTTP response. */
function apiError(status: number, type: string, msg: string): APIError {
  return APIError.generate(status, { type: "error", error: { type, message: msg } }, undefined, new Headers());
}

const CREDIT_LOW = "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.";

describe("claudeChat", () => {
  it("returns the text blocks of the final message, the model that answered and a normal end as stop", async () => {
    const { client } = fakeClient(message({ model: "claude-sonnet-5-5-20261001" }));

    const result = await claudeChat(SONNET, MESSAGES, { client, apiKey: KEY });

    expect(result).toMatchObject({
      content: '{"verdict":"garap"}',
      finishReason: "stop",
      httpStatus: 200,
      servedModel: "claude-sonnet-5-5-20261001",
    });
    expect(result.errorBody).toBeUndefined();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("streams one request: the system prompt as a cached system block, the rest as user turns, low effort, no sampling params", async () => {
    const { client, calls } = fakeClient(message());

    await claudeChat(SONNET, MESSAGES, { client, apiKey: KEY });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      model: "claude-sonnet-5-5",
      max_tokens: 16_000,
      system: [{ type: "text", text: "Jawab HANYA dengan satu objek JSON.", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "PROJECT: Ink" }],
      output_config: { effort: "low" },
    });
    // The whole request, stream included, is cut off after REQUEST_TIMEOUT_MS.
    expect(calls[0]?.options?.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]?.options?.timeout).toBe(180_000);
  });

  it.each([
    ["refusal", "refusal"],
    ["max_tokens", "max_tokens"],
    ["pause_turn", "pause_turn"],
  ] as const)("reports stop_reason %s as finish reason %s, never as stop", async (stopReason, finish) => {
    const { client } = fakeClient(
      message({
        stop_reason: stopReason,
        stop_details: stopReason === "refusal" ? { type: "refusal", category: "general_harms", explanation: null } : null,
      }),
    );

    const result = await claudeChat(SONNET, MESSAGES, { client, apiKey: KEY });

    expect(result.httpStatus).toBe(200);
    expect(result.finishReason).toBe(finish);
  });

  it("reports an exhausted credit (HTTP 400) with its status and error body", async () => {
    const { client } = fakeClient(apiError(400, "invalid_request_error", CREDIT_LOW));

    const result = await claudeChat(SONNET, MESSAGES, { client, apiKey: KEY });

    expect(result).toMatchObject({ content: "", finishReason: null, httpStatus: 400, servedModel: null });
    expect(result.errorBody).toContain("credit balance is too low");
  });

  it.each([
    [401, "authentication_error"],
    [402, "billing_error"],
    [403, "permission_error"],
    [429, "rate_limit_error"],
    [500, "api_error"],
    [529, "overloaded_error"],
  ])("reports HTTP %i (%s) with its status", async (status, type) => {
    const { client } = fakeClient(apiError(status, type, "nope"));

    const result = await claudeChat(SONNET, MESSAGES, { client, apiKey: KEY });

    expect(result.httpStatus).toBe(status);
    expect(result.finishReason).toBeNull();
  });

  it.each([
    ["a timeout", new APIConnectionTimeoutError()],
    ["a connection error", new APIConnectionError({ message: "Connection error." })],
    ["an aborted stream", new DOMException("The operation was aborted.", "AbortError")],
    ["any other throw", new TypeError("boom")],
  ])("reports %s as HTTP 0 and never throws", async (_name, error) => {
    const { client } = fakeClient(error);

    const result = await claudeChat(SONNET, MESSAGES, { client, apiKey: KEY });

    expect(result).toMatchObject({ content: "", finishReason: null, httpStatus: 0, servedModel: null });
  });

  it("never puts the API key into the error body, even when the error message carries it", async () => {
    const { client } = fakeClient(apiError(401, "authentication_error", `invalid x-api-key ${KEY}`));

    const result = await claudeChat(SONNET, MESSAGES, { client, apiKey: KEY });

    expect(result.httpStatus).toBe(401);
    expect(result.errorBody).toContain("invalid x-api-key");
    expect(result.errorBody).not.toContain(KEY);
  });

  it("cuts the error body at 500 characters", async () => {
    const { client } = fakeClient(apiError(500, "api_error", "x".repeat(2000)));

    const result = await claudeChat(SONNET, MESSAGES, { client, apiKey: KEY });

    expect(result.errorBody?.length).toBe(500);
  });
});

/** Claude first, then a fallback model answering `{"verdict":"pantau"}`. */
function chain(client: ClaudeClient): { chat: ChatFn; fallbackCalls: number[] } {
  const fallbackCalls: number[] = [];
  const chat: ChatFn = async (model, messages) => {
    if (model.provider === "anthropic") return claudeChat(model, messages, { client, apiKey: KEY });
    fallbackCalls.push(1);
    return { content: '{"verdict":"pantau"}', finishReason: "stop", latencyMs: 1, httpStatus: 200, servedModel: "glm" };
  };
  return { chat, fallbackCalls };
}

describe("Claude in the structured model chain", () => {
  const noSleep = async (): Promise<void> => {};

  it("uses Claude's answer when it is schema-valid, without calling the next model", async () => {
    const { client } = fakeClient(message());
    const { chat, fallbackCalls } = chain(client);

    const out = await callStructured(MESSAGES, schema, [SONNET, NEXT], { chat, sleep: noSleep });

    expect(out).toMatchObject({ ok: true, value: { verdict: "garap" }, model: "anthropic:claude-sonnet-5-5", servedModel: "claude-sonnet-5-5" });
    expect(fallbackCalls).toHaveLength(0);
  });

  it.each([
    ["a refusal", message({ stop_reason: "refusal" }), "finish_refusal"],
    ["a max_tokens cut-off", message({ stop_reason: "max_tokens" }), "finish_max_tokens"],
    ["an exhausted credit", apiError(400, "invalid_request_error", CREDIT_LOW), "http_400"],
    ["an invalid key", apiError(401, "authentication_error", "invalid x-api-key"), "http_401"],
    ["an overloaded API", apiError(529, "overloaded_error", "Overloaded"), "http_529"],
    ["a timeout", new APIConnectionTimeoutError(), "http_0"],
    [
      "unparsable text",
      message({ content: [{ type: "text", text: "Maaf, saya tidak bisa.", citations: null }] }),
      "json_parse",
    ],
    ["a schema mismatch", message({ content: [{ type: "text", text: '{"verdikt":"garap"}', citations: null }] }), "schema"],
  ])("falls back to the next model after %s", async (_name, outcome, error) => {
    const { client, calls } = fakeClient(outcome);
    const { chat, fallbackCalls } = chain(client);

    const out = await callStructured(MESSAGES, schema, [SONNET, NEXT], { chat, sleep: noSleep });

    expect(out).toMatchObject({ ok: true, value: { verdict: "pantau" }, model: "nvidia:z-ai/glm-5.3-flash" });
    expect(calls).toHaveLength(1);
    expect(fallbackCalls).toHaveLength(1);
    expect(out.attempts.map((a) => [a.model, a.error])).toEqual([
      ["anthropic:claude-sonnet-5-5", error],
      ["nvidia:z-ai/glm-5.3-flash", null],
    ]);
  });

  it("retries a rate-limited Claude call twice with the existing backoff, then falls back", async () => {
    const { client, calls } = fakeClient(apiError(429, "rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit"));
    const { chat, fallbackCalls } = chain(client);
    const slept: number[] = [];

    const out = await callStructured(MESSAGES, schema, [SONNET, NEXT], {
      chat,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });

    expect(calls).toHaveLength(3);
    expect(slept).toEqual([2000, 4000]);
    expect(fallbackCalls).toHaveLength(1);
    expect(out.ok).toBe(true);
    expect(out.attempts.map((a) => a.error)).toEqual(["http_429", "http_429", "http_429", null]);
  });

  it("keeps the API key out of every recorded attempt", async () => {
    const { client } = fakeClient(apiError(401, "authentication_error", `invalid x-api-key ${KEY}`));
    const { chat } = chain(client);

    const out = await callStructured(MESSAGES, schema, [SONNET, NEXT], { chat, sleep: noSleep });

    expect(JSON.stringify(out.attempts)).not.toContain(KEY);
  });
});

describe("createChat", () => {
  const providers = {
    freellm: { baseUrl: "https://llm.test/v1", apiKey: "" },
    nvidia: { baseUrl: "https://integrate.api.nvidia.com/v1", apiKey: "nv" },
    anthropic: { apiKey: KEY },
  };

  function recordingFetch(): { fetch: typeof fetch; urls: string[] } {
    const urls: string[] = [];
    const fetchFn = (async (input: unknown) => {
      urls.push(String(input));
      return new Response('data: {"model":"m","choices":[{"delta":{"content":"{}"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    }) as typeof fetch;
    return { fetch: fetchFn, urls };
  }

  it("sends Claude models to the Claude client and the others to their OpenAI-compatible endpoint", async () => {
    const { client, calls } = fakeClient(message());
    const { fetch: fetchFn, urls } = recordingFetch();
    const chat = createChat(providers, { fetch: fetchFn, claude: client });

    const claude = await chat(SONNET, MESSAGES);
    const nvidia = await chat(NEXT, MESSAGES);

    expect(claude.servedModel).toBe("claude-sonnet-5-5");
    expect(calls).toHaveLength(1);
    expect(nvidia.servedModel).toBe("m");
    expect(urls).toEqual(["https://integrate.api.nvidia.com/v1/chat/completions"]);
  });

  it("fails a Claude model at once, with no request, when there is no Claude client (no key)", async () => {
    const { fetch: fetchFn, urls } = recordingFetch();
    const chat = createChat({ ...providers, anthropic: { apiKey: "" } }, { fetch: fetchFn, claude: null });

    const result = await chat(SONNET, MESSAGES);

    expect(result).toMatchObject({ content: "", finishReason: null, httpStatus: 0, servedModel: null });
    expect(urls).toEqual([]);
  });
});

describe("createClaudeClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses only the given key and the Anthropic API, whatever ANTHROPIC_AUTH_TOKEN or ANTHROPIC_BASE_URL say", async () => {
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "other-token");
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://elsewhere.test");
    const seen: { url: string; apiKey: string | null; authorization: string | null }[] = [];
    const fetchFn = (async (input: unknown, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({ url: String(input), apiKey: headers.get("x-api-key"), authorization: headers.get("authorization") });
      return new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "x" } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await claudeChat(SONNET, MESSAGES, { client: createClaudeClient(KEY, fetchFn), apiKey: KEY });

    expect(seen).toEqual([{ url: "https://api.anthropic.com/v1/messages", apiKey: KEY, authorization: null }]);
  });

  it("makes exactly one request per call, sending the key: retries are left to callStructured", async () => {
    const seen: { url: string; apiKey: string | null }[] = [];
    const fetchFn = (async (input: unknown, init?: RequestInit) => {
      seen.push({ url: String(input), apiKey: new Headers(init?.headers).get("x-api-key") });
      return new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }), {
        status: 529,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const client = createClaudeClient(KEY, fetchFn);

    const result = await claudeChat(SONNET, MESSAGES, { client, apiKey: KEY });

    expect(result.httpStatus).toBe(529);
    expect(result.errorBody).toContain("Overloaded");
    expect(seen).toEqual([{ url: "https://api.anthropic.com/v1/messages", apiKey: KEY }]);
  });
});
