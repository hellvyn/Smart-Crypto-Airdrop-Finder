import { ExternalLink } from "../ExternalLink";
import { HazardBlock } from "./HazardBlock";
import { Tag, type TagTone } from "./Tag";

export type LinkStatusValue = "official" | "different_domain" | "phishing" | "unchecked";

const LABELS: Record<Exclude<LinkStatusValue, "phishing">, { tone: TagTone; text: string }> = {
  official: { tone: "verified", text: "✓ Official domain" },
  different_domain: { tone: "warn", text: "⚠ Beda domain dari web official" },
  unchecked: { tone: "plain", text: "Belum dicek" },
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
 * printed at all: the row shows only a hazard block.
 */
export function LinkStatus({ status, url }: { status: LinkStatusValue; url: string }) {
  if (status === "phishing") {
    return (
      <HazardBlock>
        <b className="ui-link-hidden">Link di-hide: kedeteksi phishing</b>
        <span>Kalau link ini nongol di grup atau DM, jangan dibuka.</span>
      </HazardBlock>
    );
  }
  const label = LABELS[status];
  return (
    <span className="ui-link-status">
      <ExternalLink href={url}>{displayUrl(url)}</ExternalLink>
      <Tag tone={label.tone}>{label.text}</Tag>
    </span>
  );
}
