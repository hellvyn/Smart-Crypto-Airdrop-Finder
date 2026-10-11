import type { Http } from "../collectors/types.js";

const MS_PER_DAY = 86_400_000;
/** A domain with thousands of certificates answers with megabytes; past this we treat the answer as unusable. */
const MAX_BODY_CHARS = 5_000_000;
/**
 * Minimum time between the starts of two crt.sh requests in one run. crt.sh is slow and refuses bursts; in the first
 * production run (2026-10-11) every request of a burst failed. A single request is capped at 20 s by the client
 * (`createHttp`).
 */
export const CRTSH_MIN_INTERVAL_MS = 2000;

/**
 * Age in whole days (floored, never negative) of the earliest certificate crt.sh knows for the domain. A
 * fallback for domains whose registry has no RDAP answer. crt.sh `not_before` has no zone and is UTC.
 * Returns null on any error, an empty list, an oversized body, or no parseable date.
 */
export async function firstCertificateAgeDays(http: Http, domain: string, now: Date): Promise<number | null> {
  const res = await http.get(`https://crt.sh/?q=${encodeURIComponent(domain.toLowerCase())}&output=json`);
  if (res.status !== 200 || res.body.length > MAX_BODY_CHARS) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(res.body);
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) return null;
  let earliest = Number.POSITIVE_INFINITY;
  for (const cert of raw as unknown[]) {
    const notBefore = (cert as { not_before?: unknown } | null)?.not_before;
    if (typeof notBefore !== "string") continue;
    const at = Date.parse(/(?:Z|[+-]\d\d:?\d\d)$/.test(notBefore) ? notBefore : `${notBefore}Z`);
    if (!Number.isNaN(at) && at < earliest) earliest = at;
  }
  if (earliest === Number.POSITIVE_INFINITY) return null;
  return Math.max(0, Math.floor((now.getTime() - earliest) / MS_PER_DAY));
}
