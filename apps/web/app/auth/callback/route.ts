import { NextResponse, type NextRequest } from "next/server";
import { callbackDestination, parseEmailOtpType } from "@/lib/auth-callback";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Target of the links in Supabase auth emails (signup confirmation, password recovery):
 * - `?token_hash=...&type=...` (the email templates in supabase/templates/): verified with `verifyOtp`.
 * - `?code=...` (PKCE redirect from Supabase's own /verify endpoint): exchanged for a session.
 * On success the session cookies are set and the user is redirected; recovery always goes to /update-password.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = parseEmailOtpType(params.get("type"));

  const supabase = await createServerClient();
  let ok = false;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  }

  // The error page copy is fixed rather than echoed from the URL, so the link cannot inject text.
  return redirectTo(ok ? callbackDestination(type, params.get("next")) : "/login?error=link");
}

/**
 * Same-origin redirect with a relative Location. `request.url` in a route handler reports the server's bind host
 * (e.g. localhost), which can differ from the host the browser used, and the session cookies belong to the latter.
 * `path` is always a safe relative path (callbackDestination). The cookies set through `cookies()` are kept.
 */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}
