import { APIError } from "@anthropic-ai/sdk";
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
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

    const events = await collect(streamText([SONNET, FREE], MESSAGES, { providers: PROVIDERS, fetch: f, claude: client }));

    expect(events).toEqual([
      { delta: "Hello " },
      { delta: "there" },
      { done: { model: "anthropic:claude-sonnet-5-5", inputTokens: 1200, outputTokens: 80, cacheReadTokens: 0, cacheCreationTokens: 0 } },
    ]);
    expect(fetchCalls).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });

  it("sends the system prompt as a cached system block and the chat history as turns", async () => {
    const { client, calls } = fakeClaude({ events: [textEvent("x")] });

    await collect(streamText([SONNET], MESSAGES, { providers: PROVIDERS, fetch: fakeFetch().fetch, claude: client }));

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
      streamText([SONNET, FREE], MESSAGES, { providers: PROVIDERS, fetch: f, claude: client, breaker }),
    );

    expect(events).toEqual([
      { delta: "Free " },
      { delta: "answer" },
      { done: { model: "freellm:auto", inputTokens: 30, outputTokens: 7, cacheReadTokens: null, cacheCreationTokens: null } },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://llm.test/v1/chat/completions");
    expect(breaker.isOpen("anthropic:claude-sonnet-5-5")).toBe(true);
  });

  it("falls back when the final message ends with refusal before any output", async () => {
    const { client } = fakeClaude({ events: [], final: finalMessage({ stop_reason: "refusal", content: [] }) });
    const { fetch: f, calls } = fakeFetch(sseResponse(GOOD_SSE));

    const events = await collect(streamText([SONNET, FREE], MESSAGES, { providers: PROVIDERS, fetch: f, claude: client }));

    expect(events.at(-1)).toMatchObject({ done: { model: "freellm:auto" } });
    expect(calls).toHaveLength(1);
  });

  it("falls back when the final message ends with max_tokens before any output", async () => {
    const { client } = fakeClaude({ events: [thinkingEvent()], final: finalMessage({ stop_reason: "max_tokens", content: [] }) });
    const { fetch: f } = fakeFetch(sseResponse(GOOD_SSE));

    const events = await collect(streamText([SONNET, FREE], MESSAGES, { providers: PROVIDERS, fetch: f, claude: client }));

    expect(events.at(-1)).toMatchObject({ done: { model: "freellm:auto" } });
  });

  it("ends with failed and no fallback when Claude fails after the first delta", async () => {
    const { client } = fakeClaude({ events: [textEvent("Par"), new TypeError("socket closed")] });
    const { fetch: f, calls } = fakeFetch(sseResponse(GOOD_SSE));

    const events = await collect(streamText([SONNET, FREE], MESSAGES, { providers: PROVIDERS, fetch: f, claude: client }));

    expect(events).toEqual([{ delta: "Par" }, { failed: true }]);
    expect(calls).toHaveLength(0);
  });

  it("ends with failed when Claude refuses after the first delta", async () => {
    const { client } = fakeClaude({ events: [textEvent("Par")], final: finalMessage({ stop_reason: "refusal" }) });
    const { fetch: f, calls } = fakeFetch(sseResponse(GOOD_SSE));

    const events = await collect(streamText([SONNET, FREE], MESSAGES, { providers: PROVIDERS, fetch: f, claude: client }));

    expect(events).toEqual([{ delta: "Par" }, { failed: true }]);
    expect(calls).toHaveLength(0);
  });

  it("skips Claude without a request when ANTHROPIC_API_KEY is empty", async () => {
    const { client, calls: claudeCalls } = fakeClaude({ events: [textEvent("never")] });
    const { fetch: f, calls } = fakeFetch(sseResponse(GOOD_SSE));
    const breaker = createCircuitBreaker(1);

    const events = await collect(
      streamText([SONNET, FREE], MESSAGES, { providers: NO_CLAUDE_KEY, fetch: f, claude: client, breaker }),
    );

    expect(events.at(-1)).toMatchObject({ done: { model: "freellm:auto" } });
    expect(claudeCalls).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(breaker.opened()).toEqual([]);
  });

  it("skips Claude when there is no client", async () => {
    const { fetch: f } = fakeFetch(sseResponse(GOOD_SSE));

    const events = await collect(streamText([SONNET, FREE], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null }));

    expect(events.at(-1)).toMatchObject({ done: { model: "freellm:auto" } });
  });
});

