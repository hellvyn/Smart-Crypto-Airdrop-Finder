import type { User } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { REQUEST_PATH_HEADER, loginRedirectPath } from "./routes";
import { safeNextPath } from "./safe-next";
import { createServerClient } from "./supabase/server";

/** The signed-in user, verified with Supabase Auth, or null. Cached for the duration of one request. */
export const getUser = cache(async (): Promise<User | null> => {
  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
});

/**
 * The signed-in user. When there is none (the session ended while the page was open), redirects to
 * `/login?next=<the page>`, using the path the proxy passed on; plain /login when that is missing or not a safe path.
 */
export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) {
    const page = safeNextPath((await headers()).get(REQUEST_PATH_HEADER), "");
    redirect(page ? loginRedirectPath(page, "") : "/login");
  }
  return user;
}
