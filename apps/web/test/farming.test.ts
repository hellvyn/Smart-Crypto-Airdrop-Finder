import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireUser = vi.fn();
const revalidatePath = vi.fn();
let serverDb: SupabaseClient;

class Redirect extends Error {
  constructor(public readonly to: string) {
    super(`redirect:${to}`);
  }
}

vi.mock("@/lib/auth", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => serverDb }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));

import {
  startFarmingAction,
  submitAddTask,
  submitArchiveTask,
  submitCheck,
  submitRefresh,
  submitResult,
  submitResultForm,
  submitShareAnonymous,
  submitStartFarming,
  submitStopFarming,
} from "../app/(app)/garapan/actions";
import {
  FARMING_ERROR_MESSAGES,
  FarmingError,
  addCustomTask,
  archiveTask,
  getFarmingBoard,
  getResults,
  isFarming,
  refreshFromSource,
  setCheck,
  startFarming,
  stopFarming,
  type ResultInput,
} from "../lib/farming";

const USER = { id: "11111111-1111-4111-8111-111111111111" };
const PID = "22222222-2222-4222-8222-222222222222";
const PID2 = "33333333-3333-4333-8333-333333333333";
const TID = "44444444-4444-4444-8444-444444444444";

type Call = [method: string, ...args: unknown[]];
type DbError = { message: string; code?: string };
type Result = { data: unknown; error: DbError | null };
interface Recorded {
  table: string;
  calls: Call[];
}

const ok = (data: unknown = null): Result => ({ data, error: null });
const fail = (code: string, message = `db error ${code}`): Result => ({ data: null, error: { message, code } });
const has = (rec: Recorded, method: string): boolean => rec.calls.some((c) => c[0] === method);
const arg = (rec: Recorded, method: string): unknown => rec.calls.find((c) => c[0] === method)?.[1];

/**
 * Fake supabase-js client: every `from(table)` chain and every `rpc(fn, args)` is recorded (rpc as table
 * `rpc:<fn>`), and resolves (awaited, or via maybeSingle) to `respond(rec)` with the calls made so far.
 */
function fakeDb(respond: (rec: Recorded) => Result = () => ok()) {
  const recs: Recorded[] = [];
  const db = {
    from(table: string) {
      const rec: Recorded = { table, calls: [] };
      recs.push(rec);
      const b: Record<string, unknown> = {};
      for (const m of ["select", "insert", "update", "delete", "eq", "in", "is", "not", "gte", "order", "limit", "range"]) {
        b[m] = (...args: unknown[]) => {
          rec.calls.push([m, ...args]);
          return b;
        };
      }
      b.maybeSingle = () => {
        rec.calls.push(["maybeSingle"]);
        return Promise.resolve(respond(rec));
      };
      b.then = (res: (r: Result) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(respond(rec)).then(res, rej);
      return b;
    },
    rpc(fn: string, args: unknown) {
      const rec: Recorded = { table: `rpc:${fn}`, calls: [["rpc", args]] };
      recs.push(rec);
      return Promise.resolve(respond(rec));
    },
  };
  return { db: db as unknown as SupabaseClient, recs };
}

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue(USER);
  revalidatePath.mockReset();
});

/** The farming_projects lookup of startFarming/refresh/addCustomTask: `row` is what maybeSingle finds. */
const farmingRow = (rec: Recorded, row: { archived_at: string | null } | null): Result | undefined =>
  rec.table === "farming_projects" && has(rec, "maybeSingle") ? ok(row) : undefined;

