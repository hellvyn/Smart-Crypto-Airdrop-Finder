import type { ActivitySummary, ChainAdapter } from "@saf/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUser = vi.fn();
vi.mock("@/lib/auth", () => ({ requireUser: () => requireUser() }));

import { getWalletActivity } from "../lib/wallet-activity";

const USER = { id: "11111111-1111-4111-8111-111111111111" };
const WID = "33333333-3333-4333-8333-333333333333";
const ADDR = "0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae";
const NOW = new Date("2026-10-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const SUMMARY: ActivitySummary = {
  chain: "ethereum",
  txCount: 142,
  firstTxAt: new Date("2021-03-05T10:00:00Z"),
  lastTxAt: new Date("2026-09-30T23:59:59Z"),
  activeMonths: { value: 12, exact: true },
  source: "blockscout",
  fetchedAt: hoursAgo(1),
};
const stored = (s: ActivitySummary) => ({
  ...s,
  firstTxAt: s.firstTxAt?.toISOString() ?? null,
  lastTxAt: s.lastTxAt?.toISOString() ?? null,
  fetchedAt: s.fetchedAt.toISOString(),
});

interface World {
  /** wallets visible to the user (id -> address); anything else is "not yours". */
  wallets: Record<string, string>;
  cache: { result: unknown; checked_at: string } | null;
  requestCount: number;
  rpcError: boolean;
}

function fakeDb(world: World) {
  const log: { kind: string; name: string; args: unknown }[] = [];
  const db = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let head = false;
      let inserted: unknown;
      const b: Record<string, unknown> = {};
      b.select = (_cols?: string, opts?: { head?: boolean }) => {
        head = Boolean(opts?.head);
        return b;
      };
      b.eq = (col: string, v: unknown) => {
        filters[col] = v;
        return b;
      };
      b.gte = (col: string, v: unknown) => {
        filters[`>=${col}`] = v;
        return b;
      };
      b.insert = (row: unknown) => {
        inserted = row;
        log.push({ kind: "insert", name: table, args: row });
        return b;
      };
      b.maybeSingle = async () => {
        log.push({ kind: "select", name: table, args: filters });
        if (table !== "wallets") return { data: null, error: null };
        const id = String(filters.id);
        const mine = filters.user_id === USER.id && id in world.wallets;
        return { data: mine ? { id, address: world.wallets[id] } : null, error: null };
      };
      b.then = (res: (r: unknown) => unknown, rej: (e: unknown) => unknown) => {
        let out: unknown = { data: null, error: null };
        if (table === "wallet_check_requests" && head) {
          log.push({ kind: "count", name: table, args: filters });
          out = { data: null, count: world.requestCount, error: null };
        } else if (inserted !== undefined) {
          world.requestCount += 1;
        }
        return Promise.resolve(out).then(res, rej);
      };
      return b;
    },
    rpc(name: string, args: unknown) {
      log.push({ kind: "rpc", name, args });
      const out =
        name === "get_wallet_check"
          ? { data: world.cache ? [world.cache] : [], error: null }
          : { data: null, error: world.rpcError ? { message: "boom", code: "XX000" } : null };
      return Promise.resolve(out);
    },
  };
  return { db: db as unknown as SupabaseClient, log };
}

function fakeAdapter(impl: () => Promise<ActivitySummary> = async () => SUMMARY) {
  const getActivity = vi.fn(impl);
  const adapter: ChainAdapter = { family: "evm", chains: ["ethereum"], isValidAddress: () => true, getActivity };
  return { adapter, getActivity };
}

let world: World;
beforeEach(() => {
  requireUser.mockReset().mockResolvedValue(USER);
  world = { wallets: { [WID]: ADDR }, cache: null, requestCount: 0, rpcError: false };
});

