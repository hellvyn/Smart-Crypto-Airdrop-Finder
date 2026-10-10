import type { Status } from "@saf/core";
import { statusLabel } from "@/lib/view";

/** Airdrop status as words. An unknown status is shown as "Unconfirmed". */
export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`badge status-${status}`} data-testid="status-badge" data-status={status}>
      <span className="badge-kind">Status</span> <span className="badge-value">{statusLabel(status)}</span>
    </span>
  );
}
