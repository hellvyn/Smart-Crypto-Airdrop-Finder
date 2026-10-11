// Official website text for the AI Analyst (owner request 2026-10-11, `official_sites` stage).
//
// A listed project whose sources are only an aggregator line or a DefiLlama listing gets a thin analysis. For the listed
// projects (latest curation passed) with a clean official domain, this stage reads the homepage and at most 2 pages of
// the same domain that look like docs, points, airdrop, rewards, quests or campaign pages, and the AI Analyst gets the
// text as one more source.
//
// The text is untrusted: the project's own marketing, or whatever sits on a domain that may have changed hands. It is
// fetched with `FetchUntrusted` (public hosts only, 10 s, 3 redirects, 1 MB, text types only; nothing is run), turned
// into plain text, and given to the model as data (every analysis prompt marks the SUMBER section so). Its source URL
// is `official-site://<domain>`, which is never the URL of a stored source document, so the web never links it; the
// pages' own URLs are not put in the text either (only their paths), and no link from a page is ever stored.
//
// Storage: the `claim_pages` table (url primary key, text, fetched_at; service role only) with the key
// `official-site://<domain>`, which no claim link can have. One row per domain holds all of its pages, so the 7-day
// refresh and the 14-day use limit are the claim pages' rules. No migration.
import { load } from "cheerio";
import pLimit from "p-limit";
import { registrableDomain } from "@saf/core";
import { isNonProjectHost } from "../collectors/html-text.js";
import type { PipelineConfig } from "../config.js";
import type { FetchUntrusted } from "../http.js";
import type { DailyStats } from "../stats.js";
import type { ClaimPage, PipelineRepo, ProjectForScoring } from "../store/repo.js";
import type { SourceText } from "./analyze.js";
import { claimPageText } from "./link-checks.js";

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** A site fetched at most this long ago is not fetched again. */
const FRESH_MS = 7 * DAY_MS;
/** A cached site that could not be fetched again is still used up to this age (like the claim pages). */
const MAX_AGE_MS = 14 * DAY_MS;
/** Most characters of one page's text that are kept (a prompt carries 24,000 over all its sources). */
const MAX_PAGE_CHARS = 8_000;
/** Pages read after the homepage. */
const MAX_LINKED_PAGES = 2;
const SCHEME = "official-site://";

/** The source URL of a domain's site text: not http(s), so it never matches a source document and is never linked. */
export const officialSiteUrl = (domain: string): string => `${SCHEME}${domain}`;

const FILE_EXTENSION = /\.(pdf|png|jpe?g|gif|svg|webp|ico|zip|gz|mp[34]|mov|css|js|json|xml|txt|csv)$/i;
const POINTS_WORDS = "airdrops?|points?|rewards?|quests?|campaigns?|incentives?|loyalty";
const POINTS_PATH = new RegExp(`(^|[/_-])(${POINTS_WORDS})([/_.-]|$)`, "i");
const POINTS_TEXT = new RegExp(`\\b(${POINTS_WORDS})\\b`, "i");
const DOCS_PATH = /(^|\/)(docs?|documentation|gitbook)([/_.-]|$)/i;
const DOCS_TEXT = /\b(docs?|documentation)\b/i;

/** The link without query and fragment and without a trailing slash, for comparing and for the request. */
function normalizedLink(url: URL): string {
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/**
 * The (at most 2) pages to read after a homepage: links of `html` to http(s) pages of `domain` (its subdomains too,
 * never another registrable domain) whose path or link text names points, airdrop, rewards, quests, campaigns or
 * incentives (best) or docs. Files, the homepage itself, and duplicates (query and fragment dropped) are left out.
 * Better matches first, then document order.
 */
export function pickOfficialPages(html: string, baseUrl: string, domain: string): string[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const self = normalizedLink(base);
  const found = new Map<string, number>();
  const order: string[] = [];
  const $ = load(html);
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")?.trim();
    if (!href) return;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      return;
    }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || registrableDomain(url.href) !== domain) return;
    // Default port only (the URL parser drops :443 on https and :80 on http): no service on a port of its own.
    if (url.port !== "") return;
    if (FILE_EXTENSION.test(url.pathname)) return;
    const link = normalizedLink(url);
    if (link === self) return;
    // The homepage under its other spelling (www.).
    if (url.pathname === "/" && url.hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "")) return;
    const label = $(el).text().replace(/\s+/g, " ").trim();
    const score =
      POINTS_PATH.test(url.pathname) || POINTS_TEXT.test(label)
        ? 2
        : DOCS_PATH.test(url.pathname) || url.hostname.startsWith("docs.") || DOCS_TEXT.test(label)
          ? 1
          : 0;
    if (score === 0) return;
    if (!found.has(link)) order.push(link);
    found.set(link, Math.max(found.get(link) ?? 0, score));
  });
  return order
    .map((link, index) => ({ link, index, score: found.get(link) ?? 0 }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_LINKED_PAGES)
    .map((x) => x.link);
}

