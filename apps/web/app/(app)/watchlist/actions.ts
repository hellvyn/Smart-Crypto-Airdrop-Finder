"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";
import { setWatching } from "@/lib/watchlist";

/**
 * Watch or unwatch a project for the signed-in user. With `desired` the call is idempotent (the watch button always
 * sends the state it wants); without it the current state is flipped.
 */
export async function toggleWatch(projectId: string, desired?: boolean): Promise<{ watching: boolean }> {
  await requireUser();
  if (!isUuid(projectId)) throw new Error("Invalid project id");
  const db = await createServerClient();
  const watching = await setWatching(db, projectId, desired);
  revalidatePath("/watchlist");
  return { watching };
}

/** Form entry point for the watch button: reads `projectId` and the wanted state (`watch` = "1" | "0"). */
export async function submitWatch(formData: FormData): Promise<void> {
  const projectId = formData.get("projectId");
  const want = formData.get("watch");
  if (!isUuid(projectId) || (want !== "1" && want !== "0")) throw new Error("Invalid watch request");
  await toggleWatch(projectId, want === "1");
}