describe("getWalletActivity", () => {
  it("fetches, saves with ISO dates through the RPC, records the request, and returns the summary", async () => {
    const { db, log } = fakeDb(world);
    const { adapter, getActivity } = fakeAdapter();
    const r = await getWalletActivity(db, adapter, WID, "Ethereum", NOW);
    expect(r).toEqual({ kind: "ok", summary: SUMMARY, cached: false });
    expect(getActivity).toHaveBeenCalledWith(ADDR, "ethereum");

    const save = log.find((l) => l.kind === "rpc" && l.name === "save_wallet_check");
    expect(save?.args).toEqual({ p_wallet_id: WID, p_chain: "ethereum", p_result: stored(SUMMARY) });
    expect(log.find((l) => l.kind === "insert")?.args).toEqual({ user_id: USER.id });
    // The request is logged before the adapter is called.
    const order = log.map((l) => `${l.kind}:${l.name}`);
    expect(order.indexOf("insert:wallet_check_requests")).toBeLessThan(order.indexOf("rpc:save_wallet_check"));
  });

  it("answers from a 5-hour-old cache without calling the adapter or counting a request", async () => {
    world.cache = { result: stored(SUMMARY), checked_at: hoursAgo(5).toISOString() };
    const { db, log } = fakeDb(world);
    const { adapter, getActivity } = fakeAdapter();
    const r = await getWalletActivity(db, adapter, WID, "ethereum", NOW);
    expect(r).toEqual({ kind: "ok", summary: SUMMARY, cached: true });
    if (r.kind === "ok") {
      expect(r.summary.firstTxAt).toBeInstanceOf(Date);
      expect(r.summary.fetchedAt).toBeInstanceOf(Date);
    }
    expect(getActivity).not.toHaveBeenCalled();
    expect(log.some((l) => l.kind === "insert")).toBe(false);
    expect(log.some((l) => l.name === "save_wallet_check")).toBe(false);
  });

  it("a cache hit is served even when the user is at the rate limit", async () => {
    world.cache = { result: stored(SUMMARY), checked_at: hoursAgo(1).toISOString() };
    world.requestCount = 50;
    const { db } = fakeDb(world);
    const r = await getWalletActivity(db, fakeAdapter().adapter, WID, "ethereum", NOW);
    expect(r).toMatchObject({ kind: "ok", cached: true });
  });

  it("refetches when the cache is 7 hours old", async () => {
    world.cache = { result: stored({ ...SUMMARY, txCount: 1 }), checked_at: hoursAgo(7).toISOString() };
    const { db } = fakeDb(world);
    const { adapter, getActivity } = fakeAdapter();
    const r = await getWalletActivity(db, adapter, WID, "ethereum", NOW);
    expect(getActivity).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ kind: "ok", summary: SUMMARY, cached: false });
  });

  it("refetches when the cached payload is malformed", async () => {
    world.cache = { result: { nonsense: true }, checked_at: hoursAgo(1).toISOString() };
    const { db } = fakeDb(world);
    const { adapter, getActivity } = fakeAdapter();
    await getWalletActivity(db, adapter, WID, "ethereum", NOW);
    expect(getActivity).toHaveBeenCalledTimes(1);
  });

  it("the 11th request within an hour is rate limited and does not call the adapter", async () => {
    world.requestCount = 10;
    const { db, log } = fakeDb(world);
    const { adapter, getActivity } = fakeAdapter();
    expect(await getWalletActivity(db, adapter, WID, "ethereum", NOW)).toEqual({ kind: "rate_limited" });
    expect(getActivity).not.toHaveBeenCalled();
    expect(log.some((l) => l.kind === "insert")).toBe(false);
    // The window is the last 60 minutes, for this user only.
    const count = log.find((l) => l.kind === "count");
    expect(count?.args).toEqual({ user_id: USER.id, ">=created_at": hoursAgo(1).toISOString() });
  });

  it("the 10th request is still allowed", async () => {
    world.requestCount = 9;
    const { db } = fakeDb(world);
    expect(await getWalletActivity(db, fakeAdapter().adapter, WID, "ethereum", NOW)).toMatchObject({ kind: "ok" });
  });

  it("an adapter error is 'unavailable', not cached, but the attempt still counts", async () => {
    const { db, log } = fakeDb(world);
    const { adapter } = fakeAdapter(async () => {
      throw new Error("HTTP 502");
    });
    expect(await getWalletActivity(db, adapter, WID, "ethereum", NOW)).toEqual({ kind: "unavailable" });
    expect(log.some((l) => l.name === "save_wallet_check")).toBe(false);
    expect(world.requestCount).toBe(1);
  });

  it("a chain that is not EVM-supported is chain_not_supported", async () => {
    const { db } = fakeDb(world);
    const { adapter, getActivity } = fakeAdapter();
    expect(await getWalletActivity(db, adapter, WID, "Sui", NOW)).toEqual({ kind: "chain_not_supported" });
    expect(getActivity).not.toHaveBeenCalled();
  });

  it("a wallet id of another user is not_owner (and nothing else is touched)", async () => {
    const other = "44444444-4444-4444-8444-444444444444";
    const { db, log } = fakeDb(world);
    const { adapter, getActivity } = fakeAdapter();
    expect(await getWalletActivity(db, adapter, other, "ethereum", NOW)).toEqual({ kind: "not_owner" });
    expect(getActivity).not.toHaveBeenCalled();
    expect(log.some((l) => l.kind === "rpc" || l.kind === "insert")).toBe(false);
    // The lookup is scoped to the signed-in user.
    expect(log[0]?.args).toMatchObject({ id: other, user_id: USER.id });
  });

  it("an invalid wallet id is not_owner without querying", async () => {
    const { db, log } = fakeDb(world);
    expect(await getWalletActivity(db, fakeAdapter().adapter, "nope", "ethereum", NOW)).toEqual({ kind: "not_owner" });
    expect(log).toHaveLength(0);
  });

  it("still returns the fresh summary when saving the cache fails", async () => {
    world.rpcError = true;
    const { db } = fakeDb(world);
    expect(await getWalletActivity(db, fakeAdapter().adapter, WID, "ethereum", NOW)).toEqual({ kind: "ok", summary: SUMMARY, cached: false });
  });
});
