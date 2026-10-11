import { registrableDomain } from "@saf/core";
import type { Http } from "./collectors/types.js";

const USER_AGENT = "SmartAirdropFinder/0.1 (+https://github.com/hellvyn/Smart-Airdrop-Finder)";
const TIMEOUT_MS = 20_000;

/** Builds the HTTP client used by collectors. Never throws: network failures become status 0. */
export function createHttp(fetchImpl: typeof fetch = fetch): Http {
  const headers = { "User-Agent": USER_AGENT };
  return {
    async get(url) {
      try {
        const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
        // Header names come lowercased from the Headers iterator (e.g. `retry-after`).
        return { status: res.status, body: await res.text(), headers: Object.fromEntries(res.headers.entries()) };
      } catch {
        return { status: 0, body: "" };
      }
    },
    async resolveRedirect(url) {
      try {
        const res = await fetchImpl(url, {
          headers,
          redirect: "manual",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const location = res.headers.get("location");
        // Drain the body so the connection can be reused.
        await res.body?.cancel().catch(() => undefined);
        return location ? new URL(location, url).href : null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * GET of a page an unknown party wrote (a claim portal, #42). Never throws: anything refused or failed is status 0
 * with an empty body.
 */
export type FetchUntrusted = (url: string) => Promise<{ status: number; body: string }>;

/** Most bytes of an untrusted page that are read; the rest is not downloaded. */
export const UNTRUSTED_MAX_BYTES = 1_000_000;
const UNTRUSTED_TIMEOUT_MS = 10_000;
const UNTRUSTED_MAX_REDIRECTS = 3;
/** Host suffixes of private networks that still have a registrable domain in the public suffix list's view. */
const PRIVATE_HOST_SUFFIXES = [".internal", ".local", ".localhost", ".arpa", ".lan", ".home", ".corp", ".intranet"];
/** Content types read as text; any other type gives an empty body. */
const TEXT_TYPE = /^(text\/|application\/(xhtml\+xml|xml)\b)/i;

/**
 * An http(s) URL whose host has a registrable domain and is not a private-network name: no IP address, no
 * localhost. (A public name that resolves to a private address is not caught here.)
 */
function isPublicHttpUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (PRIVATE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
  return registrableDomain(parsed.href) !== null;
}

/** The body as UTF-8 text, at most `maxBytes` of it; the rest of the stream is cancelled. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (res.body === null) return "";
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    const part = value.subarray(0, maxBytes - size);
    parts.push(part);
    size += part.length;
  }
  await reader.cancel().catch(() => undefined);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * The fetch the pipeline uses for untrusted pages: a plain GET with the collectors' User-Agent, no cookies, 10 s in
 * all, at most `UNTRUSTED_MAX_BYTES` of a text response, and at most 3 redirects, each followed by hand and only
 * to a public http(s) URL (`isPublicHttpUrl`). The page is only read as text; nothing in it is ever run.
 */
export function createFetchUntrusted(fetchImpl: typeof fetch = fetch): FetchUntrusted {
  const headers = { "User-Agent": USER_AGENT };
  return async (url) => {
    // One timeout for the whole fetch, redirects and body included: 20 pages, 4 at a time, take at most ~50 s.
    const signal = AbortSignal.timeout(UNTRUSTED_TIMEOUT_MS);
    let current = url;
    for (let hop = 0; hop <= UNTRUSTED_MAX_REDIRECTS; hop++) {
      if (!isPublicHttpUrl(current)) return { status: 0, body: "" };
      try {
        const res = await fetchImpl(current, { headers, redirect: "manual", credentials: "omit", signal });
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get("location");
          await res.body?.cancel().catch(() => undefined);
          if (location === null) return { status: res.status, body: "" };
          current = new URL(location, current).href;
          continue;
        }
        if (!TEXT_TYPE.test(res.headers.get("content-type") ?? "text/html")) {
          await res.body?.cancel().catch(() => undefined);
          return { status: res.status, body: "" };
        }
        return { status: res.status, body: await readCapped(res, UNTRUSTED_MAX_BYTES) };
      } catch {
        return { status: 0, body: "" };
      }
    }
    return { status: 0, body: "" };
  };
}
