"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { coachErrorFrom, saveCoachProfile, type CoachError } from "@/lib/coach";
import { getPlanCards, type PlanCardInfo } from "@/lib/coach-view";
import { coach } from "@/lib/copy";
import { createServerClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

// A server action is a public endpoint and the proxy lets its POSTs through, so each one checks the user itself.
// Everything is written through the member's own session (RLS and the security definer functions of
// 0017_coach_briefing.sql), never a service key.

export type SaveProfileResult = { ok: true } | { ok: false; message: string };

/** Saves the member's Coach profile. The input is untrusted: `coachProfileSchema` checks it again on the server. */
export async function saveCoachProfileAction(input: unknown): Promise<SaveProfileResult> {
  const user = await requireUser();
  const db = await createServerClient();
  const saved = await saveCoachProfile(db, user.id, input);
  if (!saved.ok) return { ok: false, message: saved.error === "bad_input" ? coach.form.errors.save : coach.errors[saved.error] };
  revalidatePath("/coach");
  return { ok: true };
}

export type StartThreadResult = { ok: true; threadId: string } | { ok: false; error: CoachError; message: string };

/** A new thread about one project ("Tanya AI", "Jelasin langkah ini"). It costs nothing: only a message counts. */
export async function startCoachThreadAction(projectId: unknown): Promise<StartThreadResult> {
  await requireUser();
  if (!isUuid(projectId)) return { ok: false, error: "bad_input", message: coach.errors.bad_input };
  const db = await createServerClient();
  const { data, error } = await db.rpc("coach_new_thread", { p_project_id: projectId });
  if (error || typeof data !== "string") {
    const code = coachErrorFrom(error);
    return { ok: false, error: code, message: coach.errors[code] };
  }
  return { ok: true, threadId: data };
}

/** Logo, risk and capital of the projects a plan names, so its cards look like the list's. */
export async function planCardsAction(ids: unknown): Promise<PlanCardInfo[]> {
  await requireUser();
  if (!Array.isArray(ids)) return [];
  return getPlanCards(await createServerClient(), ids.filter((id): id is string => typeof id === "string"));
}

/** "Hapus" on a thread of the history: `threadId`. RLS lets a member delete only their own; messages go with it. */
export async function deleteCoachThread(formData: FormData): Promise<void> {
  await requireUser();
  const threadId = formData.get("threadId");
  if (!isUuid(threadId)) throw new Error("Invalid threadId");
  const db = await createServerClient();
  const { error } = await db.from("coach_threads").delete().eq("id", threadId);
  if (error) throw new Error("Failed to delete the thread");
  revalidatePath("/coach");
}

