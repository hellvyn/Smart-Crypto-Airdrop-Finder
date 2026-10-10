// POST /api/wallet-activity  { walletId, chain }  ->  the wallet activity of one of the signed-in user's wallets.
// Signed-out callers get a JSON 401 (never a redirect). Responses are never cached and never contain or log addresses.
import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { BlockscoutAdapter } from "@/lib/chains/evm-blockscout";
import { createServerClient } from "@/lib/supabase/server";
import { serializeSummary } from "@/lib/activity-summary";
import { getWalletActivity } from "@/lib/wallet-activity";

const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  // JSON only: a cross-site <form> cannot send this content type, so it cannot trigger a check on the user's behalf.
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return json({ error: "bad_request" }, 400);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const { walletId, chain } = (body ?? {}) as { walletId?: unknown; chain?: unknown };
  if (typeof walletId !== "string" || typeof chain !== "string" || walletId.length > 64 || chain.length === 0 || chain.length > 64) {
    return json({ error: "bad_request" }, 400);
  }

  try {
    const db = await createServerClient();
    const result = await getWalletActivity(db, new BlockscoutAdapter(fetch), walletId, chain, new Date());
    switch (result.kind) {
      case "ok":
        return json({ kind: "ok", summary: serializeSummary(result.summary), cached: result.cached }, 200);
      case "rate_limited":
        return json({ kind: "rate_limited" }, 429);
      case "unavailable":
        return json({ kind: "unavailable" }, 503);
      case "chain_not_supported":
        return json({ kind: "chain_not_supported" }, 422);
      case "not_owner":
        return json({ kind: "not_owner" }, 404);
    }
  } catch {
    // Database trouble: report it like a provider outage (never as zero activity).
    return json({ kind: "unavailable" }, 503);
  }
}