/**
 * The official domain a project's site text is read from, or null: its first official domain that is a registrable
 * domain, not an aggregator or intermediary host, and (when `phishing` is given: this run's GoPlus answers) checked
 * and clean. A project that looks like another project's domain has none.
 */
function siteDomain(
  project: ProjectForScoring,
  intermediaryHosts: readonly string[],
  phishing: ReadonlyMap<string, boolean | null> | undefined,
): string | null {
  if (project.lookalikeOf !== null) return null;
  for (const raw of project.officialDomains) {
    const domain = raw.toLowerCase();
    if (registrableDomain(`https://${domain}/`) !== domain) continue;
    if (isNonProjectHost(domain, intermediaryHosts)) continue;
    if (phishing !== undefined && phishing.get(domain) !== false) continue;
    return domain;
  }
  return null;
}

type PageResult = { kind: "ok"; html: string; finalUrl: string } | { kind: "empty" } | { kind: "failed" };

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return "/";
  }
};

/**
 * Loads the official website text of the listed projects of `projects` (the AI Analyst's extra source), by project id.
 *
 * - Only projects whose latest curation passed, with a clean official domain (`siteDomain`). Without `opts.phishing`
 *   (the stage before `analyze`: this run's GoPlus answers do not exist yet) a project that passed curation last run has
 *   no phishing-listed official domain and no lookalike (curation fails on both); with it (`analyze_listed`, after
 *   `score`) the domain must also be one GoPlus answered "not phishing" for in this run, as for the favicon.
 * - Cache: `claim_pages` under `official-site://<domain>`. A site fetched within 7 days is not fetched again. Due sites go
 *   never-fetched first, then the oldest, at most `config.officialSites.maxPerRun`; `concurrency` at a time; none
 *   starts after `budgetMinutes` (by `deps.now()`). Each domain is fetched once however many projects share it.
 * - A site: the homepage (`https://<domain>/`), then at most 2 pages found on it (`pickOfficialPages`), one after the
 *   other. Only 2xx answers whose final URL is still on the domain count; text is `claimPageText` cut at 8,000
 *   characters per page, under a `[Page <path>]` heading. A homepage that fails keeps a still usable cached text; with
 *   none (or one older than 14 days) an empty text is stored, so the site waits a week instead of heading the queue on
 *   every run. A homepage that is not HTML stores an empty text too.
 * - Nothing is asked once more than `config.enrichmentCutoffMinutes` have passed since `now` (the run's start) by
 *   `deps.now()`: the due sites count as skipped and the cache is still read.
 * - A cached text is used up to 14 days after its fetch; an empty one gives no source.
 * Counts pages in `official_pages_fetched`, `_failed` and `_skipped` (not HTML, or a site not started). Item errors
 * (a page, a write) count as failed; a repository read error is thrown. Never logs.
 */
