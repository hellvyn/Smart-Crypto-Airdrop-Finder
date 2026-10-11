import { ui } from "@/lib/copy";
import { ExternalLink } from "../ExternalLink";
import { HazardBlock } from "./HazardBlock";
import { Tag, type TagTone } from "./Tag";

export type LinkStatusValue = "official" | "different_domain" | "phishing" | "unchecked";

const LABELS: Record<Exclude<LinkStatusValue, "phishing">, { tone: TagTone; text: string }> = {
  official: { tone: "verified", text: ui.linkStatus.official },
  different_domain: { tone: "warn", text: ui.linkStatus.differentDomain },
  unchecked: { tone: "plain", text: ui.linkStatus.unchecked },
};

/** Host plus path for display, so a long query string never fills the row. Falls back to the raw text. */
function displayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.host) return url;
    return parsed.pathname === "/" ? parsed.host : `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/**
 * A claim or app link with its domain check result. A phishing link is never an anchor and its URL is not
 * printed at all: the row shows only a hazard block. A status outside the four known ones reads "Belum dicek".
 */
export function LinkStatus({ status, url }: { status: LinkStatusValue; url: string }) {
  if (status === "phishing") {
    return (
      <HazardBlock>
        <b className="ui-link-hidden">{ui.linkStatus.phishingHidden}</b>
        <span>{ui.linkStatus.phishingWarning}</span>
      </HazardBlock>
    );
  }
  const label = Object.hasOwn(LABELS, status) ? LABELS[status] : LABELS.unchecked;
  return (
    <span className="ui-link-status">
      <ExternalLink href={url}>{displayUrl(url)}</ExternalLink>
      <Tag tone={label.tone}>{label.text}</Tag>
    </span>
  );
}
