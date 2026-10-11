import * as cheerio from "cheerio";
import { cleanUrl } from "@saf/core";
import { embedLinks, isAggregatorHost, markBlocks, normalizeText } from "./html-text.js";
import type { CollectedDocument, CollectorResult, Http } from "./types.js";

const ORIGIN = "https://airdrops.io";
const SOURCE_KEY = "airdrops_io";
const CONCURRENCY = 4;
const START_MARK = "\uE000";
const END_MARK = "\uE001";

/** First path segments on airdrops.io that are not airdrop detail pages. */
const NON_AIRDROP_SLUGS = new Set([
  "blog", "calendar", "faq", "contact", "feed", "wp-json", "speculative", "confirmed", "claims",
  "stay-safe", "airdrop-alert", "bulk", "hot", "latest", "about", "privacy-policy", "terms",
  "advertise", "comments", "wp-content", "wp-admin", "wp-includes", "category", "tag", "author",
  "page", "visit",
]);

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Detail page URLs (`https://airdrops.io/<slug>/`) found on the home page, in page order. */
export function parseListing(html: string): string[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let url: URL;
    try {
      url = new URL(href, ORIGIN);
    } catch {
      return;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return;
    if (!isAggregatorHost(url.hostname)) return;
    const match = /^\/([a-z0-9][a-z0-9-]*)\/?$/.exec(url.pathname);
    const slug = match?.[1];
    if (!slug || NON_AIRDROP_SLUGS.has(slug)) return;
    seen.add(`${ORIGIN}/${slug}/`);
  });
  return [...seen];
}

