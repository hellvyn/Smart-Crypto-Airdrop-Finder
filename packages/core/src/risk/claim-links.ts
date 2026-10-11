// Claim link checks (curation spec §15.2, #42). A claim page is what phishing imitates, so a link only counts as
// official when its registrable domain equals one of the project's official domains (never a name or substring match).
import { domainMatches } from "../curate/domain-match.js";

/** `link_checks.status`. A `phishing` link is never rendered as a link; `different_domain` is shown with a warning. */
export type LinkCheckStatus = "official" | "different_domain" | "phishing" | "unchecked";

/** A claim/app link of a project with its check status, as `RiskInput.claimLinks` takes it. */
export interface ClaimLink {
  url: string;
  status: LinkCheckStatus;
}

/**
 * The status of one claim/app link. `phishing` is the GoPlus answer for the link's domain (null = not checked: the
 * request failed, or the GoPlus budget or breaker skipped it).
 *
 * - `phishing === true` → `phishing`, on an official domain too;
 * - `phishing === null` → `unchecked`, on an official domain too: a link that was not checked is never shown as clean;
 * - host is an official domain or a subdomain of one (same registrable domain, see `domainMatches`) → `official`;
 * - otherwise `different_domain`.
 */
export function classifyLink(url: string, officialDomains: string[], phishing: boolean | null): LinkCheckStatus {
  if (phishing === true) return "phishing";
  if (phishing === null) return "unchecked";
  return domainMatches(officialDomains, url) ? "official" : "different_domain";
}