describe("streamText prompt-cache layout", () => {
  const TWO_SYSTEMS: ChatMessage[] = [
    { role: "system", content: "rules" },
    { role: "system", content: "briefing" },
    { role: "user", content: "question" },
  ];

  it("by default sends one merged cached system block and no top-level cache_control", async () => {
    const { client, calls } = fakeClaude({ events: [textEvent("x")] });

    await collect(streamText([SONNET], TWO_SYSTEMS, { providers: PROVIDERS, fetch: fakeFetch().fetch, claude: client }));

    expect(calls[0]?.body).toEqual({
      model: "claude-sonnet-5-5",
      max_tokens: 16_000,
      system: [{ type: "text", text: "rules\n\nbriefing", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "question" }],
      output_config: { effort: "low" },
    });
  });

  it("with cache: true sends each system message as its own cached block plus top-level cache_control", async () => {
    const { client, calls } = fakeClaude({ events: [textEvent("x")] });

    await collect(streamText([SONNET], TWO_SYSTEMS, { providers: PROVIDERS, fetch: fakeFetch().fetch, claude: client, cache: true }));

    expect(calls[0]?.body).toEqual({
      model: "claude-sonnet-5-5",
      max_tokens: 16_000,
      system: [
        { type: "text", text: "rules", cache_control: { type: "ephemeral" } },
        { type: "text", text: "briefing", cache_control: { type: "ephemeral" } },
      ],
      cache_control: { type: "ephemeral" },
      messages: [{ role: "user", content: "question" }],
      output_config: { effort: "low" },
    });
  });

  it("leaves the OpenAI-compatible request unchanged with cache: true", async () => {
    const run = async (cache: boolean): Promise<unknown> => {
      const { fetch: f, calls } = fakeFetch(sseResponse(GOOD_SSE));
      await collect(streamText([FREE], TWO_SYSTEMS, { providers: PROVIDERS, fetch: f, claude: null, cache }));
      return JSON.parse(String(calls[0]?.init.body));
    };

    expect(await run(true)).toEqual(await run(false));
  });

  it("reports uncached input, cache reads and cache writes separately in done", async () => {
    const usage = { ...finalMessage().usage, input_tokens: 40, output_tokens: 90, cache_read_input_tokens: 5000, cache_creation_input_tokens: 700 };
    const { client } = fakeClaude({ events: [textEvent("x")], final: finalMessage({ usage }) });

    const events = await collect(streamText([SONNET], MESSAGES, { providers: PROVIDERS, fetch: fakeFetch().fetch, claude: client, cache: true }));

    expect(events.at(-1)).toEqual({
      done: { model: "anthropic:claude-sonnet-5-5", inputTokens: 40, outputTokens: 90, cacheReadTokens: 5000, cacheCreationTokens: 700 },
    });
  });
});

