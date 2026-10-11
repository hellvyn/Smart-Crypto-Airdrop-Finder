import type { StreamTextEvent } from "@saf/llm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { coach } from "../lib/copy";
import { OUTSIDER, P1, P2, P3, PROFILE, candidateTables, fakeCoachDb, type FakeDb, type Result, type Row } from "./coach-fakes";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "secret.member@example.com" };
const THREAD = "22222222-2222-4222-8222-222222222222";
const MSG = "33333333-3333-4333-8333-333333333333";
const STEP_ID = "44444444-4444-4444-8444-444444444444";

const getUser = vi.fn();
const streamText = vi.fn();
const callStructured = vi.fn();
let fake: FakeDb;

vi.mock("@/lib/auth", () => ({ getUser: () => getUser() }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => fake.db }));
vi.mock("@saf/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@saf/llm")>()),
  streamText: (...a: unknown[]) => streamText(...a),
  callStructured: (...a: unknown[]) => callStructured(...a),
}));

import { POST as chatPOST, maxDuration as chatMaxDuration } from "../app/api/coach/chat/route";
import { POST as planPOST, maxDuration as planMaxDuration } from "../app/api/coach/plan/route";

const ok: Result = { data: null, error: null };
const rpcError = (message: string, code = "P0001"): Result => ({ data: null, error: { message, code } });

interface Setup {
  rpc?: Record<string, (args: Record<string, unknown>) => Result>;
  tables?: Record<string, Row[]>;
}

/** A db with a member profile, three candidates and working RPCs, overridable per test. */
function setup({ rpc = {}, tables = {} }: Setup = {}): FakeDb {
  fake = fakeCoachDb({
    tables: {
      coach_profiles: [{ user_id: USER.id, ...PROFILE }],
      ...candidateTables([
        { id: P1, name: "Alpha" },
        { id: P2, name: "Beta" },
        { id: P3, name: "Gamma" },
      ]),
      coach_threads: [{ id: THREAD, user_id: USER.id, project_id: null }],
      ...tables,
    },
    rpc: {
      coach_new_thread: () => ({ data: THREAD, error: null }),
      coach_begin: () => ({ data: MSG, error: null }),
      coach_mark_used: () => ok,
      coach_save_plan: () => ok,
      coach_finish: () => ({ data: "55555555-5555-4555-8555-555555555555", error: null }),
      ...rpc,
    },
  });
  return fake;
}

