// On-demand wallet activity for one of the signed-in user's wallets. The user is verified with requireUser(), the
// wallet is looked up by id AND user id (RLS is the second barrier), and the cache is reached only through the
// get_wallet_check / save_wallet_check RPCs. Wallet addresses are never logged.
import type { ActivitySummary, ChainAdapter } from "@saf/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "./auth";
import { chainIdFromName } from "./chains/config";
import { parseSummary, serializeSummary } from "./activity-summary";
import { isUuid } from "./watchlist";

export const CACHE_TTL_MS = 6 * 3_600_000;
/** A cached result stamped slightly in the future (clock skew between servers) still counts as fresh. */
export const CLOCK_SKEW_MS = 60_000;
export const RATE_LIMIT_WINDOW_MS = 60 * 60_000;
export const RATE_LIMIT_MAX = 10;

export type WalletActivityResult =
  | { kind: "ok"; summary: ActivitySummary; cached: boolean }
  | { kind: "rate_limited" }
  | { kind: "unavailable" }
  | { kind: "chain_not_supported" }
  | { kind: "not_owner" };

function throwIf(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`Failed to ${what}: ${error.message}`);
}

export async function getWalletActivity(
  db: SupabaseClient,
  adapter: ChainAdapter,
  walletId: string,
  chainName: string,
  now: Date,
): Promise<WalletActivityResult> {
  const user = await requireUser();

  // 1. Ownership: the wallet must be one of this user's own.
  if (!isUuid(walletId)) return { kind: "not_owner" };
  const owned = await db.from("wallets").select("id,address").eq("id", walletId).eq("user_id", user.id).maybeSingle();
  throwIf(owned.error, "load the wallet");
  const address = (owned.data as { address?: unknown } | null)?.address;
  if (typeof address !== "string") return { kind: "not_owner" };

  // 2. Chain.
  const chain = chainIdFromName(chainName);
  if (chain === null || !adapter.chains.includes(chain)) return { kind: "chain_not_supported" };

  // 3. Cache (6 hours). A hit is not a request: it neither counts toward the limit nor is blocked by it.
  const cache = await db.rpc("get_wallet_check", { p_wallet_id: walletId, p_chain: chain });
  throwIf(cache.error, "read the wallet check cache");
  const row = (Array.isArray(cache.data) ? cache.data[0] : cache.data) as { result?: unknown; checked_at?: unknown } | null | undefined;
  if (row && typeof row.checked_at === "string") {
    const age = now.getTime() - Date.parse(row.checked_at);
    const cachedSummary = parseSummary(row.result);
    if (cachedSummary && age >= -CLOCK_SKEW_MS && age < CACHE_TTL_MS) return { kind: "ok", summary: cachedSummary, cached: true };
  }

  // 4. Rate limit: 10 requests per user in the last 60 minutes.
  const since = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS).toISOString();
  const recent = await db
    .from("wallet_check_requests")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", since);
  throwIf(recent.error, "count recent wallet checks");
  if ((recent.count ?? 0) >= RATE_LIMIT_MAX) return { kind: "rate_limited" };

  // 5. Log the request first (a failing provider still costs a request), then ask the provider.
  const logged = await db.from("wallet_check_requests").insert({ user_id: user.id });
  throwIf(logged.error, "record the wallet check");

  let summary: ActivitySummary;
  try {
    summary = await adapter.getActivity(address, chain);
  } catch {
    return { kind: "unavailable" };
  }

  // 6. Cache it. A failed save only costs a later refetch, so the fresh result is still returned.
  await db.rpc("save_wallet_check", { p_wallet_id: walletId, p_chain: chain, p_result: serializeSummary(summary) });
  return { kind: "ok", summary, cached: false };
}