describe("startFarming", () => {
  const SOURCE = [
    { description: "Follow @proj on X", text_id: null, cadence: "once" },
    { description: "Bridge ETH to the chain", text_id: null, cadence: "once" },
    { description: "follow @PROJ on x", text_id: null, cadence: "daily" },
    { description: "  Swap on the DEX  ", text_id: null, cadence: "daily" },
    { description: "   ", text_id: null, cadence: "daily" },
    { description: "Claim the faucet", text_id: null, cadence: "weekly" },
  ];

  it("creates the farming row, then snapshots once/daily/weekly source steps with case-insensitive dedup", async () => {
    const { db, recs } = fakeDb((rec) => farmingRow(rec, null) ?? (rec.table === "tasks" ? ok(SOURCE) : ok([])));
    await startFarming(db, PID);

    const insertProject = recs.find((r) => r.table === "farming_projects" && has(r, "insert"))!;
    expect(arg(insertProject, "insert")).toEqual({ user_id: USER.id, project_id: PID });
    expect(recs.some((r) => r.table === "farming_projects" && (has(r, "update") || has(r, "upsert")))).toBe(false);

    const source = recs.find((r) => r.table === "tasks")!;
    expect(arg(source, "select")).toBe("description, text_id, cadence");
    expect(source.calls).toContainEqual(["eq", "project_id", PID]);
    expect(source.calls).toContainEqual(["in", "cadence", ["once", "daily", "weekly"]]);
    const orders = source.calls.filter((c) => c[0] === "order").map((c) => c[1]);
    expect(orders).toEqual(["document_id", "position"]);

    const insertTasks = recs.find((r) => r.table === "farming_tasks" && has(r, "insert"))!;
    const base = { user_id: USER.id, project_id: PID, origin: "source" };
    expect(arg(insertTasks, "insert")).toEqual([
      { ...base, text: "Follow @proj on X", cadence: "once", position: 0 },
      { ...base, text: "Bridge ETH to the chain", cadence: "once", position: 1 },
      { ...base, text: "Swap on the DEX", cadence: "daily", position: 2 },
      { ...base, text: "Claim the faucet", cadence: "weekly", position: 3 },
    ]);
  });

  it("uses a step's Indonesian text when it has one, and the source text otherwise", async () => {
    const steps = [
      { description: "Bridge ETH to the chain", text_id: "Bridge ETH ke chain-nya", cadence: "once" },
      { description: "Swap on the DEX", text_id: null, cadence: "daily" },
      { description: "Claim the faucet", text_id: "   ", cadence: "weekly" },
      { description: "Bridge some ETH", text_id: "bridge eth ke CHAIN-nya", cadence: "once" },
    ];
    const { db, recs } = fakeDb((rec) => farmingRow(rec, null) ?? (rec.table === "tasks" ? ok(steps) : ok([])));
    await startFarming(db, PID);
    const rows = arg(recs.find((r) => r.table === "farming_tasks" && has(r, "insert"))!, "insert") as { text: string }[];
    // A blank translation falls back to the source text; duplicates are found on the text used.
    expect(rows.map((r) => r.text)).toEqual(["Bridge ETH ke chain-nya", "Swap on the DEX", "Claim the faucet"]);
  });

  it("clips a source step longer than 200 characters so the row passes the text check", async () => {
    const long = "x".repeat(250);
    const { db, recs } = fakeDb(
      (rec) => farmingRow(rec, null) ?? (rec.table === "tasks" ? ok([{ description: long, text_id: null, cadence: "daily" }]) : ok([])),
    );
    await startFarming(db, PID);
    const rows = arg(recs.find((r) => r.table === "farming_tasks" && has(r, "insert"))!, "insert") as { text: string }[];
    expect(rows[0]!.text).toBe(`${"x".repeat(199)}…`);
  });

  it("snapshots at most 30 steps, the limit of active tasks per project", async () => {
    const many = Array.from({ length: 33 }, (_, i) => ({ description: `Step ${i + 1}`, text_id: null, cadence: "daily" }));
    const { db, recs } = fakeDb((rec) => farmingRow(rec, null) ?? (rec.table === "tasks" ? ok(many) : ok([])));
    await startFarming(db, PID);
    const rows = arg(recs.find((r) => r.table === "farming_tasks" && has(r, "insert"))!, "insert") as { text: string }[];
    expect(rows).toHaveLength(30);
    expect(rows.at(-1)!.text).toBe("Step 30");
  });

  it("counts a duplicate-key insert (another tab won the race) as success and leaves the snapshot to that tab", async () => {
    const { db, recs } = fakeDb(
      (rec) =>
        farmingRow(rec, null) ??
        (rec.table === "farming_projects" && has(rec, "insert") ? fail("23505") : rec.table === "tasks" ? ok(SOURCE) : ok([])),
    );
    await expect(startFarming(db, PID)).resolves.toBeUndefined();
    expect(recs.some((r) => r.table === "farming_tasks" && has(r, "insert"))).toBe(false);
  });

  it("resumes an archived project before adding source steps the active list does not have yet", async () => {
    const active = [{ id: TID, text: "swap on the dex", origin: "source", position: 4 }];
    const { db, recs } = fakeDb((rec) => {
      const found = farmingRow(rec, { archived_at: "2026-10-01T00:00:00+00:00" });
      if (found) return found;
      if (rec.table === "farming_projects" && has(rec, "update")) return ok([{ project_id: PID }]);
      if (rec.table === "tasks") return ok(SOURCE);
      if (rec.table === "farming_tasks" && has(rec, "select")) return ok(active);
      return ok();
    });
    await startFarming(db, PID);

    const resumeAt = recs.findIndex((r) => r.table === "farming_projects" && has(r, "update"));
    const insertAt = recs.findIndex((r) => r.table === "farming_tasks" && has(r, "insert"));
    expect(resumeAt).toBeGreaterThanOrEqual(0);
    expect(resumeAt).toBeLessThan(insertAt);
    const resume = recs[resumeAt]!;
    expect(arg(resume, "update")).toEqual({ archived_at: null });
    expect(resume.calls).toContainEqual(["eq", "user_id", USER.id]);
    expect(resume.calls).toContainEqual(["eq", "project_id", PID]);
    expect(recs.some((r) => r.table === "farming_projects" && has(r, "insert"))).toBe(false);

    const base = { user_id: USER.id, project_id: PID, origin: "source" };
    expect(arg(recs[insertAt]!, "insert")).toEqual([
      { ...base, text: "Follow @proj on X", cadence: "once", position: 5 },
      { ...base, text: "Bridge ETH to the chain", cadence: "once", position: 6 },
      { ...base, text: "Claim the faucet", cadence: "weekly", position: 7 },
    ]);
  });

  it("leaves an already active project and its tasks unchanged", async () => {
    const { db, recs } = fakeDb((rec) => farmingRow(rec, { archived_at: null }) ?? ok(SOURCE));
    await startFarming(db, PID);
    expect(recs.map((r) => r.table)).toEqual(["farming_projects"]);
  });

  it("passes the 50-active-projects limit (23514) on as a project_limit error", async () => {
    const { db } = fakeDb(
      (rec) => farmingRow(rec, null) ?? (rec.table === "farming_projects" && has(rec, "insert") ? fail("23514") : ok([])),
    );
    const err = await startFarming(db, PID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FarmingError);
    expect((err as FarmingError).code).toBe("project_limit");
  });

  it("surfaces other database errors", async () => {
    const { db } = fakeDb((rec) => farmingRow(rec, null) ?? fail("XX000", "boom"));
    await expect(startFarming(db, PID)).rejects.toThrow(/boom/);
  });

  it("requires a user and a UUID before touching the database", async () => {
    const { db, recs } = fakeDb();
    await expect(startFarming(db, "nope")).rejects.toThrow(/invalid project/i);
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(startFarming(db, PID)).rejects.toThrow("NEXT_REDIRECT");
    expect(recs).toHaveLength(0);
  });
});

