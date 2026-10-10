import * as cheerio from "cheerio";
import pLimit from "p-limit";
import { cleanUrl } from "@saf/core";
import { isNonProjectHost, markBlocks, normalizeText } from "./html-text.js";
import type { CollectedDocument, CollectorResult, Http } from "./types.js";

const ORIGIN = "https://alphadrops.net";
const LISTING_URL = `${ORIGIN}/airdrops`;
const SOURCE_KEY = "alphadrops";
/** Listing statuses worth a document; `ended` and `inactive` items are skipped. */
const COLLECTED_STATUSES: ReadonlySet<string> = new Set(["active", "upcoming", "claimable"]);
const MAX_REDIRECTS = 3;
/** Website links are resolved on the projects' own hosts, never on alphadrops.net, so a small pool is fine. */
const WEBSITE_CONCURRENCY = 4;
const START_MARK = "";
const END_MARK = "";
/** Headings of the boxes that follow the guide on a detail page: community promo, then other airdrops. */
const END_HEADINGS: ReadonlySet<string> = new Set(["Alpha community", "Other airdrop opportunities"]);

export interface AlphaItem {
  name: string;
  slug: string;
  status: string;
  shortDescription: string | null;
  description: string | null;
  categories: string[];
  blockchains: string[];
  /** Funding as AlphaDrops writes it (`"$30M"`, `"Undisclosed"`), never parsed into a number. */
  fundingAmount: string | null;
  website: string | null;
  hasPoints: boolean;
  claimDeadline: string | null;
  addedDate: string;
}

/** The strings of every `self.__next_f.push([1, "…"])` script, joined in page order (the React flight payload). */
function flightPayload(html: string): string {
  const $ = cheerio.load(html);
  let payload = "";
  $("script").each((_, el) => {
    const match = /^\s*self\.__next_f\.push\(([\s\S]*)\)\s*;?\s*$/.exec($(el).text());
    if (!match?.[1]) return;
    try {
      const chunk: unknown = JSON.parse(match[1]);
      if (Array.isArray(chunk) && chunk[0] === 1 && typeof chunk[1] === "string") payload += chunk[1];
    } catch {
      // Not a JSON push: ignore it.
    }
  });
  return payload;
}

/** Placeholders AlphaDrops uses for "no value". */
const EMPTY_VALUES: ReadonlySet<string> = new Set(["", "NA", "—", "-"]);

/**
 * A text field of the payload. Flight escapes a leading `$` as `$$` (`"$$30M"` is `"$30M"`); any other leading `$`
 * marks a reference such as `$undefined`, which carries no text here. Placeholders become null.
 */
function textValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.startsWith("$$")) return text.slice(1);
  if (text.startsWith("$") || EMPTY_VALUES.has(text)) return null;
  return text;
}

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((v) => textValue(v) ?? []) : [];
}

function toItem(o: Record<string, unknown>): AlphaItem | null {
  // Premium placeholders ("Upgrade to Premium to unlock this project.") carry no public data.
  if (o.premiumOnly === true) return null;
  const slug = textValue(o.slug);
  const name = textValue(o.name);
  const status = textValue(o.status);
  if (!slug || !name || !status) return null;
  return {
    name,
    slug,
    status: status.toLowerCase(),
    shortDescription: textValue(o.shortDescription),
    description: textValue(o.description),
    categories: textList(o.categories),
    blockchains: textList(o.blockchains),
    fundingAmount: textValue(o.fundingAmount),
    website: textValue(o.website),
    hasPoints: o.hasPoints === true,
    claimDeadline: textValue(o.claimDeadline),
    addedDate: textValue(o.addedDate) ?? "",
  };
}

/**
 * Airdrop items of the listing page, in page order, deduped by slug (first wins). The page renders its data as a
 * Next.js flight payload: rows `<id>:<json>`, one per line; every JSON object with a `slug` and a `fundingAmount`
 * is an item. Returns [] when the payload is missing or holds no items.
 */
