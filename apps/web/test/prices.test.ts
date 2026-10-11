import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { geckoIdFor, priceNow, priceOn } from "../lib/prices";

// Prices: CoinGecko Demo first when the server has COINGECKO_API_KEY, DefiLlama's keyless coins API as the fallback
// (coin key "coingecko:{id}"). Every failure of both is a null price, never an exception.

const KEY = "CG-test-key-not-real";
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("PRICES_API_BASE", "");
  vi.stubEnv("COINGECKO_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** CoinGecko /coins/{id}/history, trimmed to the fields around the one we read (the confirmed live shape). */
const geckoHistory = (usd: unknown) =>
  json({ id: "astra-swap", symbol: "astra", name: "Astra", market_data: { current_price: { usd, eur: 0.3 }, market_cap: { usd: 1 } } });
/** CoinGecko /simple/price. */
const geckoSimple = (usd: unknown) => json({ "astra-swap": { usd } });
/** DefiLlama /prices/{historical/<ts>|current}/coingecko:{id}. */
const llama = (price: unknown, key = "coingecko:astra-swap") =>
  json({ coins: { [key]: { symbol: "ASTRA", price, timestamp: 1791331200, confidence: 0.99 } } });

type Init = RequestInit & { next?: { revalidate?: number } };
const call = (i: number): { url: string; init: Init } => {
  const [url, init] = fetchMock.mock.calls[i]!;
  return { url: String(url), init: (init ?? {}) as Init };
};
const urls = (): string[] => fetchMock.mock.calls.map((c) => String(c[0]));

const GECKO_HISTORY = "https://api.coingecko.com/api/v3/coins/astra-swap/history?date=07-10-2026&localization=false";
const GECKO_SIMPLE = "https://api.coingecko.com/api/v3/simple/price?ids=astra-swap&vs_currencies=usd";
const LLAMA_HISTORY = "https://coins.llama.fi/prices/historical/1791331200/coingecko:astra-swap";
const LLAMA_NOW = "https://coins.llama.fi/prices/current/coingecko:astra-swap";

describe("priceOn", () => {
  it("with the key: CoinGecko Demo history, key in the header only, cached for 24 hours", async () => {
    vi.stubEnv("COINGECKO_API_KEY", KEY);
    fetchMock.mockResolvedValue(geckoHistory(0.3296));
    expect(await priceOn("astra-swap", "2026-10-07")).toBe(0.3296);
    expect(urls()).toEqual([GECKO_HISTORY]);
    const { init } = call(0);
    expect(new Headers(init.headers).get("x-cg-demo-api-key")).toBe(KEY);
    expect(init.next?.revalidate).toBe(86_400);
  });

  it("CoinGecko 429 falls back to DefiLlama at 00:00 UTC of the day, also cached for 24 hours", async () => {
    vi.stubEnv("COINGECKO_API_KEY", KEY);
    fetchMock.mockResolvedValueOnce(json({ status: { error_code: 429 } }, 429)).mockResolvedValueOnce(llama(0.31));
    expect(await priceOn("astra-swap", "2026-10-07")).toBe(0.31);
    expect(urls()).toEqual([GECKO_HISTORY, LLAMA_HISTORY]);
    expect(call(1).init.next?.revalidate).toBe(86_400);
    expect(new Headers(call(1).init.headers).get("x-cg-demo-api-key")).toBeNull();
  });

  it("CoinGecko's bad shape (no market data that day), 500 or failed request also falls back", async () => {
    vi.stubEnv("COINGECKO_API_KEY", KEY);
    for (const gecko of [json({ id: "astra-swap", name: "Astra" }), geckoHistory("0.33"), json({}, 500)]) {
      fetchMock.mockReset().mockResolvedValueOnce(gecko).mockResolvedValueOnce(llama(0.31));
      expect(await priceOn("astra-swap", "2026-10-07")).toBe(0.31);
    }
    fetchMock.mockReset().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(llama(0.31));
    expect(await priceOn("astra-swap", "2026-10-07")).toBe(0.31);
  });

  it("without a key asks DefiLlama only", async () => {
    fetchMock.mockResolvedValue(llama(0.3296));
    expect(await priceOn("astra-swap", "2026-10-07")).toBe(0.3296);
    expect(urls()).toEqual([LLAMA_HISTORY]);
  });

  it("returns null without throwing when both fail (429s, a missing coin, a bad shape, no JSON)", async () => {
    vi.stubEnv("COINGECKO_API_KEY", KEY);
    fetchMock.mockResolvedValueOnce(json({}, 429)).mockResolvedValueOnce(json({}, 429));
    await expect(priceOn("astra-swap", "2026-10-07")).resolves.toBeNull();
    for (const llamaAnswer of [
      json({ coins: {} }),
      llama(2, "coingecko:other-coin"),
      llama("0.33"),
      llama(0),
      llama(-1),
      json([1, 2, 3]),
      new Response("<html>blocked</html>", { status: 200 }),
    ]) {
      fetchMock.mockReset().mockResolvedValueOnce(geckoHistory(null)).mockResolvedValueOnce(llamaAnswer);
      expect(await priceOn("astra-swap", "2026-10-07")).toBeNull();
    }
    fetchMock.mockReset().mockRejectedValue(new TypeError("fetch failed"));
    expect(await priceOn("astra-swap", "2026-10-07")).toBeNull();
  });

  it("refuses a malformed id or day without a request", async () => {
    vi.stubEnv("COINGECKO_API_KEY", KEY);
    expect(await priceOn("../../admin", "2026-10-07")).toBeNull();
    expect(await priceOn("astra-swap", "2026-13-40")).toBeNull();
    expect(await priceOn("astra-swap", "2026-02-30")).toBeNull();
    expect(await priceOn("astra-swap", "07-10-2026")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("priceNow", () => {
  it("with the key: CoinGecko simple price, cached for 1 hour", async () => {
    vi.stubEnv("COINGECKO_API_KEY", KEY);
    fetchMock.mockResolvedValue(geckoSimple(0.304));
    expect(await priceNow("astra-swap")).toBe(0.304);
    expect(urls()).toEqual([GECKO_SIMPLE]);
    expect(new Headers(call(0).init.headers).get("x-cg-demo-api-key")).toBe(KEY);
    expect(call(0).init.next?.revalidate).toBe(3_600);
  });

  it("CoinGecko 429 falls back to DefiLlama's current price, cached for 1 hour", async () => {
    vi.stubEnv("COINGECKO_API_KEY", KEY);
    fetchMock.mockResolvedValueOnce(json({}, 429)).mockResolvedValueOnce(llama(0.3));
    expect(await priceNow("astra-swap")).toBe(0.3);
    expect(urls()).toEqual([GECKO_SIMPLE, LLAMA_NOW]);
    expect(call(1).init.next?.revalidate).toBe(3_600);
  });

  it("without a key asks DefiLlama only; null when it fails too", async () => {
    fetchMock.mockResolvedValueOnce(llama(0.3));
    expect(await priceNow("astra-swap")).toBe(0.3);
    expect(urls()).toEqual([LLAMA_NOW]);
    fetchMock.mockReset().mockResolvedValueOnce(json({ coins: {} }));
    expect(await priceNow("astra-swap")).toBeNull();
    fetchMock.mockReset().mockRejectedValueOnce(new Error("socket hang up"));
    expect(await priceNow("astra-swap")).toBeNull();
  });

  it("CoinGecko answering for another coin falls back", async () => {
    vi.stubEnv("COINGECKO_API_KEY", KEY);
    fetchMock.mockResolvedValueOnce(json({ "other-coin": { usd: 9 } })).mockResolvedValueOnce(llama(0.3));
    expect(await priceNow("astra-swap")).toBe(0.3);
  });
});

describe("the key", () => {
  it("never appears in any URL, whichever provider answers", async () => {
    vi.stubEnv("COINGECKO_API_KEY", KEY);
    fetchMock.mockImplementation(async () => json({}, 429));
    await priceOn("astra-swap", "2026-10-07");
    await priceNow("astra-swap");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const url of urls()) expect(url).not.toContain(KEY);
  });
});

describe("DefiLlama base (e2e seam)", () => {
  it("uses a loopback PRICES_API_BASE, so the e2e can answer from a local stub", async () => {
    vi.stubEnv("PRICES_API_BASE", "http://127.0.0.1:3101");
    fetchMock.mockResolvedValue(llama(2));
    expect(await priceNow("astra-swap")).toBe(2);
    expect(urls()).toEqual(["http://127.0.0.1:3101/prices/current/coingecko:astra-swap"]);
  });

  it("ignores a PRICES_API_BASE that is not loopback", async () => {
    for (const base of ["https://evil.example", "http://127.0.0.1.evil.example", "http://localhost@evil.example"]) {
      vi.stubEnv("PRICES_API_BASE", base);
      fetchMock.mockReset().mockResolvedValue(llama(2));
      await priceNow("astra-swap");
      expect(urls()).toEqual([LLAMA_NOW]);
    }
  });
});

describe("geckoIdFor", () => {
  const PID = "22222222-2222-4222-8222-222222222222";

  /** A fake query builder recording its calls and answering `result` from maybeSingle. */
  function signalsDb(result: { data: unknown; error: { message: string } | null }) {
    const calls: unknown[][] = [];
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit"]) {
      b[m] = (...args: unknown[]) => {
        calls.push([m, ...args]);
        return b;
      };
    }
    b.maybeSingle = () => Promise.resolve(result);
    const db = {
      from: (table: string) => {
        calls.push(["from", table]);
        return b;
      },
    } as unknown as SupabaseClient;
    return { db, calls };
  }

  it("reads the CoinGecko id of the project's verified coingecko_listed signal", async () => {
    const { db, calls } = signalsDb({ data: { value: { gecko_id: "astra-swap" } }, error: null });
    expect(await geckoIdFor(db, PID)).toBe("astra-swap");
    expect(calls).toContainEqual(["from", "project_signals"]);
    expect(calls).toContainEqual(["eq", "project_id", PID]);
    expect(calls).toContainEqual(["eq", "kind", "coingecko_listed"]);
    expect(calls).toContainEqual(["eq", "verified", true]);
  });

  it("returns null without a signal, with a malformed id, or when the read fails", async () => {
    expect(await geckoIdFor(signalsDb({ data: null, error: null }).db, PID)).toBeNull();
    expect(await geckoIdFor(signalsDb({ data: { value: { gecko_id: "a/b?c" } }, error: null }).db, PID)).toBeNull();
    expect(await geckoIdFor(signalsDb({ data: { value: {} }, error: null }).db, PID)).toBeNull();
    expect(await geckoIdFor(signalsDb({ data: null, error: { message: "boom" } }).db, PID)).toBeNull();
  });
});