describe("refreshFromSource", () => {
  const T_SWAP = "55555555-5555-4555-8555-555555555551";
  const T_BRIDGE = "55555555-5555-4555-8555-555555555552";
  const T_MEME = "55555555-5555-4555-8555-555555555553";
  const T_OWN = "55555555-5555-4555-8555-555555555554";
  const ACTIVE = [
    { id: T_SWAP, text: "Swap on the DEX", origin: "source", position: 0 },
    { id: T_BRIDGE, text: "Bridge ETH", origin: "source", position: 1 },
    { id: T_MEME, text: "Post a meme", origin: "custom", position: 5 },
    { id: T_OWN, text: "Check Discord", origin: "custom", position: 2 },
  ];
  const SOURCE = [
    { description: "swap on the dex", text_id: null, cadence: "daily" },
    { description: "Post a meme", text_id: null, cadence: "once" },
    { description: "Mint the NFT", text_id: null, cadence: "once" },
  ];
  const route = (rec: Recorded): Result =>
    farmingRow(rec, { archived_at: null }) ??
    (rec.table === "tasks" ? ok(SOURCE) : rec.table === "farming_tasks" && has(rec, "select") ? ok(ACTIVE) : ok());

  it("adds the one new step and archives the one source step that is gone, never a custom task", async () => {
    const { db, recs } = fakeDb(route);
    expect(await refreshFromSource(db, PID)).toEqual({ added: 1, archived: 1 });

    const active = recs.find((r) => r.table === "farming_tasks" && has(r, "select"))!;
    expect(active.calls).toContainEqual(["eq", "user_id", USER.id]);
    expect(active.calls).toContainEqual(["eq", "project_id", PID]);
    expect(active.calls).toContainEqual(["is", "archived_at", null]);

    const archive = recs.find((r) => r.table === "farming_tasks" && has(r, "update"))!;
    expect(arg(archive, "update")).toEqual({ archived_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
    expect(archive.calls).toContainEqual(["in", "id", [T_BRIDGE]]);
    expect(archive.calls).toContainEqual(["eq", "user_id", USER.id]);

    const insert = recs.find((r) => r.table === "farming_tasks" && has(r, "insert"))!;
    expect(arg(insert, "insert")).toEqual([
      { user_id: USER.id, project_id: PID, text: "Mint the NFT", cadence: "once", origin: "source", position: 6 },
    ]);
  });

  it("replaces a source task with its Indonesian text once the step is translated", async () => {
    const translated = [{ description: "Swap on the DEX", text_id: "Swap di DEX", cadence: "daily" }];
    const { db, recs } = fakeDb(
      (rec) =>
        farmingRow(rec, { archived_at: null }) ??
        (rec.table === "tasks" ? ok(translated) : rec.table === "farming_tasks" && has(rec, "select") ? ok([ACTIVE[0]]) : ok()),
    );
    expect(await refreshFromSource(db, PID)).toEqual({ added: 1, archived: 1 });
    expect(recs.find((r) => r.table === "farming_tasks" && has(r, "update"))!.calls).toContainEqual(["in", "id", [T_SWAP]]);
    expect(arg(recs.find((r) => r.table === "farming_tasks" && has(r, "insert"))!, "insert")).toEqual([
      { user_id: USER.id, project_id: PID, text: "Swap di DEX", cadence: "daily", origin: "source", position: 0 },
    ]);
  });

  it("changes nothing when the active list already matches the source", async () => {
    const { db, recs } = fakeDb(
      (rec) =>
        farmingRow(rec, { archived_at: null }) ??
        (rec.table === "tasks" ? ok(SOURCE.slice(0, 2)) : rec.table === "farming_tasks" ? ok([ACTIVE[0], ACTIVE[2], ACTIVE[3]]) : ok()),
    );
    expect(await refreshFromSource(db, PID)).toEqual({ added: 0, archived: 0 });
    expect(recs.some((r) => has(r, "insert") || has(r, "update"))).toBe(false);
  });

  it("refuses a project the member is not farming", async () => {
    const { db, recs } = fakeDb((rec) => farmingRow(rec, { archived_at: "2026-10-01T00:00:00+00:00" }) ?? route(rec));
    const err = await refreshFromSource(db, PID).catch((e: unknown) => e);
    expect((err as FarmingError).code).toBe("not_farming");
    expect(recs.some((r) => has(r, "insert") || has(r, "update"))).toBe(false);
  });
});

describe("addCustomTask", () => {
  it("rejects empty, blank or over-200-character text before the database", async () => {
    const { db, recs } = fakeDb();
    for (const text of ["", "    ", "a".repeat(201), "🌱".repeat(201)]) {
      const err = await addCustomTask(db, PID, text, "daily").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(FarmingError);
      expect((err as FarmingError).code).toBe("invalid_task");
    }
    expect(recs).toHaveLength(0);
  });

  it("rejects an unknown cadence before the database", async () => {
    const { db, recs } = fakeDb();
    await expect(addCustomTask(db, PID, "Swap", "monthly" as "daily")).rejects.toThrow(FarmingError);
    expect(recs).toHaveLength(0);
  });

  it("adds a trimmed custom task after the last active one; 200 characters (code points) is allowed", async () => {
    const text = "🌱".repeat(200);
    const { db, recs } = fakeDb(
      (rec) =>
        farmingRow(rec, { archived_at: null }) ??
        (rec.table === "farming_tasks" && has(rec, "select") ? ok([{ id: TID, text: "x", origin: "source", position: 7 }]) : ok()),
    );
    await addCustomTask(db, PID, `  ${text}  `, "weekly");
    const insert = recs.find((r) => r.table === "farming_tasks" && has(r, "insert"))!;
    expect(arg(insert, "insert")).toEqual([
      { user_id: USER.id, project_id: PID, text, cadence: "weekly", origin: "custom", position: 8 },
    ]);
  });

  it("passes the 30-active-tasks limit (23514) on as a task_limit error", async () => {
    const { db } = fakeDb(
      (rec) => farmingRow(rec, { archived_at: null }) ?? (has(rec, "insert") ? fail("23514") : ok([])),
    );
    const err = await addCustomTask(db, PID, "Swap", "daily").catch((e: unknown) => e);
    expect((err as FarmingError).code).toBe("task_limit");
  });

  it("refuses a project the member is not farming", async () => {
    const { db, recs } = fakeDb((rec) => farmingRow(rec, null) ?? ok([]));
    const err = await addCustomTask(db, PID, "Swap", "daily").catch((e: unknown) => e);
    expect((err as FarmingError).code).toBe("not_farming");
    expect(recs.some((r) => has(r, "insert"))).toBe(false);
  });
});

describe("stopFarming, archiveTask, isFarming, setCheck", () => {
  it("stopFarming stamps archived_at on this member's active row only", async () => {
    const { db, recs } = fakeDb();
    await stopFarming(db, PID);
    const rec = recs[0]!;
    expect(rec.table).toBe("farming_projects");
    expect(arg(rec, "update")).toEqual({ archived_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
    expect(rec.calls).toContainEqual(["eq", "user_id", USER.id]);
    expect(rec.calls).toContainEqual(["eq", "project_id", PID]);
    expect(rec.calls).toContainEqual(["is", "archived_at", null]);
  });

  it("archiveTask stamps archived_at on this member's active task only", async () => {
    const { db, recs } = fakeDb();
    await archiveTask(db, TID);
    const rec = recs[0]!;
    expect(rec.table).toBe("farming_tasks");
    expect(arg(rec, "update")).toEqual({ archived_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
    expect(rec.calls).toContainEqual(["eq", "id", TID]);
    expect(rec.calls).toContainEqual(["eq", "user_id", USER.id]);
    expect(rec.calls).toContainEqual(["is", "archived_at", null]);
  });

  it("isFarming is true only for an active row of this member", async () => {
    const active = fakeDb(() => ok({ archived_at: null }));
    expect(await isFarming(active.db, PID)).toBe(true);
    expect(active.recs[0]!.calls).toContainEqual(["eq", "user_id", USER.id]);
    expect(active.recs[0]!.calls).toContainEqual(["eq", "project_id", PID]);
    expect(await isFarming(fakeDb(() => ok({ archived_at: "2026-10-01T00:00:00+00:00" })).db, PID)).toBe(false);
    expect(await isFarming(fakeDb(() => ok(null)).db, PID)).toBe(false);
  });

  it("setCheck calls toggle_farming_check with the wanted state and returns its answer", async () => {
    const { db, recs } = fakeDb(() => ok(false));
    expect(await setCheck(db, TID, false)).toBe(false);
    expect(recs[0]).toEqual({ table: "rpc:toggle_farming_check", calls: [["rpc", { p_task_id: TID, p_done: false }]] });
  });

  it("setCheck reports a task archived or a project stopped in another tab (22023) as task_inactive", async () => {
    const { db } = fakeDb(() => fail("22023", "task is archived"));
    await expect(setCheck(db, TID, true)).rejects.toMatchObject({ name: "FarmingError", code: "task_inactive" });
    await expect(setCheck(fakeDb(() => fail("XX000")).db, TID, true)).rejects.not.toBeInstanceOf(FarmingError);
  });

  it("setCheck reports a task gone with its deleted project (42501 task not found) as task_inactive", async () => {
    const { db } = fakeDb(() => fail("42501", "task not found"));
    await expect(setCheck(db, TID, true)).rejects.toMatchObject({ name: "FarmingError", code: "task_inactive" });
  });

  // G5 I3.4: only toggle_farming_check's own "task not found" is a gone task; any other 42501 (a missing grant, an
  // RLS refusal) is a real error, never shown as "Task itu udah diarsipkan".
  it("setCheck throws any other 42501 as a plain error, not task_inactive", async () => {
    const { db } = fakeDb(() => fail("42501", "permission denied for function toggle_farming_check"));
    const error = await setCheck(db, TID, true).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(FarmingError);
  });

  it("setCheck reports a profile time zone Postgres does not know (22023) as invalid_timezone, not task_inactive", async () => {
    const { db } = fakeDb(() => fail("22023", 'time zone "Mars/Olympus_Mons" not recognized'));
    await expect(setCheck(db, TID, true)).rejects.toMatchObject({ name: "FarmingError", code: "invalid_timezone" });
    expect(FARMING_ERROR_MESSAGES.invalid_timezone).not.toBe(FARMING_ERROR_MESSAGES.task_inactive);
  });

  it("refuses ids that are not UUIDs without touching the database", async () => {
    const { db, recs } = fakeDb();
    await expect(stopFarming(db, "x")).rejects.toThrow(/invalid/i);
    await expect(archiveTask(db, "x")).rejects.toThrow(/invalid/i);
    await expect(setCheck(db, "x", true)).rejects.toThrow(/invalid/i);
    await expect(refreshFromSource(db, "x")).rejects.toThrow(/invalid/i);
    await expect(addCustomTask(db, "x", "Swap", "daily")).rejects.toThrow(/invalid/i);
    expect(recs).toHaveLength(0);
  });
});

describe("getFarmingBoard", () => {
  // Member in Asia/Jakarta (UTC+7). 2026-10-10T20:00Z is Sunday 2026-10-11 there; its ISO week starts Monday 10-05.
  const NOW = new Date("2026-10-10T20:00:00Z");
  const T = {
    once: "a0000000-0000-4000-8000-000000000001",
    d1: "a0000000-0000-4000-8000-000000000002",
    weekly: "a0000000-0000-4000-8000-000000000003",
    d2: "a0000000-0000-4000-8000-000000000004",
    d3: "a0000000-0000-4000-8000-000000000005",
    p2daily: "a0000000-0000-4000-8000-000000000006",
  };
  const START = "2026-10-05T18:00:00+00:00"; // 2026-10-06 01:00 in Jakarta
  const task = (id: string, project_id: string, cadence: string, position: number, created_at = START, archived_at: string | null = null) => ({
    id,
    project_id,
    text: `Task ${position}`,
    cadence,
    origin: "source",
    position,
    created_at,
    archived_at,
  });
  const TASKS = [
    task(T.d2, PID, "daily", 3, "2026-10-07T17:30:00+00:00"), // local 2026-10-08
    task(T.weekly, PID, "weekly", 2),
    task(T.d3, PID, "daily", 4, START, "2026-10-08T18:00:00+00:00"), // archived local 2026-10-09
    task(T.once, PID, "once", 0),
    task(T.d1, PID, "daily", 1),
    task(T.p2daily, PID2, "daily", 0, "2026-10-10T18:00:00+00:00"),
  ];
  const check = (task_id: string, day: string) => ({ task_id, day });
  const CHECKS = [
    ...["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"].map((d) => check(T.d1, d)),
    check(T.d3, "2026-10-06"),
    check(T.d3, "2026-10-08"),
    check(T.d2, "2026-10-08"),
    check(T.d2, "2026-10-10"),
    check(T.d2, "2026-10-11"),
    check(T.weekly, "2026-10-06"),
    check(T.once, "2026-10-07"),
  ];
  const DEADLINES = [
    { project_id: PID, kind: "claim", date: "2026-10-01", precision: "exact" },
    { project_id: PID, kind: "snapshot", date: "2026-10-20", precision: "exact" },
    { project_id: PID, kind: "claim", date: "2026-10-15", precision: "exact" },
    { project_id: PID, kind: "campaign_end", date: "2026-11-30", precision: "approximate" },
    { project_id: PID, kind: "tge", date: "2026-10-12", precision: "month" },
  ];
  const FARMING = [
    { project_id: PID, started_at: START, projects: { name: "Demo", slug: "demo" } },
    { project_id: PID2, started_at: "2026-10-10T18:00:00+00:00", projects: { name: "Other", slug: "other" } },
  ];
  const board = (timezone: string | null, checks = CHECKS, latestCurations: unknown[] = []) =>
    fakeDb((rec) => {
      switch (rec.table) {
        case "latest_curations":
          return ok(latestCurations);
        case "profiles":
          return ok(timezone === null ? null : { timezone });
        case "farming_projects":
          return ok(FARMING);
        case "farming_tasks":
          return ok(TASKS);
        case "farming_checks":
          return ok(checks);
        case "deadlines":
          return ok(DEADLINES);
        default:
          return ok([]);
      }
    });

  it("builds one card per active project from the member's local days", async () => {
    const { db, recs } = board("Asia/Jakarta");
    const [demo, other] = await getFarmingBoard(db, NOW);

    const farming = recs.find((r) => r.table === "farming_projects")!;
    expect(farming.calls).toContainEqual(["eq", "user_id", USER.id]);
    expect(farming.calls).toContainEqual(["is", "archived_at", null]);

    expect(demo).toMatchObject({
      projectId: PID,
      name: "Demo",
      slug: "demo",
      today: "2026-10-11",
      nextDeadline: { kind: "claim", date: "2026-10-15", precision: "exact" },
      range: { start: "2026-10-06", end: "2026-10-20", endKind: "snapshot", endsOn: "2026-10-20" },
      daysLeft: 10,
      streak: 2,
      weeklyDone: { [T.weekly]: true },
      mainProgress: { done: 1, total: 1 },
    });
    // Active tasks in position order; the archived daily task is gone from the checklist.
    expect(demo!.tasks.map((t) => t.id)).toEqual([T.once, T.d1, T.weekly, T.d2]);
    expect(demo!.tasks[0]).toEqual({ id: T.once, text: "Task 0", cadence: "once", origin: "source" });
    // Ticked now: the done once task and the dailies checked today; the weekly was checked on another day.
    expect(demo!.checkedToday).toEqual([T.once, T.d1, T.d2]);
    // The archived daily task still counts on the days it was active (10-06 to 10-08).
    expect(demo!.heatmap.slice(0, 7)).toEqual([
      { day: "2026-10-06", level: 3, done: 2, total: 2, upcoming: false },
      { day: "2026-10-07", level: 2, done: 1, total: 2, upcoming: false },
      { day: "2026-10-08", level: 3, done: 3, total: 3, upcoming: false },
      { day: "2026-10-09", level: 2, done: 1, total: 2, upcoming: false },
      { day: "2026-10-10", level: 3, done: 2, total: 2, upcoming: false },
      { day: "2026-10-11", level: 3, done: 2, total: 2, upcoming: false },
      { day: "2026-10-12", level: null, done: 0, total: 2, upcoming: true },
    ]);
    expect(demo!.heatmap).toHaveLength(15);

    // The other project gets none of the first project's checks or deadlines.
    expect(other).toMatchObject({
      projectId: PID2,
      nextDeadline: null,
      range: { start: "2026-10-11", end: "2027-10-10", endKind: null, endsOn: null },
      daysLeft: null,
      streak: 0,
      weeklyDone: {},
      mainProgress: { done: 0, total: 0 },
      checkedToday: [],
    });
    expect(other!.heatmap).toHaveLength(365);
    expect(other!.heatmap[0]).toEqual({ day: "2026-10-11", level: 0, done: 0, total: 1, upcoming: false });
  });

  it("keeps today and the streak in the card once the snapshot has passed", async () => {
    // 2026-10-21T20:00Z is 2026-10-22 in Jakarta: the 10-20 snapshot passed, the 11-30 campaign end did not.
    const later = new Date("2026-10-21T20:00:00Z");
    const checks = [...CHECKS, ...["2026-10-21", "2026-10-22"].flatMap((d) => [check(T.d1, d), check(T.d2, d)])];
    const [demo] = await getFarmingBoard(board("Asia/Jakarta", checks).db, later);
    expect(demo).toMatchObject({
      today: "2026-10-22",
      range: { start: "2026-10-06", end: "2026-11-30", endKind: "campaign_end", endsOn: "2026-11-30" },
      daysLeft: 40,
      streak: 2,
    });
    expect(demo!.heatmap.find((c) => c.day === "2026-10-22")).toEqual({ day: "2026-10-22", level: 3, done: 2, total: 2, upcoming: false });
  });

  it("ends the range on the date the project ended, from its latest curation", async () => {
    const latest = [
      { project_id: PID, ended_on: "2026-10-09" },
      { project_id: PID2, ended_on: null },
    ];
    const { db, recs } = board("Asia/Jakarta", CHECKS, latest);
    const [demo, other] = await getFarmingBoard(db, NOW);
    const curations = recs.find((r) => r.table === "latest_curations")!;
    expect(curations.calls).toContainEqual(["select", "project_id, ended_on, tab"]);
    expect(curations.calls).toContainEqual(["in", "project_id", [PID, PID2]]);
    // Ended before the snapshot of 2026-10-20: the window stops at the end date.
    expect(demo!.range).toEqual({ start: "2026-10-06", end: "2026-10-09", endKind: "ended", endsOn: "2026-10-09" });
    expect(demo!.daysLeft).toBeNull();
    expect(demo!.heatmap.at(-1)!.day).toBe("2026-10-09");
    // A project that has not ended keeps its usual window.
    expect(other!.range).toEqual({ start: "2026-10-11", end: "2027-10-10", endKind: null, endsOn: null });
  });

  it("marks a card ended when its latest curation is in the Ended tab or the project status is ended, with its token symbol", async () => {
    const farmed = [
      { project_id: PID, started_at: START, projects: { name: "Demo", slug: "demo", token_symbol: "DMO", status: "live" } },
      { project_id: PID2, started_at: START, projects: { name: "Other", slug: "other", token_symbol: null, status: "ended" } },
    ];
    const third = "55555555-5555-4555-8555-555555555555";
    farmed.push({ project_id: third, started_at: START, projects: { name: "Third", slug: "third", token_symbol: "TRD", status: "live" } });
    const { db, recs } = fakeDb((rec) => {
      if (rec.table === "profiles") return ok({ timezone: "UTC" });
      if (rec.table === "farming_projects") return ok(farmed);
      if (rec.table === "latest_curations")
        return ok([
          { project_id: PID, ended_on: "2026-10-09", tab: "ended" },
          { project_id: third, ended_on: null, tab: "live_now" },
        ]);
      return ok([]);
    });
    const cards = await getFarmingBoard(db, NOW);
    expect(cards.map((c) => [c.name, c.ended, c.tokenSymbol])).toEqual([
      ["Demo", true, "DMO"],
      ["Other", true, null],
      ["Third", false, "TRD"],
    ]);
    const farming = recs.find((r) => r.table === "farming_projects")!;
    expect(farming.calls).toContainEqual(["select", "project_id, started_at, projects(name, slug, token_symbol, status)"]);
  });

  it("fails rather than drop the end date when the curations cannot be read", async () => {
    const { db } = fakeDb((rec) => {
      if (rec.table === "latest_curations") return fail("42501", "permission denied for view latest_curations");
      if (rec.table === "profiles") return ok({ timezone: "UTC" });
      if (rec.table === "farming_projects") return ok(FARMING);
      return ok([]);
    });
    await expect(getFarmingBoard(db, NOW)).rejects.toThrow(/permission denied/);
  });

  it("uses UTC days when the profile has no time zone or one this runtime does not know", async () => {
    for (const zone of [null, "Mars/Olympus_Mons"]) {
      const [demo] = await getFarmingBoard(board(zone).db, NOW);
      expect(demo!.range.start).toBe("2026-10-05");
      expect(demo!.today).toBe("2026-10-10");
      expect(demo!.checkedToday).toEqual([T.once, T.d1, T.d2]); // 2026-10-10 in UTC
    }
  });

  it("returns no cards without further queries when nothing is farmed", async () => {
    const { db, recs } = fakeDb((rec) => (rec.table === "profiles" ? ok({ timezone: "UTC" }) : ok([])));
    expect(await getFarmingBoard(db, NOW)).toEqual([]);
    expect(recs.map((r) => r.table).sort()).toEqual(["farming_projects", "profiles"]);
  });

  it("pages through checks past the 1000-row cap", async () => {
    const page = (from: number) => Array.from({ length: from === 0 ? 1000 : 1 }, () => check(T.d1, "2026-10-11"));
    const { db, recs } = fakeDb((rec) => {
      if (rec.table === "farming_checks") return ok(page(arg(rec, "range") as number));
      if (rec.table === "profiles") return ok({ timezone: "Asia/Jakarta" });
      if (rec.table === "farming_projects") return ok(FARMING.slice(0, 1));
      if (rec.table === "farming_tasks") return ok(TASKS.slice(0, 5));
      return ok([]);
    });
    await getFarmingBoard(db, NOW);
    const ranges = recs.filter((r) => r.table === "farming_checks").map((r) => r.calls.find((c) => c[0] === "range")!.slice(1));
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });
});

describe("garapan actions", () => {
  const form = (fields: Record<string, string>): FormData => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  it("every form action requires a signed-in user before anything else", async () => {
    const { db, recs } = fakeDb();
    serverDb = db;
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT"));
    const calls = [
      () => submitStartFarming(form({ projectId: PID })),
      () => submitStopFarming(form({ projectId: PID })),
      () => submitAddTask(form({ projectId: PID, text: "Swap", cadence: "daily" })),
      () => submitArchiveTask(form({ taskId: TID })),
      () => submitRefresh(form({ projectId: PID })),
      () => submitCheck(form({ taskId: TID, done: "1" })),
      () => startFarmingAction(PID),
    ];
    for (const call of calls) await expect(call()).rejects.toThrow("NEXT_REDIRECT");
    expect(recs).toHaveLength(0);
  });

  it("refuses malformed ids and check states without touching the database", async () => {
    const { db, recs } = fakeDb();
    serverDb = db;
    await expect(submitStartFarming(form({ projectId: "nope" }))).rejects.toThrow(/invalid/i);
    await expect(submitStopFarming(form({}))).rejects.toThrow(/invalid/i);
    await expect(submitArchiveTask(form({ taskId: "1 or 1=1" }))).rejects.toThrow(/invalid/i);
    await expect(submitCheck(form({ taskId: TID, done: "yes" }))).rejects.toThrow(/invalid/i);
    await expect(submitCheck(form({ taskId: "x", done: "1" }))).rejects.toThrow(/invalid/i);
    await expect(startFarmingAction("nope")).rejects.toThrow(/invalid/i);
    expect(recs).toHaveLength(0);
  });

  it("submitCheck sends the wanted state to toggle_farming_check and revalidates /garapan", async () => {
    const { db, recs } = fakeDb((rec) => ok(rec.calls[0]![1] && (rec.calls[0]![1] as { p_done: boolean }).p_done));
    serverDb = db;
    await submitCheck(form({ taskId: TID, done: "0" }));
    await submitCheck(form({ taskId: TID, done: "1" }));
    expect(recs.map((r) => r.calls[0])).toEqual([
      ["rpc", { p_task_id: TID, p_done: false }],
      ["rpc", { p_task_id: TID, p_done: true }],
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/garapan");
  });

  it("submitCheck on a task archived in another tab sends the member to /garapan with a message", async () => {
    serverDb = fakeDb(() => fail("22023", "task is archived")).db;
    await expect(submitCheck(form({ taskId: TID, done: "1" }))).rejects.toMatchObject({ to: "/garapan?error=task_inactive" });
    expect(FARMING_ERROR_MESSAGES.task_inactive).toMatch(/\S/);
  });

  it("a successful form sent from /garapan goes back to a clean /garapan, so a stale ?error= clears", async () => {
    const { db } = fakeDb((rec) => farmingRow(rec, { archived_at: null }) ?? (rec.table.startsWith("rpc:") ? ok(true) : ok([])));
    serverDb = db;
    const fromGarapan = [
      () => submitCheck(form({ taskId: TID, done: "1", from: "garapan" })),
      () => submitAddTask(form({ projectId: PID, text: "Swap", cadence: "daily", from: "garapan" })),
      () => submitArchiveTask(form({ taskId: TID, from: "garapan" })),
      () => submitRefresh(form({ projectId: PID, from: "garapan" })),
      () => submitStopFarming(form({ projectId: PID, from: "garapan" })),
    ];
    for (const call of fromGarapan) await expect(call()).rejects.toMatchObject({ to: "/garapan" });
  });

  it("a successful form sent from the project page stays there (no redirect)", async () => {
    const { db } = fakeDb((rec) => farmingRow(rec, { archived_at: null }) ?? ok([]));
    serverDb = db;
    await expect(submitStopFarming(form({ projectId: PID }))).resolves.toBeUndefined();
    await expect(submitStartFarming(form({ projectId: PID }))).resolves.toBeUndefined();
  });

  it("startFarmingAction reports the project limit as a result for the AI Coach", async () => {
    const { db } = fakeDb((rec) => farmingRow(rec, null) ?? (has(rec, "insert") ? fail("23514") : ok([])));
    serverDb = db;
    expect(await startFarmingAction(PID)).toEqual({ ok: false, error: "project_limit" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("startFarmingAction starts farming and revalidates /garapan", async () => {
    const { db, recs } = fakeDb((rec) => farmingRow(rec, null) ?? ok([]));
    serverDb = db;
    expect(await startFarmingAction(PID)).toEqual({ ok: true });
    expect(recs.some((r) => r.table === "farming_projects" && has(r, "insert"))).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/garapan");
  });

  it("form actions send a refused request to /garapan with the error code", async () => {
    const limit = fakeDb((rec) => farmingRow(rec, null) ?? (has(rec, "insert") ? fail("23514") : ok([])));
    serverDb = limit.db;
    await expect(submitStartFarming(form({ projectId: PID }))).rejects.toMatchObject({ to: "/garapan?error=project_limit" });

    const blank = fakeDb();
    serverDb = blank.db;
    await expect(submitAddTask(form({ projectId: PID, text: " ", cadence: "daily" }))).rejects.toMatchObject({
      to: "/garapan?error=invalid_task",
    });
    expect(blank.recs).toHaveLength(0);
  });

  it("submitAddTask, submitArchiveTask, submitStopFarming and submitRefresh write and revalidate", async () => {
    const { db, recs } = fakeDb((rec) => farmingRow(rec, { archived_at: null }) ?? ok([]));
    serverDb = db;
    await submitAddTask(form({ projectId: PID, text: "Swap", cadence: "daily" }));
    await submitArchiveTask(form({ taskId: TID }));
    await submitStopFarming(form({ projectId: PID }));
    await submitRefresh(form({ projectId: PID }));
    expect(recs.filter((r) => has(r, "insert")).map((r) => r.table)).toEqual(["farming_tasks"]);
    expect(recs.filter((r) => has(r, "update")).map((r) => r.table)).toEqual(["farming_tasks", "farming_projects"]);
    expect(recs.some((r) => r.table === "tasks")).toBe(true);
    expect(revalidatePath).toHaveBeenCalledTimes(4);
    expect(revalidatePath).toHaveBeenCalledWith("/garapan");
  });
});

describe("airdrop results (Hasil garapan, #51)", () => {
  const fetchMock = vi.fn();
  const GECKO = "astra-swap";
  // 2026-10-10T20:00Z is 2026-10-11 in Jakarta (UTC+7) and still 2026-10-10 in UTC.
  const NOW = new Date("2026-10-10T20:00:00Z");

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("PRICES_API_BASE", "");
    vi.stubEnv("COINGECKO_API_KEY", "");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const llama = (price: number) =>
    new Response(JSON.stringify({ coins: { [`coingecko:${GECKO}`]: { symbol: "ASTRA", price, timestamp: 1, confidence: 0.99 } } }), {
      status: 200,
    });

  interface World {
    tab?: string | null;
    status?: string;
    timezone?: string;
    farming?: { archived_at: string | null } | null;
    gecko?: string | null;
    /** Rows the update of farming_results matches (an existing result). */
    existing?: boolean;
    insertError?: string;
  }

  /** A fake db for saveResult: the project's curation/status, the member's time zone and farming row, the signal. */
  function resultDb(w: World = {}) {
    return fakeDb((rec) => {
      switch (rec.table) {
        case "profiles":
          return ok({ timezone: w.timezone ?? "Asia/Jakarta" });
        case "projects":
          return ok({ status: w.status ?? "live" });
        case "latest_curations":
          return ok(w.tab === null ? null : { tab: w.tab ?? "ended" });
        case "farming_projects":
          return ok(w.farming === undefined ? { archived_at: null } : w.farming);
        case "project_signals":
          return ok(w.gecko === null ? null : { value: { gecko_id: w.gecko ?? GECKO } });
        case "farming_results":
          if (has(rec, "update")) return ok(w.existing ? [{ project_id: PID }] : []);
          if (has(rec, "insert")) return w.insertError ? fail(w.insertError) : ok(null);
          return ok([]);
        default:
          return ok(null);
      }
    });
  }

  const resultWrites = (recs: Recorded[]) => recs.filter((r) => r.table === "farming_results" && (has(r, "insert") || has(r, "update")));
  const input = { amount: "1250", claimedOn: "2026-10-07", noReward: false };

  describe("submitResult", () => {
    it("refuses a project that has not ended, by curation tab and by status, without writing", async () => {
      const { db, recs } = resultDb({ tab: "live_now", status: "live" });
      serverDb = db;
      expect(await submitResult(PID, input)).toEqual({ ok: false, error: "result_not_ended" });
      expect(resultWrites(recs)).toHaveLength(0);
      serverDb = resultDb({ tab: null, status: "announced" }).db;
      expect(await submitResult(PID, input)).toEqual({ ok: false, error: "result_not_ended" });
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it("accepts a project in the Ended tab, or one whose status is ended without a curation", async () => {
      fetchMock.mockImplementation(async () => llama(0.32));
      serverDb = resultDb({ tab: "ended", status: "live" }).db;
      expect(await submitResult(PID, input)).toEqual({ ok: true });
      serverDb = resultDb({ tab: null, status: "ended" }).db;
      expect(await submitResult(PID, input)).toEqual({ ok: true });
      expect(revalidatePath).toHaveBeenCalledWith("/garapan");
    });

    it("refuses tomorrow's claim date in the member's time zone, and accepts today there", async () => {
      fetchMock.mockImplementation(async () => llama(0.32));
      const tomorrow = resultDb();
      serverDb = tomorrow.db;
      expect(await submitResult(PID, { ...input, claimedOn: "2026-10-12" })).toEqual({ ok: false, error: "invalid_claim_date" });
      expect(resultWrites(tomorrow.recs)).toHaveLength(0);
      // 2026-10-11 is already today in Jakarta, though still tomorrow in UTC.
      serverDb = resultDb().db;
      expect(await submitResult(PID, { ...input, claimedOn: "2026-10-11" })).toEqual({ ok: true });
      serverDb = resultDb({ timezone: "UTC" }).db;
      expect(await submitResult(PID, { ...input, claimedOn: "2026-10-11" })).toEqual({ ok: false, error: "invalid_claim_date" });
    });

    it("refuses an amount that is not a number above 0 (and at most 1e15), and an impossible date, before the database", async () => {
      const { db, recs } = resultDb();
      serverDb = db;
      for (const amount of ["0", "-1", "", "abc", "1e5", "0x10", "1.2.3", "1000000000000001"]) {
        expect(await submitResult(PID, { ...input, amount })).toEqual({ ok: false, error: "invalid_amount" });
      }
      for (const claimedOn of ["", "2026-02-30", "07-10-2026", "2026-10-7"]) {
        expect(await submitResult(PID, { ...input, claimedOn })).toEqual({ ok: false, error: "invalid_claim_date" });
      }
      expect(recs).toHaveLength(0);
    });

    it("stores amount × the price on the claim day as usd_at_claim, inserting the first result", async () => {
      fetchMock.mockImplementation(async () => llama(0.32));
      const { db, recs } = resultDb();
      serverDb = db;
      expect(await submitResult(PID, { amount: "1250", claimedOn: "2026-10-07", noReward: false })).toEqual({ ok: true });
      expect(String(fetchMock.mock.calls[0]![0])).toBe(`https://coins.llama.fi/prices/historical/1791331200/coingecko:${GECKO}`);
      const signals = recs.find((r) => r.table === "project_signals")!;
      expect(signals.calls).toContainEqual(["eq", "project_id", PID]);
      const insert = recs.find((r) => r.table === "farming_results" && has(r, "insert"))!;
      expect(arg(insert, "insert")).toEqual({
        user_id: USER.id,
        project_id: PID,
        amount: "1250",
        no_reward: false,
        claimed_on: "2026-10-07",
        usd_at_claim: 400,
      });
    });

    // G5 I3.5: "1.250" could be 1250 tokens (id-ID thousands) or 1.25; neither guess is safe, so the member is asked
    // to write it without separators.
    it("refuses an amount with thousands separators as ambiguous, before the database", async () => {
      const { db, recs } = resultDb();
      serverDb = db;
      for (const amount of ["1.250", "1,250", "12.345.678", "1,250,000", "999.999"]) {
        expect(await submitResult(PID, { ...input, amount })).toEqual({ ok: false, error: "ambiguous_amount" });
      }
      expect(recs).toHaveLength(0);
      expect(FARMING_ERROR_MESSAGES.ambiguous_amount).toMatch(/tanpa pemisah ribuan/);
    });

    it("still accepts a plain decimal that is not a thousands group", async () => {
      fetchMock.mockImplementation(async () => llama(0.32));
      for (const amount of ["1.25", "1250", "0.250", "1234.567", "12,5"]) {
        serverDb = resultDb().db;
        expect(await submitResult(PID, { ...input, amount })).toEqual({ ok: true });
      }
    });

    // G5 I3.8: a server action is a public endpoint; a non-boolean flag ("false" is truthy) must not be used as one.
    it("refuses a noReward or shareAnonymous that is not a boolean, before the database", async () => {
      const { db, recs } = resultDb();
      serverDb = db;
      for (const bad of [
        { ...input, noReward: "false" },
        { ...input, noReward: 1 },
        { ...input, noReward: undefined },
        { ...input, shareAnonymous: "true" },
        { ...input, shareAnonymous: null },
      ]) {
        await expect(submitResult(PID, bad as unknown as ResultInput)).rejects.toThrow(/invalid/i);
      }
      expect(recs).toHaveLength(0);
    });

    it("accepts a result without shareAnonymous (the current choice is kept)", async () => {
      fetchMock.mockImplementation(async () => llama(0.32));
      serverDb = resultDb().db;
      expect(await submitResult(PID, { ...input, shareAnonymous: undefined })).toEqual({ ok: true });
    });

    it("accepts a decimal comma and rounds the USD value to cents", async () => {
      fetchMock.mockImplementation(async () => llama(0.333));
      const { db, recs } = resultDb();
      serverDb = db;
      expect(await submitResult(PID, { ...input, amount: "12,5" })).toEqual({ ok: true });
      const insert = recs.find((r) => r.table === "farming_results" && has(r, "insert"))!;
      expect(arg(insert, "insert")).toMatchObject({ amount: "12.5", usd_at_claim: 4.16 });
    });

    it("keeps the token amount with no USD value when the price is not found", async () => {
      fetchMock.mockImplementation(async () => new Response("{}", { status: 429 }));
      const limited = resultDb();
      serverDb = limited.db;
      expect(await submitResult(PID, input)).toEqual({ ok: true });
      expect(arg(limited.recs.find((r) => r.table === "farming_results" && has(r, "insert"))!, "insert")).toMatchObject({
        amount: "1250",
        usd_at_claim: null,
      });

      fetchMock.mockReset();
      const unlisted = resultDb({ gecko: null });
      serverDb = unlisted.db;
      expect(await submitResult(PID, input)).toEqual({ ok: true });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(arg(unlisted.recs.find((r) => r.table === "farming_results" && has(r, "insert"))!, "insert")).toMatchObject({
        usd_at_claim: null,
      });
    });

    it('"Gak dapet" stores no amount, no date and no price, and asks for no price', async () => {
      const { db, recs } = resultDb();
      serverDb = db;
      expect(await submitResult(PID, { amount: "", claimedOn: "", noReward: true })).toEqual({ ok: true });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(arg(recs.find((r) => r.table === "farming_results" && has(r, "insert"))!, "insert")).toEqual({
        user_id: USER.id,
        project_id: PID,
        amount: null,
        no_reward: true,
        claimed_on: null,
        usd_at_claim: null,
      });
    });

    it("updates an existing result of this member in place, keeping the sharing choice unless one is sent", async () => {
      fetchMock.mockImplementation(async () => llama(0.32));
      const { db, recs } = resultDb({ existing: true });
      serverDb = db;
      expect(await submitResult(PID, input)).toEqual({ ok: true });
      const update = recs.find((r) => r.table === "farming_results" && has(r, "update"))!;
      expect(arg(update, "update")).toEqual({ amount: "1250", no_reward: false, claimed_on: "2026-10-07", usd_at_claim: 400 });
      expect(update.calls).toContainEqual(["eq", "user_id", USER.id]);
      expect(update.calls).toContainEqual(["eq", "project_id", PID]);
      expect(recs.some((r) => r.table === "farming_results" && has(r, "insert"))).toBe(false);

      const shared = resultDb({ existing: true });
      serverDb = shared.db;
      await submitResult(PID, { ...input, shareAnonymous: true });
      expect(arg(shared.recs.find((r) => r.table === "farming_results" && has(r, "update"))!, "update")).toMatchObject({
        share_anonymous: true,
      });
    });

    it("refuses a project the member never farmed", async () => {
      const { db, recs } = resultDb({ farming: null });
      serverDb = db;
      expect(await submitResult(PID, input)).toEqual({ ok: false, error: "not_farming" });
      expect(resultWrites(recs)).toHaveLength(0);
    });

    it("requires a user and a UUID before touching the database", async () => {
      const { db, recs } = resultDb();
      serverDb = db;
      await expect(submitResult("nope", input)).rejects.toThrow(/invalid/i);
      requireUser.mockRejectedValue(new Error("NEXT_REDIRECT"));
      await expect(submitResult(PID, input)).rejects.toThrow("NEXT_REDIRECT");
      expect(recs).toHaveLength(0);
    });
  });

  describe("result forms", () => {
    const form = (fields: Record<string, string>): FormData => {
      const f = new FormData();
      for (const [k, v] of Object.entries(fields)) f.set(k, v);
      return f;
    };

    it("submitResultForm saves the fields and goes back to /garapan, clearing a stale ?error=", async () => {
      fetchMock.mockImplementation(async () => llama(0.32));
      const { db, recs } = resultDb();
      serverDb = db;
      await expect(
        submitResultForm(form({ projectId: PID, amount: "1250", claimedOn: "2026-10-07", from: "garapan" })),
      ).rejects.toMatchObject({ to: "/garapan" });
      expect(arg(recs.find((r) => r.table === "farming_results" && has(r, "insert"))!, "insert")).toMatchObject({
        amount: "1250",
        no_reward: false,
      });
    });

    it('submitResultForm with the "Gak dapet" button ignores the amount fields', async () => {
      const { db, recs } = resultDb();
      serverDb = db;
      await expect(submitResultForm(form({ projectId: PID, amount: "", claimedOn: "", noReward: "1", from: "garapan" }))).rejects.toMatchObject({
        to: "/garapan",
      });
      expect(arg(recs.find((r) => r.table === "farming_results" && has(r, "insert"))!, "insert")).toMatchObject({ no_reward: true });
    });

    it("submitResultForm sends a refusal to /garapan with its code", async () => {
      serverDb = resultDb({ tab: "live_now" }).db;
      await expect(submitResultForm(form({ projectId: PID, amount: "1250", claimedOn: "2026-10-07", from: "garapan" }))).rejects.toMatchObject({
        to: "/garapan?error=result_not_ended",
      });
    });

    it("submitShareAnonymous sets the member's opt-in for that project only", async () => {
      const { db, recs } = fakeDb(() => ok([{ project_id: PID }]));
      serverDb = db;
      await expect(submitShareAnonymous(form({ projectId: PID, share: "1", from: "garapan" }))).rejects.toMatchObject({ to: "/garapan" });
      const update = recs.find((r) => r.table === "farming_results")!;
      expect(arg(update, "update")).toEqual({ share_anonymous: true });
      expect(update.calls).toContainEqual(["eq", "user_id", USER.id]);
      expect(update.calls).toContainEqual(["eq", "project_id", PID]);
      await expect(submitShareAnonymous(form({ projectId: PID, share: "maybe" }))).rejects.toThrow(/invalid/i);
    });

    it("both result forms require a signed-in user first", async () => {
      const { db, recs } = fakeDb();
      serverDb = db;
      requireUser.mockRejectedValue(new Error("NEXT_REDIRECT"));
      await expect(submitResultForm(form({ projectId: PID, amount: "1", claimedOn: "2026-10-07" }))).rejects.toThrow("NEXT_REDIRECT");
      await expect(submitShareAnonymous(form({ projectId: PID, share: "1" }))).rejects.toThrow("NEXT_REDIRECT");
      expect(recs).toHaveLength(0);
    });
  });

  describe("getResults", () => {
    const P3 = "55555555-5555-4555-8555-555555555555";
    const ROWS = [
      { project_id: PID, amount: 1250, no_reward: false, claimed_on: "2026-10-07", usd_at_claim: 400, share_anonymous: true },
      { project_id: PID2, amount: null, no_reward: true, claimed_on: null, usd_at_claim: null, share_anonymous: false },
      // A project the member stopped farming still counts in the total.
      { project_id: P3, amount: "10.5", no_reward: false, claimed_on: "2026-09-01", usd_at_claim: "12.25", share_anonymous: false },
    ];

    function resultsDb(stats: Record<string, { contributors: number; avg_usd: number | string | null }>) {
      return fakeDb((rec) => {
        if (rec.table === "farming_results") return ok(ROWS);
        if (rec.table === "project_signals") return ok({ value: { gecko_id: GECKO } });
        if (rec.table === "rpc:farming_result_stats") {
          const id = (rec.calls[0]![1] as { p_project_id: string }).p_project_id;
          return ok(stats[id] ? [stats[id]] : [{ contributors: 0, avg_usd: null }]);
        }
        return ok([]);
      });
    }

    it("sums usd_at_claim of every result of the member into the total", async () => {
      const { db, recs } = resultsDb({});
      const overview = await getResults(db, []);
      expect(overview.totalUsd).toBe(412.25);
      const read = recs.find((r) => r.table === "farming_results")!;
      expect(read.calls).toContainEqual(["eq", "user_id", USER.id]);
    });

    it("gives each ended project its result with today's value, and the member average only when there is one", async () => {
      fetchMock.mockImplementation(async () => llama(0.304));
      const { db, recs } = resultsDb({
        [PID]: { contributors: 23, avg_usd: "296.4" },
        [PID2]: { contributors: 4, avg_usd: null },
      });
      const overview = await getResults(db, [PID, PID2]);
      expect(overview.results[PID]).toEqual({
        amount: 1250,
        noReward: false,
        claimedOn: "2026-10-07",
        usdAtClaim: 400,
        shareAnonymous: true,
        usdNow: 380,
      });
      expect(overview.results[PID2]).toMatchObject({ noReward: true, amount: null, usdNow: null });
      expect(overview.averages).toEqual({ [PID]: { contributors: 23, avgUsd: 296.4 } });
      expect(String(fetchMock.mock.calls[0]![0])).toBe(`https://coins.llama.fi/prices/current/coingecko:${GECKO}`);
      // Stats are asked for the ended projects on the board only.
      expect(recs.filter((r) => r.table === "rpc:farming_result_stats").map((r) => r.calls[0]![1])).toEqual([
        { p_project_id: PID },
        { p_project_id: PID2 },
      ]);
    });

    it("shows no current value when today's price is not found", async () => {
      fetchMock.mockImplementation(async () => new Response("{}", { status: 503 }));
      const overview = await getResults(resultsDb({}).db, [PID]);
      expect(overview.results[PID]).toMatchObject({ usdAtClaim: 400, usdNow: null });
    });
  });
});
