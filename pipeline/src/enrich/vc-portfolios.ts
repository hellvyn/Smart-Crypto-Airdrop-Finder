// VC portfolio cross-check (curation spec §5.2, §9): the registrable domains linked from each VC's portfolio page,
// cached weekly in `vc_portfolios`. Only domains are kept, never the page text (spec §8).
import * as cheerio from "cheerio";
import { registrableDomain } from "@saf/core";
import type { Http } from "../collectors/types.js";
import type { VcConfig } from "../config.js";
import type { VcIndex } from "../steps/signals.js";
import type { PipelineRepo } from "../store/repo.js";

const DAY_MS = 86_400_000;
/** A cache up to this old is used without fetching the page again. */
const REFRESH_AFTER_MS = 7 * DAY_MS;
/** When a refresh fails, a cache up to this old is still used; an older one leaves the VC "not checked". */
const STALE_LIMIT_MS = 14 * DAY_MS;

/**
 * Registrable domains a portfolio page links to that are not portfolio companies: social networks, video and
 * podcast hosts, code hosts, hiring boards, link pages and sites that list or rate many projects. Their subdomains
 * are left out too.
 */
const NON_PORTFOLIO_DOMAINS: readonly string[] = [
  // Social networks, video, podcasts, blogs and code hosts.
  "x.com",
  "twitter.com",
  "t.me",
  "telegram.me",
  "discord.gg",
  "discord.com",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "threads.net",
  "reddit.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "spotify.com",
  "apple.com",
  "medium.com",
  "substack.com",
  "mirror.xyz",
  "warpcast.com",
  "farcaster.xyz",
  "github.com",
  // Hiring boards.
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "getro.com",
  "workable.com",
  // Link pages, forms and shorteners.
  "linktr.ee",
  "google.com",
  "forms.gle",
  "bit.ly",
  "t.co",
  "notion.site",
  "notion.so",
  // Aggregators and data sites.
  "crunchbase.com",
  "pitchbook.com",
  "coingecko.com",
  "coinmarketcap.com",
  "defillama.com",
  "llama.fi",
  "messari.io",
  "rootdata.com",
  "cryptorank.io",
  "dune.com",
  "airdrops.io",
  "alphadrops.net",
  // Sister sites of a VC in VC_LIST that its portfolio page links to (a16z crypto: a16z.com).
  "a16z.com",
];

const isNonPortfolio = (domain: string): boolean =>
  NON_PORTFOLIO_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));

/**
 * The registrable domains of every outbound `<a href>` on a VC's portfolio page (relative links resolve against
 * `vc.portfolioUrl`), each once, in page order. Links to the VC's own registrable domain, to the social, hiring and
 * aggregator hosts above, non-http(s) links and hosts without a registrable domain (IP addresses) are left out. The
 * page structure does not matter: a page rendered by JavaScript, with no links in its HTML, gives nothing.
 */
export function parsePortfolioDomains(html: string, vc: VcConfig): string[] {
  const own = registrableDomain(vc.portfolioUrl);
  const $ = cheerio.load(html);
  const domains = new Set<string>();
  $("a[href]").each((_, el) => {
    let url: URL;
    try {
      url = new URL($(el).attr("href") ?? "", vc.portfolioUrl);
    } catch {
      return;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return;
    const domain = registrableDomain(url.href);
    if (domain === null || domain === own || isNonPortfolio(domain)) return;
    domains.add(domain);
  });
  return [...domains];
}

/** Domains of the VC's page as fetched now; null when the page did not answer 200 or has no portfolio link. */
async function fetchPortfolio(http: Http, vc: VcConfig): Promise<string[] | null> {
  const res = await http.get(vc.portfolioUrl);
  if (res.status !== 200) return null;
  const domains = parsePortfolioDomains(res.body, vc);
  // An empty result is a changed or JavaScript-only page, never "no portfolio": it must not replace a good cache.
  return domains.length > 0 ? domains : null;
}

/**
 * The portfolio domains to use for one VC this run, or null when it is "not checked". Adds the VC to `failed` when
 * its page had to be fetched and gave nothing usable.
 */
async function portfolioOf(
  deps: { http: Http; repo: PipelineRepo },
  vc: VcConfig,
  now: Date,
  failed: Set<string>,
): Promise<string[] | null> {
  const cache = await deps.repo.listVcPortfolio(vc.id);
  const age = cache.fetchedAt === null ? Infinity : now.getTime() - cache.fetchedAt.getTime();
  if (age <= REFRESH_AFTER_MS) return cache.domains;
  const fresh = await fetchPortfolio(deps.http, vc);
  if (fresh === null) {
    failed.add(vc.id);
    return age <= STALE_LIMIT_MS ? cache.domains : null;
  }
  try {
    await deps.repo.saveVcPortfolio(vc.id, fresh, now);
  } catch {
    // The fetched domains still count for this run; the old (or emptied) cache makes the next run fetch again.
  }
  return fresh;
}

/**
 * Loads the portfolio of every VC in `list` (one at a time): from the `vc_portfolios` cache when it is at most 7
 * days old, otherwise from the VC's page, which then replaces the cache. When the page fails (not 200, or no
 * portfolio link), the cache is used if it is at most 14 days old; an older or missing cache leaves the VC "not
 * checked" (spec §9). Failed fetches, and VCs whose cache could not be read, are in `failed`; VCs whose portfolio
 * is used this run are in `checked`. Never throws for a single VC.
 */
export async function refreshPortfolios(
  deps: { http: Http; repo: PipelineRepo },
  list: VcConfig[],
  now: Date,
): Promise<VcIndex> {
  const index: VcIndex = { byDomain: new Map(), checked: new Set(), failed: new Set() };
  for (const vc of list) {
    let domains: string[] | null;
    try {
      domains = await portfolioOf(deps, vc, now, index.failed);
    } catch {
      index.failed.add(vc.id);
      domains = null;
    }
    if (domains === null) continue;
    index.checked.add(vc.id);
    for (const domain of domains) {
      const entries = index.byDomain.get(domain) ?? [];
      entries.push({ vcId: vc.id, name: vc.name, tier: vc.tier });
      index.byDomain.set(domain, entries);
    }
  }
  return index;
}
