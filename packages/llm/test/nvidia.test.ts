import { describe, expect, it } from "vitest";
import type { ModelConfig } from "../src/nvidia.js";
import { REQUEST_TIMEOUT_MS, streamChat } from "../src/nvidia.js";

const enc = new TextEncoder();

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

function sseLine(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function delta(content: string, finish: string | null = null) {
  return { choices: [{ delta: { content }, finish_reason: finish }] };
}

function sseResponse(text: string, status = 200): Response {
  return new Response(streamOf([enc.encode(text)]), { status });
}

const MODEL: ModelConfig = { provider: "nvidia", id: "m/one", extraBody: { reasoning_effort: "low" } };
const BASE_URL = "https://example.test/v1";
const MESSAGES = [{ role: "user" as const, content: "hi" }];

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => handler(String(input), init ?? {})) as unknown as typeof fetch;
}

describe("streamChat", () => {
  it("decodes a UTF-8 character split across two chunks", async () => {
    const bytes = enc.encode(sseLine(delta("a×b")) + "data: [DONE]\n\n");
    const cut = bytes.indexOf(0xc3) + 1; // between 0xC3 and 0x97
    const chunks = [bytes.slice(0, cut), bytes.slice(cut)];
    const f = fakeFetch(() => new Response(streamOf(chunks), { status: 200 }));
    const r = await streamChat(MODEL, MESSAGES, { fetch: f, apiKey: "k", baseUrl: BASE_URL });
    expect(r.content).toBe("a×b");
    expect(r.content).not.toContain("Ã");
    expect(r.httpStatus).toBe(200);
  });

  it("handles SSE lines split across chunks and accumulates deltas", async () => {
    const full = sseLine(delta("Hel")) + sseLine(delta("lo", "stop")) + "data: [DONE]\n\n";
    const bytes = enc.encode(full);
    const chunks = [bytes.slice(0, 17), bytes.slice(17, 40), bytes.slice(40)];
    const f = fakeFetch(() => new Response(streamOf(chunks), { status: 200 }));
    const r = await streamChat(MODEL, MESSAGES, { fetch: f, apiKey: "k", baseUrl: BASE_URL });
    expect(r.content).toBe("Hello");
    expect(r.finishReason).toBe("stop");
  });

  it("returns finishReason null when the stream ends without one", async () => {
    const f = fakeFetch(() => sseResponse(sseLine(delta("partial"))));
    const r = await streamChat(MODEL, MESSAGES, { fetch: f, apiKey: "k", baseUrl: BASE_URL });
    expect(r.content).toBe("partial");
    expect(r.finishReason).toBeNull();
  });

  it("ignores reasoning deltas, non-data lines, usage chunks and unparseable lines", async () => {
    const text =
      ": keep-alive\n" +
      "event: message\n" +
      sseLine({ choices: [{ delta: { reasoning_content: "thinking", content: null }, finish_reason: null }] }) +
      sseLine({ choices: [{ delta: { reasoning: "more" }, finish_reason: null }] }) +
      "data: {not json\n\n" +
      sseLine(delta("ok", "length")) +
      sseLine({ choices: [], usage: { total_tokens: 5 } }) +
      "data: [DONE]\n\n" +
      sseLine(delta("ignored after done"));
    const r = await streamChat(MODEL, MESSAGES, { fetch: fakeFetch(() => sseResponse(text)), apiKey: "k", baseUrl: BASE_URL });
    expect(r.content).toBe("ok");
    expect(r.finishReason).toBe("length");
  });

  it("reports the token usage of the final usage chunk, and none when the stream has no usage", async () => {
    const withUsage =
      sseLine(delta("ok", "stop")) + sseLine({ choices: [], usage: { prompt_tokens: 30, completion_tokens: 7 } }) + "data: [DONE]\n\n";
    const a = await streamChat(MODEL, MESSAGES, { fetch: fakeFetch(() => sseResponse(withUsage)), apiKey: "k", baseUrl: BASE_URL });
    expect(a.usage).toEqual({ inputTokens: 30, outputTokens: 7 });
    const b = await streamChat(MODEL, MESSAGES, {
      fetch: fakeFetch(() => sseResponse(sseLine(delta("ok", "stop")) + "data: [DONE]\n\n")),
      apiKey: "k",
      baseUrl: BASE_URL,
    });
    expect("usage" in b).toBe(false);
  });

  it("sends the documented request", async () => {
    let seenUrl = "";
    let seenInit: RequestInit = {};
    const f = fakeFetch((url, init) => {
      seenUrl = url;
      seenInit = init;
      return sseResponse("data: [DONE]\n\n");
    });
    await streamChat(MODEL, MESSAGES, { fetch: f, apiKey: "secret", baseUrl: "https://example.test/v1" });
    expect(seenUrl).toBe("https://example.test/v1/chat/completions");
    expect(seenInit.method).toBe("POST");
    const headers = seenInit.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer secret");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(seenInit.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(seenInit.body))).toEqual({
      model: "m/one",
      messages: MESSAGES,
      temperature: 0,
      max_tokens: 8192,
      stream: true,
      stream_options: { include_usage: true },
      reasoning_effort: "low",
    });
  });

  it("aborts a request after 180 seconds", () => {
    expect(REQUEST_TIMEOUT_MS).toBe(180_000);
  });

  it("omits Authorization for an empty key", async () => {
    let seenUrl = "";
    let seenInit: RequestInit = {};
    const f = fakeFetch((url, init) => {
      seenUrl = url;
      seenInit = init;
      return sseResponse("data: [DONE]\n\n");
    });
    await streamChat(MODEL, MESSAGES, { fetch: f, apiKey: "", baseUrl: "https://freellm.test/v1" });
    expect(seenUrl).toBe("https://freellm.test/v1/chat/completions");
    expect(Object.keys(seenInit.headers as Record<string, string>)).not.toContain("Authorization");
  });

  it("captures the model that actually answered from the stream", async () => {
    const text =
      sseLine({ choices: [{ delta: { role: "assistant" }, finish_reason: null }] }) +
      sseLine({ model: "", choices: [] }) +
      sseLine({ model: "gpt-oss:120b", choices: [{ delta: { content: "{" }, finish_reason: null }] }) +
      sseLine({ model: "other-model", choices: [{ delta: { content: "}" }, finish_reason: "stop" }] }) +
      "data: [DONE]\n\n";
    const auto: ModelConfig = { provider: "freellm", id: "auto", extraBody: {} };
    const r = await streamChat(auto, MESSAGES, {
      fetch: fakeFetch(() => sseResponse(text)),
      apiKey: "",
      baseUrl: "https://x.test/v1",
    });
    expect(r.content).toBe("{}");
    expect(r.servedModel).toBe("gpt-oss:120b");
  });

  it("reports no served model when the stream never names one", async () => {
    const r = await streamChat(MODEL, MESSAGES, {
      fetch: fakeFetch(() => sseResponse(sseLine(delta("ok", "stop")) + "data: [DONE]\n\n")),
      apiKey: "k",
      baseUrl: BASE_URL,
    });
    expect(r.servedModel).toBeNull();
  });

  it("reports no served model for a failed request", async () => {
    const f = fakeFetch(() => new Response("busy", { status: 503 }));
    const r = await streamChat(MODEL, MESSAGES, { fetch: f, apiKey: "k", baseUrl: BASE_URL });
    expect(r.servedModel).toBeNull();
  });

  it("never throws: network errors become httpStatus 0", async () => {
    const f = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    const r = await streamChat(MODEL, MESSAGES, { fetch: f, apiKey: "k", baseUrl: BASE_URL });
    expect(r).toMatchObject({ httpStatus: 0, content: "", finishReason: null });
  });

  it("never throws: a stream that errors mid-read becomes httpStatus 0", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(sseLine(delta("x"))));
        c.error(new Error("boom"));
      },
    });
    const r = await streamChat(MODEL, MESSAGES, { fetch: fakeFetch(() => new Response(body)), apiKey: "k", baseUrl: BASE_URL });
    expect(r).toMatchObject({ httpStatus: 0, content: "", finishReason: null });
  });

  it("non-2xx returns the status and a truncated error body", async () => {
    const f = fakeFetch(() => new Response("x".repeat(900), { status: 502 }));
    const r = await streamChat(MODEL, MESSAGES, { fetch: f, apiKey: "k", baseUrl: BASE_URL });
    expect(r.httpStatus).toBe(502);
    expect(r.content).toBe("");
    expect(r.finishReason).toBeNull();
    expect(r.errorBody).toBe("x".repeat(500));
  });
});
