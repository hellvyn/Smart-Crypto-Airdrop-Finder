import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUser = vi.fn();
const revalidatePath = vi.fn();
let serverDb: SupabaseClient;

vi.mock("@/lib/auth", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => serverDb }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));

import { toggleWatch } from "../app/(app)/watchlist/actions";
import { getWatchlist, isUuid, isWatching } from "../lib/watchlist";

const USER = { id: "11111111-1111-4111-8111-111111111111" };
const PID = "22222222-2222-4222-8222-222222222222";

type Call = [method: string, ...args: unknown[]];
type Result = { data: unknown; error: { message: string } | null };
interface Recorded {
  table: string;
  calls: Call[];
}

/** Fake PostgREST builder: records calls, resolves (thenable or maybeSingle) to `respond(rec)`. */
function fakeDb(respond: (rec: Recorded) => Result = () => ({ data: null, error: null })) {
  const recs: Recorded[] = [];
  const db = {
    from(table: string) {
      const rec: Recorded = { table, calls: [] };
      recs.push(rec);
      const b: Record<string, unknown> = {};
      for (const m of ["select", "upsert", "delete", "eq", "in", "order", "limit"]) {
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
  };
  return { db: db as unknown as SupabaseClient, recs };
}

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue(USER);
  revalidatePath.mockReset();
});

describe("isUuid", () => {
  it("accepts UUIDs and rejects anything else", () => {
    expect(isUuid(PID)).toBe(true);
    expect(isUuid(PID.toUpperCase())).toBe(true);
    for (const bad of ["", "not-a-uuid", `${PID}x`, ` ${PID}`, "1; drop table watchlist", 5, null, undefined]) {
      expect(isUuid(bad)).toBe(false);
    }
  });
});

describe("toggleWatch", () => {
  it("rejects a non-UUID project id without touching the database", async () => {
    const { db, recs } = fakeDb();
    serverDb = db;
    await expect(toggleWatch("nope")).rejects.toThrow(/invalid project/i);
    await expect(toggleWatch("")).rejects.toThrow(/invalid project/i);
    expect(recs).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("requires a signed-in user before anything else", async () => {
    const { db, recs } = fakeDb();
    serverDb = db;
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(toggleWatch(PID, true)).rejects.toThrow("NEXT_REDIRECT");
    expect(recs).toHaveLength(0);
  });

  it("watch inserts with on-conflict-ignore, so a double submit leaves one row", async () => {
    const { db, recs } = fakeDb();
    serverDb = db;
    expect(await toggleWatch(PID, true)).toEqual({ watching: true });
    expect(recs[0]!.table).toBe("watchlist");
    expect(recs[0]!.calls).toContainEqual([
      "upsert",
      { user_id: USER.id, project_id: PID },
      { onConflict: "user_id,project_id", ignoreDuplicates: true },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/watchlist");
  });

  it("unwatch deletes only this user's row for this project", async () => {
    const { db, recs } = fakeDb();
    serverDb = db;
    expect(await toggleWatch(PID, false)).toEqual({ watching: false });
    const calls = recs[0]!.calls;
    expect(calls[0]).toEqual(["delete"]);
    expect(calls).toContainEqual(["eq", "user_id", USER.id]);
    expect(calls).toContainEqual(["eq", "project_id", PID]);
  });

  it("without an explicit target it flips the current state", async () => {
    const watched = fakeDb((rec) => ({ data: rec.calls.some((c) => c[0] === "maybeSingle") ? { project_id: PID } : null, error: null }));
    serverDb = watched.db;
    expect(await toggleWatch(PID)).toEqual({ watching: false });
    expect(watched.recs.some((r) => r.calls.some((c) => c[0] === "delete"))).toBe(true);

    const unwatched = fakeDb();
    serverDb = unwatched.db;
    expect(await toggleWatch(PID)).toEqual({ watching: true });
    expect(unwatched.recs.some((r) => r.calls.some((c) => c[0] === "upsert"))).toBe(true);
  });

  it("surfaces database errors", async () => {
    const { db } = fakeDb(() => ({ data: null, error: { message: "boom" } }));
    serverDb = db;
    await expect(toggleWatch(PID, true)).rejects.toThrow(/boom/);
  });
});

describe("isWatching", () => {
  it("requires a user and reads this user's row", async () => {
    const { db, recs } = fakeDb(() => ({ data: { project_id: PID }, error: null }));
    expect(await isWatching(db, PID)).toBe(true);
    expect(requireUser).toHaveBeenCalled();
    expect(recs[0]!.calls).toContainEqual(["eq", "user_id", USER.id]);
    expect(recs[0]!.calls).toContainEqual(["eq", "project_id", PID]);
  });

  it("is false without a row", async () => {
    const { db } = fakeDb();
    expect(await isWatching(db, PID)).toBe(false);
  });
});

describe("getWatchlist", () => {
  const row = {
    slug: "demo",
    name: "Demo",
    status: "live",
    chains: ["ethereum"],
    last_seen: "2026-10-09T00:00:00Z",
    next_deadline_date: "2026-11-01",
    next_deadline_kind: "claim",
    next_deadline_precision: "exact",
    latest_risk_level: "high",
  };

  it("returns [] without a second query when nothing is watched", async () => {
    const { db, recs } = fakeDb(() => ({ data: [], error: null }));
    expect(await getWatchlist(db)).toEqual([]);
    expect(recs.map((r) => r.table)).toEqual(["watchlist"]);
    expect(requireUser).toHaveBeenCalled();
  });

  it("reads project_list for the watched ids, ordered like the list", async () => {
    const { db, recs } = fakeDb((rec) =>
      rec.table === "watchlist" ? { data: [{ project_id: PID }], error: null } : { data: [row], error: null },
    );
    const items = await getWatchlist(db);
    expect(recs[0]!.calls).toContainEqual(["eq", "user_id", USER.id]);
    const list = recs[1]!;
    expect(list.table).toBe("project_list");
    expect(list.calls).toContainEqual(["in", "id", [PID]]);
    expect(list.calls).toContainEqual(["order", "next_deadline_date", { ascending: true, nullsFirst: false }]);
    expect(list.calls).toContainEqual(["order", "last_seen", { ascending: false }]);
    expect(items).toEqual([
      {
        slug: "demo",
        name: "Demo",
        status: "live",
        riskLevel: "high",
        chains: ["ethereum"],
        nextDeadline: { date: "2026-11-01", kind: "claim", precision: "exact" },
        lastSeen: "2026-10-09T00:00:00Z",
      },
    ]);
  });
});
