"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { LIST_PATH } from "@/lib/routes";
import { createServerClient } from "@/lib/supabase/server";

/**
 * "Tandai sudah dibaca": marks the signed-in member's changes seen. The browser sends nothing; the database stamps
 * `changes_seen_at` with its own now() whatever is written (trigger in 0014), and RLS plus the column grant keep the
 * update to this column of the member's own profile.
 */
export async function markChangesSeen(): Promise<void> {
  const user = await requireUser();
  const db = await createServerClient();
  const { data, error } = await db
    .from("profiles")
    .update({ changes_seen_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .select("user_id");
  if (error) throw new Error(`Failed to mark the changes seen: ${error.message}`);
  if (!data || data.length === 0) throw new Error("Failed to mark the changes seen: no profile found");
  revalidatePath(LIST_PATH);
  revalidatePath("/watchlist");
}
