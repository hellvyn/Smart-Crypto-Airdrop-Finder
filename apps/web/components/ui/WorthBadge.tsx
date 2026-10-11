import type { WorthLevel } from "@saf/core";
import { ui } from "@/lib/copy";

export type { WorthLevel } from "@saf/core";

const TEXT: Record<WorthLevel, string> = ui.worth;

/**
 * The worth-it verdict: orange fill (high), white with black outline (medium), plain grey text (low and
 * insufficient data, "Data belum cukup").
 */
export function WorthBadge({ level }: { level: WorthLevel }) {
  return (
    <span className="ui-worth" data-level={level}>
      {TEXT[level]}
    </span>
  );
}
