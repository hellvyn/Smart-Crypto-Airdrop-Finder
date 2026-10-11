import { describe, expect, it, vi } from "vitest";
import { redactSensitive } from "@saf/core";
import {
  DAILY_QUOTA,
  MAX_REPLY_CHARS,
  candidateContext,
  chatWithDeadline,
  coachErrorFrom,
  createStreamSanitizer,
  getCoachProfile,
  isCoachCandidate,
  loadCandidates,
  remainingQuota,
  saveCoachProfile,
  wibDayStart,
} from "../lib/coach";
import type { ChatFn } from "@saf/llm";
import { P1, P2, P3, PROFILE, candidate, candidateTables, fakeCoachDb } from "./coach-fakes";

const NOW = new Date("2026-10-11T05:00:00Z");
const USER = "11111111-1111-4111-8111-111111111111";

describe("coachErrorFrom", () => {
  it.each([
    [{ code: "P0001", message: "quota" }, "quota"],
    [{ code: "P0001", message: "threads" }, "quota"],
    [{ code: "P0001", message: "thread" }, "not_member"],
    [{ code: "P0001", message: "message" }, "not_member"],
    [{ code: "42501", message: "not authenticated" }, "not_member"],
    [{ code: "23514", message: "content check" }, "bad_input"],
    [{ code: "P0001", message: "expired" }, "unavailable"],
    [{ code: "P0001", message: "replied" }, "unavailable"],
    [{ code: "XX000", message: "boom" }, "unavailable"],
    [{ message: "network" }, "unavailable"],
  ])("maps %j to %s", (error, expected) => {
    expect(coachErrorFrom(error)).toBe(expected);
  });
});

describe("getCoachProfile", () => {
  it("reads the member's own row and returns it parsed", async () => {
    const { db, reads } = fakeCoachDb({ tables: { coach_profiles: [{ user_id: USER, ...PROFILE, updated_at: "x" }] } });
    expect(await getCoachProfile(db, USER)).toEqual(PROFILE);
    expect(reads[0]?.filters).toContainEqual(["eq", "user_id", USER]);
  });

  it("is null without a row, and null for a row the schema refuses", async () => {
    expect(await getCoachProfile(fakeCoachDb().db, USER)).toBeNull();
    const bad = fakeCoachDb({ tables: { coach_profiles: [{ user_id: USER, ...PROFILE, level: "wizard" }] } });
    expect(await getCoachProfile(bad.db, USER)).toBeNull();
  });

  it("throws on a database error instead of reporting no profile", async () => {
    const { db } = fakeCoachDb({ tableErrors: { coach_profiles: { message: "down" } } });
    await expect(getCoachProfile(db, USER)).rejects.toThrow();
  });
});

