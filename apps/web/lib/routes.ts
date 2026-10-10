/** Top-level paths of the signed-in app (the `(app)` route group). The proxy sends signed-out users to /login. */
export const PROTECTED_PREFIXES = ["/watchlist", "/wallets", "/settings"] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** `/login?next=<the page the user asked for>`. */
export function loginRedirectPath(pathname: string, search: string): string {
  return `/login?${new URLSearchParams({ next: `${pathname}${search}` }).toString()}`;
}
