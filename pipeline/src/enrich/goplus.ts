import { z } from "zod";
import type { Http } from "../collectors/types.js";

const responseSchema = z.object({
  code: z.number(),
  result: z.object({ phishing_site: z.number() }),
});

/** Pause before the single retry after GoPlus rate-limits (429) or fails (5xx). */
export const GOPLUS_RETRY_MS = 2000;

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Asks GoPlus whether a URL is a known phishing site. A 429 or 5xx is retried once after `GOPLUS_RETRY_MS`.
 * Returns true (listed), false (not listed), or null on any error or unexpected response.
 */
export async function checkPhishingSite(
  http: Http,
  url: string,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<boolean | null> {
  const endpoint = `https://api.gopluslabs.io/api/v1/phishing_site?url=${encodeURIComponent(url)}`;
  let res = await http.get(endpoint);
  if (res.status === 429 || res.status >= 500) {
    await sleep(GOPLUS_RETRY_MS);
    res = await http.get(endpoint);
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