describe("saveCoachProfile", () => {
  it("upserts the member's row on user_id", async () => {
    const { db, upserts } = fakeCoachDb();
    expect(await saveCoachProfile(db, USER, PROFILE)).toEqual({ ok: true });
    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.table).toBe("coach_profiles");
    expect(upserts[0]?.values).toEqual({ user_id: USER, ...PROFILE });
    expect(upserts[0]?.options).toEqual({ onConflict: "user_id" });
  });

  it("trims and de-duplicates the chain names", async () => {
    const { db, upserts } = fakeCoachDb();
    await saveCoachProfile(db, USER, { ...PROFILE, chains: [" Base ", "base", "", "Arbitrum"] });
    expect((upserts[0]?.values as { chains: string[] }).chains).toEqual(["Base", "Arbitrum"]);
  });

  it("keeps wallet_count null for a member with no wallet, and does not let the client send a user id", async () => {
    const { db, upserts } = fakeCoachDb();
    await saveCoachProfile(db, USER, { ...PROFILE, has_wallet: false, wallet_count: null, user_id: "other", email: "a@b.c" });
    expect(upserts[0]?.values).toMatchObject({ user_id: USER, has_wallet: false, wallet_count: null });
    expect(JSON.stringify(upserts[0]?.values)).not.toContain("a@b.c");
  });

  it.each([
    ["wrong level", { ...PROFILE, level: "wizard" }],
    ["wallet count without a wallet", { ...PROFILE, has_wallet: false }],
    ["too many chains", { ...PROFILE, chains: Array.from({ length: 11 }, (_, i) => `c${i}`) }],
    ["not an object", "nope"],
  ])("refuses %s as bad_input without touching the database", async (_n, input) => {
    const { db, upserts } = fakeCoachDb();
    expect(await saveCoachProfile(db, USER, input)).toEqual({ ok: false, error: "bad_input" });
    expect(upserts).toHaveLength(0);
  });

  it("maps a database error", async () => {
    const rls = fakeCoachDb({ upsertError: { message: "denied", code: "42501" } });
    expect(await saveCoachProfile(rls.db, USER, PROFILE)).toEqual({ ok: false, error: "not_member" });
    const check = fakeCoachDb({ upsertError: { message: "check", code: "23514" } });
    expect(await saveCoachProfile(check.db, USER, PROFILE)).toEqual({ ok: false, error: "bad_input" });
    const down = fakeCoachDb({ upsertError: { message: "down" } });
    expect(await saveCoachProfile(down.db, USER, PROFILE)).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("loadCandidates", () => {
  it("builds candidates from curated_list, the latest analyst result and tasks (text_id first)", async () => {
    const tables = candidateTables([{ id: P1, name: "Alpha" }]);
    tables.tasks!.push({ project_id: P1, document_id: "d2", position: 1, cadence: "daily", text_id: null, description: "Claim daily reward" });
    const { db } = fakeCoachDb({ tables });
    const [c] = await loadCandidates(db, NOW);
    expect(c).toEqual({
      id: P1,
      slug: "alpha",
      name: "Alpha",
      risk: "low",
      worthLevel: "high",
      tab: "live_now",
      capital: "free",
      capitalMinUsd: null,
      chains: ["Base"],
      minutesPerDay: 15,
      nextDeadline: null,
      points: [{ text: "Alpha punya program poin aktif", quote: "Alpha points program is live", sourceUrl: "https://docs.example.org/points" }],
      steps: [
        { text: "Bridge sedikit ETH ke Base lalu swap di Alpha", cadence: "weekly" },
        { text: "Claim daily reward", cadence: "daily" },
      ],
      signalRank: 1,
    });
  });

  it("reads only the live and early tabs", async () => {
    const { db, reads } = fakeCoachDb({ tables: candidateTables([{ id: P1, name: "Alpha" }]) });
    await loadCandidates(db, NOW);
    expect(reads[0]?.table).toBe("curated_list");
    expect(reads[0]?.filters).toContainEqual(["in", "tab", ["live_now", "early_bets"]]);
  });

  it("uses only the latest analyst result of a project", async () => {
    const tables = candidateTables([{ id: P1, name: "Alpha" }]);
    tables.ai_analyses!.push({
      project_id: P1,
      kind: "analyst",
      created_at: "2026-10-01T00:00:00Z",
      seq: 0,
      result: {
        verdict: "garap",
        confidence: "tinggi",
        points: [{ text: "lama", quote: "old quote", source_url: "https://docs.example.org/old" }],
        effort: { minutes_per_day: 99, capital_usd_min: null, note: "x" },
        steps_id: [],
      },
    });
    const { db } = fakeCoachDb({ tables });
    const [c] = await loadCandidates(db, NOW);
    expect(c?.points.map((p) => p.text)).toEqual(["Alpha punya program poin aktif"]);
    expect(c?.minutesPerDay).toBe(15);
  });

  it("drops a project that has neither a usable point nor a step, since nothing can be quoted", async () => {
    const tables = candidateTables([
      { id: P1, name: "Alpha" },
      { id: P2, name: "Beta" },
      { id: P3, name: "Gamma" },
    ]);
    tables.ai_analyses = tables.ai_analyses!.filter((r) => r.project_id !== P2);
    tables.ai_analyses!.find((r) => r.project_id === P3)!.result = { verdict: "nonsense" };
    tables.tasks = tables.tasks!.filter((r) => r.project_id === P1);
    const { db } = fakeCoachDb({ tables });
    expect((await loadCandidates(db, NOW)).map((c) => c.id)).toEqual([P1]);
  });

  it("keeps a project with steps but no analysis, with no points and no minutes", async () => {
    const tables = candidateTables([{ id: P1, name: "Alpha" }]);
    tables.ai_analyses = [];
    const { db } = fakeCoachDb({ tables });
    const [c] = await loadCandidates(db, NOW);
    expect(c?.points).toEqual([]);
    expect(c?.minutesPerDay).toBeNull();
    expect(c?.steps).toHaveLength(1);
  });

  it("leaves a deadline that already passed out, and keeps a future one", async () => {
    const tables = candidateTables([
      { id: P1, name: "Alpha" },
      { id: P2, name: "Beta" },
    ]);
    tables.curated_list![0]!.next_deadline_date = "2026-10-01";
    tables.curated_list![1]!.next_deadline_date = "2026-11-01";
    const { db } = fakeCoachDb({ tables });
    const byId = new Map((await loadCandidates(db, NOW)).map((c) => [c.id, c]));
    expect(byId.get(P1)?.nextDeadline).toBeNull();
    expect(byId.get(P2)?.nextDeadline).toBe("2026-11-01");
  });

  it("coerces numeric strings and unknown enums from the view", async () => {
    const tables = candidateTables([{ id: P1, name: "Alpha" }]);
    Object.assign(tables.curated_list![0]!, { capital: "deposit", capital_min_usd: "25.5", latest_risk_level: "weird", worth_level: null, signal_rank: null });
    const { db } = fakeCoachDb({ tables });
    const [c] = await loadCandidates(db, NOW);
    expect(c).toMatchObject({ capital: "deposit", capitalMinUsd: 25.5, risk: null, worthLevel: "insufficient_data", signalRank: null });
  });

  it("throws on a database error", async () => {
    const { db } = fakeCoachDb({ tableErrors: { curated_list: { message: "down" } } });
    await expect(loadCandidates(db, NOW)).rejects.toThrow();
  });

  it("returns nothing when the list is empty, without reading the other tables", async () => {
    const { db, reads } = fakeCoachDb();
    expect(await loadCandidates(db, NOW)).toEqual([]);
    expect(reads.map((r) => r.table)).toEqual(["curated_list"]);
  });
});

describe("wibDayStart", () => {
  it("is 00:00 WIB of the day, as UTC", () => {
    expect(wibDayStart(new Date("2026-10-11T05:00:00Z")).toISOString()).toBe("2026-10-10T17:00:00.000Z");
    // 17:30 UTC is already the next day in WIB.
    expect(wibDayStart(new Date("2026-10-11T17:30:00Z")).toISOString()).toBe("2026-10-11T17:00:00.000Z");
  });
});

describe("remainingQuota", () => {
  it("is what coach_quota_remaining returns (the ledger coach_begin counts from)", async () => {
    const { db, rpcCalls } = fakeCoachDb({ rpc: { coach_quota_remaining: () => ({ data: 7, error: null }) } });
    expect(await remainingQuota(db)).toBe(7);
    expect(rpcCalls.map((c) => c.name)).toEqual(["coach_quota_remaining"]);
  });

  it("is null when the RPC fails or throws", async () => {
    const failing = fakeCoachDb({ rpc: { coach_quota_remaining: () => ({ data: null, error: { message: "down" } }) } });
    expect(await remainingQuota(failing.db)).toBeNull();
    const throwing = fakeCoachDb({
      rpc: {
        coach_quota_remaining: () => {
          throw new Error("network");
        },
      },
    });
    expect(await remainingQuota(throwing.db)).toBeNull();
  });
});

describe("createStreamSanitizer", () => {
  const CONTEXT = candidateContext([candidate(P1, "Alpha")], PROFILE);

  it("holds text until a sentence is complete, then releases it", () => {
    const s = createStreamSanitizer(CONTEXT);
    expect(s.push("Halo, ini Alp")).toBe("");
    expect(s.push("ha. Kedua")).toBe("Halo, ini Alpha. ");
    expect(s.push(" tuntas! Sisa")).toBe("Kedua tuntas! ");
    expect(s.flush()).toBe("Sisa");
  });

  it("redacts a URL the context does not have, even when it arrives in pieces", () => {
    const s = createStreamSanitizer(CONTEXT);
    const out = [s.push("Silakan claim di https://ev"), s.push("il.xyz sekarang. Selesai."), s.flush()].join("");
    expect(out).toContain("[dihapus: info sensitif]");
    expect(out).not.toContain("evil");
    expect(s.redactions()).toBe(1);
  });

  it("replaces em dashes with commas", () => {
    const s = createStreamSanitizer(CONTEXT);
    expect(s.push("Mulai dari sini — pelan-pelan.\n") + s.flush()).toBe("Mulai dari sini, pelan-pelan.\n");
  });

  it("releases a very long sentence at a space rather than holding it forever", () => {
    const s = createStreamSanitizer(CONTEXT);
    const out = s.push("kata ".repeat(600));
    expect(out.length).toBeGreaterThan(0);
    expect(out.length + s.flush().length).toBe(3000);
  });

  it("MAX_REPLY_CHARS is the assistant message limit of coach_messages", () => {
    expect(MAX_REPLY_CHARS).toBe(16000);
  });
});

describe("candidateContext", () => {
  it("carries names, points and steps but not source URLs or member data", () => {
    const text = candidateContext([candidate(P1, "Alpha")], PROFILE);
    expect(text).toContain("Alpha");
    expect(text).toContain("Alpha points program is live");
    expect(text).not.toContain("docs.example.org");
  });

  it("drops every URL that has a scheme or a path, and keeps a bare host name", () => {
    const text = candidateContext(
      [
        candidate(P1, "Jumper.Exchange", {
          points: [{ text: "Claim di https://claim.alpha.xyz/start sekarang", quote: "see app.alpha.xyz/rewards?x=1 for points", sourceUrl: "https://s.example.org/p" }],
          steps: [{ text: "Buka ftp://files.alpha.xyz:21/a lalu pakai alpha.xyz:8080/path/x", cadence: "once" }],
        }),
      ],
      PROFILE,
    );
    for (const gone of ["claim.alpha.xyz", "https://", "app.alpha.xyz", "rewards", "files.alpha.xyz", "8080/path"]) {
      expect(text).not.toContain(gone);
    }
    expect(text).toContain("Jumper.Exchange");
    expect(text).toContain("Claim di");
    expect(text).toContain("sekarang");
  });

  it("makes the redactor replace a URL that the candidate data itself carried", () => {
    const candidates = [candidate(P1, "Alpha", { steps: [{ text: "Buka https://claim.alpha.xyz/start", cadence: "once" }] })];
    const out = redactSensitive("claim di https://claim.alpha.xyz/claim sekarang", candidateContext(candidates, PROFILE));
    expect(out.text).not.toContain("claim.alpha.xyz");
    expect(out.redactions).toBe(1);
  });
});

describe("loadCandidates narrowed to one project", () => {
  it("reads only that project's rows", async () => {
    const fake = fakeCoachDb({ tables: candidateTables([{ id: P1, name: "Alpha" }, { id: P2, name: "Beta" }]) });
    const out = await loadCandidates(fake.db, NOW, P2);
    expect(out.map((c) => c.id)).toEqual([P2]);
    expect(fake.reads.find((r) => r.table === "curated_list")?.filters).toContainEqual(["eq", "id", P2]);
  });
});

describe("isCoachCandidate", () => {
  const tables = (over: Record<string, unknown> = {}) => ({
    coach_profiles: [{ user_id: USER, ...PROFILE }],
    ...candidateTables([{ id: P1, name: "Alpha" }, { id: P2, name: "Beta" }]),
    ...over,
  });

  it("is true for a project the member's profile keeps", async () => {
    expect(await isCoachCandidate(fakeCoachDb({ tables: tables() }).db, P1, NOW)).toBe(true);
  });

  it("is true for a listed project the profile would filter out of a plan: Tanya AI never filters by profile", async () => {
    const t = tables({
      coach_profiles: [{ user_id: USER, ...PROFILE, level: "beginner" }],
      curated_list: candidateTables([{ id: P1, name: "Alpha" }]).curated_list!.map((r) => ({ ...r, latest_risk_level: "high" })),
    });
    expect(await isCoachCandidate(fakeCoachDb({ tables: t }).db, P1, NOW)).toBe(true);
  });

  it("is false for a project that is not on the curated candidate tabs, and for one without points or steps", async () => {
    expect(await isCoachCandidate(fakeCoachDb({ tables: tables() }).db, "ffffffff-ffff-4fff-8fff-fffffffffff9", NOW)).toBe(false);
    const t = tables({ ai_analyses: [], tasks: [] });
    expect(await isCoachCandidate(fakeCoachDb({ tables: t }).db, P1, NOW)).toBe(false);
  });

  it("is true without a coach profile, and false when the database fails", async () => {
    expect(await isCoachCandidate(fakeCoachDb({ tables: tables({ coach_profiles: [] }) }).db, P1, NOW)).toBe(true);
    const failing = fakeCoachDb({ tables: tables(), tableErrors: { curated_list: { message: "down" } } });
    expect(await isCoachCandidate(failing.db, P1, NOW)).toBe(false);
  });
});

describe("chatWithDeadline", () => {
  it("gives one attempt at most perAttemptMs, so the next model still has time", async () => {
    vi.useFakeTimers();
    try {
      const never: ChatFn = () => new Promise(() => {});
      const chat = chatWithDeadline(never, Date.now() + 50_000, 22_000);
      const pending = chat({ provider: "freellm", id: "auto", extraBody: {} }, []);
      await vi.advanceTimersByTimeAsync(22_000);
      expect(await pending).toMatchObject({ httpStatus: 0, content: "", latencyMs: 22_000 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("never waits past the overall deadline", async () => {
    vi.useFakeTimers();
    try {
      const never: ChatFn = () => new Promise(() => {});
      const chat = chatWithDeadline(never, Date.now() + 5_000, 22_000);
      const pending = chat({ provider: "freellm", id: "auto", extraBody: {} }, []);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await pending).toMatchObject({ latencyMs: 5_000 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createStreamSanitizer, plain text", () => {
  it("sends chat text without markdown or JSON plan lines", () => {
    const s = createStreamSanitizer("");
    const out = s.push("TGE itu **Token Generation Event**.\n{\n  \"tasks\": [\n") + s.push("  ],\n}\nSelesai.\n") + s.flush();
    expect(out).toBe("TGE itu Token Generation Event.\nSelesai.\n");
  });
});
