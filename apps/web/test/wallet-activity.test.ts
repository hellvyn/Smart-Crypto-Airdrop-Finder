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
  /** Requests in the current hour; claim_wallet_check() succeeds while it is below 10 (atomically). */
  requestCount: number;
  rpcError: boolean;
  claimError: boolean;
}

function fakeDb(world: World) {
  const log: { kind: string; name: string; args: unknown }[] = [];
  const db = {
    from(table: string) {
      // The request log is only reached through claim_wallet_check(): a direct count/insert is a race.
      if (table !== "wallets") throw new Error(`unexpected direct access to ${table}`);
      const filters: Record<string, unknown> = {};
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = (col: string, v: unknown) => {
        filters[col] = v;
        return b;
      };
      b.maybeSingle = async () => {
        log.push({ kind: "select", name: table, args: filters });
        if (table !== "wallets") return { data: null, error: null };
        const id = String(filters.id);
        const mine = filters.user_id === USER.id && id in world.wallets;
        return { data: mine ? { id, address: world.wallets[id] } : null, error: null };
      };
      return b;
    },
    rpc(name: string, args?: unknown) {
      log.push({ kind: "rpc", name, args });
      if (name === "claim_wallet_check") {
        if (world.claimError) return Promise.resolve({ data: null, error: { message: "boom", code: "XX000" } });
        // Atomic like the SQL function (advisory lock + count + insert in one transaction).
        const ok = world.requestCount < 10;
        if (ok) world.requestCount += 1;
        return Promise.resolve({ data: ok, error: null });
      }
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
  world = { wallets: { [WID]: ADDR }, cache: null, requestCount: 0, rpcError: false, claimError: false };
});

describe("getWalletActivity", () => {
  it("fetches, saves with ISO dates through the RPC, records the request, and returns the summary", async () => {
    const { db, log } = fakeDb(world);
    const { adapter, getActivity } = fakeAdapter(async () => {
      log.push({ kind: "adapter", name: "getActivity", args: null });
      return SUMMARY;
    });
    const r = await getWalletActivity(db, adapter, WID, "Ethereum", NOW);
    expect(r).toEqual({ kind: "ok", summary: SUMMARY, cached: false });
    expect(getActivity).toHaveBeenCalledWith(ADDR, "ethereum");

    const save = log.find((l) => l.kind === "rpc" && l.name === "save_wallet_check");
    expect(save?.args).toEqual({ p_wallet_id: WID, p_chain: "ethereum", p_result: stored(SUMMARY) });
    expect(world.requestCount).toBe(1);
    // The request is claimed (and recorded) BEFORE the provider is called, and the result is saved after it.
    const order = log.map((l) => `${l.kind}:${l.name}`);
    expect(order.indexOf("adapter:getActivity")).toBeGreaterThan(-1);
    expect(order.indexOf("rpc:claim_wallet_check")).toBeGreaterThan(-1);
    expect(order.indexOf("rpc:claim_wallet_check")).toBeLessThan(order.indexOf("adapter:getActivity"));
    expect(order.indexOf("adapter:getActivity")).toBeLessThan(order.indexOf("rpc:save_wallet_check"));
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
    expect(log.some((l) => l.name === "claim_wallet_check")).toBe(false);
    expect(log.some((l) => l.name === "save_wallet_check")).toBe(false);
  });

  it("a cache hit is served even when the user is at the rate limit", async () => {
    world.cache = { result: stored(SUMMARY), checked_at: hoursAgo(1).toISOString() };
    world.requestCount = 50;
    const { db } = fakeDb(world);
    const r = await getWalletActivity(db, fakeAdapter().adapter, WID, "ethereum", NOW);
    expect(r).toMatchObject({ kind: "ok", cached: true });
  });

  it("treats a result stamped up to 60 s in the future (clock skew) as fresh, but not minutes ahead", async () => {
    const skewed = new Date(NOW.getTime() + 30_000).toISOString();
    world.cache = { result: stored(SUMMARY), checked_at: skewed };
    const a = fakeAdapter();
    expect(await getWalletActivity(fakeDb(world).db, a.adapter, WID, "ethereum", NOW)).toMatchObject({ kind: "ok", cached: true });
    expect(a.getActivity).not.toHaveBeenCalled();

    world.cache = { result: stored(SUMMARY), checked_at: new Date(NOW.getTime() + 5 * 60_000).toISOString() };
    const b = fakeAdapter();
    await getWalletActivity(fakeDb(world).db, b.adapter, WID, "ethereum", NOW);
    expect(b.getActivity).toHaveBeenCalledTimes(1);
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
    expect(world.requestCount).toBe(10);
    // The claim takes no arguments: the database decides the user (auth.uid()) and the window.
    expect(log.find((l) => l.name === "claim_wallet_check")?.args).toBeUndefined();
  });

  it("parallel requests cannot overshoot the limit: 15 at once reach the provider only 10 times", async () => {
    world.requestCount = 0;
    const { db } = fakeDb(world);
    const { adapter, getActivity } = fakeAdapter();
    const results = await Promise.all(
      Array.from({ length: 15 }, () => getWalletActivity(db, adapter, WID, "ethereum", NOW)),
    );
    expect(getActivity).toHaveBeenCalledTimes(10);
    expect(results.filter((r) => r.kind === "rate_limited")).toHaveLength(5);
  });

  it("a failing claim RPC is an error, and the provider is not called", async () => {
    world.claimError = true;
    const { db } = fakeDb(world);
    const { adapter, getActivity } = fakeAdapter();
    await expect(getWalletActivity(db, adapter, WID, "ethereum", NOW)).rejects.toThrow(/wallet check/);
    expect(getActivity).not.toHaveBeenCalled();
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
    expect(log.some((l) => l.kind === "rpc")).toBe(false);
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
