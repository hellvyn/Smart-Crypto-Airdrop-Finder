import { createServerClient as createSsrServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAnonKey, supabaseUrl } from "../env";
import { REQUEST_PATH_HEADER, proxyRedirect } from "../routes";

/**
 * Runs on every page request: refreshes the Supabase session cookies, sends signed-out users away from the signed-in
 * app pages, and sends old list links (`/?status=live`) to /airdrops. Pages still check the user themselves
 * (`requireUser`); this is not the only guard.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  // Overwrites anything the client sent under this name; requireUser reads it to build /login?next=...
  request.headers.set(REQUEST_PATH_HEADER, `${pathname}${search}`);
  let response = NextResponse.next({ request });

  const supabase = createSsrServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  // Do not run code between creating the client and this call: it is what refreshes an expired session.
  const { data } = await supabase.auth.getClaims();

  const target = proxyRedirect({
    pathname,
    search,
    signedIn: Boolean(data?.claims),
    // Next.js marks server action posts with this header; see proxyRedirect for why they are let through.
    serverAction: request.method === "POST" && request.headers.has("next-action"),
  });
  if (target) {
    const redirect = NextResponse.redirect(new URL(target, request.url));
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }
  return response;
}
