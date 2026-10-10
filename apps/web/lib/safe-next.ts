/** Where users land after logging in when no (valid) `next` is given. */
export const DEFAULT_NEXT = "/watchlist";

const PLACEHOLDER_ORIGIN = "http://placeholder.invalid";

/**
 * Open-redirect guard for `next` parameters: returns `raw` unchanged when it is a same-origin relative path
 * ("/..." but not "//..." or "/\..."), otherwise `fallback`.
 * - Backslashes, whitespace and control characters are rejected outright because browsers normalise them
 *   (e.g. "/\t/evil" and "/\evil" both become "//evil").
 * - Inputs whose dot segments normalise to "//..." (e.g. "/.//evil", "/%2e%2e//evil") are rejected too.
 * - The validated string is returned as given, never the normalised form, so what was checked is what is used.
 */
export function safeNextPath(raw: unknown, fallback: string = DEFAULT_NEXT): string {
  if (typeof raw !== "string") return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (/[\\\s\u0000-\u001f\u007f]/.test(raw)) return fallback;
  let parsed: URL;
  try {
    parsed = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return fallback;
  }
  if (parsed.origin !== PLACEHOLDER_ORIGIN) return fallback;
  if (parsed.pathname.startsWith("//") || parsed.pathname.startsWith("/\\")) return fallback;
  return raw;
}
