import { APIError } from "@anthropic-ai/sdk";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { createCircuitBreaker } from "../src/circuit-breaker.js";
import type { ClaudeStreamClient } from "../src/claude.js";
import { COACH_MODELS, ANALYZE_MODELS } from "../src/models.js";
import type { ChatMessage, ModelConfig } from "../src/nvidia.js";
import { loadProviders } from "../src/providers.js";
import { streamText } from "../src/stream.js";
import type { StreamTextEvent } from "../src/stream.js";

type Message = Anthropic.Message;

const SONNET: ModelConfig = { provider: "anthropic", id: "claude-sonnet-5-5", extraBody: {} };
const FREE: ModelConfig = { provider: "freellm", id: "auto", extraBody: {} };
const NVIDIA: ModelConfig = { provider: "nvidia", id: "z-ai/glm-5.3-flash", extraBody: { reasoning_effort: "low" } };
const MESSAGES: ChatMessage[] = [
  { role: "system", content: "You are a coach." },
  { role: "user", content: "first question" },
  { role: "assistant", content: "first answer" },
  { role: "user", content: "second question" },
];
const PROVIDERS = loadProviders({ LLM_BASE_URL: "https://llm.test/v1", LLM_API_KEY: "fk", NVIDIA_API_KEY: "nk", ANTHROPIC_API_KEY: "ak" });
const NO_CLAUDE_KEY = loadProviders({ LLM_BASE_URL: "https://llm.test/v1", ANTHROPIC_API_KEY: "  " });
const noSleep = async (): Promise<void> => {};

function finalMessage(over: Partial<Message> = {}): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    container: null,
    diagnostics: null,
    content: [{ type: "text", text: "Hello there", citations: null }],
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

function textEvent(text: string): Anthropic.MessageStreamEvent {
  return { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } };
}

function thinkingEvent(): Anthropic.MessageStreamEvent {
  return { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } };
}

interface ClaudeScript {
  /** Events yielded in order; an `Error` is thrown at that point of the iteration. */
  events: (Anthropic.MessageStreamEvent | Error)[];
  final?: Message | Error;
}

interface StreamCall {
  body: Anthropic.MessageStreamParams;
  options: { signal?: AbortSignal | null; timeout?: number } | undefined;
}

function fakeClaude(...scripts: ClaudeScript[]): { client: ClaudeStreamClient; calls: StreamCall[] } {
  const calls: StreamCall[] = [];
  const client: ClaudeStreamClient = {
    messages: {
      stream: (body, options) => {
        calls.push({ body, options });
        const script = scripts[Math.min(calls.length - 1, scripts.length - 1)] as ClaudeScript;
        return {
          async *[Symbol.asyncIterator]() {
            for (const event of script.events) {
              if (event instanceof Error) throw event;
              yield event;
            }
          },
          finalMessage: () => {
            const final = script.final ?? finalMessage();
            return final instanceof Error ? Promise.reject(final) : Promise.resolve(final);
          },
        };
      },
    },
  };
  return { client, calls };
}

function apiError(status: number, message: string): APIError {
  return APIError.generate(status, { type: "error", error: { type: "invalid_request_error", message } }, undefined, new Headers());
}

const enc = new TextEncoder();

function sseLine(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function sseDelta(content: string, finish: string | null = null, extra: Record<string, unknown> = {}) {
  return { model: "served/model", choices: [{ delta: { content }, finish_reason: finish }], ...extra };
}

function streamOf(chunks: Uint8Array[], failAfter?: Error): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[i++];
      if (chunk !== undefined) controller.enqueue(chunk);
      else if (failAfter) controller.error(failAfter);
      else controller.close();
    },
  });
}

function sseResponse(text: string, status = 200): Response {
  return new Response(streamOf([enc.encode(text)]), { status });
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

function fakeFetch(...responses: (Response | Error)[]): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const f = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)] as Response | Error;
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