export async function loadOfficialSites(
  deps: { repo: PipelineRepo; fetchUntrusted: FetchUntrusted; now: () => Date },
  config: PipelineConfig,
  projects: ProjectForScoring[],
  now: Date,
  stats: DailyStats,
  opts: { phishing?: ReadonlyMap<string, boolean | null> } = {},
): Promise<Map<string, SourceText[]>> {
  const { repo } = deps;
  const listed = new Set(await repo.listListedProjects(projects.map((p) => p.id)));
  const domainOf = new Map<string, string>();
  for (const project of projects) {
    if (!listed.has(project.id)) continue;
    const domain = siteDomain(project, config.alphadrops.intermediaryHosts, opts.phishing);
    if (domain !== null) domainOf.set(project.id, domain);
  }
  const domains = [...new Set(domainOf.values())];
  const keyOf = (domain: string): string => officialSiteUrl(domain);
  const cache = new Map<string, ClaimPage>(
    (await repo.listClaimPages(domains.map(keyOf))).map((page) => [page.url, page]),
  );
  const fetchedAt = (domain: string): number => cache.get(keyOf(domain))?.fetchedAt.getTime() ?? Number.NEGATIVE_INFINITY;

  const due = domains
    .filter((domain) => now.getTime() - fetchedAt(domain) > FRESH_MS)
    .sort((a, b) => fetchedAt(a) - fetchedAt(b) || (a < b ? -1 : a > b ? 1 : 0));
  // The run is already old (its other stages need the time left): no site is asked, the cache is still used.
  const startedAt = deps.now().getTime();
  const late = startedAt - now.getTime() > config.enrichmentCutoffMinutes * MINUTE_MS;
  const toFetch = late ? [] : due.slice(0, config.officialSites.maxPerRun);
  stats.official_pages_skipped += due.length - toFetch.length;

  const deadline = startedAt + config.officialSites.budgetMinutes * MINUTE_MS;

  const fetchPage = async (url: string, domain: string): Promise<PageResult> => {
    try {
      const res = await deps.fetchUntrusted(url);
      if (res.status < 200 || res.status >= 300) return { kind: "failed" };
      const finalUrl = res.finalUrl ?? url;
      // A redirect to another site: what it shows is not the project's website.
      if (registrableDomain(finalUrl) !== domain || new URL(finalUrl).port !== "") return { kind: "failed" };
      return res.body === "" ? { kind: "empty" } : { kind: "ok", html: res.body, finalUrl };
    } catch {
      return { kind: "failed" };
    }
  };
  const section = (finalUrl: string, html: string): string | null => {
    const text = [...claimPageText(html)].slice(0, MAX_PAGE_CHARS).join("").trim();
    return text === "" ? null : `[Page ${pathOf(finalUrl)}]\n${text}`;
  };

  const fetchSite = async (domain: string): Promise<void> => {
    const home = await fetchPage(`https://${domain}/`, domain);
    if (home.kind === "failed") {
      stats.official_pages_failed += 1;
      // No usable row (none, or older than 14 days): leave an empty one, so the site waits 7 days instead of being
      // first in the queue (never fetched) on every run. A row that is still usable keeps its text and is retried.
      const row = cache.get(keyOf(domain));
      if (row === undefined || now.getTime() - row.fetchedAt.getTime() > MAX_AGE_MS) {
        await repo.saveClaimPage(keyOf(domain), "", now).catch(() => undefined);
        cache.set(keyOf(domain), { url: keyOf(domain), text: "", fetchedAt: now });
      }
      return;
    }
    const sections: string[] = [];
    if (home.kind === "empty") {
      stats.official_pages_skipped += 1;
    } else {
      stats.official_pages_fetched += 1;
      const text = section(home.finalUrl, home.html);
      if (text !== null) sections.push(text);
      for (const url of pickOfficialPages(home.html, home.finalUrl, domain)) {
        const page = await fetchPage(url, domain);
        if (page.kind === "failed") stats.official_pages_failed += 1;
        else if (page.kind === "empty") stats.official_pages_skipped += 1;
        else {
          stats.official_pages_fetched += 1;
          const pageText = section(page.finalUrl, page.html);
          if (pageText !== null) sections.push(pageText);
        }
      }
    }
    const text = sections.join("\n\n");
    await repo.saveClaimPage(keyOf(domain), text, now);
    cache.set(keyOf(domain), { url: keyOf(domain), text, fetchedAt: now });
  };

  const limit = pLimit(config.officialSites.concurrency);
  await Promise.all(
    toFetch.map((domain) =>
      limit(async () => {
        if (deps.now().getTime() >= deadline) {
          stats.official_pages_skipped += 1;
          return;
        }
        try {
          await fetchSite(domain);
        } catch {
          // The cache could not be written: the site counts as failed and is tried again next run.
          stats.official_pages_failed += 1;
        }
      }),
    ),
  );

  const out = new Map<string, SourceText[]>();
  for (const [projectId, domain] of domainOf) {
    const page = cache.get(keyOf(domain));
    if (page === undefined || page.text === "" || now.getTime() - page.fetchedAt.getTime() > MAX_AGE_MS) continue;
    out.set(projectId, [{ url: officialSiteUrl(domain), text: page.text }]);
  }
  return out;
}
