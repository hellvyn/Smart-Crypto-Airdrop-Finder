import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defaultConfig } from "../src/config.js";
import { createCircuitBreaker } from "../src/llm/circuit-breaker.js";
import type { ChatMessage, ChatResult, ModelConfig } from "../src/llm/nvidia.js";
import { callStructured } from "../src/llm/structured.js";
import type { ChatFn } from "../src/llm/structured.js";

const MODELS: ModelConfig[] = [
  { provider: "nvidia", id: "m/one", extraBody: {} },
  { provider: "nvidia", id: "m/two", extraBody: {} },
  { provider: "nvidia", id: "m/three", extraBody: {} },
];

const MESSAGES: ChatMessage[] = [
  { role: "system", content: "Answer with JSON." },
  { role: "user", content: "Rate this." },
];

const schema = z.object({ verdict: z.enum(["garap", "pantau", "skip"]), score: z.number() });

function reply(over: Partial<ChatResult> = {}): ChatResult {
  return {
    content: JSON.stringify({ verdict: "pantau", score: 2 }),
    finishReason: "stop",
    latencyMs: 5,
    httpStatus: 200,
    servedModel: null,
    ...over,
  };
}

/** Answers with `replies` in order and records the model id and messages of every call. */
function scripted(replies: ChatResult[]): { chat: ChatFn; calls: string[]; messages: ChatMessage[][] } {
  const calls: string[] = [];
  const messages: ChatMessage[][] = [];
  let i = 0;
  const chat: ChatFn = async (model, msgs) => {
    calls.push(model.id);
    messages.push(msgs);
    const r = replies[i++];
    if (!r) throw new Error("script exhausted");
    return r;
  };
  return { chat, calls, messages };
}

const noSleep = async (): Promise<void> => {};

describe("callStructured", () => {
  it("returns the schema-valid value with the configured and the served model", async () => {
    const { chat, messages } = scripted([reply({ servedModel: "gpt-oss:120b" })]);
    const out = await callStructured(MESSAGES, schema, MODELS, { chat, sleep: noSleep });
    expect(out).toMatchObject({
      ok: true,
      value: { verdict: "pantau", score: 2 },
      model: "nvidia:m/one",
      servedModel: "gpt-oss:120b",
    });
    expect(messages).toEqual([MESSAGES]);
  });

  it("moves on to the next model when an answer fails the given schema", async () => {
    const breaker = createCircuitBreaker(1);
    const { chat, calls } = scripted([
      reply({ content: JSON.stringify({ verdict: "farm", score: 2 }) }),
      reply({ content: "```json\n{\"verdict\": \"skip\", \"score\": 0}\n```" }),
    ]);
    const out = await callStructured(MESSAGES, schema, MODELS, { chat, sleep: noSleep, breaker });
    expect(out.ok && out.value).toEqual({ verdict: "skip", score: 0 });
    expect(out.ok && out.model).toBe("nvidia:m/two");
    expect(calls).toEqual(["m/one", "m/two"]);
    expect(out.attempts.map((a) => a.error)).toEqual(["schema", null]);
    // A 200 with an unusable answer is not an endpoint failure.
    expect(breaker.isOpen("nvidia:m/one")).toBe(false);
  });

  it("retries a 429 on the same model after 2000 then 4000 ms, then moves to the next model", async () => {
    const limited = reply({ httpStatus: 429, content: "", finishReason: null, errorBody: "slow down" });
    const { chat, calls } = scripted([limited, limited, limited, reply()]);
    const sleep = vi.fn(async (_ms: number) => {});
    const out = await callStructured(MESSAGES, schema, MODELS, { chat, sleep });
    expect(out.ok && out.model).toBe("nvidia:m/two");
    expect(calls).toEqual(["m/one", "m/one", "m/one", "m/two"]);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([2000, 4000]);
  });

  it("skips a model whose circuit is open and counts a final non-200 reply against its model", async () => {
    const breaker = createCircuitBreaker(1);
    breaker.recordFailure("nvidia:m/one");
    const { chat, calls } = scripted([reply({ httpStatus: 503, content: "", finishReason: null }), reply()]);
    const out = await callStructured(MESSAGES, schema, MODELS, { chat, sleep: noSleep, breaker });
    expect(calls).toEqual(["m/two", "m/three"]);
    expect(out.ok && out.model).toBe("nvidia:m/three");
    expect(breaker.opened()).toEqual(["nvidia:m/one", "nvidia:m/two"]);
  });

  it("falls back to NVIDIA when freellm auto returns invalid JSON, without tripping the auto circuit", async () => {
    const breaker = createCircuitBreaker(1);
    const { chat, calls } = scripted([reply({ content: "not json", servedModel: "gpt-oss:120b" }), reply()]);
    const out = await callStructured(MESSAGES, schema, defaultConfig.models, { chat, sleep: noSleep, breaker });
    expect(out.ok && out.model).toBe("nvidia:z-ai/glm-5.3-flash");
    expect(calls).toEqual(["auto", "z-ai/glm-5.3-flash"]);
    expect(breaker.isOpen("freellm:auto")).toBe(false);
  });

  it("reports a real failure (not stopped) when every model fails", async () => {
    const { chat } = scripted([reply({ content: "" }), reply({ finishReason: "length" }), reply({ content: "{}" })]);
    const out = await callStructured(MESSAGES, schema, MODELS, { chat, sleep: noSleep, shouldStop: () => false });
    expect(out.ok).toBe(false);
    expect(!out.ok && out.stopped).toBe(false);
    expect(out.attempts.map((a) => a.error)).toEqual(["empty_content", "finish_length", "schema"]);
  });

  it("starts no further call once shouldStop is true and reports stopped", async () => {
    let stop = false;
    const { chat, calls } = scripted([reply({ content: "" }), reply()]);
    const out = await callStructured(MESSAGES, schema, MODELS, {
      chat: async (m, msgs) => {
        const r = await chat(m, msgs);
        stop = true;
        return r;
      },
      sleep: noSleep,
      shouldStop: () => stop,
    });
    expect(out).toMatchObject({ ok: false, stopped: true });
    expect(calls).toEqual(["m/one"]);
  });

  it("reports stopped without any call when every model's circuit is open", async () => {
    const breaker = createCircuitBreaker(1);
    for (const m of MODELS) breaker.recordFailure(`nvidia:${m.id}`);
    const { chat, calls } = scripted([]);
    const out = await callStructured(MESSAGES, schema, MODELS, { chat, sleep: noSleep, breaker });
    expect(out).toEqual({ ok: false, stopped: true, attempts: [] });
    expect(calls).toEqual([]);
  });
});