async function collect(iterable: AsyncIterable<StreamTextEvent>): Promise<StreamTextEvent[]> {
  const events: StreamTextEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

const GOOD_SSE =
  sseLine(sseDelta("Free ")) +
  sseLine(sseDelta("answer", "stop")) +
  sseLine({ model: "served/model", choices: [], usage: { prompt_tokens: 30, completion_tokens: 7 } }) +
  "data: [DONE]\n\n";

describe("COACH_MODELS", () => {
  it("is the analysis chain with Claude Sonnet first", () => {
    expect(COACH_MODELS).toBe(ANALYZE_MODELS);
    expect(COACH_MODELS[0]).toEqual({ provider: "anthropic", id: "claude-sonnet-5-5", extraBody: {} });
  });
});

describe("streamText with Claude", () => {
  it("yields the text deltas, then done with the configured model and the token usage", async () => {
    const { client, calls } = fakeClaude({ events: [thinkingEvent(), textEvent("Hello "), textEvent("there")] });
    const { fetch: f, calls: fetchCalls } = fakeFetch(new Error("must not be called"));

    const events = await collect(streamText([SONNET, FREE], MESSAGES, { providers: PROVIDERS, fetch: f, claude: client, sleep: noSleep }));

    expect(events).toEqual([
      { delta: "Hello " },
      { delta: "there" },
      { done: { model: "anthropic:claude-sonnet-5-5", inputTokens: 1200, outputTokens: 80 } },
    ]);
    expect(fetchCalls).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });

  it("sends the system prompt as a cached system block and the chat history as turns", async () => {
    const { client, calls } = fakeClaude({ events: [textEvent("x")] });

    await collect(streamText([SONNET], MESSAGES, { providers: PROVIDERS, fetch: fakeFetch().fetch, claude: client, sleep: noSleep }));

    expect(calls[0]?.body.model).toBe("claude-sonnet-5-5");
    expect(calls[0]?.body.system).toEqual([{ type: "text", text: "You are a coach.", cache_control: { type: "ephemeral" } }]);
    expect(calls[0]?.body.messages).toEqual([
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "second question" },
    ]);
    expect(calls[0]?.options?.signal).toBeInstanceOf(AbortSignal);
  });

  it("falls back to the next model when Claude fails with a 400 credit error before any output", async () => {
    const { client } = fakeClaude({ events: [apiError(400, "Your credit balance is too low")] });
    const { fetch: f, calls } = fakeFetch(sseResponse(GOOD_SSE));
    const breaker = createCircuitBreaker(1);

    const events = await collect(
      streamText([SONNET, FREE], MESSAGES, { providers: PROVIDERS, fetch: f, claude: client, sleep: noSleep, breaker }),
    );

    expect(events).toEqual([
      { delta: "Free " },
      { delta: "answer" },
      { done: { model: "freellm:auto", inputTokens: 30, outputTokens: 7 } },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://llm.test/v1/chat/completions");
    expect(breaker.isOpen("anthropic:claude-sonnet-5-5")).toBe(true);
  });

  it("falls back when the final message ends with refusal before any output", async () => {
    const { client } = fakeClaude({ events: [], final: finalMessage({ stop_reason: "refusal", content: [] }) });
    const { fetch: f, calls } = fakeFetch(sseResponse(GOOD_SSE));

    const events = await collect(streamText([SONNET, FREE], MESSAGES, { providers: PROVIDERS, fetch: f, claude: client, sleep: noSleep }));

    expect(events.at(-1)).toMatchObject({ done: { model: "freellm:auto" } });
    expect(calls).toHaveLength(1);
  });

  it("falls back when the final message ends with max_tokens before any output", async () => {
    const { client } = fakeClaude({ events: [thinkingEvent()], final: finalMessage({ stop_reason: "max_tokens", content: [] }) });
    const { fetch: f } = fakeFetch(sseResponse(GOOD_SSE));

    const events = await collect(streamText([SONNET, FREE], MESSAGES, { providers: PROVIDERS, fetch: f, claude: client, sleep: noSleep }));

    expect(events.at(-1)).toMatchObject({ done: { model: "freellm:auto" } });
  });

  it("ends with failed and no fallback when Claude fails after the first delta", async () => {
    const { client } = fakeClaude({ events: [textEvent("Par"), new TypeError("socket closed")] });
    const { fetch: f, calls } = fakeFetch(sseResponse(GOOD_SSE));

    const events = await collect(streamText([SONNET, FREE], MESSAGES, { providers: PROVIDERS, fetch: f, claude: client, sleep: noSleep }));

    expect(events).toEqual([{ delta: "Par" }, { failed: true }]);
    expect(calls).toHaveLength(0);
  });

  it("ends with failed when Claude refuses after the first delta", async () => {
    const { client } = fakeClaude({ events: [textEvent("Par")], final: finalMessage({ stop_reason: "refusal" }) });
    const { fetch: f, calls } = fakeFetch(sseResponse(GOOD_SSE));

    const events = await collect(streamText([SONNET, FREE], MESSAGES, { providers: PROVIDERS, fetch: f, claude: client, sleep: noSleep }));

    expect(events).toEqual([{ delta: "Par" }, { failed: true }]);
    expect(calls).toHaveLength(0);
  });

  it("skips Claude without a request when ANTHROPIC_API_KEY is empty", async () => {
    const { client, calls: claudeCalls } = fakeClaude({ events: [textEvent("never")] });
    const { fetch: f, calls } = fakeFetch(sseResponse(GOOD_SSE));
    const breaker = createCircuitBreaker(1);

    const events = await collect(
      streamText([SONNET, FREE], MESSAGES, { providers: NO_CLAUDE_KEY, fetch: f, claude: client, sleep: noSleep, breaker }),
    );

    expect(events.at(-1)).toMatchObject({ done: { model: "freellm:auto" } });
    expect(claudeCalls).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(breaker.opened()).toEqual([]);
  });

  it("skips Claude when there is no client", async () => {
    const { fetch: f } = fakeFetch(sseResponse(GOOD_SSE));

    const events = await collect(streamText([SONNET, FREE], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null, sleep: noSleep }));

    expect(events.at(-1)).toMatchObject({ done: { model: "freellm:auto" } });
  });
});

describe("streamText with OpenAI-compatible providers", () => {
  it("parses SSE lines split across chunks and reports null tokens when the stream has no usage", async () => {
    const bytes = enc.encode(sseLine(sseDelta("Hel")) + sseLine(sseDelta("lo", "stop")) + "data: [DONE]\n\n");
    const response = new Response(streamOf([bytes.slice(0, 17), bytes.slice(17, 40), bytes.slice(40)]), { status: 200 });
    const { fetch: f, calls } = fakeFetch(response);

    const events = await collect(streamText([NVIDIA], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null, sleep: noSleep }));

    expect(events).toEqual([
      { delta: "Hel" },
      { delta: "lo" },
      { done: { model: "nvidia:z-ai/glm-5.3-flash", inputTokens: null, outputTokens: null } },
    ]);
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer nk");
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ model: "z-ai/glm-5.3-flash", stream: true, reasoning_effort: "low", messages: MESSAGES });
  });

  it("falls back on an HTTP error and records the failure on the breaker", async () => {
    const { fetch: f, calls } = fakeFetch(new Response("down", { status: 502 }), sseResponse(GOOD_SSE));
    const breaker = createCircuitBreaker(1);

    const events = await collect(
      streamText([FREE, NVIDIA], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null, sleep: noSleep, breaker }),
    );

    expect(events.at(-1)).toMatchObject({ done: { model: "nvidia:z-ai/glm-5.3-flash" } });
    expect(calls).toHaveLength(2);
    expect(breaker.opened()).toEqual(["freellm:auto"]);
  });

  it("retries a 429 after 2 s then 4 s on the same model before falling back", async () => {
    const { fetch: f, calls } = fakeFetch(
      new Response("slow down", { status: 429 }),
      new Response("slow down", { status: 429 }),
      new Response("slow down", { status: 429 }),
      sseResponse(GOOD_SSE),
    );
    const sleep = vi.fn(async (_ms: number): Promise<void> => {});

    const events = await collect(streamText([FREE, NVIDIA], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null, sleep }));

    expect(sleep.mock.calls.map((c) => c[0])).toEqual([2000, 4000]);
    expect(calls).toHaveLength(4);
    expect(events.at(-1)).toMatchObject({ done: { model: "nvidia:z-ai/glm-5.3-flash" } });
  });

  it("skips a model whose circuit is open without a request", async () => {
    const breaker = createCircuitBreaker(1);
    breaker.recordFailure("freellm:auto");
    const { fetch: f, calls } = fakeFetch(sseResponse(GOOD_SSE));

    const events = await collect(streamText([FREE, NVIDIA], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null, sleep: noSleep, breaker }));

    expect(calls).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ done: { model: "nvidia:z-ai/glm-5.3-flash" } });
  });

  it("falls back when the stream finishes with length and no output", async () => {
    const empty = sseResponse(sseLine(sseDelta("", "length")) + "data: [DONE]\n\n");
    const { fetch: f } = fakeFetch(empty, sseResponse(GOOD_SSE));

    const events = await collect(streamText([FREE, NVIDIA], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null, sleep: noSleep }));

    expect(events.at(-1)).toMatchObject({ done: { model: "nvidia:z-ai/glm-5.3-flash" } });
    expect(events.some((e) => "failed" in e)).toBe(false);
  });

  it("ends with failed and no fallback when the stream breaks after the first delta", async () => {
    const broken = new Response(streamOf([enc.encode(sseLine(sseDelta("Par")))], new TypeError("terminated")), { status: 200 });
    const { fetch: f, calls } = fakeFetch(broken, sseResponse(GOOD_SSE));
    const breaker = createCircuitBreaker(1);

    const events = await collect(streamText([FREE, NVIDIA], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null, sleep: noSleep, breaker }));

    expect(events).toEqual([{ delta: "Par" }, { failed: true }]);
    expect(calls).toHaveLength(1);
    expect(breaker.opened()).toEqual(["freellm:auto"]);
  });

  it("ends with failed when the stream is cut off by a length finish after output", async () => {
    const cut = sseResponse(sseLine(sseDelta("Par")) + sseLine(sseDelta("", "length")) + "data: [DONE]\n\n");
    const { fetch: f } = fakeFetch(cut, sseResponse(GOOD_SSE));

    const events = await collect(streamText([FREE, NVIDIA], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null, sleep: noSleep }));

    expect(events).toEqual([{ delta: "Par" }, { failed: true }]);
  });
});

