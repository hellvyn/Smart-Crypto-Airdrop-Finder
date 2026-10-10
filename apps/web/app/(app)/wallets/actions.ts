"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { insertWallet, removeWallet, type AddWalletResult } from "@/lib/wallets";

/**
 * Adds an EVM wallet for the signed-in user. The address is trimmed, validated and stored lowercase, so a
 * checksum-cased and a lowercase address are the same wallet. Returns `{ ok: false, error }` with
 * `invalid_address | duplicate` per the brief, plus `invalid_label` (label over 64 characters) and `limit_reached`
 * (already 20 wallets).
 */
export async function addWallet(input: { address: string; label?: string }): Promise<AddWalletResult> {
  await requireUser();
  const db = await createServerClient();
  const result = await insertWallet(db, input);
  if (result.ok) revalidatePath("/wallets");
  return result;
}

/** Deletes one of the signed-in user's wallets (and, via a database trigger, its cached checks). */
export async function deleteWallet(id: string): Promise<void> {
  await requireUser();
  const db = await createServerClient();
  await removeWallet(db, id);
  revalidatePath("/wallets");
}

/** Form entry point for the add form; goes back to /wallets, with `?error=<code>` when the wallet was refused. */
export async function submitAddWallet(formData: FormData): Promise<void> {
  const address = formData.get("address");
  const label = formData.get("label");
  const result = await addWallet({
    address: typeof address === "string" ? address : "",
    label: typeof label === "string" ? label : undefined,
  });
  redirect(result.ok ? "/wallets" : `/wallets?error=${result.error}`);
}

/** Form entry point for the (confirmed) delete button. */
export async function submitDeleteWallet(formData: FormData): Promise<void> {
  const id = formData.get("id");
  await deleteWallet(typeof id === "string" ? id : "");
  redirect("/wallets");
}
