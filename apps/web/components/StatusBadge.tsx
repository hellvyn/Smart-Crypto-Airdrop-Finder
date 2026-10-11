import type { Status } from "@saf/core";
import { labels } from "@/lib/copy";
import { statusLabel } from "@/lib/view";

/** Airdrop status as words. An unknown status is shown as "Belum pasti". */
export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`badge status-${status}`} data-testid="status-badge" data-status={status}>
      <span className="badge-kind">{labels.statusBadge}</span> <span className="badge-value">{statusLabel(status)}</span>
    </span>
  );
}
