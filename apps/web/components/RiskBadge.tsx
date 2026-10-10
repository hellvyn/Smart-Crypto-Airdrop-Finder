import type { RiskLevel } from "@saf/core";
import { riskLabel } from "@/lib/view";

/** Risk level as words only. Risk is separate from Status; there is no "safe" level. */
export function RiskBadge({ level }: { level: RiskLevel | null }) {
  return (
    <span className={`badge risk-${level ?? "none"}`} data-testid="risk-badge" data-level={level ?? "none"}>
      <span className="badge-kind">Risk</span> <span className="badge-value">{riskLabel(level)}</span>
    </span>
  );
}
