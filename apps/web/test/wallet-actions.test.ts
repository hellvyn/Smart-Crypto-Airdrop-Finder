import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUser = vi.fn();
const revalidatePath = vi.fn();
const redirect = vi.fn();
let serverDb: SupabaseClient;

vi.mock("@/lib/auth", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => serverDb }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock("next/navigation", () => ({
  redirect: (p: string) => {
    redirect(p);
    throw new Error("NEXT_REDIRECT");
  },
}));

import { addWallet, deleteWallet, submitAddWallet, submitDeleteWallet } from "../app/(app)/wallets/actions";
import { listWallets, shortAddress } from "../lib/wallets";

const USER = { id: "11111111-1111-4111-8111-111111111111" };
const WID = "33333333-3333-4333-8333-333333333333";
// A checksum-cased address (mixed case) and its lowercase form.
const CHECKSUM = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const LOWER = CHECKSUM.toLowerCase();

type Call = [method: string, ...args: unknown[]];
type Result = { data: unknown; error: { message: string; code?: string } | null };
interface Recorded {
  table: string;
  calls: Call[];
}

/** Fake PostgREST builder: records calls and resolves (thenable) to `respond(rec)`. */
function fakeDb(respond: (rec: Recorded) => Result = () => ({ data: null, error: null })) {
  const recs: Recorded[] = [];
  const db = {
    from(table: string) {
      const rec: Recorded = { table, calls: [] };
      recs.push(rec);
      const b: Record<string, unknown> = {};
      for (const m of ["select", "insert", "delete", "eq", "order"]) {
        b[m] = (...args: unknown[]) => {
          rec.calls.push([m, ...args]);
          return b;
        };
      }
      b.then = (res: (r: Result) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(respond(rec)).then(res, rej);
      return b;
    },
  };
  return { db: db as unknown as SupabaseClient, recs };
}

const insertedRow = (recs: Recorded[]) => (recs[0]!.calls.find((c) => c[0] === "insert") as Call)[1] as Record<string, unknown>;

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue(USER);
  revalidatePath.mockReset();
  redirect.mockReset();
});