function parseUpdated(text: string): Date | null {
  const match = /Updated\s+(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/.exec(text);
  if (!match) return null;
  const month = MONTHS.indexOf((match[2] ?? "").slice(0, 3).toLowerCase());
  if (month < 0) return null;
  const date = new Date(Date.UTC(Number(match[3]), month, Number(match[1])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function visitCode(url: URL): string | null {
  const match = /^\/visit\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
  return match?.[1] ?? null;
}

export interface OverviewLink {
  label: string;
  /** Absolute href as written on the page (a `/visit/<code>/` link or a direct link). */
  href: string;
  outboundHost: string | null;
}

export interface AirdropsIoDetail {
  title: string;
  text: string;
  visitLinks: string[];
  /** Links of the Overview box (after `.airdrop-bottom`), in page order. Empty when the box is missing. */
  overview: OverviewLink[];
  /** `/visit/<code>/` code to the `data-outbound-host` airdrops.io declares for it. */
  visitHosts: Map<string, string>;
  pageUpdatedAt: Date | null;
}

/** The source site spells the wrapper class `aidrop-info-wrapper`; accept the correct spelling too. */
const OVERVIEW_ITEMS = ".aidrop-info-wrapper li, .airdrop-info-wrapper li";

function parseOverview($: cheerio.CheerioAPI, base: string): OverviewLink[] {
  const links: OverviewLink[] = [];
  $(OVERVIEW_ITEMS).each((_, li) => {
    const anchor = $(li).find("a[href]").first();
    const raw = anchor.attr("href");
    if (!raw) return;
    let href: string;
    try {
      href = new URL(raw, base).href;
    } catch {
      return;
    }
    const text = $(li).text().replace(/\s+/g, " ").trim();
    const colon = text.indexOf(":");
    const label = (colon > 0 ? text.slice(0, colon) : anchor.text()).replace(/\s+/g, " ").trim();
    links.push({ label, href, outboundHost: anchor.attr("data-outbound-host")?.trim() || null });
  });
  return links;
}

/**
 * Extracts the guide content between `.airdrop-info` and `.airdrop-bottom`, plus the Overview box that follows it.
 * `/visit/<code>/` links stay in the text as `[[visit:<code>]]` placeholders for the collector to resolve.
 * Returns null when the expected structure is missing; a missing Overview box only leaves `overview` empty.
 */
export function parseDetail(html: string, url: string): AirdropsIoDetail | null {
  const $ = cheerio.load(html);
  const title = $("h1").first().text().replace(/\s+/g, " ").trim();
  const info = $(".airdrop-info").first();
  const bottom = $(".airdrop-bottom").first();
  if (!title || info.length === 0 || bottom.length === 0) return null;

  const overview = parseOverview($, url);

  $("script,style,noscript,svg,img,iframe,button,.related-airdrops,.lifi-bridge,.step-progress").remove();

  const visitLinks = new Set<string>();
  const visitHosts = new Map<string, string>();
  embedLinks($, url, (link, outboundHost) => {
    const code = visitCode(link);
    if (!code) return null;
    visitLinks.add(link.href);
    if (outboundHost && !visitHosts.has(code)) visitHosts.set(code, outboundHost);
    return `[[visit:${code}]]`;
  });
  markBlocks($);
  info.before(START_MARK);
  bottom.before(END_MARK);

  const full = $.root().text();
  const start = full.indexOf(START_MARK);
  const end = full.indexOf(END_MARK);
  if (start < 0 || end < start) return null;

  const text = normalizeText(full.slice(start + 1, end));
  if (text === "") return null;
  return { title, text, visitLinks: [...visitLinks], overview, visitHosts, pageUpdatedAt: parseUpdated(text) };
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function cleanResolved(location: string | null): string | null {
  if (!location) return null;
  try {
    if (isAggregatorHost(new URL(location).hostname)) return null;
    return cleanUrl(location).url;
  } catch {
    return null;
  }
}

const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/** `https://<host>/` for a declared outbound host, or null when it is malformed or an aggregator host. */
function hostUrl(host: string | null | undefined): string | null {
  if (!host || !HOST_PATTERN.test(host)) return null;
  return cleanResolved(`https://${host.toLowerCase()}/`);
}

/** Overview line URL: the resolved redirect, else the declared host, or the direct link for non-visit anchors. */
function overviewUrl(
  link: OverviewLink,
  resolved: Map<string, string | null>,
  visitHosts: Map<string, string>,
): string | null {
  const href = new URL(link.href);
  if (href.protocol !== "http:" && href.protocol !== "https:") return null;
  if (!isAggregatorHost(href.hostname)) return cleanResolved(href.href);
  const code = visitCode(href);
  if (!code) return null;
  return resolved.get(code) ?? hostUrl(link.outboundHost ?? visitHosts.get(code));
}

export async function collectAirdropsIo(http: Http, now: Date): Promise<CollectorResult> {
  const home = await http.get(`${ORIGIN}/`);
  if (home.status !== 200) {
    return { sourceKey: SOURCE_KEY, documents: [], failed: true, error: `home page returned HTTP ${home.status}` };
  }
  const listing = parseListing(home.body);
  if (listing.length === 0) {
    return { sourceKey: SOURCE_KEY, documents: [], failed: true, error: "home page yielded no airdrop links" };
  }

  const pages = await mapPool(listing, CONCURRENCY, async (url) => {
    const res = await http.get(url);
    const detail = res.status === 200 ? parseDetail(res.body, url) : null;
    return detail ? { url, detail } : null;
  });
  const parsed = pages.filter((p): p is NonNullable<typeof p> => p !== null);
  const skipped = pages.length - parsed.length;

  // Resolve each distinct visit code once per run.
  const visitUrls = new Map<string, string>();
  for (const { detail } of parsed) {
    for (const link of detail.visitLinks) {
      const code = visitCode(new URL(link));
      if (code && !visitUrls.has(code)) visitUrls.set(code, link);
    }
  }
  const entries = [...visitUrls.entries()];
  const resolvedList = await mapPool(entries, CONCURRENCY, async ([, link]) =>
    cleanResolved(await http.resolveRedirect(link)),
  );
  const resolved = new Map(entries.map(([code], i) => [code, resolvedList[i] ?? null]));

  const documents: CollectedDocument[] = parsed.map(({ url, detail }) => {
    const body = detail.text.replace(/ ?\[\[visit:([A-Za-z0-9_-]+)\]\] ?/g, (_m, code: string) => {
      const target = resolved.get(code) ?? hostUrl(detail.visitHosts.get(code));
      return target ? ` [${target}] ` : " ";
    });
    const overviewLines = detail.overview.flatMap((link) => {
      const target = overviewUrl(link, resolved, detail.visitHosts);
      return target && link.label ? [`${link.label}: [${target}]`] : [];
    });
    const overview = overviewLines.length > 0 ? `\n\nOverview\n${overviewLines.join("\n")}` : "";
    return {
      sourceKind: "airdrops_io",
      sourceKey: SOURCE_KEY,
      url,
      text: normalizeText(`${detail.title}\n\n${body}${overview}`),
      publishedAt: null,
      pageUpdatedAt: detail.pageUpdatedAt,
      fetchedAt: now,
    };
  });

  // Every listed page was skipped: the detail structure most likely changed.
  const result: CollectorResult = { sourceKey: SOURCE_KEY, documents, failed: documents.length === 0 };
  if (skipped > 0) result.error = `${skipped} detail ${skipped === 1 ? "page" : "pages"} skipped`;
  return result;
}
