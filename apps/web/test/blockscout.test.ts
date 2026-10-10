import { describe, expect, it, vi } from "vitest";
import { chainIdFromName, EVM_CHAINS } from "../lib/chains/config";
import { BlockscoutAdapter } from "../lib/chains/evm-blockscout";

const BASE = "https://eth.blockscout.com";
const ADDR = "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe";
const LOWER = ADDR.toLowerCase();

const ts = (iso: string) => String(Math.floor(Date.parse(iso) / 1000));
const tx = (iso: string) => ({ timeStamp: ts(iso), hash: "0xabc" });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const list = (result: unknown[]) => json({ status: "1", message: "OK", result });
const none = () => json({ status: "0", message: "No transactions found", result: [] });

/** Fake fetch routed by URL; records every call. */
function fakeFetch(routes: { counters: () => Response; asc: () => Response; desc: () => Response }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/counters")) return routes.counters();
    if (url.includes("sort=asc")) return routes.asc();
    if (url.includes("sort=desc")) return routes.desc();
    throw new Error(`unexpected url ${url}`);
  });
  return { fetch: impl as unknown as typeof fetch, calls, impl };
}

describe("chainIdFromName", () => {
  it.each(["Ethereum", "ETH", "ethereum mainnet", "  Mainnet  ", "eth", "ethereum"])("maps %j to ethereum", (name) => {
    expect(chainIdFromName(name)).toBe("ethereum");
  });
  it.each(["Sui", "Solana", "", "base", "ethereum classic"])("maps %j to null", (name) => {
    expect(chainIdFromName(name)).toBeNull();
  });
  it("config starts with Ethereum on eth.blockscout.com", () => {
    expect(EVM_CHAINS).toEqual({ ethereum: { blockscoutBase: BASE } });
  });
});