const post = (route: typeof planPOST, body: unknown, init: { type?: string; signal?: AbortSignal } = {}) =>
  route(
    new Request("http://x/api/coach", {
      method: "POST",
      headers: { "content-type": init.type ?? "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
      ...(init.signal ? { signal: init.signal } : {}),
    }),
  );

const rpcNames = () => fake.rpcCalls.map((c) => c.name);

beforeEach(() => {
  getUser.mockReset().mockResolvedValue(USER);
  streamText.mockReset();
  callStructured.mockReset();
  setup();
});

// ---------------------------------------------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------------------------------------------

const rec = (project_id: string, name: string) => ({
  project_id,
  reasons: [{ text: `${name} punya program poin aktif`, quote: `${name} points program is live` }],
  minutes_per_day: 15,
  capital_note: "Gratis, siapkan gas sedikit",
});

const planAnswer = (...recs: ReturnType<typeof rec>[]) => ({
  ok: true as const,
  value: { recommendations: recs },
  model: "freellm:auto",
  servedModel: null,
  attempts: [],
});

const GOOD = () => planAnswer(rec(P1, "Alpha"), rec(P2, "Beta"), rec(P3, "Gamma"));

describe("POST /api/coach/plan", () => {
  it("exports a 60 s duration for the streaming platform limit", () => {
    expect(planMaxDuration).toBe(60);
    expect(chatMaxDuration).toBe(60);
  });

  it("is a JSON 401 for a visitor, with no database or model call", async () => {
    getUser.mockResolvedValue(null);
    const res = await post(planPOST, {});
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(fake.rpcCalls).toHaveLength(0);
    expect(fake.reads).toHaveLength(0);
    expect(callStructured).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong content type", "{}", "text/plain"],
    ["malformed JSON", "{nope", "application/json"],
    ["an array body", "[]", "application/json"],
    ["a null body", "null", "application/json"],
  ])("is 400 bad_input for %s", async (_n, body, type) => {
    const res = await post(planPOST, body, { type });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_input", message: coach.errors.bad_input });
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("is 400 bad_input when the member has no profile yet, without any RPC", async () => {
    setup({ tables: { coach_profiles: [] } });
    const res = await post(planPOST, {});
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_input");
    expect(fake.rpcCalls).toHaveLength(0);
    expect(callStructured).not.toHaveBeenCalled();
  });

  it("answers 200 with the empty state and calls neither the model nor any RPC when there are no candidates", async () => {
    setup({ tables: { curated_list: [] } });
    const res = await post(planPOST, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ state: "no_candidates", threadId: null, recommendations: [], message: coach.empty.noCandidates });
    expect(fake.rpcCalls).toHaveLength(0);
    expect(callStructured).not.toHaveBeenCalled();
  });

  it("treats candidates the profile filters out as the empty state too", async () => {
    // Gratis aja: only free projects; every candidate here needs a deposit.
    setup({
      tables: {
        coach_profiles: [{ user_id: USER.id, ...PROFILE, capital_band: "free" }],
        curated_list: candidateTables([{ id: P1, name: "Alpha" }]).curated_list!.map((r) => ({ ...r, capital: "deposit", capital_min_usd: 5 })),
      },
    });
    const res = await post(planPOST, {});
    expect((await res.json()).state).toBe("no_candidates");
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("runs the RPCs in order and returns the validated plan with the thread and the remaining quota", async () => {
    callStructured.mockResolvedValue(GOOD());
    setup({
      tables: {
        coach_messages: [
          { id: "old", role: "user", reply_to: null, created_at: new Date().toISOString() },
          { id: "oldr", role: "assistant", reply_to: "old", created_at: new Date().toISOString() },
        ],
      },
    });
    const res = await post(planPOST, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.threadId).toBe(THREAD);
    expect(body.remaining).toBe(19);
    expect(body.state).toBeUndefined();
    expect(body.recommendations.map((r: { project_id: string }) => r.project_id)).toEqual([P1, P2, P3]);
    expect(body.recommendations[0]).toMatchObject({ slug: "alpha", name: "Alpha", minutes_per_day: 15 });
    expect(res.headers.get("cache-control")).toBe("no-store");

    expect(rpcNames()).toEqual(["coach_new_thread", "coach_begin", "coach_mark_used", "coach_save_plan", "coach_finish"]);
    const [thread, begin, used, save, finish] = fake.rpcCalls;
    expect(thread?.args).toEqual({ p_project_id: null });
    expect(begin?.args).toEqual({ p_thread_id: THREAD, p_kind: "plan", p_content: coach.planRequest });
    expect(used?.args).toEqual({ p_user_message_id: MSG });
    expect(save?.args.p_thread_id).toBe(THREAD);
    expect((save?.args.p_plan as { recommendations: unknown[] }).recommendations).toHaveLength(3);
    expect(finish?.args).toMatchObject({ p_user_message_id: MSG, p_model: "freellm:auto" });
    const stored = String(finish?.args.p_content);
    expect(stored).toContain("Alpha");
    expect(stored.length).toBeLessThanOrEqual(16000);
  });

  it("stores the same recommendations it returns", async () => {
    callStructured.mockResolvedValue(GOOD());
    const res = await post(planPOST, {});
    const body = await res.json();
    const saved = fake.rpcCalls.find((c) => c.name === "coach_save_plan")?.args.p_plan;
    expect(saved).toEqual({ recommendations: body.recommendations });
  });

  it("drops a recommendation whose project is not among the candidates", async () => {
    callStructured.mockResolvedValue(planAnswer(rec(P1, "Alpha"), rec(OUTSIDER, "Zeta"), rec(P2, "Beta"), rec(P3, "Gamma")));
    const res = await post(planPOST, {});
    const ids = (await res.json()).recommendations.map((r: { project_id: string }) => r.project_id);
    expect(ids).toEqual([P1, P2, P3]);
    expect(ids).not.toContain(OUTSIDER);
  });

  it("marks the message used as soon as the model answers, even when validation then leaves nothing", async () => {
    callStructured.mockResolvedValue(planAnswer(rec(OUTSIDER, "A"), rec("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "B"), rec("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "C")));
    const res = await post(planPOST, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: "no_plan", recommendations: [], threadId: THREAD, message: coach.empty.noPlan });
    expect(rpcNames()).toEqual(["coach_new_thread", "coach_begin", "coach_mark_used"]);
  });

  it("maps a quota error from coach_begin to 429 with the quota copy, and stops there", async () => {
    setup({ rpc: { coach_begin: () => rpcError("quota") } });
    const res = await post(planPOST, {});
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "quota", message: coach.errors.quota });
    expect(callStructured).not.toHaveBeenCalled();
    expect(rpcNames()).not.toContain("coach_finish");
  });

  it("maps the daily thread cap to the quota copy as well", async () => {
    setup({ rpc: { coach_new_thread: () => rpcError("threads") } });
    const res = await post(planPOST, {});
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("quota");
    expect(rpcNames()).toEqual(["coach_new_thread"]);
  });

  it("is 503 unavailable when every model fails, and neither marks the message used nor finishes it", async () => {
    callStructured.mockResolvedValue({ ok: false, stopped: false, attempts: [] });
    const res = await post(planPOST, {});
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable", message: coach.errors.unavailable });
    expect(rpcNames()).toEqual(["coach_new_thread", "coach_begin"]);
  });

  it("is 503 unavailable when the model call throws", async () => {
    callStructured.mockRejectedValue(new Error("boom"));
    const res = await post(planPOST, {});
    expect(res.status).toBe(503);
    expect(rpcNames()).not.toContain("coach_finish");
  });

  it("is 503 and saves nothing when coach_mark_used refuses an expired message", async () => {
    callStructured.mockResolvedValue(GOOD());
    setup({ rpc: { coach_mark_used: () => rpcError("expired") } });
    const res = await post(planPOST, {});
    expect(res.status).toBe(503);
    expect(rpcNames()).toEqual(["coach_new_thread", "coach_begin", "coach_mark_used"]);
  });

  it("is 503 when the plan cannot be saved", async () => {
    callStructured.mockResolvedValue(GOOD());
    setup({ rpc: { coach_save_plan: () => rpcError("boom", "XX000") } });
    const res = await post(planPOST, {});
    expect(res.status).toBe(503);
    expect(rpcNames()).not.toContain("coach_finish");
  });

  it("still returns the saved plan when only the final coach_finish bookkeeping fails", async () => {
    callStructured.mockResolvedValue(GOOD());
    setup({ rpc: { coach_finish: () => rpcError("boom", "XX000") } });
    const res = await post(planPOST, {});
    expect(res.status).toBe(200);
    expect((await res.json()).recommendations).toHaveLength(3);
  });

  it("omits remaining when the member's messages cannot be read", async () => {
    callStructured.mockResolvedValue(GOOD());
    setup();
    fake = fakeCoachDb({
      tables: {
        coach_profiles: [{ user_id: USER.id, ...PROFILE }],
        ...candidateTables([{ id: P1, name: "Alpha" }, { id: P2, name: "Beta" }, { id: P3, name: "Gamma" }]),
      },
      tableErrors: { coach_messages: { message: "down" } },
      rpc: { coach_new_thread: () => ({ data: THREAD, error: null }), coach_begin: () => ({ data: MSG, error: null }) },
    });
    const res = await post(planPOST, {});
    expect(res.status).toBe(200);
    expect((await res.json()).remaining).toBeNull();
  });

  describe("the prompt", () => {
    const sentMessages = (): { role: string; content: string }[] => callStructured.mock.calls[0]![0] as { role: string; content: string }[];

    it("is two system blocks (shared, then member) and one user turn, with no model other than the Coach chain", async () => {
      callStructured.mockResolvedValue(GOOD());
      await post(planPOST, {});
      const messages = sentMessages();
      expect(messages.map((m) => m.role)).toEqual(["system", "system", "user"]);
      expect(messages[0]!.content).toContain("GLOSARIUM");
      expect(messages[1]!.content).toContain("PROFIL MEMBER");
      expect(messages[1]!.content).toContain("Alpha");
      expect(messages[2]!.content).toContain("recommendations");
    });

    it("never contains the member's email or user id", async () => {
      callStructured.mockResolvedValue(GOOD());
      await post(planPOST, {});
      const all = JSON.stringify(callStructured.mock.calls[0]);
      expect(all).not.toContain(USER.email);
      expect(all).not.toContain(USER.id);
    });

    it("has byte-identical system blocks across two calls for the same member and day", async () => {
      callStructured.mockResolvedValue(GOOD());
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date("2026-10-11T01:00:00Z"));
        await post(planPOST, {});
        vi.setSystemTime(new Date("2026-10-11T09:30:00Z"));
        setup();
        await post(planPOST, {});
      } finally {
        vi.useRealTimers();
      }
      const [first, second] = [callStructured.mock.calls[0]![0], callStructured.mock.calls[1]![0]] as { content: string }[][];
      expect(first![0]!.content).toBe(second![0]!.content);
      expect(first![1]!.content).toBe(second![1]!.content);
    });

    it("has an identical shared block for two different members, and no date or time in it", async () => {
      callStructured.mockResolvedValue(GOOD());
      await post(planPOST, {});
      setup({ tables: { coach_profiles: [{ user_id: USER.id, ...PROFILE, level: "pro", capital_band: "over_1000", chains: ["Solana"] }] } });
      await post(planPOST, {});
      const [first, second] = [callStructured.mock.calls[0]![0], callStructured.mock.calls[1]![0]] as { content: string }[][];
      expect(first![0]!.content).toBe(second![0]!.content);
      expect(first![1]!.content).not.toBe(second![1]!.content);
      expect(first![0]!.content).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}/);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------------------------------------------

async function* events(...list: (StreamTextEvent | Error)[]): AsyncGenerator<StreamTextEvent, void, undefined> {
  for (const e of list) {
    if (e instanceof Error) throw e;
    yield e;
  }
}

const DONE = (over: Partial<Extract<StreamTextEvent, { done: unknown }>["done"]> = {}): StreamTextEvent => ({
  done: { model: "anthropic:claude-sonnet-5-5", inputTokens: 100, outputTokens: 40, cacheReadTokens: 80, cacheCreationTokens: 20, ...over },
});

const chatBody = (over: Record<string, unknown> = {}) => ({ threadId: THREAD, message: "Mulai dari mana?", kind: "chat", ...over });

describe("POST /api/coach/chat: input", () => {
  it("is a JSON 401 for a visitor, with no database or model call", async () => {
    getUser.mockResolvedValue(null);
    const res = await post(chatPOST, chatBody());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(fake.rpcCalls).toHaveLength(0);
    expect(streamText).not.toHaveBeenCalled();
  });

  it.each([
    ["a thread id that is not a uuid", chatBody({ threadId: "abc" })],
    ["a missing message", { threadId: THREAD, kind: "chat" }],
    ["a blank message", chatBody({ message: "   " })],
    ["a message of 1001 characters", chatBody({ message: "x".repeat(1001) })],
    ["a non-string message", chatBody({ message: 5 })],
    ["an unknown kind", chatBody({ kind: "plan" })],
    ["a step id that is not a uuid", chatBody({ kind: "explain_step", stepId: "nope" })],
    ["a step id on a plain chat", chatBody({ stepId: STEP_ID })],
  ])("is 400 bad_input for %s, with no RPC and no model call", async (_n, body) => {
    const res = await post(chatPOST, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_input", message: coach.errors.bad_input });
    expect(fake.rpcCalls).toHaveLength(0);
    expect(streamText).not.toHaveBeenCalled();
  });

  it("accepts a message of exactly 1000 characters", async () => {
    streamText.mockReturnValue(events({ delta: "Oke. " }, DONE()));
    const res = await post(chatPOST, chatBody({ message: "x".repeat(1000) }));
    expect(res.status).toBe(200);
    await res.text();
  });

  it.each([
    ["wrong content type", "{}", "text/plain"],
    ["malformed JSON", "{nope", "application/json"],
  ])("is 400 for %s", async (_n, body, type) => {
    expect((await post(chatPOST, body, { type })).status).toBe(400);
  });

  it("is 400 bad_input without a profile", async () => {
    setup({ tables: { coach_profiles: [] } });
    const res = await post(chatPOST, chatBody());
    expect(res.status).toBe(400);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("is 403 not_member for a thread that is not the member's, before counting any quota", async () => {
    setup({ tables: { coach_threads: [] } });
    const res = await post(chatPOST, chatBody());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not_member", message: coach.errors.not_member });
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("is 429 with the quota copy when coach_begin says quota, and calls no model", async () => {
    setup({ rpc: { coach_begin: () => rpcError("quota") } });
    const res = await post(chatPOST, chatBody());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "quota", message: coach.errors.quota });
    expect(streamText).not.toHaveBeenCalled();
  });

  it("is 403 not_member when coach_begin says the thread is not the caller's", async () => {
    setup({ rpc: { coach_begin: () => rpcError("thread") } });
    expect((await post(chatPOST, chatBody())).status).toBe(403);
  });

  it("is 400 when the content check of coach_begin fails", async () => {
    setup({ rpc: { coach_begin: () => rpcError("check", "23514") } });
    expect((await post(chatPOST, chatBody())).status).toBe(400);
  });
});

describe("POST /api/coach/chat: streaming", () => {
  it("streams the text, marks the message used before any byte, and stores the reply with its token counts", async () => {
    const order: string[] = [];
    setup({
      rpc: {
        coach_begin: () => (order.push("begin"), { data: MSG, error: null }),
        coach_mark_used: () => (order.push("mark_used"), ok),
        coach_finish: () => (order.push("finish"), { data: "r", error: null }),
      },
    });
    async function* gen(): AsyncGenerator<StreamTextEvent, void, undefined> {
      order.push("model");
      yield { delta: "Mulai dari Alpha. " };
      order.push("delta1");
      yield { delta: "Itu paling ringan.\n" };
      yield DONE();
    }
    streamText.mockReturnValue(gen());
    const res = await post(chatPOST, chatBody());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("Mulai dari Alpha. Itu paling ringan.\n");

    expect(order.indexOf("mark_used")).toBeGreaterThan(order.indexOf("model"));
    expect(order.indexOf("mark_used")).toBeLessThan(order.indexOf("delta1"));
    expect(order.at(-1)).toBe("finish");
    expect(rpcNames()).toEqual(["coach_begin", "coach_mark_used", "coach_finish"]);
    expect(fake.rpcCalls[0]?.args).toEqual({ p_thread_id: THREAD, p_kind: "chat", p_content: "Mulai dari mana?" });
    expect(fake.rpcCalls[1]?.args).toEqual({ p_user_message_id: MSG });
    expect(fake.rpcCalls[2]?.args).toEqual({
      p_user_message_id: MSG,
      p_content: "Mulai dari Alpha. Itu paling ringan.\n",
      p_model: "anthropic:claude-sonnet-5-5",
      p_in: 100,
      p_out: 40,
      p_cache_read: 80,
      p_cache_write: 20,
    });
  });

  it("sends null token counts when the provider reported none", async () => {
    streamText.mockReturnValue(events({ delta: "Oke. " }, DONE({ inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheCreationTokens: null })));
    await (await post(chatPOST, chatBody())).text();
    expect(fake.rpcCalls.at(-1)?.args).toMatchObject({ p_in: null, p_out: null, p_cache_read: null, p_cache_write: null });
  });

  it("asks streamText for the cached layout with the request's signal and a capped max_tokens", async () => {
    streamText.mockReturnValue(events({ delta: "Oke. " }, DONE()));
    const controller = new AbortController();
    await (await post(chatPOST, chatBody(), { signal: controller.signal })).text();
    const [models, , deps] = streamText.mock.calls[0] as [{ extraBody: Record<string, unknown> }[], unknown, { cache: boolean; signal: AbortSignal }];
    expect(deps.cache).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) expect(m.extraBody.max_tokens).toBe(3000);
    expect(deps.signal.aborted).toBe(false);
    controller.abort();
    expect(deps.signal.aborted).toBe(true);
  });

  it("sends two system blocks, the earlier answered turns, then the new message, and never the email", async () => {
    setup({
      tables: {
        coach_messages: [
          { id: "u1", thread_id: THREAD, role: "user", reply_to: null, content: "Bikinin rencana", created_at: "2026-10-11T01:00:00Z" },
          { id: "a1", thread_id: THREAD, role: "assistant", reply_to: "u1", content: "Rencana: Alpha", created_at: "2026-10-11T01:00:05Z" },
          // A question that never got an answer is left out, so turns still alternate.
          { id: "u2", thread_id: THREAD, role: "user", reply_to: null, content: "Pertanyaan gagal", created_at: "2026-10-11T01:05:00Z" },
          { id: "u3", thread_id: THREAD, role: "user", reply_to: null, content: "Apa itu bridge?", created_at: "2026-10-11T01:10:00Z" },
          { id: "a3", thread_id: THREAD, role: "assistant", reply_to: "u3", content: "Bridge itu memindahkan aset antar chain.", created_at: "2026-10-11T01:10:05Z" },
          { id: "x", thread_id: "someone-elses-thread", role: "user", reply_to: null, content: "RAHASIA", created_at: "2026-10-11T01:00:00Z" },
        ],
      },
    });
    streamText.mockReturnValue(events({ delta: "Oke. " }, DONE()));
    await (await post(chatPOST, chatBody())).text();
    const messages = streamText.mock.calls[0]![1] as { role: string; content: string }[];
    expect(messages.map((m) => m.role)).toEqual(["system", "system", "user", "assistant", "user", "assistant", "user"]);
    expect(messages.map((m) => m.content).slice(2)).toEqual([
      "Bikinin rencana",
      "Rencana: Alpha",
      "Apa itu bridge?",
      "Bridge itu memindahkan aset antar chain.",
      "Mulai dari mana?",
    ]);
    const all = JSON.stringify(streamText.mock.calls[0]![1]);
    expect(all).not.toContain(USER.email);
    expect(all).not.toContain(USER.id);
    expect(all).not.toContain("RAHASIA");
    expect(messages[1]!.content).toContain("Alpha");
  });

  it("returns the candidates' names and internal links as separate metadata, never parsed from the text", async () => {
    streamText.mockReturnValue(events({ delta: "Coba Alpha dulu. " }, DONE()));
    const res = await post(chatPOST, chatBody());
    await res.text();
    const links = JSON.parse(decodeURIComponent(res.headers.get("x-coach-links")!)) as { name: string; href: string }[];
    expect(links).toEqual(
      expect.arrayContaining([
        { name: "Alpha", href: "/projects/alpha" },
        { name: "Beta", href: "/projects/beta" },
      ]),
    );
    expect(links).toHaveLength(3);
    for (const l of links) expect(l.href).toMatch(/^\/projects\/[a-z0-9-]+$/);
  });

  it("reports the remaining quota in a header, counting the message just begun", async () => {
    setup({
      tables: {
        coach_messages: [{ id: "n", role: "user", reply_to: null, created_at: new Date().toISOString() }],
      },
    });
    streamText.mockReturnValue(events({ delta: "Oke. " }, DONE()));
    const res = await post(chatPOST, chatBody());
    await res.text();
    expect(res.headers.get("x-coach-remaining")).toBe("19");
  });

  it("is 503 unavailable when every model fails before any text, and marks and finishes nothing", async () => {
    streamText.mockReturnValue(events({ failed: true }));
    const res = await post(chatPOST, chatBody());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable", message: coach.errors.unavailable });
    expect(rpcNames()).toEqual(["coach_begin"]);
  });

  it("is 503 when the stream throws before any text", async () => {
    streamText.mockReturnValue(events(new Error("boom")));
    const res = await post(chatPOST, chatBody());
    expect(res.status).toBe(503);
    expect(rpcNames()).toEqual(["coach_begin"]);
  });

  it("forwards nothing and does not finish when coach_mark_used refuses (expired)", async () => {
    setup({ rpc: { coach_mark_used: () => rpcError("expired") } });
    streamText.mockReturnValue(events({ delta: "Teks yang tidak boleh keluar. " }, DONE()));
    const res = await post(chatPOST, chatBody());
    const text = await res.text();
    expect(text).not.toContain("Teks yang tidak boleh keluar");
    expect(res.status).toBe(503);
    expect(rpcNames()).toEqual(["coach_begin", "coach_mark_used"]);
  });

  it("forwards nothing when coach_mark_used throws", async () => {
    setup({ rpc: { coach_mark_used: () => { throw new Error("network"); } } });
    streamText.mockReturnValue(events({ delta: "Teks yang tidak boleh keluar. " }, DONE()));
    const res = await post(chatPOST, chatBody());
    expect(await res.text()).not.toContain("Teks yang tidak boleh keluar");
    expect(rpcNames()).not.toContain("coach_finish");
  });

  it("still counts a message whose stream fails after the first text, but stores no half answer", async () => {
    streamText.mockReturnValue(events({ delta: "Mulai dari Alpha. Lalu " }, { failed: true }));
    const res = await post(chatPOST, chatBody());
    await expect(res.text()).rejects.toThrow();
    expect(rpcNames()).toEqual(["coach_begin", "coach_mark_used"]);
  });

  it("ends quietly (no error) when the client aborted mid-answer, and keeps the message counted", async () => {
    const controller = new AbortController();
    async function* gen(): AsyncGenerator<StreamTextEvent, void, undefined> {
      yield { delta: "Mulai dari Alpha. " };
      controller.abort();
      yield { failed: true };
    }
    streamText.mockReturnValue(gen());
    const res = await post(chatPOST, chatBody(), { signal: controller.signal });
    await res.text().catch(() => "");
    expect(rpcNames()).toEqual(["coach_begin", "coach_mark_used"]);
  });

  it("redacts a foreign URL in the stream and in the stored reply", async () => {
    streamText.mockReturnValue(events({ delta: "Silakan claim di https://evil.xyz sekarang. " }, { delta: "Sisanya santai." }, DONE()));
    const res = await post(chatPOST, chatBody());
    const text = await res.text();
    expect(text).toContain("[dihapus: info sensitif]");
    expect(text).not.toContain("evil.xyz");
    const stored = String(fake.rpcCalls.at(-1)?.args.p_content);
    expect(stored).toContain("[dihapus: info sensitif]");
    expect(stored).not.toContain("evil.xyz");
    expect(stored).toBe(text);
  });

  it("redacts a URL split across two deltas", async () => {
    streamText.mockReturnValue(events({ delta: "Claim di https://ev" }, { delta: "il.xyz sekarang. Selesai." }, DONE()));
    const text = await (await post(chatPOST, chatBody())).text();
    expect(text).not.toContain("evil");
    expect(text).toContain("[dihapus: info sensitif]");
  });

  it("replaces an em dash with a comma", async () => {
    streamText.mockReturnValue(events({ delta: "Pelan dulu — jangan buru-buru." }, DONE()));
    const text = await (await post(chatPOST, chatBody())).text();
    expect(text).toBe("Pelan dulu, jangan buru-buru.");
  });

  it("cuts a reply longer than 16000 characters before coach_finish", async () => {
    const sentence = "Ini kalimat panjang yang diulang terus. ";
    const long = sentence.repeat(Math.ceil(20000 / sentence.length));
    streamText.mockReturnValue(events({ delta: long.slice(0, 10000) }, { delta: long.slice(10000, 20000) }, DONE()));
    const text = await (await post(chatPOST, chatBody())).text();
    const stored = String(fake.rpcCalls.at(-1)?.args.p_content);
    expect(stored.length).toBeLessThanOrEqual(16000);
    expect(stored.length).toBeGreaterThan(15000);
    expect(text.length).toBeGreaterThanOrEqual(stored.length);
  });

  it("does not call coach_finish for a reply that is only blank", async () => {
    streamText.mockReturnValue(events({ delta: "   " }, DONE()));
    await (await post(chatPOST, chatBody())).text();
    expect(rpcNames()).toEqual(["coach_begin", "coach_mark_used"]);
  });
});

describe("POST /api/coach/chat: explain_step and project threads", () => {
  const STEP_ROW = { id: STEP_ID, project_id: P1, text_id: "Bridge sedikit ETH ke Base lalu swap di Alpha", description: "bridge and swap" };

  it("puts the step text in the prompt (not in the stored message) for explain_step", async () => {
    setup({ tables: { tasks: [...candidateTables([{ id: P1, name: "Alpha" }]).tasks!, STEP_ROW] } });
    streamText.mockReturnValue(events({ delta: "Bridge itu memindahkan aset. " }, DONE()));
    await (await post(chatPOST, chatBody({ kind: "explain_step", stepId: STEP_ID, message: "Jelasin langkah ini" }))).text();
    const messages = streamText.mock.calls[0]![1] as { role: string; content: string }[];
    const last = messages.at(-1)!;
    expect(last.role).toBe("user");
    expect(last.content).toContain("Bridge sedikit ETH ke Base lalu swap di Alpha");
    expect(last.content).toContain("Jelasin langkah ini");
    expect(fake.rpcCalls[0]?.args).toEqual({ p_thread_id: THREAD, p_kind: "explain_step", p_content: "Jelasin langkah ini" });
  });

  it("falls back to the step's description when it has no text_id", async () => {
    setup({ tables: { tasks: [...candidateTables([{ id: P1, name: "Alpha" }]).tasks!, { ...STEP_ROW, text_id: null, description: "Claim daily reward" }] } });
    streamText.mockReturnValue(events({ delta: "Oke. " }, DONE()));
    await (await post(chatPOST, chatBody({ kind: "explain_step", stepId: STEP_ID }))).text();
    expect((streamText.mock.calls[0]![1] as { content: string }[]).at(-1)!.content).toContain("Claim daily reward");
  });

  it("is 400 for a step that does not exist or whose project is not a candidate, before counting quota", async () => {
    const missing = await post(chatPOST, chatBody({ kind: "explain_step", stepId: STEP_ID }));
    expect(missing.status).toBe(400);
    setup({ tables: { tasks: [{ ...STEP_ROW, project_id: OUTSIDER }] } });
    const foreign = await post(chatPOST, chatBody({ kind: "explain_step", stepId: STEP_ID }));
    expect(foreign.status).toBe(400);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("narrows the candidates to the thread's project", async () => {
    setup({ tables: { coach_threads: [{ id: THREAD, user_id: USER.id, project_id: P2 }] } });
    streamText.mockReturnValue(events({ delta: "Oke. " }, DONE()));
    const res = await post(chatPOST, chatBody());
    await res.text();
    const member = (streamText.mock.calls[0]![1] as { content: string }[])[1]!.content;
    expect(member).toContain("Beta");
    expect(member).not.toContain("Alpha");
    const links = JSON.parse(decodeURIComponent(res.headers.get("x-coach-links")!)) as { name: string }[];
    expect(links.map((l) => l.name)).toEqual(["Beta"]);
  });
});
