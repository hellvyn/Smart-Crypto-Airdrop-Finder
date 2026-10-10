"use server";

import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

/**
 * Turns off the daily digest for the profile that owns `token` (the secret from the email link). Needs no sign-in:
 * the visitor is usually logged out, so this uses the anon client and the `unsubscribe_digest` function, which is
 * granted to anon. "done" when a profile has that token (also when it was already unsubscribed, so repeating the
 * request is harmless); "invalid" for a malformed or unknown token. A failing RPC throws; the message never
 * contains the token.
 */
export async function unsubscribe(token: string): Promise<"done" | "invalid"> {
  if (!isUuid(token)) return "invalid";
  const db = await createServerClient();
  const { data, error } = await db.rpc("unsubscribe_digest", { token });
  if (error) throw new Error(`Failed to unsubscribe: ${error.message}`);
  return data === true ? "done" : "invalid";
}

/**
 * Form entry point (POST only; the page's GET never reaches this). Redirects without the token in the URL:
 * `/unsubscribe?done=1` on success, `/unsubscribe` (the invalid view) otherwise.
 */
export async function submitUnsubscribe(formData: FormData): Promise<void> {
  const token = formData.get("token");
  const result = await unsubscribe(typeof token === "string" ? token : "");
  redirect(result === "done" ? "/unsubscribe?done=1" : "/unsubscribe");
}
