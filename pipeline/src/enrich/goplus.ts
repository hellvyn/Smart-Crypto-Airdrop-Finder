import { z } from "zod";
import type { Http } from "../collectors/types.js";

const responseSchema = z.object({
  code: z.number(),
  result: z.object({ phishing_site: z.number() }),
});

/**
 * Asks GoPlus whether a URL is a known phishing site.
 * Returns true (listed), false (not listed), or null on any error or unexpected response.
 */
export async function checkPhishingSite(http: Http, url: string): Promise<boolean | null> {
  const res = await http.get(`https://api.gopluslabs.io/api/v1/phishing_site?url=${encodeURIComponent(url)}`);
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
