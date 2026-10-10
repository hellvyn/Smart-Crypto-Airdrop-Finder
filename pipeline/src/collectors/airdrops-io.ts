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

/**
 * Extracts the guide content between `.airdrop-info` and `.airdrop-bottom`.
 * `/visit/<code>/` links stay in the text as `[[visit:<code>]]` placeholders for the collector to resolve.
 * Returns null when the expected structure is missing.
 */
export function parseDetail(
  html: string,
  url: string,
): { title: string; text: string; visitLinks: string[]; pageUpdatedAt: Date | null } | null {
  const $ = cheerio.load(html);
  const title = $("h1").first().text().replace(/\s+/g, " ").trim();
  const info = $(".airdrop-info").first();
  const bottom = $(".airdrop-bottom").first();
  if (!title || info.length === 0 || bottom.length === 0) return null;

  $("script,style,noscript,svg,img,iframe,button,.related-airdrops,.lifi-bridge,.step-progress").remove();

  const visitLinks = new Set<string>();
  embedLinks($, url, (link) => {
    const code = visitCode(link);
    if (!code) return null;
    visitLinks.add(link.href);
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
  return { title, text, visitLinks: [...visitLinks], pageUpdatedAt: parseUpdated(text) };
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
      const target = resolved.get(code);
      return target ? ` [${target}] ` : " ";
    });
    return {
      sourceKind: "airdrops_io",
      sourceKey: SOURCE_KEY,
      url,
      text: normalizeText(`${detail.title}\n\n${body}`),
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
