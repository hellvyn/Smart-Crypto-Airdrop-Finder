import { createServerClient as createSsrServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAnonKey, supabaseUrl } from "../env";
import { sessionCookieOptions } from "./cookie-options";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers. Reads and writes the session
 * cookies of the current request. Async because `cookies()` is async in Next.js 15+.
 */
export async function createServerClient() {
  const cookieStore = await cookies();
  return createSsrServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookieOptions: sessionCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. The proxy refreshes the session.
        }
      },
    },
  });
}