describe("streamText with OpenAI-compatible providers", () => {
  it("parses SSE lines split across chunks and reports null tokens when the stream has no usage", async () => {
    const bytes = enc.encode(sseLine(sseDelta("Hel")) + sseLine(sseDelta("lo", "stop")) + "data: [DONE]\n\n");
    const response = new Response(streamOf([bytes.slice(0, 17), bytes.slice(17, 40), bytes.slice(40)]), { status: 200 });
    const { fetch: f, calls } = fakeFetch(response);

    const events = await collect(streamText([NVIDIA], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null }));

    expect(events).toEqual([
      { delta: "Hel" },
      { delta: "lo" },
      { done: { model: "nvidia:z-ai/glm-5.3-flash", inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheCreationTokens: null } },
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
      streamText([FREE, NVIDIA], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null, breaker }),
    );

    expect(events.at(-1)).toMatchObject({ done: { model: "nvidia:z-ai/glm-5.3-flash" } });
    expect(calls).toHaveLength(2);
    expect(breaker.opened()).toEqual(["freellm:auto"]);
  });

  it("does not retry a 429: it records the failure and falls back at once", async () => {
    const { fetch: f, calls } = fakeFetch(new Response("slow down", { status: 429 }), sseResponse(GOOD_SSE));
    const breaker = createCircuitBreaker(1);

    const events = await collect(streamText([FREE, NVIDIA], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null, breaker }));

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe("https://llm.test/v1/chat/completions");
    expect(events.at(-1)).toMatchObject({ done: { model: "nvidia:z-ai/glm-5.3-flash" } });
    expect(breaker.opened()).toEqual(["freellm:auto"]);
  });

  it("skips a model whose circuit is open without a request", async () => {
    const breaker = createCircuitBreaker(1);
    breaker.recordFailure("freellm:auto");
    const { fetch: f, calls } = fakeFetch(sseResponse(GOOD_SSE));

    const events = await collect(streamText([FREE, NVIDIA], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null, breaker }));

    expect(calls).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ done: { model: "nvidia:z-ai/glm-5.3-flash" } });
  });

  it("falls back when the stream finishes with length and no output", async () => {
    const empty = sseResponse(sseLine(sseDelta("", "length")) + "data: [DONE]\n\n");
    const { fetch: f } = fakeFetch(empty, sseResponse(GOOD_SSE));

    const events = await collect(streamText([FREE, NVIDIA], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null }));

    expect(events.at(-1)).toMatchObject({ done: { model: "nvidia:z-ai/glm-5.3-flash" } });
    expect(events.some((e) => "failed" in e)).toBe(false);
  });

  it("ends with failed and no fallback when the stream breaks after the first delta", async () => {
    const broken = new Response(streamOf([enc.encode(sseLine(sseDelta("Par")))], new TypeError("terminated")), { status: 200 });
    const { fetch: f, calls } = fakeFetch(broken, sseResponse(GOOD_SSE));
    const breaker = createCircuitBreaker(1);

    const events = await collect(streamText([FREE, NVIDIA], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null, breaker }));

    expect(events).toEqual([{ delta: "Par" }, { failed: true }]);
    expect(calls).toHaveLength(1);
    expect(breaker.opened()).toEqual(["freellm:auto"]);
  });

  it("ends with failed when the stream is cut off by a length finish after output", async () => {
    const cut = sseResponse(sseLine(sseDelta("Par")) + sseLine(sseDelta("", "length")) + "data: [DONE]\n\n");
    const { fetch: f } = fakeFetch(cut, sseResponse(GOOD_SSE));

    const events = await collect(streamText([FREE, NVIDIA], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null }));

    expect(events).toEqual([{ delta: "Par" }, { failed: true }]);
  });
});

