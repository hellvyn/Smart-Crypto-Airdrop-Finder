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
        return { status: res.status, body: await res.text() };
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
