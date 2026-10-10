import { getDomain } from "tldts";
import { parseUrl } from "./whatwg-url.js";

/**
 * Returns the registrable domain (eTLD+1) of a URL as ASCII/punycode, or null
 * for invalid URLs and hosts without one (IP addresses, localhost).
 */
export function registrableDomain(url: string): string | null {
  let host: string;
  try {
    host = parseUrl(url).hostname;
  } catch {
    return null;
  }
  // Private suffixes (vercel.app, github.io, ...) are public registries, so
  // each tenant is its own registrable domain.
  return getDomain(host, { allowPrivateDomains: true }) ?? null;
}

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

function adapt(delta: number, numPoints: number, first: boolean): number {
  let d = first ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((BASE - T_MIN) * T_MAX) >> 1) {
    d = Math.floor(d / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * d) / (d + SKEW));
}

function digitValue(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 26; // 0-9
  if (code >= 0x41 && code <= 0x5a) return code - 0x41; // A-Z
  if (code >= 0x61 && code <= 0x7a) return code - 0x61; // a-z
  return -1;
}

/** Decodes one punycode label body (without the `xn--` prefix), RFC 3492. */
function decodePunycode(input: string): string | null {
  const delimiter = input.lastIndexOf("-");
  const output: number[] = [];
  for (let i = 0; i < Math.max(delimiter, 0); i++) {
    output.push(input.charCodeAt(i));
  }

  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let i = 0;
  let pos = delimiter > 0 ? delimiter + 1 : 0;

  while (pos < input.length) {
    const oldI = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (pos >= input.length) return null;
      const digit = digitValue(input.charCodeAt(pos++));
      if (digit < 0) return null;
      i += digit * w;
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
    }
    const len = output.length + 1;
    bias = adapt(i - oldI, len, oldI === 0);
    n += Math.floor(i / len);
    i %= len;
    if (n > 0x10ffff) return null;
    output.splice(i, 0, n);
    i++;
  }
  return String.fromCodePoint(...output);
}

/** Converts an ASCII/punycode domain to its Unicode form for display. */
export function toUnicodeDomain(domain: string): string {
  return domain
    .split(".")
    .map((label) => {
      if (!label.toLowerCase().startsWith("xn--")) return label;
      try {
        return decodePunycode(label.slice(4)) ?? label;
      } catch {
        return label;
      }
    })
    .join(".");
}