describe("addWallet", () => {
  it("stores a checksum-cased address as lowercase for the signed-in user", async () => {
    const { db, recs } = fakeDb();
    serverDb = db;
    expect(await addWallet({ address: CHECKSUM })).toEqual({ ok: true });
    expect(recs[0]!.table).toBe("wallets");
    expect(insertedRow(recs)).toEqual({ user_id: USER.id, address: LOWER, chain_family: "evm", label: null });
    expect(revalidatePath).toHaveBeenCalledWith("/wallets");
  });

  it("trims the address before validating and storing it", async () => {
    const { db, recs } = fakeDb();
    serverDb = db;
    expect(await addWallet({ address: `  ${CHECKSUM}\n` })).toEqual({ ok: true });
    expect(insertedRow(recs).address).toBe(LOWER);
  });

  it("adding the same address again in lowercase is reported as duplicate", async () => {
    const stored = new Set<string>();
    const { db } = fakeDb((rec) => {
      const row = (rec.calls.find((c) => c[0] === "insert") as Call)[1] as { address: string };
      if (stored.has(row.address)) {
        return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "wallets_user_id_address_key"' } };
      }
      stored.add(row.address);
      return { data: null, error: null };
    });
    serverDb = db;
    expect(await addWallet({ address: CHECKSUM })).toEqual({ ok: true });
    expect(await addWallet({ address: LOWER })).toEqual({ ok: false, error: "duplicate" });
  });

  it("rejects invalid addresses without touching the database", async () => {
    const { db, recs } = fakeDb();
    serverDb = db;
    for (const bad of ["0x123", "", "   ", "5aaeb6053f3e94c9b9a09f33669435e7ef1beaed", `${CHECKSUM}00`, "0xZZAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"]) {
      expect(await addWallet({ address: bad })).toEqual({ ok: false, error: "invalid_address" });
    }
    expect(recs).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("trims the label, and an empty label is stored as null", async () => {
    const { db, recs } = fakeDb();
    serverDb = db;
    await addWallet({ address: LOWER, label: "  Main  " });
    expect(insertedRow(recs).label).toBe("Main");
    await addWallet({ address: LOWER, label: "   " });
    expect(insertedRow(recs.slice(1)).label).toBeNull();
  });

  it("rejects labels over 64 characters but accepts exactly 64", async () => {
    const { db, recs } = fakeDb();
    serverDb = db;
    expect(await addWallet({ address: LOWER, label: "x".repeat(65) })).toEqual({ ok: false, error: "invalid_label" });
    expect(recs).toHaveLength(0);
    expect(await addWallet({ address: LOWER, label: "x".repeat(64) })).toEqual({ ok: true });
  });

  it("maps the wallet-limit trigger error to limit_reached", async () => {
    const { db } = fakeDb(() => ({ data: null, error: { code: "23514", message: "wallet limit reached (20)" } }));
    serverDb = db;
    expect(await addWallet({ address: LOWER })).toEqual({ ok: false, error: "limit_reached" });
  });

  it("maps a label check-constraint violation to invalid_label", async () => {
    const { db } = fakeDb(() => ({
      data: null,
      error: { code: "23514", message: 'new row for relation "wallets" violates check constraint "wallets_label_check"' },
    }));
    serverDb = db;
    expect(await addWallet({ address: LOWER })).toEqual({ ok: false, error: "invalid_label" });
  });

  it("throws on other database errors", async () => {
    const { db } = fakeDb(() => ({ data: null, error: { code: "XX000", message: "boom" } }));
    serverDb = db;
    await expect(addWallet({ address: LOWER })).rejects.toThrow(/boom/);
  });

  it("requires a signed-in user before anything else", async () => {
    const { db, recs } = fakeDb();
    serverDb = db;
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(addWallet({ address: LOWER })).rejects.toThrow("NEXT_REDIRECT");
    expect(recs).toHaveLength(0);
  });
});

describe("deleteWallet", () => {
  it("rejects a non-UUID id without touching the database", async () => {
    const { db, recs } = fakeDb();
    serverDb = db;
    await expect(deleteWallet("nope")).rejects.toThrow(/invalid wallet/i);
    await expect(deleteWallet("")).rejects.toThrow(/invalid wallet/i);
    expect(recs).toHaveLength(0);
  });

  it("deletes only this user's wallet with that id", async () => {
    const { db, recs } = fakeDb();
    serverDb = db;
    await deleteWallet(WID);
    const calls = recs[0]!.calls;
    expect(recs[0]!.table).toBe("wallets");
    expect(calls[0]).toEqual(["delete"]);
    expect(calls).toContainEqual(["eq", "id", WID]);
    expect(calls).toContainEqual(["eq", "user_id", USER.id]);
    expect(revalidatePath).toHaveBeenCalledWith("/wallets");
  });

  it("is not an error when nothing was deleted", async () => {
    const { db } = fakeDb(() => ({ data: [], error: null }));
    serverDb = db;
    await expect(deleteWallet(WID)).resolves.toBeUndefined();
  });

  it("requires a signed-in user", async () => {
    const { db, recs } = fakeDb();
    serverDb = db;
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(deleteWallet(WID)).rejects.toThrow("NEXT_REDIRECT");
    expect(recs).toHaveLength(0);
  });

  it("surfaces database errors", async () => {
    const { db } = fakeDb(() => ({ data: null, error: { message: "boom" } }));
    serverDb = db;
    await expect(deleteWallet(WID)).rejects.toThrow(/boom/);
  });
});

describe("form entry points", () => {
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  it("submitAddWallet redirects back to /wallets with the error code", async () => {
    const { db } = fakeDb();
    serverDb = db;
    await expect(submitAddWallet(form({ address: "0x123", label: "" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/wallets?error=invalid_address");
  });

  it("submitAddWallet redirects to a clean /wallets on success", async () => {
    const { db } = fakeDb();
    serverDb = db;
    await expect(submitAddWallet(form({ address: CHECKSUM, label: "Main" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/wallets");
  });

  it("submitDeleteWallet deletes by the posted id and redirects", async () => {
    const { db, recs } = fakeDb();
    serverDb = db;
    await expect(submitDeleteWallet(form({ id: WID }))).rejects.toThrow("NEXT_REDIRECT");
    expect(recs[0]!.calls).toContainEqual(["eq", "id", WID]);
    expect(redirect).toHaveBeenCalledWith("/wallets");
  });

  it("submitDeleteWallet rejects a missing or malformed id", async () => {
    const { db, recs } = fakeDb();
    serverDb = db;
    await expect(submitDeleteWallet(form({}))).rejects.toThrow(/invalid wallet/i);
    await expect(submitDeleteWallet(form({ id: "x" }))).rejects.toThrow(/invalid wallet/i);
    expect(recs).toHaveLength(0);
  });
});

describe("listWallets", () => {
  it("requires a user and reads only this user's wallets, ordered by address", async () => {
    const { db, recs } = fakeDb(() => ({ data: [{ id: WID, address: LOWER, label: "Main" }], error: null }));
    expect(await listWallets(db)).toEqual([{ id: WID, address: LOWER, label: "Main" }]);
    expect(requireUser).toHaveBeenCalled();
    expect(recs[0]!.table).toBe("wallets");
    expect(recs[0]!.calls).toContainEqual(["eq", "user_id", USER.id]);
  });
});

describe("shortAddress", () => {
  it("shortens to 0x1234…abcd", () => {
    expect(shortAddress(LOWER)).toBe("0x5aae…eaed");
  });
});
