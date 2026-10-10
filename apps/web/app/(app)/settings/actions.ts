"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { DELETE_CONFIRMATION, saveSettings, type Settings, type SettingsError } from "@/lib/settings";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Saves the signed-in user's settings. The time zone must be one of `Intl.supportedValuesOf("timeZone")` (or UTC);
 * otherwise `{ ok: false, error: "invalid_timezone" }` is returned and nothing is written.
 */
export async function updateSettings(input: Settings): Promise<{ ok: true } | { ok: false; error: SettingsError }> {
  await requireUser();
  const db = await createServerClient();
  const result = await saveSettings(db, input);
  if (result.ok) revalidatePath("/settings");
  return result;
}

/** Form entry point: back to /settings with `?saved=1`, or `?error=<code>` when the settings were refused. */
export async function submitUpdateSettings(formData: FormData): Promise<void> {
  const timezone = formData.get("timezone");
  const result = await updateSettings({
    timezone: typeof timezone === "string" ? timezone : "",
  });
  redirect(result.ok ? "/settings?saved=1" : `/settings?error=${result.error}`);
}

/**
 * Deletes the signed-in user's account and everything tied to it (the `delete_my_account` function cascades to the
 * profile, watchlist, wallets and their checks). `confirmation` must be exactly "DELETE", re-checked here. On success
 * the session is ended and the user is sent to /?deleted=1, so this only ever returns for a wrong confirmation.
 * A failing RPC throws before anything is signed out.
 */
export async function deleteAccount(input: { confirmation: string }): Promise<{ ok: false; error: "confirmation_mismatch" }> {
  await requireUser();
  if (input.confirmation !== DELETE_CONFIRMATION) return { ok: false, error: "confirmation_mismatch" };
  const db = await createServerClient();
  const { error } = await db.rpc("delete_my_account");
  if (error) throw new Error(`Failed to delete the account: ${error.message}`);
  // The auth user is already gone; this clears the session cookies (the server ignores the dead token).
  await db.auth.signOut();
  redirect("/?deleted=1");
}

/** Form entry point for the delete form; a wrong confirmation goes back to /settings with `?error=confirmation`. */
export async function submitDeleteAccount(formData: FormData): Promise<void> {
  const confirmation = formData.get("confirmation");
  const result = await deleteAccount({ confirmation: typeof confirmation === "string" ? confirmation : "" });
  if (!result.ok) redirect("/settings?error=confirmation");
}
