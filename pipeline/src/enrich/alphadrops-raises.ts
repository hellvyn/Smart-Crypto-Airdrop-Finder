// AlphaDrops fundraising data (#41, curation spec §15.1): `llms-full.txt` chooses which `/raises/<slug>` pages to
// read, and the rounds of those pages are cached in `alphadrops_raises`. What AlphaDrops reports is never verified:
// it becomes a `reported_backer` ("Menurut AlphaDrops") only when the page's official website matches the project's
// domain (the `signals` stage).
import * as cheerio from "cheerio";
import { cleanUrl, normalizeName, registrableDomain } from "@saf/core";
import type { Http } from "../collectors/types.js";
import type { DailyStats } from "../stats.js";
import type { AlphaRaises } from "../steps/signals.js";
import type { PipelineRepo, ProjectForScoring } from "../store/repo.js";

const ORIGIN = "https://alphadrops.net";
const LLMS_FULL_URL = `${ORIGIN}/llms-full.txt`;
const DAY_MS = 86_400_000;
/** A cached raise page up to this old is used without fetching it again. */
const REFRESH_AFTER_MS = 7 * DAY_MS;

/** One funding round of a raise page. `date` is `YYYY-MM-DD`; amounts are in US dollars. */
export interface RaiseRound {
  round: string;
  date: string | null;
  amountUsd: number | null;
  lead: string[];
  others: string[];
  /** The round's "Announcement Source" link, referral parts removed. */
  sourceUrl: string | null;
}

export interface RaisePage {
  /** Registrable domain of the page's "Official Website" link; null when there is none. */
  officialDomain: string | null;
  rounds: RaiseRound[];
}

