import type { NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/proxy";

// Next.js 16 renamed the `middleware.ts` convention to `proxy.ts`; this is the app's middleware.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
