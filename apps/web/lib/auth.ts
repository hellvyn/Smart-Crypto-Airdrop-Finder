import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createServerClient } from "./supabase/server";

/** The signed-in user, verified with Supabase Auth, or null. Cached for the duration of one request. */
export const getUser = cache(async (): Promise<User | null> => {
  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
});

/** The signed-in user; redirects to /login when there is none. */
export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}