describe("streamText when nothing works", () => {
  it("yields only failed when every model fails before output", async () => {
    const { client } = fakeClaude({ events: [apiError(400, "credit")] });
    const { fetch: f } = fakeFetch(new Response("down", { status: 502 }), new Error("network"));

    const events = await collect(
      streamText([SONNET, FREE, NVIDIA], MESSAGES, { providers: PROVIDERS, fetch: f, claude: client, sleep: noSleep }),
    );

    expect(events).toEqual([{ failed: true }]);
  });

  it("yields only failed for an empty chain and when every circuit is open", async () => {
    const breaker = createCircuitBreaker(1);
    breaker.recordFailure("freellm:auto");
    const { fetch: f, calls } = fakeFetch(sseResponse(GOOD_SSE));

    expect(await collect(streamText([], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null, sleep: noSleep }))).toEqual([{ failed: true }]);
    expect(await collect(streamText([FREE], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null, sleep: noSleep, breaker }))).toEqual([
      { failed: true },
    ]);
    expect(calls).toHaveLength(0);
  });

  it("stops without a request when the caller's signal is already aborted", async () => {
    const { fetch: f, calls } = fakeFetch(sseResponse(GOOD_SSE));
    const controller = new AbortController();
    controller.abort();

    const events = await collect(
      streamText([FREE], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null, sleep: noSleep, signal: controller.signal }),
    );

    expect(events).toEqual([{ failed: true }]);
    expect(calls).toHaveLength(0);
  });
});
