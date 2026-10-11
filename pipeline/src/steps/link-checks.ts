// Claim link checks (curation spec §15.2, #42) and claim portal pages for the AI Scam Analyst (#56).
//
// `score` classifies every claim/app link from the GoPlus results it already has per domain and writes `link_checks`.
// `analyze`, earlier in the same run, reads the claim portal pages so the scam analyst sees them in that run. The pages
// are untrusted: fetched with `FetchUntrusted` (no scripts run, size and redirect limits), and given to the model as
// data only.
import { load } from "cheerio";
import pLimit from "p-limit";
import { classifyLink, registrableDomain } from "@saf/core";
import type { ClaimLink, LinkCheckStatus } from "@saf/core";
import { markBlocks, normalizeText } from "../collectors/html-text.js";
import type { FetchUntrusted } from "../http.js";
import type { DailyStats } from "../stats.js";
import type { ClaimPage, PipelineRepo, ProjectForScoring } from "../store/repo.js";
import type { SourceText } from "./analyze.js";

const DAY_MS = 86_400_000;
/** Most claim portal pages fetched per run (spec §15.2). */
export const MAX_CLAIM_PAGES_PER_RUN = 20;
/** A page fetched at most this long ago is not fetched again. */
const CLAIM_PAGE_FRESH_MS = 7 * DAY_MS;
/** A page that could not be fetched again is still read up to this age (like the VC portfolio cache). */
const CLAIM_PAGE_MAX_AGE_MS = 14 * DAY_MS;
/** Most characters of one page's text that are kept. */
const MAX_CLAIM_PAGE_CHARS = 20_000;
const FETCH_CONCURRENCY = 4;
/** Link kinds that are checked and read. */
const CLAIM_KINDS: readonly string[] = ["claim", "app"];
/** Elements that are never page text: scripts and styles, and content that only a browser would render. */
const NON_TEXT = "script, style, noscript, template, iframe, object, embed, svg, canvas, head > :not(title)";
/**
 * How cautious a status is, for a link that several projects share: whether a link is official depends on the
 * project, so the stored status is the most cautious one. `phishing` and `unchecked` come from the link's domain only.
 */
const CAUTION: Record<LinkCheckStatus, number> = { official: 0, different_domain: 1, unchecked: 2, phishing: 3 };

/** The project's claim and app links, each URL once, in link order. */
function claimLinksOf(project: ProjectForScoring): { url: string; kind: string }[] {
  const seen = new Set<string>();
  const out: { url: string; kind: string }[] = [];
  for (const link of project.links) {
    if (!CLAIM_KINDS.includes(link.kind) || seen.has(link.url)) continue;
    seen.add(link.url);
    out.push(link);
  }
  return out;
}

export interface ClaimLinkChecks {
  /** Per project id: its claim/app links with their status for that project ([] when it has none). */
  byProject: Map<string, ClaimLink[]>;
  /** Per URL, in first-seen order: the status written to `link_checks`. */
  byUrl: Map<string, LinkCheckStatus>;
}

/**
 * Classifies every claim/app link of the scored projects with `classifyLink`, from `phishing`: the GoPlus answer per
 * registrable domain of the run's paced, budgeted queue (a domain it skipped or failed is null, so its links are
 * `unchecked`). Nothing is requested here.
 */
export function checkClaimLinks(
  projects: ProjectForScoring[],
  phishing: ReadonlyMap<string, boolean | null>,
): ClaimLinkChecks {
  const byProject = new Map<string, ClaimLink[]>();
  const byUrl = new Map<string, LinkCheckStatus>();
  for (const project of projects) {
    const links = claimLinksOf(project).map(({ url }) => {
      const domain = registrableDomain(url);
      const flag = domain === null ? null : (phishing.get(domain) ?? null);
      return { url, status: classifyLink(url, project.officialDomains, flag) };
    });
    byProject.set(project.id, links);
    for (const { url, status } of links) {
      const stored = byUrl.get(url);
      if (stored === undefined || CAUTION[status] > CAUTION[stored]) byUrl.set(url, status);
    }
  }
  return { byProject, byUrl };
}

