import { z } from "zod";
import type { Http } from "../collectors/types.js";
import { defaultSleep } from "./time.js";

const MS_PER_DAY = 86_400_000;

/**
 * Minimum time between the starts of two RDAP requests in one run (retries included). The first production run
 * (2026-10-11) fired every lookup back to back, 4 at a time: after the first ~25 requests rdap.org answered almost
 * none, while single requests were answered.
 */
export const RDAP_MIN_INTERVAL_MS = 1000;
/** Pause before the single retry after a 429 or 5xx without a readable `Retry-After`. */
export const RDAP_RETRY_MS = 3000;
/** A longer `Retry-After` is cut to this. */
export const RDAP_RETRY_AFTER_MAX_MS = 10_000;

const responseSchema = z.object({
  events: z.array(z.object({ eventAction: z.string(), eventDate: z.string() }).partial()),
});

/**
 * What an RDAP lookup gave: `age` (with `days`); `no_rdap`, a 404 (rdap.org has no RDAP service for the TLD, e.g.
 * .io, .gg, .co, or the registry does not know the domain); `no_date`, a 200 without a usable registration date; `rate_limited`, still 429 after the retry;
 * `failed`, anything else (5xx after the retry, timeout, other status). Only `no_rdap` and `no_date` are worth asking
 * crt.sh; the others are asked RDAP again in the next run.
 */
export type RdapOutcome = "age" | "no_rdap" | "no_date" | "rate_limited" | "failed";

export interface RdapResult {
  outcome: RdapOutcome;
  days: number | null;
}

/** The wait a `Retry-After` header asks for (seconds or an HTTP date, against `clock`), or null when unreadable. */
function retryAfterMs(value: string | undefined, clock: () => number): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? null : Math.max(0, at - clock());
}

function ageFromBody(body: string, now: Date): number | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) return null;
  const registration = parsed.data.events.find((e) => e.eventAction === "registration");
  if (registration?.eventDate === undefined) return null;
  const registeredAt = Date.parse(registration.eventDate);
  if (Number.isNaN(registeredAt)) return null;
  return Math.max(0, Math.floor((now.getTime() - registeredAt) / MS_PER_DAY));
}

/**
 * Domain age in whole days (floored, never negative) from the RDAP registration event, with the outcome
 * (`RdapOutcome`). A 429 or 5xx is retried once, after its `Retry-After` (capped at `RDAP_RETRY_AFTER_MAX_MS`) or
 * else `RDAP_RETRY_MS`. Pacing between requests is the caller's (`pacedHttp`).
 */
export async function rdapDomainAge(
  http: Http,
  domain: string,
  now: Date,
  sleep: (ms: number) => Promise<void> = defaultSleep,
  clock: () => number = Date.now,
): Promise<RdapResult> {
  const url = `https://rdap.org/domain/${encodeURIComponent(domain.toLowerCase())}`;
  let res = await http.get(url);
  if (res.status === 429 || res.status >= 500) {
    const asked = retryAfterMs(res.headers?.["retry-after"], clock);
    await sleep(asked === null ? RDAP_RETRY_MS : Math.min(asked, RDAP_RETRY_AFTER_MAX_MS));
    res = await http.get(url);
  }
  if (res.status === 200) {
    const days = ageFromBody(res.body, now);
    return days === null ? { outcome: "no_date", days: null } : { outcome: "age", days };
  }
  if (res.status === 404) return { outcome: "no_rdap", days: null };
  if (res.status === 429) return { outcome: "rate_limited", days: null };
  return { outcome: "failed", days: null };
}
