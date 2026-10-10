import type { ActivitySummary } from "@saf/core";

/** What the card can show: the server's result kinds, plus a signed-out response from the API. */
export type WalletActivityView =
  | { kind: "ok"; summary: ActivitySummary; cached: boolean }
  | { kind: "rate_limited" }
  | { kind: "unavailable" }
  | { kind: "chain_not_supported" }
  | { kind: "not_owner" }
  | { kind: "signed_out" };

const day = (d: Date) => d.toISOString().slice(0, 10);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The outcome of a wallet activity check. A failed check is never shown as zero activity. */
export function WalletActivity({ result, chainLabel }: { result: WalletActivityView; chainLabel: string }) {
  switch (result.kind) {
    case "ok": {
      const s = result.summary;
      if (s.txCount === 0) return <p>No activity on {chainLabel}</p>;
      const months = `${s.activeMonths.value}${s.activeMonths.exact ? "" : "+"}`;
      return (
        <p>
          {`Wallet activity on ${chainLabel}: ${plural(s.txCount, "transaction")}` +
            (s.firstTxAt ? `, first ${day(s.firstTxAt)}` : "") +
            (s.lastTxAt ? `, last ${day(s.lastTxAt)}` : "") +
            `, active ${months} ${s.activeMonths.value === 1 && s.activeMonths.exact ? "month" : "months"}`}
          {result.cached ? <span className="muted"> (checked within the last 6 hours)</span> : null}
        </p>
      );
    }
    case "rate_limited":
      return <p role="alert">You&apos;ve reached 10 checks per hour. Try again later.</p>;
    case "chain_not_supported":
      return <p>Chain not supported yet.</p>;
    case "not_owner":
      return <p role="alert">That wallet isn&apos;t in your list.</p>;
    case "signed_out":
      return <p role="alert">Sign in to check wallet activity.</p>;
    case "unavailable":
      return <p role="alert">Data unavailable, try again later.</p>;
  }
}
