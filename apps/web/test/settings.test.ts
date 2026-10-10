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

import { deleteAccount, submitDeleteAccount, submitUpdateSettings, updateSettings } from "../app/(app)/settings/actions";
import { getSettings, isValidTimezone, timezoneOptions } from "../lib/settings";

const USER = { id: "11111111-1111-4111-8111-111111111111" };

type Call = [method: string, ...args: unknown[]];
type Result = { data: unknown; error: { message: string } | null };
interface Recorded {
  table: string;
  calls: Call[];
}

/** Fake PostgREST builder + rpc + auth: records calls, resolves to `respond(rec)`. */
function fakeDb(
  opts: {
    respond?: (rec: Recorded) => Result;
    rpc?: Result;
    signOut?: () => Promise<{ error: null }>;
  } = {},
) {
  const respond = opts.respond ?? (() => ({ data: [{ user_id: USER.id }], error: null }));
  const recs: Recorded[] = [];
  const order: string[] = [];
  const db = {
    from(table: string) {
      const rec: Recorded = { table, calls: [] };
      recs.push(rec);
      const b: Record<string, unknown> = {};
      for (const m of ["select", "update", "eq"]) {
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
    rpc(name: string) {
      order.push(`rpc:${name}`);
      return Promise.resolve(opts.rpc ?? { data: null, error: null });
    },
    auth: {
      signOut: () => {
        order.push("signOut");
        return (opts.signOut ?? (() => Promise.resolve({ error: null })))();
      },
    },
  };
  return { db: db as unknown as SupabaseClient, recs, order };
}

async function redirected(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof Redirect) return e.to;
    throw e;
  }
  throw new Error("expected a redirect");
}

function form(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue(USER);
  revalidatePath.mockReset();
});

describe("timezones", () => {
  it("accepts supported zones and UTC, rejects everything else", () => {
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Europe/Berlin")).toBe(true);
    expect(isValidTimezone("Asia/Jakarta")).toBe(true);
    expect(isValidTimezone("Mars/Base")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone(" UTC")).toBe(false);
    expect(isValidTimezone("europe/berlin")).toBe(false);
    expect(isValidTimezone(undefined)).toBe(false);
  });

  it("lists UTC once, plus the current profile zone when it is unknown", () => {
    const base = timezoneOptions();
    expect(base.filter((z) => z === "UTC")).toHaveLength(1);
    expect(base).toContain("Europe/Berlin");
    expect(timezoneOptions("Legacy/Zone")).toContain("Legacy/Zone");
    expect(timezoneOptions("Europe/Berlin")).toEqual(base);
  });
});

describe("getSettings", () => {
  it("reads the signed-in user's profile", async () => {
    const { db, recs } = fakeDb({
      respond: () => ({ data: { timezone: "Asia/Jakarta" }, error: null }),
    });
    expect(await getSettings(db)).toEqual({ timezone: "Asia/Jakarta" });
    expect(requireUser).toHaveBeenCalled();
    expect(recs[0]!.table).toBe("profiles");
    expect(recs[0]!.calls).toContainEqual(["select", "timezone"]);
    expect(recs[0]!.calls).toContainEqual(["eq", "user_id", USER.id]);
  });

  it("falls back to defaults when there is no profile row, and throws on a database error", async () => {
    const { db } = fakeDb({ respond: () => ({ data: null, error: null }) });
    expect(await getSettings(db)).toEqual({ timezone: "UTC" });
    const bad = fakeDb({ respond: () => ({ data: null, error: { message: "boom" } }) });
    await expect(getSettings(bad.db)).rejects.toThrow(/boom/);
  });
});

describe("updateSettings", () => {
  it("writes only the timezone column, scoped by user_id", async () => {
    const f = fakeDb();
    serverDb = f.db;
    const res = await updateSettings({ timezone: "Europe/Berlin" });
    expect(res).toEqual({ ok: true });
    expect(requireUser).toHaveBeenCalled();
    const rec = f.recs[0]!;
    expect(rec.table).toBe("profiles");
    expect(rec.calls).toContainEqual(["update", { timezone: "Europe/Berlin" }]);
    expect(rec.calls).toContainEqual(["eq", "user_id", USER.id]);
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("refuses an unknown timezone and writes nothing", async () => {
    const f = fakeDb();
    serverDb = f.db;
    const res = await updateSettings({ timezone: "Mars/Base" });
    expect(res).toEqual({ ok: false, error: "invalid_timezone" });
    expect(f.recs).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("throws when the database fails or no profile row was updated", async () => {
    serverDb = fakeDb({ respond: () => ({ data: null, error: { message: "denied" } }) }).db;
    await expect(updateSettings({ timezone: "UTC" })).rejects.toThrow(/denied/);
    serverDb = fakeDb({ respond: () => ({ data: [], error: null }) }).db;
    await expect(updateSettings({ timezone: "UTC" })).rejects.toThrow();
  });
});

describe("submitUpdateSettings (form)", () => {
  it("saves the timezone and redirects with saved=1", async () => {
    const f = fakeDb();
    serverDb = f.db;
    const to = await redirected(submitUpdateSettings(form({ timezone: "Asia/Jakarta" })));
    expect(to).toBe("/settings?saved=1");
    expect(f.recs[0]!.calls).toContainEqual(["update", { timezone: "Asia/Jakarta" }]);
  });

  it("redirects with the error and writes nothing for a bad timezone", async () => {
    const f = fakeDb();
    serverDb = f.db;
    const to = await redirected(submitUpdateSettings(form({ timezone: "Mars/Base" })));
    expect(to).toBe("/settings?error=invalid_timezone");
    expect(f.recs).toHaveLength(0);
  });
});

describe("deleteAccount", () => {
  it("requires the exact, case-sensitive word DELETE and does nothing otherwise", async () => {
    for (const bad of ["", "delete", "Delete", " DELETE", "DELETE ", "DELETED"]) {
      const f = fakeDb();
      serverDb = f.db;
      expect(await deleteAccount({ confirmation: bad })).toEqual({ ok: false, error: "confirmation_mismatch" });
      expect(f.order).toEqual([]);
    }
    expect(requireUser).toHaveBeenCalled();
  });

  it("calls the RPC, then signs out, then redirects to /?deleted=1", async () => {
    const f = fakeDb();
    serverDb = f.db;
    const to = await redirected(deleteAccount({ confirmation: "DELETE" }));
    expect(to).toBe("/?deleted=1");
    expect(f.order).toEqual(["rpc:delete_my_account", "signOut"]);
  });

  it("throws and does not sign out when the RPC fails", async () => {
    const f = fakeDb({ rpc: { data: null, error: { message: "rpc failed" } } });
    serverDb = f.db;
    await expect(deleteAccount({ confirmation: "DELETE" })).rejects.toThrow(/rpc failed/);
    expect(f.order).toEqual(["rpc:delete_my_account"]);
  });

  it("form entry point redirects to the error on mismatch, and deletes on DELETE", async () => {
    let f = fakeDb();
    serverDb = f.db;
    expect(await redirected(submitDeleteAccount(form({ confirmation: "nope" })))).toBe("/settings?error=confirmation");
    expect(f.order).toEqual([]);
    f = fakeDb();
    serverDb = f.db;
    expect(await redirected(submitDeleteAccount(form({ confirmation: "DELETE" })))).toBe("/?deleted=1");
    expect(f.order).toEqual(["rpc:delete_my_account", "signOut"]);
    f = fakeDb();
    serverDb = f.db;
    expect(await redirected(submitDeleteAccount(new FormData()))).toBe("/settings?error=confirmation");
  });
});
