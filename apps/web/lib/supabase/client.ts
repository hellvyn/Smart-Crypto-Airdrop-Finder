import { createBrowserClient as createSsrBrowserClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "../env";

/** Supabase client for Client Components. Shares the session cookies with the server. */
export function createBrowserClient() {
  return createSsrBrowserClient(supabaseUrl(), supabaseAnonKey());
}
