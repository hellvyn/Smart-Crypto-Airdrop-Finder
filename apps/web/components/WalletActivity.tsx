import type { ActivitySummary } from "@saf/core";
import { walletActivity as copy } from "@/lib/copy";

/** What the card can show: the server's result kinds, plus a signed-out response from the API. */
export type WalletActivityView =
  | { kind: "ok"; summary: ActivitySummary; cached: boolean }
  | { kind: "rate_limited" }
  | { kind: "unavailable" }
  | { kind: "chain_not_supported" }
  | { kind: "not_owner" }
  | { kind: "signed_out" };

const day = (d: Date) => d.toISOString().slice(0, 10);

/** The outcome of a wallet activity check. A failed check is never shown as zero activity. */
export function WalletActivity({ result, chainLabel }: { result: WalletActivityView; chainLabel: string }) {
  switch (result.kind) {
    case "ok": {
      const s = result.summary;
      if (s.txCount === 0) return <p>{copy.none(chainLabel)}</p>;
      return (
        <p>
          {copy.summary({
            chain: chainLabel,
            txCount: s.txCount,
            first: s.firstTxAt ? day(s.firstTxAt) : null,
            last: s.lastTxAt ? day(s.lastTxAt) : null,
            months: `${s.activeMonths.value}${s.activeMonths.exact ? "" : "+"}`,
          })}
          {result.cached ? <span className="muted">{copy.cached}</span> : null}
        </p>
      );
    }
    case "rate_limited":
      return <p role="alert">{copy.rateLimited}</p>;
    case "chain_not_supported":
      return <p>{copy.chainNotSupported}</p>;
    case "not_owner":
      return <p role="alert">{copy.notOwner}</p>;
    case "signed_out":
      return <p role="alert">{copy.signedOut}</p>;
    case "unavailable":
      return <p role="alert">{copy.unavailable}</p>;
  }
}
