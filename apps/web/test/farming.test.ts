import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  submitStartFarming,
  submitStopFarming,
} from "../app/(app)/garapan/actions";
import {
  FarmingError,
  addCustomTask,
  archiveTask,
  getFarmingBoard,
  isFarming,
  refreshFromSource,
  setCheck,
  startFarming,
  stopFarming,
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
    { description: "Follow @proj on X", cadence: "once" },
    { description: "Bridge ETH to the chain", cadence: "once" },
    { description: "follow @PROJ on x", cadence: "daily" },
    { description: "  Swap on the DEX  ", cadence: "daily" },
    { description: "   ", cadence: "daily" },
    { description: "Claim the faucet", cadence: "weekly" },
  ];

  it("creates the farming row, then snapshots once/daily/weekly source steps with case-insensitive dedup", async () => {
    const { db, recs } = fakeDb((rec) => farmingRow(rec, null) ?? (rec.table === "tasks" ? ok(SOURCE) : ok([])));
    await startFarming(db, PID);

    const insertProject = recs.find((r) => r.table === "farming_projects" && has(r, "insert"))!;
    expect(arg(insertProject, "insert")).toEqual({ user_id: USER.id, project_id: PID });
    expect(recs.some((r) => r.table === "farming_projects" && (has(r, "update") || has(r, "upsert")))).toBe(false);

    const source = recs.find((r) => r.table === "tasks")!;
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

  it("clips a source step longer than 200 characters so the row passes the text check", async () => {
    const long = "x".repeat(250);
    const { db, recs } = fakeDb(
      (rec) => farmingRow(rec, null) ?? (rec.table === "tasks" ? ok([{ description: long, cadence: "daily" }]) : ok([])),
    );
    await startFarming(db, PID);
    const rows = arg(recs.find((r) => r.table === "farming_tasks" && has(r, "insert"))!, "insert") as { text: string }[];
    expect(rows[0]!.text).toBe(`${"x".repeat(199)}…`);
  });

  it("snapshots at most 30 steps, the limit of active tasks per project", async () => {
    const many = Array.from({ length: 33 }, (_, i) => ({ description: `Step ${i + 1}`, cadence: "daily" }));
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
    { description: "swap on the dex", cadence: "daily" },
    { description: "Post a meme", cadence: "once" },
    { description: "Mint the NFT", cadence: "once" },
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
  const board = (timezone: string | null) =>
    fakeDb((rec) => {
      switch (rec.table) {
        case "profiles":
          return ok(timezone === null ? null : { timezone });
        case "farming_projects":
          return ok(FARMING);
        case "farming_tasks":
          return ok(TASKS);
        case "farming_checks":
          return ok(CHECKS);
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
      nextDeadline: { kind: "claim", date: "2026-10-15", precision: "exact" },
      range: { start: "2026-10-06", end: "2026-10-20", endKind: "snapshot" },
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
      range: { start: "2026-10-11", end: "2027-10-10", endKind: null },
      daysLeft: null,
      streak: 0,
      weeklyDone: {},
      mainProgress: { done: 0, total: 0 },
      checkedToday: [],
    });
    expect(other!.heatmap).toHaveLength(365);
    expect(other!.heatmap[0]).toEqual({ day: "2026-10-11", level: 0, done: 0, total: 1, upcoming: false });
  });

  it("uses UTC days when the profile has no time zone or one this runtime does not know", async () => {
    for (const zone of [null, "Mars/Olympus_Mons"]) {
      const [demo] = await getFarmingBoard(board(zone).db, NOW);
      expect(demo!.range.start).toBe("2026-10-05");
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
