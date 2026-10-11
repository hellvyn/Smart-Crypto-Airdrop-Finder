import { createClient } from "@supabase/supabase-js";
import { supabaseAnonKey, supabaseUrl } from "../env";

/**
 * Supabase client with the anon key and no session: it never reads or writes cookies. For public data served in a
 * response that is cached publicly (the logo route), where a refreshed session cookie must never end up in a shared
 * cache. Everything it reads must be readable by anon (RLS still applies).
 */
export function createPublicClient() {
  return createClient(supabaseUrl(), supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