describe("streamText when nothing works", () => {
  it("yields only failed when every model fails before output", async () => {
    const { client } = fakeClaude({ events: [apiError(400, "credit")] });
    const { fetch: f } = fakeFetch(new Response("down", { status: 502 }), new Error("network"));

    const events = await collect(
      streamText([SONNET, FREE, NVIDIA], MESSAGES, { providers: PROVIDERS, fetch: f, claude: client }),
    );

    expect(events).toEqual([{ failed: true }]);
  });

  it("yields only failed for an empty chain and when every circuit is open", async () => {
    const breaker = createCircuitBreaker(1);
    breaker.recordFailure("freellm:auto");
    const { fetch: f, calls } = fakeFetch(sseResponse(GOOD_SSE));

    expect(await collect(streamText([], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null }))).toEqual([{ failed: true }]);
    expect(await collect(streamText([FREE], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null, breaker }))).toEqual([
      { failed: true },
    ]);
    expect(calls).toHaveLength(0);
  });

  it("stops without a request when the caller's signal is already aborted", async () => {
    const { fetch: f, calls } = fakeFetch(sseResponse(GOOD_SSE));
    const controller = new AbortController();
    controller.abort();

    const events = await collect(
      streamText([FREE], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null, signal: controller.signal }),
    );

    expect(events).toEqual([{ failed: true }]);
    expect(calls).toHaveLength(0);
  });

  it("on a caller abort mid-stream ends with failed, touches no breaker and tries no other model", async () => {
    const controller = new AbortController();
    const client: ClaudeStreamClient = {
      messages: {
        stream: () => ({
          async *[Symbol.asyncIterator]() {
            yield textEvent("Par");
            controller.abort();
            throw new TypeError("aborted");
          },
          finalMessage: () => Promise.reject(new TypeError("aborted")),
        }),
      },
    };
    const { fetch: f, calls } = fakeFetch(sseResponse(GOOD_SSE));
    const breaker = createCircuitBreaker(1);

    const events = await collect(
      streamText([SONNET, FREE], MESSAGES, { providers: PROVIDERS, fetch: f, claude: client, breaker, signal: controller.signal }),
    );

    expect(events).toEqual([{ delta: "Par" }, { failed: true }]);
    expect(calls).toHaveLength(0);
    expect(breaker.opened()).toEqual([]);
  });

  it("on a caller abort before any output does not fall back or record a failure", async () => {
    const controller = new AbortController();
    let requests = 0;
    const f = (async () => {
      requests += 1;
      controller.abort();
      throw new TypeError("aborted");
    }) as unknown as typeof fetch;
    const breaker = createCircuitBreaker(1);

    const events = await collect(
      streamText([FREE, NVIDIA], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null, breaker, signal: controller.signal }),
    );

    expect(events).toEqual([{ failed: true }]);
    expect(requests).toBe(1);
    expect(breaker.opened()).toEqual([]);
  });
});

