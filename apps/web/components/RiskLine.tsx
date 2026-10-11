import type { RiskLevel } from "@saf/core";
import { ExternalLink } from "./ExternalLink";
import { RiskBadge } from "./RiskBadge";
import { detail } from "@/lib/copy";
import { safeHttpUrl } from "@/lib/view";

/**
 * The risk badge with the project's official checker links beside it (spec §7). Only http(s) claim URLs are shown,
 * always labelled "Checker official (belum verified)"; a non-linkable claim URL hides the label entirely.
 */
export function RiskLine({
  level,
  links,
  testId,
}: {
  level: RiskLevel | null;
  links: { url: string; kind: string }[];
  testId: string;
}) {
  const claimLinks = links.filter((l) => l.kind === "claim" && safeHttpUrl(l.url) !== null);
  return (
    <div className="badges" data-testid={testId}>
      <RiskBadge level={level} />
      {claimLinks.map((l) => (
        <span key={l.url} className="claim-link">
          <ExternalLink href={l.url} title={new URL(safeHttpUrl(l.url)!).hostname}>
            {detail.officialChecker}
          </ExternalLink>
        </span>
      ))}
    </div>
  );
}
