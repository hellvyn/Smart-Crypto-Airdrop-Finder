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
 * GET of a page an unknown party wrote (a claim portal, #42; an official website, #owner request 2026-10-11). Never
 * throws: anything refused or failed is status 0 with an empty body. `finalUrl` is the URL the answer came from after
 * redirects, when a page was answered at all (a caller that only wants pages of one domain compares its host).
 */
export type FetchUntrusted = (url: string) => Promise<{ status: number; body: string; finalUrl?: string }>;

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
          return { status: res.status, body: "", finalUrl: current };
        }
        return { status: res.status, body: await readCapped(res, UNTRUSTED_MAX_BYTES), finalUrl: current };
      } catch {
        return { status: 0, body: "" };
      }
    }
    return { status: 0, body: "" };
  };
}

/** Raster image types a logo may be (`project_logos.mime`); never SVG, which can carry script. */
export type LogoMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "image/x-icon";

export interface LogoImage {
  mime: LogoMime;
  bytes: Uint8Array;
}

/**
 * GET of one logo image. `allowHost` decides the first URL's host and the host of every redirect. Never throws: an
 * image refused or failed for any reason is null.
 */
export type FetchImage = (url: string, allowHost: (host: string) => boolean) => Promise<LogoImage | null>;

/** Most bytes a logo may have (`project_logos` refuses more); a longer body is not read further. */
export const LOGO_MAX_BYTES = 65_536;
const LOGO_TIMEOUT_MS = 5_000;
const LOGO_MAX_REDIRECTS = 2;

const startsWith = (bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean =>
  bytes.length >= offset + prefix.length && prefix.every((b, i) => bytes[offset + i] === b);
const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

/**
 * The image type of `bytes`, from their magic bytes only: PNG, JPEG, GIF (87a/89a), WebP (RIFF....WEBP) or ICO (type 1,
 * icon). Anything else (SVG, HTML, a cursor, a truncated header) is null.
 */
export function sniffImage(bytes: Uint8Array): LogoMime | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) return "image/gif";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return "image/x-icon";
  return null;
}

/** The body, or null when it is longer than `maxBytes` (reading stops right there). */
async function readAtMost(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  if (res.body === null) return new Uint8Array(0);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) return null;
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

/** An https URL whose host `allowHost` accepts, parsed; null otherwise. */
function allowedHttps(url: string, allowHost: (host: string) => boolean): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.port !== "" || parsed.username !== "" || parsed.password !== "") return null;
  return allowHost(parsed.hostname.toLowerCase()) ? parsed : null;
}

/**
 * The logo download (owner request 2026-10-11): a plain GET with the collectors' User-Agent and no cookies, https
 * only (default port, no credentials in the URL), 5 s in all (redirects and body included), at most 2 redirects, each followed by hand and only to an https URL
 * whose host `allowHost` accepts. Only a 200 answer counts; its body is read up to 64 KB (a longer one is refused
 * without reading the rest) and its type is decided by the magic bytes (`sniffImage`), never by the header alone. A
 * response that says it is SVG is refused whatever its bytes. The image is stored as bytes and never decoded here.
 */
export function createFetchImage(fetchImpl: typeof fetch = fetch, opts: { timeoutMs?: number } = {}): FetchImage {
  const headers = { "User-Agent": USER_AGENT };
  return async (url, allowHost) => {
    const signal = AbortSignal.timeout(opts.timeoutMs ?? LOGO_TIMEOUT_MS);
    let current = allowedHttps(url, allowHost);
    for (let hop = 0; current !== null && hop <= LOGO_MAX_REDIRECTS; hop++) {
      try {
        const res = await fetchImpl(current.href, { headers, redirect: "manual", credentials: "omit", signal });
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get("location");
          await res.body?.cancel().catch(() => undefined);
          current = location === null ? null : allowedHttps(new URL(location, current).href, allowHost);
          continue;
        }
        if (res.status !== 200 || /svg/i.test(res.headers.get("content-type") ?? "")) {
          await res.body?.cancel().catch(() => undefined);
          return null;
        }
        const bytes = await readAtMost(res, LOGO_MAX_BYTES);
        const mime = bytes === null ? null : sniffImage(bytes);
        return bytes === null || mime === null ? null : { mime, bytes };
      } catch {
        return null;
      }
    }
    return null;
  };
}
