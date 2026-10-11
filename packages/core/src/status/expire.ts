import type { DatePrecision, DeadlineKind, Status } from "../types.js";

export interface ExpireDeadline {
  kind: DeadlineKind;
  date: string | null;
  precision: DatePrecision;
}

export interface ExpireResult {
  status: Status;
  expired: boolean;
  /** The latest passed `claim` / `campaign_end` deadline that caused the expiry; null when not expired. */
  basis: { kind: DeadlineKind; date: string } | null;
}

const EXPIRABLE: readonly Status[] = ["live", "announced", "speculative"];
/** A passed deadline of these kinds ends the airdrop. */
const ENDING_KINDS: readonly DeadlineKind[] = ["claim", "campaign_end"];
/** A deadline of these kinds that is still ahead (or today) keeps the airdrop open. */
const HOLDING_KINDS: readonly DeadlineKind[] = ["claim", "snapshot", "campaign_end", "tge"];

/**
 * Status becomes `ended` when a claim / campaign_end deadline has passed and no claim, snapshot, campaign_end or tge
 * deadline is left on or after `today` (`YYYY-MM-DD`, UTC). Only exact/approximate dates count: a deadline without a
 * date, or with month/quarter precision, neither expires nor holds. Pure: the caller stores the result.
 */
export function expireStatus(status: Status, deadlines: readonly ExpireDeadline[], today: string): ExpireResult {
  const unchanged: ExpireResult = { status, expired: false, basis: null };
  if (!EXPIRABLE.includes(status)) return unchanged;

  const dated = deadlines.flatMap((d) =>
    d.date !== null && (d.precision === "exact" || d.precision === "approximate")
      ? [{ kind: d.kind, date: d.date }]
      : [],
  );
  if (dated.some((d) => HOLDING_KINDS.includes(d.kind) && d.date >= today)) return unchanged;

  let basis: ExpireResult["basis"] = null;
  for (const d of dated) {
    if (ENDING_KINDS.includes(d.kind) && d.date < today && (basis === null || d.date > basis.date)) basis = d;
  }
  return basis === null ? unchanged : { status: "ended", expired: true, basis };
}
