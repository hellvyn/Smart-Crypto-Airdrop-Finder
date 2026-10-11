// USD prices of a farmed project's token for "Hasil garapan" (#51). Server-side only: actions.ts and farming.ts call
// it, never a client component. The token is keyed by the CoinGecko id the pipeline stores in project_signals
// (`coingecko_listed`, value { gecko_id }).
//
// 1. CoinGecko Demo, only when the server env COINGECKO_API_KEY is set (header x-cg-demo-api-key; never in a URL,
//    never a NEXT_PUBLIC_ name, so it cannot reach the browser bundle).
// 2. DefiLlama's keyless coins API (coin key "coingecko:{id}") when there is no key or CoinGecko fails.
// Any error, non-200 (429 included), missing coin or unexpected shape of both gives null; nothing here throws or logs.
// Answers are cached by Next's data cache (only 200 answers are stored): 24 hours for a past day, 1 hour for now.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const COINGECKO = "https://api.coingecko.com/api/v3";
const DEFILLAMA = "https://coins.llama.fi";
const DAY_SECONDS = 86_400;
const HOUR_SECONDS = 3_600;
const TIMEOUT_MS = 5_000;

/** CoinGecko ids are lowercase slugs ("astra-swap"); anything else never reaches a URL. */
const GECKO_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const positive = z.number().finite().positive();
const geckoHistory = z.object({ market_data: z.object({ current_price: z.object({ usd: positive }) }) });
const geckoSimple = z.record(z.string(), z.object({ usd: positive }));
const llamaCoins = z.object({ coins: z.record(z.string(), z.object({ price: positive })) });

/**
 * Base URL of the DefiLlama coins API. PRICES_API_BASE may point it at a stub on this machine (the e2e does); any
 * other value is ignored, so a misconfigured env cannot send requests elsewhere.
 */
function defillamaBase(): string {
  const override = process.env.PRICES_API_BASE;
  if (!override) return DEFILLAMA;
  try {
    const url = new URL(override);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (url.protocol === "http:" && loopback && url.username === "" && url.password === "") return url.origin;
  } catch {
    // Not a URL: fall through to the real API.
  }
  return DEFILLAMA;
}

/** The parsed JSON of a 200 answer, or null. */
async function getJson(url: string, revalidate: number, headers: Record<string, string> = {}): Promise<unknown> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json", ...headers },
      next: { revalidate },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status !== 200) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function geckoKey(): string | null {
  const key = process.env.COINGECKO_API_KEY;
  return key ? key : null;
}

/** "2026-10-07" as a UTC midnight Date, or null when it is not a real calendar day. */
function utcDay(day: string): Date | null {
  const m = DAY.exec(day);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return date.toISOString().slice(0, 10) === day ? date : null;
}

async function llamaPrice(path: string, geckoId: string, revalidate: number): Promise<number | null> {
  const coin = `coingecko:${geckoId}`;
  const parsed = llamaCoins.safeParse(await getJson(`${defillamaBase()}${path}/${coin}`, revalidate));
  return parsed.success ? (parsed.data.coins[coin]?.price ?? null) : null;
}

/** USD price of the token on `day` (YYYY-MM-DD, at 00:00 UTC), or null. */
export async function priceOn(geckoId: string, day: string): Promise<number | null> {
  const date = utcDay(day);
  if (!GECKO_ID.test(geckoId) || !date) return null;
  const key = geckoKey();
  if (key) {
    const [y, m, d] = day.split("-");
    const parsed = geckoHistory.safeParse(
      await getJson(`${COINGECKO}/coins/${geckoId}/history?date=${d}-${m}-${y}&localization=false`, DAY_SECONDS, {
        "x-cg-demo-api-key": key,
      }),
    );
    if (parsed.success) return parsed.data.market_data.current_price.usd;
  }
  return llamaPrice(`/prices/historical/${date.getTime() / 1000}`, geckoId, DAY_SECONDS);
}

/** Current USD price of the token, or null. */
export async function priceNow(geckoId: string): Promise<number | null> {
  if (!GECKO_ID.test(geckoId)) return null;
  const key = geckoKey();
  if (key) {
    const parsed = geckoSimple.safeParse(
      await getJson(`${COINGECKO}/simple/price?ids=${geckoId}&vs_currencies=usd`, HOUR_SECONDS, { "x-cg-demo-api-key": key }),
    );
    const usd = parsed.success ? parsed.data[geckoId]?.usd : undefined;
    if (usd !== undefined) return usd;
  }
  return llamaPrice("/prices/current", geckoId, HOUR_SECONDS);
}

/** The CoinGecko id of the project's verified `coingecko_listed` signal, or null (also when the read fails). */
export async function geckoIdFor(db: SupabaseClient, projectId: string): Promise<string | null> {
  const { data, error } = await db
    .from("project_signals")
    .select("value")
    .eq("project_id", projectId)
    .eq("kind", "coingecko_listed")
    .eq("verified", true)
    .order("observed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const id = (data as { value?: { gecko_id?: unknown } | null }).value?.gecko_id;
  return typeof id === "string" && GECKO_ID.test(id) ? id : null;
}
