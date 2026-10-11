"use client";

import { useState } from "react";
import type { WalletActivityView } from "./WalletActivity";
import { WalletActivity } from "./WalletActivity";
import { parseSummary } from "@/lib/activity-summary";
import { walletActivity as copy } from "@/lib/copy";

// Longer than the server ever needs: the provider calls run in two sequential rounds (counters, then both transaction
// lists in parallel), each capped at 10 s, plus the database round trips.
const CLIENT_TIMEOUT_MS = 35_000;
const KINDS = ["rate_limited", "unavailable", "chain_not_supported", "not_owner"] as const;

async function check(walletId: string, chain: string): Promise<WalletActivityView> {
  try {
    const res = await fetch("/api/wallet-activity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ walletId, chain }),
      signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
    });
    if (res.status === 401) return { kind: "signed_out" };
    const body = (await res.json()) as { kind?: unknown; summary?: unknown; cached?: unknown };
    if (res.status === 200 && body.kind === "ok") {
      const summary = parseSummary(body.summary);
      if (summary) return { kind: "ok", summary, cached: body.cached === true };
    }
    const kind = KINDS.find((k) => k === body.kind);
    if (kind) return { kind };
  } catch {
    // Network or parse failure: fall through.
  }
  return { kind: "unavailable" };
}

/** "Cek aktivitas wallet di <Chain>" for one wallet; posts to the API and shows the outcome. */
export function WalletActivityCheck({
  walletId,
  walletName,
  chain,
  chainLabel,
}: {
  walletId: string;
  walletName: string;
  chain: string;
  chainLabel: string;
}) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<WalletActivityView | null>(null);

  async function onClick() {
    setPending(true);
    setResult(await check(walletId, chain));
    setPending(false);
  }

  return (
    <div className="wallet-check" data-testid="wallet-check">
      <button type="button" data-tone="primary" onClick={onClick} disabled={pending} aria-label={copy.checkFor(chainLabel, walletName)}>
        {pending ? copy.checking : copy.check(chainLabel)}
      </button>{" "}
      <code>{walletName}</code>
      <div aria-live="polite">{result ? <WalletActivity result={result} chainLabel={chainLabel} /> : null}</div>
    </div>
  );
}