describe("streamText timeouts", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A fetch that never answers, and ignores the abort signal (the worst case: only our own timer can end the wait). */
  const hangingFetch = (): { fetch: typeof fetch; calls: FetchCall[] } => {
    const calls: FetchCall[] = [];
    const f = ((input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Promise<Response>(() => {});
    }) as unknown as typeof fetch;
    return { fetch: f, calls };
  };

  /** A fetch that hangs for the models in `hang` (by call number, from 1) and answers with GOOD_SSE for the others. */
  const mixedFetch = (hang: number[]): { fetch: typeof fetch; calls: FetchCall[] } => {
    const calls: FetchCall[] = [];
    const f = ((input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return hang.includes(calls.length) ? new Promise<Response>(() => {}) : Promise.resolve(sseResponse(GOOD_SSE));
    }) as unknown as typeof fetch;
    return { fetch: f, calls };
  };

  it("falls back to the next model when the first sends no text within firstTextTimeoutMs, and counts a failure", async () => {
    vi.useFakeTimers();
    const { fetch: f, calls } = mixedFetch([1]);
    const breaker = createCircuitBreaker(1);
    const pending = collect(
      streamText([FREE, NVIDIA], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null, breaker, firstTextTimeoutMs: 20_000 }),
    );

    await vi.advanceTimersByTimeAsync(19_999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2);
    const events = await pending;

    expect(calls).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ done: { model: "nvidia:z-ai/glm-5.3-flash" } });
    expect(breaker.opened()).toEqual(["freellm:auto"]);
    // The abandoned request was told to stop.
    expect((calls[0]!.init.signal as AbortSignal).aborted).toBe(true);
  });

  it("does the same for a Claude stream that never yields", async () => {
    vi.useFakeTimers();
    const client: ClaudeStreamClient = {
      messages: {
        stream: () => ({
          [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<Anthropic.MessageStreamEvent>>(() => {}) }),
          finalMessage: () => new Promise<Message>(() => {}),
        }),
      },
    };
    const { fetch: f, calls } = fakeFetch(sseResponse(GOOD_SSE));
    const pending = collect(streamText([SONNET, FREE], MESSAGES, { providers: PROVIDERS, fetch: f, claude: client, firstTextTimeoutMs: 20_000 }));

    await vi.advanceTimersByTimeAsync(20_001);
    const events = await pending;

    expect(calls).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ done: { model: "freellm:auto" } });
  });

  it("does not time out an answer whose first text arrived in time, however long the rest takes", async () => {
    vi.useFakeTimers();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(enc.encode(sseLine(sseDelta("Halo "))));
        await new Promise((resolve) => setTimeout(resolve, 25_000));
        controller.enqueue(enc.encode(sseLine(sseDelta("dunia", "stop")) + "data: [DONE]\n\n"));
        controller.close();
      },
    });
    const { fetch: f, calls } = fakeFetch(new Response(body, { status: 200 }));
    const pending = collect(streamText([FREE, NVIDIA], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null, firstTextTimeoutMs: 20_000 }));

    await vi.advanceTimersByTimeAsync(30_000);
    const events = await pending;

    expect(events.map((e) => ("delta" in e ? e.delta : Object.keys(e)[0]))).toEqual(["Halo ", "dunia", "done"]);
    expect(calls).toHaveLength(1);
  });

  it("a caller abort during the wait ends with failed, tries no other model and records no failure", async () => {
    vi.useFakeTimers();
    const { fetch: f, calls } = hangingFetch();
    const breaker = createCircuitBreaker(1);
    const controller = new AbortController();
    const pending = collect(
      streamText([FREE, NVIDIA], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null, breaker, signal: controller.signal, firstTextTimeoutMs: 20_000 }),
    );

    await vi.advanceTimersByTimeAsync(5_000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    const events = await pending;

    expect(events).toEqual([{ failed: true }]);
    expect(calls).toHaveLength(1);
    expect(breaker.opened()).toEqual([]);
  });

  it("ends with failed at deadlineMs without trying the models left, and without blaming the model in flight", async () => {
    vi.useFakeTimers();
    const { fetch: f, calls } = hangingFetch();
    const breaker = createCircuitBreaker(1);
    const pending = collect(
      streamText([FREE, NVIDIA, FREE], MESSAGES, {
        providers: PROVIDERS,
        fetch: f,
        claude: null,
        breaker,
        firstTextTimeoutMs: 20_000,
        deadlineMs: 30_000,
      }),
    );

    await vi.advanceTimersByTimeAsync(20_001);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10_000);
    const events = await pending;

    expect(events).toEqual([{ failed: true }]);
    expect(calls).toHaveLength(2);
    expect(breaker.opened()).toEqual(["freellm:auto"]);
  });

  it("ends an answer that stalls after its first text at deadlineMs", async () => {
    vi.useFakeTimers();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(sseLine(sseDelta("Halo "))));
      },
    });
    const { fetch: f } = fakeFetch(new Response(body, { status: 200 }));
    const pending = collect(streamText([FREE], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null, deadlineMs: 50_000 }));

    await vi.advanceTimersByTimeAsync(50_001);
    expect(await pending).toEqual([{ delta: "Halo " }, { failed: true }]);
  });

  it("changes nothing without the options (a slow answer is waited for)", async () => {
    vi.useFakeTimers();
    const { fetch: f, calls } = mixedFetch([]);
    const pending = collect(streamText([FREE], MESSAGES, { providers: PROVIDERS, fetch: f, claude: null }));
    await vi.advanceTimersByTimeAsync(100_000);
    expect((await pending).at(-1)).toMatchObject({ done: { model: "freellm:auto" } });
    expect(calls).toHaveLength(1);
  });
});
