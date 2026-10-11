"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import {
  FarmingError,
  addCustomTask,
  archiveTask,
  refreshFromSource,
  saveResult,
  setCheck,
  setShareAnonymous,
  startFarming,
  stopFarming,
  type Cadence,
  type FarmingErrorCode,
  type ResultInput,
} from "@/lib/farming";
import { createServerClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";

// Every action checks the user first itself: the proxy lets server-action POSTs through, so the layout's check is not
// enough. Refusals the member can fix (limits, bad task text) come back as a FarmingError code; form actions send
// them to /garapan?error=<code>, where the page shows FARMING_ERROR_MESSAGES[code]. Anything else is thrown.
// Forms on /garapan carry `from=garapan`: after a success they go back to a plain /garapan, so a message from an
// earlier refusal does not stay on screen. Forms elsewhere (the project page) stay where they are.

type Outcome = { ok: true } | { ok: false; error: FarmingErrorCode };

async function attempt(work: (db: SupabaseClient) => Promise<unknown>): Promise<Outcome> {
  const db = await createServerClient();
  try {
    await work(db);
  } catch (e) {
    if (e instanceof FarmingError) return { ok: false, error: e.code };
    throw e;
  }
  revalidatePath("/garapan");
  return { ok: true };
}

function finish(outcome: Outcome, formData: FormData): void {
  if (!outcome.ok) redirect(`/garapan?error=${outcome.error}`);
  if (formData.get("from") === "garapan") redirect("/garapan");
}

function uuidField(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (!isUuid(value)) throw new Error(`Invalid ${name}`);
  return value;
}

function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Starts farming a project for the signed-in member; also the entry point for the AI Coach (spec #38). */
export async function startFarmingAction(projectId: string): Promise<Outcome> {
  await requireUser();
  if (!isUuid(projectId)) throw new Error("Invalid projectId");
  return attempt((db) => startFarming(db, projectId));
}

/** "Mulai garap" form: `projectId`. */
export async function submitStartFarming(formData: FormData): Promise<void> {
  await requireUser();
  finish(await startFarmingAction(uuidField(formData, "projectId")), formData);
}

/** "Berhenti garap" form: `projectId`. */
export async function submitStopFarming(formData: FormData): Promise<void> {
  await requireUser();
  const projectId = uuidField(formData, "projectId");
  finish(await attempt((db) => stopFarming(db, projectId)), formData);
}

/** "+ Tambah task sendiri" form: `projectId`, `text`, `cadence` ("once" | "daily" | "weekly"). */
export async function submitAddTask(formData: FormData): Promise<void> {
  await requireUser();
  const projectId = uuidField(formData, "projectId");
  const text = textField(formData, "text");
  const cadence = textField(formData, "cadence") as Cadence;
  finish(await attempt((db) => addCustomTask(db, projectId, text, cadence)), formData);
}

/** Archive-task form: `taskId`. */
export async function submitArchiveTask(formData: FormData): Promise<void> {
  await requireUser();
  const taskId = uuidField(formData, "taskId");
  finish(await attempt((db) => archiveTask(db, taskId)), formData);
}

/** "Ambil ulang step dari source" form: `projectId`. */
export async function submitRefresh(formData: FormData): Promise<void> {
  await requireUser();
  const projectId = uuidField(formData, "projectId");
  finish(await attempt((db) => refreshFromSource(db, projectId)), formData);
}

/** Checkbox form: `taskId` and the wanted state `done` ("1" | "0"), so a repeated submit is idempotent. */
export async function submitCheck(formData: FormData): Promise<void> {
  await requireUser();
  const taskId = uuidField(formData, "taskId");
  const done = formData.get("done");
  if (done !== "1" && done !== "0") throw new Error("Invalid done");
  finish(await attempt((db) => setCheck(db, taskId, done === "1")), formData);
}

/**
 * Records the member's airdrop result for an ended project ("Hasil garapan", #51). A server action is a public
 * endpoint, so the flags are checked to be booleans before use ("false" is truthy); shareAnonymous may be left out.
 */
export async function submitResult(projectId: string, input: ResultInput): Promise<Outcome> {
  await requireUser();
  if (!isUuid(projectId)) throw new Error("Invalid projectId");
  if (typeof input?.noReward !== "boolean") throw new Error("Invalid noReward");
  if (input.shareAnonymous !== undefined && typeof input.shareAnonymous !== "boolean") {
    throw new Error("Invalid shareAnonymous");
  }
  return attempt((db) => saveResult(db, projectId, input, new Date()));
}

/** "Dapet berapa dari airdrop ini?" form: `projectId`, `amount`, `claimedOn`; the "Gak dapet" button adds `noReward=1`. */
export async function submitResultForm(formData: FormData): Promise<void> {
  await requireUser();
  const projectId = uuidField(formData, "projectId");
  const input: ResultInput = {
    amount: textField(formData, "amount"),
    claimedOn: textField(formData, "claimedOn"),
    noReward: formData.get("noReward") === "1",
  };
  finish(await submitResult(projectId, input), formData);
}

/** Anonymous-sharing checkbox form: `projectId` and the wanted state `share` ("1" | "0"). */
export async function submitShareAnonymous(formData: FormData): Promise<void> {
  await requireUser();
  const projectId = uuidField(formData, "projectId");
  const share = formData.get("share");
  if (share !== "1" && share !== "0") throw new Error("Invalid share");
  finish(await attempt((db) => setShareAnonymous(db, projectId, share === "1")), formData);
}