/** Writes one `link_checks` row per URL, checked at `at`, and counts them (`link_checks_total`, `_phishing`). */
export async function saveLinkChecks(
  repo: PipelineRepo,
  byUrl: ReadonlyMap<string, LinkCheckStatus>,
  at: Date,
  stats: DailyStats,
): Promise<void> {
  for (const [url, status] of byUrl) {
    await repo.saveLinkCheck(url, status, at);
    stats.link_checks_total += 1;
    if (status === "phishing") stats.link_checks_phishing += 1;
  }
}

/**
 * The readable text of a claim page's HTML, without running anything: the title and the body text, block elements as
 * line breaks, spaces collapsed (`normalizeText`), at most 20,000 characters. Scripts, styles and embedded frames
 * are dropped; a page that only renders through scripts gives "".
 */
export function claimPageText(html: string): string {
  const $ = load(html);
  $(NON_TEXT).remove();
  markBlocks($);
  const title = $("title").first().text();
  $("title").remove();
  const text = normalizeText(`${title}\n${$.root().text()}`);
  return [...text].slice(0, MAX_CLAIM_PAGE_CHARS).join("");
}

/** Never-fetched pages first, then the oldest fetch; claim links before app links; then by url. */
function fetchOrder(cache: ReadonlyMap<string, ClaimPage>, kinds: ReadonlyMap<string, string>) {
  const age = (url: string): number => cache.get(url)?.fetchedAt.getTime() ?? Number.NEGATIVE_INFINITY;
  const kindRank = (url: string): number => (kinds.get(url) === "claim" ? 0 : 1);
  return (a: string, b: string): number =>
    age(a) - age(b) || kindRank(a) - kindRank(b) || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * The claim portal pages of each project for the AI Scam Analyst (#56), by project id: one document per claim/app
 * link whose latest `link_checks` status is not `phishing` (never-checked links included), in link order.
 *
 * - Cache (`claim_pages`): a page fetched within the last 7 days is not fetched again. Others are fetched, at most 20
 *   per run (never-fetched first, then the oldest), and a page that answers 2xx replaces its cached text
 *   (`claim_pages_read`). A page that fails keeps its cached text.
 * - A cached text is used up to 14 days after its fetch; an empty text (a page that only scripts render) gives no
 *   document.
 * Each page is fetched once per run whatever the number of projects linking it. Repository errors are thrown.
 */
export async function readClaimPages(
  deps: { repo: PipelineRepo; fetchUntrusted: FetchUntrusted },
  projects: ProjectForScoring[],
  now: Date,
  stats: DailyStats,
): Promise<Map<string, SourceText[]>> {
  const { repo } = deps;
  const linksByProject = new Map(projects.map((p) => [p.id, claimLinksOf(p)]));
  const kinds = new Map<string, string>();
  for (const links of linksByProject.values()) {
    for (const l of links) if (kinds.get(l.url) !== "claim") kinds.set(l.url, l.kind);
  }
  const phishing = new Set(
    (await repo.listLinkChecks([...kinds.keys()])).filter((c) => c.status === "phishing").map((c) => c.url),
  );
  const urls = [...kinds.keys()].filter((url) => !phishing.has(url));
  const cache = new Map((await repo.listClaimPages(urls)).map((page) => [page.url, page]));

  const due = urls.filter((url) => {
    const page = cache.get(url);
    return page === undefined || now.getTime() - page.fetchedAt.getTime() > CLAIM_PAGE_FRESH_MS;
  });
  const toFetch = due.sort(fetchOrder(cache, kinds)).slice(0, MAX_CLAIM_PAGES_PER_RUN);
  const limit = pLimit(FETCH_CONCURRENCY);
  await Promise.all(
    toFetch.map((url) =>
      limit(async () => {
        const res = await deps.fetchUntrusted(url);
        if (res.status < 200 || res.status >= 300) return;
        const text = claimPageText(res.body);
        await repo.saveClaimPage(url, text, now);
        cache.set(url, { url, text, fetchedAt: now });
        stats.claim_pages_read += 1;
      }),
    ),
  );

  const out = new Map<string, SourceText[]>();
  for (const [projectId, links] of linksByProject) {
    out.set(
      projectId,
      links.flatMap(({ url }) => {
        const page = phishing.has(url) ? undefined : cache.get(url);
        if (page === undefined || page.text === "") return [];
        if (now.getTime() - page.fetchedAt.getTime() > CLAIM_PAGE_MAX_AGE_MS) return [];
        return [{ url, text: page.text }];
      }),
    );
  }
  return out;
}
