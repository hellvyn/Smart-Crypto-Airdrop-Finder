import type { User } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth, errors } from "./copy";
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

/**
 * The Indonesian text for a failed login: wrong credentials, a rate limit, a network failure, or the generic message
 * for anything else. Supabase's own message is never passed through (it may name internals).
 */
export function loginErrorMessage(error: unknown): string {
  const { name, code, status } = (error ?? {}) as { name?: unknown; code?: unknown; status?: unknown };
  if (code === "invalid_credentials") return auth.errors.invalidCredentials;
  if (status === 429 || (typeof code === "string" && /^over_.*rate_limit$/.test(code))) return auth.errors.rateLimited;
  if (name === "AuthRetryableFetchError") return auth.errors.network;
  return errors.generic;
}
