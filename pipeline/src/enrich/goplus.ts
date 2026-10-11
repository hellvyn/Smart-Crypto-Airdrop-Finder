import { z } from "zod";
import type { Http } from "../collectors/types.js";
import { defaultSleep } from "./time.js";

const responseSchema = z.object({
  code: z.number(),
  result: z.object({ phishing_site: z.number() }),
});

/** GoPlus signals "too many requests" with HTTP 200 and this `code` in the body (observed live), not only with 429. */
const GOPLUS_RATE_LIMIT_CODE = 4029;

/**
 * Pause before the single retry after GoPlus rate-limits (429 or 200 with code 4029) or fails (5xx).
 * Live measurement: the first request 5 s after a 4029 was answered normally.
 */
export const GOPLUS_RETRY_MS = 5000;

/**
 * Minimum pause between two consecutive GoPlus requests in one run. Live measurement: the API refused the 31st
 * request of a back-to-back burst (about 3.5 requests/s), and 18 requests one second apart were all answered.
 * 1.5 s keeps a margin over the 1 s that was measured to be safe.
 */
export const GOPLUS_MIN_INTERVAL_MS = 1500;


function bodyCode(body: string): unknown {
  try {
    return (JSON.parse(body) as { code?: unknown } | null)?.code;
  } catch {
    return undefined;
  }
}

function isRateLimited(res: { status: number; body: string }): boolean {
  return res.status === 429 || (res.status === 200 && bodyCode(res.body) === GOPLUS_RATE_LIMIT_CODE);
}

function isRetryable(res: { status: number; body: string }): boolean {
  return isRateLimited(res) || res.status >= 500;
}

/**
 * Asks GoPlus whether a URL is a known phishing site. A 429, a 200 with code 4029, or a 5xx is retried once after
 * `GOPLUS_RETRY_MS`. Returns true (listed), false (not listed), or null on any error or unexpected response.
 * `onRateLimited` is called when the answer is still a rate limit (429 or 4029) after that retry.
 */
export async function checkPhishingSite(
  http: Http,
  url: string,
  sleep: (ms: number) => Promise<void> = defaultSleep,
  onRateLimited?: () => void,
): Promise<boolean | null> {
  const endpoint = `https://api.gopluslabs.io/api/v1/phishing_site?url=${encodeURIComponent(url)}`;
  let res = await http.get(endpoint);
  if (isRetryable(res)) {
    await sleep(GOPLUS_RETRY_MS);
    res = await http.get(endpoint);
    if (isRateLimited(res)) onRateLimited?.();
  }
  if (res.status !== 200) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(res.body);
  } catch {
    return null;
  }
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success || parsed.data.code !== 1) return null;
  const flag = parsed.data.result.phishing_site;
  if (flag === 1) return true;
  if (flag === 0) return false;
  return null;
}
