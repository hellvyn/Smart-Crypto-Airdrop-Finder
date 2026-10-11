import { safeNextPath } from "./safe-next";

/** Top-level paths of the signed-in app (the `(app)` route group). The proxy sends signed-out users to /login. */
export const PROTECTED_PREFIXES = ["/garapan", "/coach", "/watchlist", "/wallets", "/settings"] as const;

/** Where the public airdrop list lives (the landing page is `/`). */
export const LIST_PATH = "/airdrops";

/**
 * Request header in which the proxy passes the requested path and query on to the server, so `requireUser` can send
 * a user whose session ended back to the page they were on. The proxy always overwrites it.
 */
export const REQUEST_PATH_HEADER = "x-airdropiq-path";

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** `/login?next=<the page the user asked for>`. */
export function loginRedirectPath(pathname: string, search: string): string {
  return `/login?${new URLSearchParams({ next: `${pathname}${search}` }).toString()}`;
}

/** Query keys of the v1 list, which lived at `/`. */
const V1_LIST_PARAMS = ["status", "risk", "chain", "page"] as const;

/**
 * The v1 list lived at `/`, so its bookmarks (`/?status=live`) go to the list with the same query. Any other query
 * keeps the landing page: `/?deleted=1` (the notice after deleting your account) and the click ids and campaign tags
 * that social and ad platforms add to shared links (`fbclid`, `gclid`, `utm_*`).
 */
export function legacyListRedirect(pathname: string, search: string): string | null {
  if (pathname !== "/") return null;
  const params = new URLSearchParams(search);
  if (!V1_LIST_PARAMS.some((key) => params.has(key))) return null;
  return `${LIST_PATH}${search}`;
}

/**
 * Where the proxy sends a request, or null to let it through. Server action posts are always let through: a redirect
 * response to the action's POST cannot be followed by the page (it shows an error page instead), so the action's own
 * `requireUser` does the redirect.
 */
export function proxyRedirect(req: { pathname: string; search: string; signedIn: boolean; serverAction: boolean }): string | null {
  if (req.serverAction) return null;
  if (!req.signedIn && isProtectedPath(req.pathname)) return loginRedirectPath(req.pathname, req.search);
  return legacyListRedirect(req.pathname, req.search);
}

/** Where a signed-in user who opens /login goes: a safe `next` page, else the list. Never /login itself. */
export function signedInLoginTarget(next: unknown): string {
  const target = safeNextPath(next, LIST_PATH);
  const { pathname } = new URL(target, "http://placeholder.invalid");
  return pathname === "/login" || pathname.startsWith("/login/") ? LIST_PATH : target;
}