const FUNDRAISING_HEADING = /^## All tracked fundraising projects\b/;
/** `- <name>[ — <amount> raised][ (investors: …)]: https://alphadrops.net/raises/<slug>` */
const RAISE_LINE = /^- (.+): https:\/\/(?:www\.)?alphadrops\.net\/raises\/([^\s/?#]+)\/?$/;

/**
 * Name and slug of every entry in the "All tracked fundraising projects" section of `llms-full.txt`, in file order.
 * The amount and investors on the line are left out: only the raise page is used for data.
 */
export function parseRaiseIndex(llmsFull: string): { name: string; slug: string }[] {
  const entries: { name: string; slug: string }[] = [];
  let inSection = false;
  for (const raw of llmsFull.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("## ")) {
      inSection = FUNDRAISING_HEADING.test(line);
      continue;
    }
    const match = inSection ? RAISE_LINE.exec(line) : null;
    if (!match?.[1] || !match[2]) continue;
    const name = (match[1].split(" — ")[0] ?? "").replace(/\s*\(investors: .*\)$/, "").trim();
    let slug: string;
    try {
      slug = decodeURIComponent(match[2]);
    } catch {
      continue;
    }
    if (name !== "") entries.push({ name, slug });
  }
  return entries;
}

const clean = (text: string): string => text.replace(/\s+/g, " ").trim();

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DATE_TEXT = /^([A-Za-z]{3,9})\.? (\d{1,2}), (\d{4})$/;

/** `Oct 8, 2026` or `March 3, 2025` as `YYYY-MM-DD`; null for anything else. */
function isoDate(text: string): string | null {
  const match = DATE_TEXT.exec(text);
  if (!match?.[1]) return null;
  const month = MONTHS.indexOf(match[1].slice(0, 3).toLowerCase());
  const day = Number(match[2]);
  const date = new Date(Date.UTC(Number(match[3]), month, day));
  if (month < 0 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

const AMOUNT_TEXT = /^\$\s?(\d[\d,]*(?:\.\d+)?)\s?([KMB])?$/i;
const UNIT: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9 };

/** `$30M`, `$1.25B`, `$750K` or `$1,500,000` in dollars; null for anything else (`TBA`, `Undisclosed`). */
function amountUsd(text: string): number | null {
  const match = AMOUNT_TEXT.exec(text);
  if (!match?.[1]) return null;
  return Math.round(Number(match[1].replace(/,/g, "")) * (UNIT[(match[2] ?? "").toUpperCase()] ?? 1));
}

/** An http(s) link as given, referral parts removed; null for any other link. */
function cleanHttpUrl(href: string | undefined): string | null {
  if (href === undefined || !/^https?:\/\//i.test(href.trim())) return null;
  try {
    return cleanUrl(href.trim()).url;
  } catch {
    return null;
  }
}

/**
 * The official website's registrable domain and the funding rounds of an AlphaDrops raise page (`/raises/<slug>`).
 * Each `h3` under "Funding Rounds History" starts a round; its card is the largest element around it that holds no
 * other round. In a card: the first date text, the first dollar amount (the valuation line is not one), the names
 * under "Lead Investors" and "Other Investors", and the "Announcement Source" link. A page without that section has
 * no rounds.
 */
export function parseRaisePage(html: string): RaisePage {
  const $ = cheerio.load(html);
  // Ads link elsewhere (sponsored links, as on the detail pages): never the project's website.
  $("script,style,noscript,svg,[rel~='sponsored']").remove();

  const website = $("a[href]")
    .filter((_, el) => clean($(el).text()) === "Official Website")
    .first()
    .attr("href");
  const websiteUrl = cleanHttpUrl(website);
  const officialDomain = websiteUrl === null ? null : registrableDomain(websiteUrl);

  const heading = $("h2").filter((_, el) => clean($(el).text()) === "Funding Rounds History").first();
  if (heading.length === 0) return { officialDomain, rounds: [] };
  const section = heading.closest("section").length > 0 ? heading.closest("section") : heading.parent();

  const rounds = section
    .find("h3")
    .toArray()
    .map((h3): RaiseRound => {
      let card = $(h3);
      while (card.parent().length > 0 && !card.parent().is(section) && card.parent().find("h3").length === 1) {
        card = card.parent();
      }
      /** The names in the element after the label `<p>` ("Lead Investors"), one per child element. */
      const investorsAfter = (label: string): string[] =>
        card
          .find("p")
          .filter((_, el) => clean($(el).text()) === label)
          .first()
          .next()
          .children()
          .toArray()
          .map((el) => clean($(el).text()))
          .filter((name) => name !== "");
      const texts = card
        .find("p")
        .toArray()
        .map((el) => clean($(el).text()));
      const date = texts.map(isoDate).find((d) => d !== null) ?? null;
      const amount = texts.map(amountUsd).find((a) => a !== null) ?? null;
      const source = card
        .find("a[href]")
        .filter((_, el) => clean($(el).text()) === "Announcement Source")
        .first()
        .attr("href");
      return {
        round: clean($(h3).text()),
        date,
        amountUsd: amount,
        lead: investorsAfter("Lead Investors"),
        others: investorsAfter("Other Investors"),
        sourceUrl: cleanHttpUrl(source),
      };
    });
  return { officialDomain, rounds };
}

const isAlphaDropsUrl = (url: string): boolean => {
  try {
    const host = new URL(url).hostname;
    return host === "alphadrops.net" || host.endsWith(".alphadrops.net");
  } catch {
    return false;
  }
};

/**
 * `http` with a count of the requests it sent to alphadrops.net (or a subdomain), so the `signals` stage knows how
 * much of the run's AlphaDrops request budget the collector left.
 */
export function countAlphaDropsRequests(http: Http): { http: Http; count: () => number } {
  let count = 0;
  const tally = (url: string): void => {
    if (isAlphaDropsUrl(url)) count += 1;
  };
  return {
    http: {
      get: (url) => (tally(url), http.get(url)),
      resolveRedirect: (url) => (tally(url), http.resolveRedirect(url)),
    },
    count: () => count,
  };
}

/** A fetched raise page with at least one round; null (counted in `raises_failed`) for anything else. */
async function fetchRaise(http: Http, slug: string): Promise<{ page: RaisePage | null; stop: boolean }> {
  const res = await http.get(`${ORIGIN}/raises/${encodeURIComponent(slug)}`);
  // A broken connection or rate limiting: asking for more pages now would not help.
  if (res.status === 0 || res.status === 429) return { page: null, stop: true };
  const page = res.status === 200 ? parseRaisePage(res.body) : null;
  return { page: page !== null && page.rounds.length > 0 ? page : null, stop: false };
}

/**
 * The AlphaDrops raise pages of this run's projects, for `reported_backer`. Reads `llms-full.txt` once; a project
 * with an official domain whose normalized name equals that of a fundraising entry gets that entry's page (the name
 * only chooses the page: the signal needs a domain match). A page cached at most 7 days ago is used as it is; the
 * others are fetched one at a time, `delayMs` after the previous AlphaDrops request, pages never cached first, then
 * the oldest, at most `maxPages` and never more than `maxRequests` requests in all (`llms-full.txt` included). A
 * fetched page with rounds replaces the cache.
 *
 * Returns null ("not checked" for every project) when there is no request budget or `llms-full.txt` gives no entry.
 * A project with a page that is neither fresh in the cache nor fetched this run (not reached, failed, or stale) is in
 * `unchecked`. A broken connection or HTTP 429 stops the fetching for this run.
 */
export async function loadRaises(
  deps: { http: Http; repo: PipelineRepo; sleep: (ms: number) => Promise<void> },
  projects: ProjectForScoring[],
  opts: { maxPages: number; maxRequests: number; delayMs: number },
  now: Date,
  stats: DailyStats,
): Promise<AlphaRaises | null> {
  if (opts.maxRequests < 1) return null;
  await deps.sleep(opts.delayMs);
  const res = await deps.http.get(LLMS_FULL_URL);
  const index = res.status === 200 ? parseRaiseIndex(res.body) : [];
  if (index.length === 0) {
    stats.raises_failed += 1;
    return null;
  }

  const slugsByName = new Map<string, string[]>();
  for (const entry of index) {
    const key = normalizeName(entry.name);
    if (key !== "") slugsByName.set(key, [...(slugsByName.get(key) ?? []), entry.slug]);
  }
  const candidates = new Map<string, string[]>();
  for (const project of projects) {
    if (project.officialDomains.length === 0) continue;
    const slugs = slugsByName.get(normalizeName(project.name));
    if (slugs !== undefined) candidates.set(project.id, slugs);
  }

  // Slugs come from AlphaDrops: without a prototype, "__proto__" is a key like any other.
  const pages: Record<string, RaisePage> = Object.create(null) as Record<string, RaisePage>;
  const missing: string[] = [];
  const stale: { slug: string; fetchedAt: Date }[] = [];
  for (const slug of new Set([...candidates.values()].flat())) {
    let cached: (RaisePage & { fetchedAt: Date }) | null = null;
    try {
      cached = await deps.repo.listAlphaRaise(slug);
    } catch {
      // An unreadable cache entry is fetched again, as if there were none.
    }
    if (cached === null) missing.push(slug);
    else if (now.getTime() - cached.fetchedAt.getTime() <= REFRESH_AFTER_MS) {
      pages[slug] = { officialDomain: cached.officialDomain, rounds: cached.rounds };
    } else stale.push({ slug, fetchedAt: cached.fetchedAt });
  }
  stale.sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime());

  const budget = Math.max(0, Math.min(opts.maxPages, opts.maxRequests - 1));
  for (const slug of [...missing, ...stale.map((s) => s.slug)].slice(0, budget)) {
    await deps.sleep(opts.delayMs);
    const { page, stop } = await fetchRaise(deps.http, slug);
    if (page === null) {
      stats.raises_failed += 1;
      if (stop) break;
      continue;
    }
    pages[slug] = page;
    stats.raises_fetched += 1;
    try {
      await deps.repo.saveAlphaRaise(slug, page, now);
    } catch {
      // The page still counts for this run; without a cache the next run fetches it again.
    }
  }

  const unchecked = new Set<string>();
  for (const [projectId, slugs] of candidates) {
    if (slugs.some((slug) => pages[slug] === undefined)) unchecked.add(projectId);
  }
  return { pages, unchecked };
}
