// Domain matching for verified signals (curation spec §5.2): the anti-scam trust boundary. A signal from an independent
// source (DefiLlama, a VC portfolio) only attaches to a project when the registrable domains are equal; a name match,
// a substring or a shared platform host never counts.
import { registrableDomain } from "../url/domain.js";

/**
 * Registrable domains where many unrelated projects have a page (social networks, link pages, forms, quest boards,
 * blog hosts) or that list other projects (the aggregators). Equal registrable domains there say nothing about who
 * owns the page, so they never match, nor do their subdomains.
 */
const NON_PROJECT_DOMAINS: readonly string[] = [
  // Social networks and code hosts.
  "x.com",
  "twitter.com",
  "t.me",
  "telegram.me",
  "discord.gg",
  "discord.com",
  "youtube.com",
  "github.com",
  // Link pages, forms and quest boards.
  "linktr.ee",
  "google.com",
  "forms.gle",
  "typeform.com",
  "galxe.com",
  "zealy.io",
  "gleam.io",
  "layer3.xyz",
  "bit.ly",
  "t.co",
  // Page and blog hosts whose tenants share the registrable domain.
  "notion.site",
  "notion.so",
  "medium.com",
  "mirror.xyz",
  "substack.com",
  "paragraph.xyz",
  // Aggregators and listing sites.
  "airdrops.io",
  "alphadrops.net",
  "defillama.com",
  "llama.fi",
  "coingecko.com",
  "coinmarketcap.com",
];

function isNonProjectDomain(domain: string): boolean {
  return NON_PROJECT_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Registrable domain of a URL or a bare domain/host (optionally with a path). URLs must be http(s); any other scheme
 * (`mailto:`, `javascript:`) has no domain here.
 */
function registrableOf(urlOrDomain: string): string | null {
  const value = urlOrDomain.trim();
  if (value === "") return null;
  if (SCHEME.test(value)) return /^https?:\/\//i.test(value) ? registrableDomain(value) : null;
  return registrableDomain(`https://${value}`);
}

/**
 * True only when the registrable domain of `candidateUrlOrDomain` equals the registrable domain of one of
 * `projectDomains`. Platform, social and aggregator hosts (and their subdomains) never match, and neither do
 * candidates without a registrable domain (unparseable, IP addresses, localhost). A project without domains never
 * matches.
 */
export function domainMatches(projectDomains: string[], candidateUrlOrDomain: string): boolean {
  const candidate = registrableOf(candidateUrlOrDomain);
  if (candidate === null || isNonProjectDomain(candidate)) return false;
  return projectDomains.some((d) => registrableOf(d) === candidate);
}
