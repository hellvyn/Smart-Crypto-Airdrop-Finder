import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUser = vi.fn();
const revalidatePath = vi.fn();
let serverDb: SupabaseClient;

vi.mock("@/lib/auth", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => serverDb }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));

import { markChangesSeen } from "../app/(app)/changes/actions";

const USER = { id: "11111111-1111-4111-8111-111111111111" };

type Call = [method: string, ...args: unknown[]];
type Result = { data: unknown; error: { message: string } | null };
interface Recorded {
  table: string;
  calls: Call[];
}

function fakeDb(result: Result) {
  const recs: Recorded[] = [];
  const db = {
    from(table: string) {
      const rec: Recorded = { table, calls: [] };
      recs.push(rec);
      const b: Record<string, unknown> = {};
      for (const m of ["update", "eq", "select"]) {
        b[m] = (...args: unknown[]) => {
          rec.calls.push([m, ...args]);
          return b;
        };
      }
      b.then = (res: (r: Result) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
      return b;
    },
  };
  return { db: db as unknown as SupabaseClient, recs };
}

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue(USER);
  revalidatePath.mockReset();
});

describe("markChangesSeen", () => {
  it("touches only changes_seen_at, only on the signed-in member's own profile, and sends no time of its own", async () => {
    const { db, recs } = fakeDb({ data: [{ user_id: USER.id }], error: null });
    serverDb = db;
    await markChangesSeen();
    expect(recs).toHaveLength(1);
    expect(recs[0]!.table).toBe("profiles");
    // null: the trigger of 0014 stamps the database's now() on any write of the column (proved in pgTAP).
    expect(recs[0]!.calls).toContainEqual(["update", { changes_seen_at: null }]);
    expect(recs[0]!.calls).toContainEqual(["eq", "user_id", USER.id]);
  });

  it("refreshes the two pages that show the changes", async () => {
    serverDb = fakeDb({ data: [{ user_id: USER.id }], error: null }).db;
    await markChangesSeen();
    expect(revalidatePath.mock.calls.map((c) => c[0]).sort()).toEqual(["/airdrops", "/watchlist"]);
  });

  it("writes nothing for a signed-out visitor", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT"));
    const { db, recs } = fakeDb({ data: null, error: null });
    serverDb = db;
    await expect(markChangesSeen()).rejects.toThrow("NEXT_REDIRECT");
    expect(recs).toHaveLength(0);
  });

  it("throws when the update fails or matches no profile", async () => {
    serverDb = fakeDb({ data: null, error: { message: "boom" } }).db;
    await expect(markChangesSeen()).rejects.toThrow("Failed to mark the changes seen: boom");
    serverDb = fakeDb({ data: [], error: null }).db;
    await expect(markChangesSeen()).rejects.toThrow("Failed to mark the changes seen: no profile found");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