describe("BlockscoutAdapter", () => {
  it("builds the summary from counters and the asc/desc tx lists", async () => {
    const f = fakeFetch({
      counters: () => json({ transactions_count: "142", token_transfers_count: "9" }),
      asc: () => list([tx("2021-03-05T10:00:00Z")]),
      desc: () => list([tx("2026-09-30T23:59:59Z"), tx("2026-09-01T00:00:00Z"), tx("2026-07-15T12:00:00Z"), tx("2021-03-05T10:00:00Z")]),
    });
    const now = new Date();
    const s = await new BlockscoutAdapter(f.fetch).getActivity(ADDR, "ethereum");
    expect(s.chain).toBe("ethereum");
    expect(s.txCount).toBe(142);
    expect(s.firstTxAt).toEqual(new Date("2021-03-05T10:00:00Z"));
    expect(s.lastTxAt).toEqual(new Date("2026-09-30T23:59:59Z"));
    expect(s.activeMonths).toEqual({ value: 3, exact: true }); // 2026-09, 2026-07, 2021-03
    expect(s.source).toBe("blockscout");
    expect(Math.abs(s.fetchedAt.getTime() - now.getTime())).toBeLessThan(5000);

    expect(f.calls.map((c) => c.url)).toEqual([
      `${BASE}/api/v2/addresses/${LOWER}/counters`,
      `${BASE}/api?module=account&action=txlist&address=${LOWER}&sort=asc&page=1&offset=1`,
      `${BASE}/api?module=account&action=txlist&address=${LOWER}&sort=desc&page=1&offset=1000`,
    ]);
  });

  it("puts a timeout signal on every request", async () => {
    const f = fakeFetch({
      counters: () => json({ transactions_count: "1" }),
      asc: () => list([tx("2022-01-01T00:00:00Z")]),
      desc: () => list([tx("2022-01-01T00:00:00Z")]),
    });
    await new BlockscoutAdapter(f.fetch).getActivity(ADDR, "ethereum");
    expect(f.calls).toHaveLength(3);
    for (const c of f.calls) expect(c.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("counts months in UTC", async () => {
    const f = fakeFetch({
      counters: () => json({ transactions_count: "2" }),
      asc: () => list([tx("2024-01-31T23:30:00Z")]),
      desc: () => list([tx("2024-02-01T00:30:00Z"), tx("2024-01-31T23:30:00Z")]),
    });
    const s = await new BlockscoutAdapter(f.fetch).getActivity(ADDR, "ethereum");
    expect(s.activeMonths).toEqual({ value: 2, exact: true });
  });

  it("marks the month count as not exact when the desc page is full (1000 items)", async () => {
    const page = Array.from({ length: 1000 }, (_, i) => tx(new Date(Date.UTC(2026, 8, 1) - i * 3_600_000).toISOString()));
    const f = fakeFetch({
      counters: () => json({ transactions_count: "5000" }),
      asc: () => list([tx("2019-01-01T00:00:00Z")]),
      desc: () => list(page),
    });
    const s = await new BlockscoutAdapter(f.fetch).getActivity(ADDR, "ethereum");
    expect(s.txCount).toBe(5000);
    expect(s.activeMonths.exact).toBe(false);
    expect(s.activeMonths.value).toBeGreaterThanOrEqual(1);
  });

  it("returns an explicit zero summary for an address without transactions", async () => {
    const f = fakeFetch({ counters: () => json({ transactions_count: "0" }), asc: none, desc: none });
    const s = await new BlockscoutAdapter(f.fetch).getActivity(ADDR, "ethereum");
    expect(s.txCount).toBe(0);
    expect(s.firstTxAt).toBeNull();
    expect(s.lastTxAt).toBeNull();
    expect(s.activeMonths).toEqual({ value: 0, exact: true });
  });

  it("throws on HTTP 502", async () => {
    const f = fakeFetch({ counters: () => json({ message: "bad gateway" }, 502), asc: none, desc: none });
    await expect(new BlockscoutAdapter(f.fetch).getActivity(ADDR, "ethereum")).rejects.toThrow();
  });

  it("throws on an Etherscan-style error status other than 'No transactions found'", async () => {
    const f = fakeFetch({
      counters: () => json({ transactions_count: "3" }),
      asc: () => json({ status: "0", message: "NOTOK", result: "Max rate limit reached" }),
      desc: none,
    });
    await expect(new BlockscoutAdapter(f.fetch).getActivity(ADDR, "ethereum")).rejects.toThrow();
  });

  it.each([null, "", " ", false, "abc", "-1", "1.5", -1, 1.5, {}, undefined])("throws on counter %j instead of reporting zero", async (counter) => {
    const f = fakeFetch({
      counters: () => json({ transactions_count: counter }),
      asc: () => list([tx("2022-01-01T00:00:00Z")]),
      desc: () => list([tx("2022-01-01T00:00:00Z")]),
    });
    await expect(new BlockscoutAdapter(f.fetch).getActivity(ADDR, "ethereum")).rejects.toThrow();
  });

  it("accepts a numeric counter", async () => {
    const f = fakeFetch({
      counters: () => json({ transactions_count: 7 }),
      asc: () => list([tx("2022-01-01T00:00:00Z")]),
      desc: () => list([tx("2022-01-01T00:00:00Z")]),
    });
    expect((await new BlockscoutAdapter(f.fetch).getActivity(ADDR, "ethereum")).txCount).toBe(7);
  });

  it("a lagging counter never shows as no activity: txCount is at least the list length", async () => {
    const f = fakeFetch({
      counters: () => json({ transactions_count: "0" }),
      asc: () => list([tx("2022-01-01T00:00:00Z")]),
      desc: () => list([tx("2022-03-01T00:00:00Z"), tx("2022-02-01T00:00:00Z"), tx("2022-01-01T00:00:00Z")]),
    });
    const s = await new BlockscoutAdapter(f.fetch).getActivity(ADDR, "ethereum");
    expect(s.txCount).toBe(3);
    expect(s.firstTxAt).not.toBeNull();
  });

  it("throws when the lists disagree about having transactions", async () => {
    const ascOnly = fakeFetch({ counters: () => json({ transactions_count: "2" }), asc: () => list([tx("2022-01-01T00:00:00Z")]), desc: none });
    await expect(new BlockscoutAdapter(ascOnly.fetch).getActivity(ADDR, "ethereum")).rejects.toThrow();
    const descOnly = fakeFetch({ counters: () => json({ transactions_count: "2" }), asc: none, desc: () => list([tx("2022-01-01T00:00:00Z")]) });
    await expect(new BlockscoutAdapter(descOnly.fetch).getActivity(ADDR, "ethereum")).rejects.toThrow();
  });

  it("throws when the counter says there are transactions but both lists are empty", async () => {
    const f = fakeFetch({ counters: () => json({ transactions_count: "5" }), asc: none, desc: none });
    await expect(new BlockscoutAdapter(f.fetch).getActivity(ADDR, "ethereum")).rejects.toThrow();
  });

  it("cancels the body of a non-200 response before throwing", async () => {
    const cancel = vi.fn(async () => undefined);
    const bad = { status: 502, body: { cancel }, json: async () => ({}) } as unknown as Response;
    const adapter = new BlockscoutAdapter((async () => bad) as unknown as typeof fetch);
    await expect(adapter.getActivity(ADDR, "ethereum")).rejects.toThrow(/502/);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("throws on a malformed counters body or timestamp", async () => {
    const bad = fakeFetch({ counters: () => json({ foo: 1 }), asc: none, desc: none });
    await expect(new BlockscoutAdapter(bad.fetch).getActivity(ADDR, "ethereum")).rejects.toThrow();
    const badTs = fakeFetch({
      counters: () => json({ transactions_count: "1" }),
      asc: () => list([{ timeStamp: "soon" }]),
      desc: () => list([{ timeStamp: "soon" }]),
    });
    await expect(new BlockscoutAdapter(badTs.fetch).getActivity(ADDR, "ethereum")).rejects.toThrow();
  });

  it("propagates a network failure", async () => {
    const adapter = new BlockscoutAdapter((async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch);
    await expect(adapter.getActivity(ADDR, "ethereum")).rejects.toThrow();
  });

  it("rejects an unsupported chain and an invalid address without fetching", async () => {
    const f = fakeFetch({ counters: none, asc: none, desc: none });
    const adapter = new BlockscoutAdapter(f.fetch);
    await expect(adapter.getActivity(ADDR, "solana")).rejects.toThrow();
    await expect(adapter.getActivity("0x123", "ethereum")).rejects.toThrow();
    expect(f.impl).not.toHaveBeenCalled();
    expect(adapter.family).toBe("evm");
    expect(adapter.chains).toEqual(["ethereum"]);
    expect(adapter.isValidAddress(ADDR)).toBe(true);
  });
});