export function parseAlphaListing(html: string): AlphaItem[] {
  const items = new Map<string, AlphaItem>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const v of value) visit(v);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const o = value as Record<string, unknown>;
    if (typeof o.slug === "string" && "fundingAmount" in o) {
      const item = toItem(o);
      if (item && !items.has(item.slug)) items.set(item.slug, item);
      return;
    }
    for (const v of Object.values(o)) visit(v);
  };
  for (const line of flightPayload(html).split("\n")) {
    const row = /^[0-9a-f]+:([[{][\s\S]*)$/.exec(line);
    if (!row?.[1]) continue;
    try {
      visit(JSON.parse(row[1]));
    } catch {
      // A text row or a row that is not JSON.
    }
  }
  return [...items.values()];
}

/** Relative age ("Listed 1d ago") changes every day; keeping it would change the document hash daily. */
const LISTED_AGE_RE = /^Listed\b.*\bago$/i;

/**
 * Main text of a detail page: the title block, description, "Airdrop tasks" and "Deep dive strategy" (or whatever
 * guide sections sit between the `h1` and the community box). Ads ("Learn more" carousel, sponsored links), the
 * community box, "Other airdrop opportunities", buttons and scripts are dropped. Links are not embedded: the only
 * URL a document carries is the cleaned Website line. Returns "" when the page has no `h1`.
 */
export function parseAlphaDetail(html: string): string {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg,img,iframe,button,aside,[rel~='sponsored']").remove();
  const title = $("h1").first();
  if (title.length === 0) return "";

  // Badges and stat label/value pairs are adjacent spans ("Funding" "$30M"); keep them apart.
  $("span").after(" ");
  markBlocks($);
  title.before(START_MARK);
  $("h2")
    .filter((_, el) => END_HEADINGS.has($(el).text().replace(/\s+/g, " ").trim()))
    .first()
    .before(END_MARK);

  const full = $.root().text();
  const start = full.indexOf(START_MARK);
  const end = full.indexOf(END_MARK, start);
  const main = full.slice(start + 1, end < 0 ? undefined : end);
  return normalizeText(
    normalizeText(main)
      .split("\n")
      .filter((line) => !LISTED_AGE_RE.test(line))
      .join("\n"),
  );
}

function httpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * The project website behind an AlphaDrops link: referral parts removed (`cleanUrl`), redirects followed (at most
 * 3, each hop cleaned before it is requested). Null when the link is not an http(s) URL or ends on a non-project
 * host (`isNonProjectHost`: alphadrops.net, airdrops.io, or exactly one of `intermediaryHosts`).
 */
export async function resolveWebsite(
  http: Http,
  raw: string,
  intermediaryHosts: readonly string[],
): Promise<string | null> {
  let current: string;
  try {
    current = cleanUrl(raw.trim()).url;
  } catch {
    return null;
  }
  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    if (!httpUrl(current)) return null;
    let next: string | null;
    try {
      next = await http.resolveRedirect(current);
    } catch {
      next = null;
    }
    if (!next) break;
    try {
      current = cleanUrl(next).url;
    } catch {
      return null;
    }
  }
  const final = httpUrl(current);
  if (!final || isNonProjectHost(final.hostname, intermediaryHosts)) return null;
  return current;
}

function documentText(item: AlphaItem, website: string | null, detail: string): string {
  const list = (values: string[]): string => (values.length > 0 ? values.join(", ") : "n/a");
  const header = [
    `Name: ${item.name}`,
    `Status (AlphaDrops): ${item.status}`,
    `Categories: ${list(item.categories)}`,
    `Chains: ${list(item.blockchains)}`,
    `Funding (reported by AlphaDrops): ${item.fundingAmount ?? "n/a"}`,
  ];
  if (website !== null) header.push(`Website: ${website}`);
  // Without a detail page the listing's own description stands in for it.
  const body = normalizeText(detail || item.description || item.shortDescription || "");
  return body === "" ? header.join("\n") : `${header.join("\n")}\n\n${body}`;
}

function parseDate(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Collects the active, upcoming and claimable airdrops of AlphaDrops, one document per item. Detail pages are
 * fetched one at a time, `delayMs` apart (the pause comes before every detail request, so the listing request
 * also gets one), and at most `maxDetails` per run; items past the limit, or whose detail page answers with an
 * HTTP error or has no title, get a listing-only document.
 *
 * `failed` when the listing fails or holds no items (page format changed). A connection failure (status 0 or a
 * throw) on a detail page stops the collector: it reports `failed` and returns the documents built so far, so
 * they are still ingested and the next items keep yesterday's stored version instead of a listing-only one.
 */
export async function collectAlphaDrops(
  http: Http,
  now: Date,
  opts: { maxDetails: number; delayMs: number; intermediaryHosts: readonly string[] },
  sleep: (ms: number) => Promise<void>,
): Promise<CollectorResult> {
  const documents: CollectedDocument[] = [];
  const failed = (error: string): CollectorResult => ({ sourceKey: SOURCE_KEY, documents, failed: true, error });
  try {
    const listing = await http.get(LISTING_URL);
    if (listing.status !== 200) return failed(`listing returned HTTP ${listing.status}`);
    const all = parseAlphaListing(listing.body);
    if (all.length === 0) return failed("listing yielded no items");
    const items = all.filter((item) => COLLECTED_STATUSES.has(item.status));

    const limit = pLimit(WEBSITE_CONCURRENCY);
    const websites = await Promise.all(
      items.map((item) =>
        limit(async () => (item.website === null ? null : resolveWebsite(http, item.website, opts.intermediaryHosts))),
      ),
    );

    let skipped = 0;
    for (const [index, item] of items.entries()) {
      let detail = "";
      if (index < opts.maxDetails) {
        await sleep(opts.delayMs);
        const res = await http.get(`${ORIGIN}/airdrops/${encodeURIComponent(item.slug)}`);
        if (res.status === 0) return failed(`connection failed after ${documents.length} documents`);
        detail = res.status === 200 ? parseAlphaDetail(res.body) : "";
        if (detail === "") skipped += 1;
      }
      documents.push({
        sourceKind: "alphadrops",
        sourceKey: SOURCE_KEY,
        url: `${ORIGIN}/airdrops/${encodeURIComponent(item.slug)}`,
        text: documentText(item, websites[index] ?? null, detail),
        publishedAt: parseDate(item.addedDate),
        pageUpdatedAt: null,
        fetchedAt: now,
      });
    }
    const result: CollectorResult = { sourceKey: SOURCE_KEY, documents, failed: false };
    if (skipped > 0) result.error = `${skipped} detail ${skipped === 1 ? "page" : "pages"} unusable`;
    return result;
  } catch {
    return failed(`request failed after ${documents.length} documents`);
  }
}
