/**
 * Options of the Supabase session cookies. Nothing in the browser reads them (every client is a server client), so they
 * are HttpOnly: a script injected into a page cannot steal the session. `Secure` is set when the site is served over
 * https (NEXT_PUBLIC_SITE_URL); the local http stack for e2e keeps working without it.
 */
export function sessionCookieOptions(): { httpOnly: true; sameSite: "lax"; secure: boolean; path: "/" } {
  const secure = (process.env.NEXT_PUBLIC_SITE_URL ?? "").startsWith("https://");
  return { httpOnly: true, sameSite: "lax", secure, path: "/" };
}
