import { ui } from "@/lib/copy";

export type WorthLevel = "high" | "medium" | "low";

const TEXT: Record<WorthLevel, string> = ui.worth;

/** The worth-it verdict: orange fill (high), white with black outline (medium), plain grey text (low). */
export function WorthBadge({ level }: { level: WorthLevel }) {
  return (
    <span className="ui-worth" data-level={level}>
      {TEXT[level]}
    </span>
  );
}
