import type { CheerioAPI } from "cheerio";
import { cleanUrl } from "@saf/core";

const BLOCK_SELECTOR =
  "p,li,ul,ol,div,section,article,header,footer,h1,h2,h3,h4,h5,h6,tr,table,blockquote,details,summary,pre";

export function isAggregatorHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "airdrops.io" || host.endsWith(".airdrops.io");
}

/**
 * The single check for hosts that are never a project's own: the aggregators we collect from (airdrops.io,
 * alphadrops.net and their subdomains) and the intermediary hosts of the config (`alphadrops.intermediaryHosts`:
 * short links, link pages, quest boards). Intermediary hosts match exactly, so a project that really lives on
 * `kaito.ai` keeps its domain while `s.kaito.ai` is refused.
 */
export function isNonProjectHost(hostname: string, intermediaryHosts: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  if (isAggregatorHost(host) || host === "alphadrops.net" || host.endsWith(".alphadrops.net")) return true;
  return intermediaryHosts.some((h) => h.toLowerCase() === host);
}

/**
 * Appends ` [<cleaned url>] ` after every outbound anchor so the LLM can copy URLs verbatim.
 * Links to the aggregator itself are dropped; `onVisit` may turn `/visit/<code>/` links into a placeholder and
 * receives the anchor's `data-outbound-host` (the destination host airdrops.io declares), if any.
 * Anchor text is always kept.
 */
export function embedLinks(
  $: CheerioAPI,
  base: string,
  onVisit?: (url: URL, outboundHost: string | null) => string | null,
): void {
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    // Query-only and fragment-only hrefs (e.g. Telegram hashtag links) carry no destination.
    if (!href || href.startsWith("?") || href.startsWith("#")) return;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    if (url.hostname === "t.me" && url.pathname === "/") return;
    if (isAggregatorHost(url.hostname)) {
      const placeholder = onVisit?.(url, $(el).attr("data-outbound-host")?.trim() || null) ?? null;
      if (placeholder) $(el).after(` ${placeholder} `);
      return;
    }
    try {
      const clean = cleanUrl(url.href).url;
      const label = $(el).text().trim();
      if (label === href.trim() || label === url.href) {
        // Raw autolink: the anchor text is the URL itself, so replace it to avoid leaking referral params.
        $(el).replaceWith(` [${clean}] `);
      } else {
        $(el).after(` [${clean}] `);
      }
    } catch {
      // Unusable link: keep the anchor text only.
    }
  });
}

/** Turns block-level markup into line breaks. Call after `embedLinks` and before reading `.text()`. */
export function markBlocks($: CheerioAPI): void {
  $("br").replaceWith("\n");
  $(BLOCK_SELECTOR).each((_, el) => {
    $(el).before("\n").after("\n");
  });
}

/** Collapses runs of spaces within lines and runs of blank lines. */
export function normalizeText(raw: string): string {
  const lines = raw.split("\n").map((line) => line.replace(/[ \t \r]+/g, " ").trim());
  const out: string[] = [];
  for (const line of lines) {
    if (line === "" && (out.length === 0 || out[out.length - 1] === "")) continue;
    out.push(line);
  }
  while (out[out.length - 1] === "") out.pop();
  return out.join("\n");
}
