import type { NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/proxy";

// Next.js 16 renamed the `middleware.ts` convention to `proxy.ts`; this is the app's middleware.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

// Not on /logo/{id}: a logo is cached publicly, and a session refresh here would put a Set-Cookie on it.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
