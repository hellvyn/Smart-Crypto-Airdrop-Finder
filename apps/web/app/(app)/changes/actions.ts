"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { LIST_PATH } from "@/lib/routes";
import { createServerClient } from "@/lib/supabase/server";

/**
 * "Tandai sudah dibaca" (used on /airdrops and /watchlist): marks the signed-in member's changes seen. No time is sent
 * from anywhere: the update writes null, and the trigger of 0014 replaces any value written to `changes_seen_at` with
 * the database's now(). RLS plus the column grant keep the update to this column of the member's own profile. Near
 * deadlines are reminders and are not affected.
 */
export async function markChangesSeen(): Promise<void> {
  const user = await requireUser();
  const db = await createServerClient();
  const { data, error } = await db
    .from("profiles")
    .update({ changes_seen_at: null })
    .eq("user_id", user.id)
    .select("user_id");
  if (error) throw new Error(`Failed to mark the changes seen: ${error.message}`);
  if (!data || data.length === 0) throw new Error("Failed to mark the changes seen: no profile found");
  revalidatePath(LIST_PATH);
  revalidatePath("/watchlist");
}
