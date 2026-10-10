// The signed-in user's EVM wallets. Every function here verifies the user itself with requireUser(), filters by that
// user's id, and relies on RLS ("own wallets ...") as the second barrier. Addresses are stored lowercase (the table
// has a check for it), so a checksum-cased and a lowercase address are the same wallet.
import { isEvmAddress } from "@saf/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "./auth";
import { isUuid } from "./uuid";

export const MAX_LABEL_LENGTH = 64;
export const MAX_WALLETS = 20;

/**
 * Result of adding a wallet. Beyond the brief's `invalid_address | duplicate`, `invalid_label` (label over 64
 * characters) and `limit_reached` (already 20 wallets) are reported as typed errors too, so the page can show them.
 */
export type AddWalletError = "invalid_address" | "duplicate" | "invalid_label" | "limit_reached";
export type AddWalletResult = { ok: true } | { ok: false; error: AddWalletError };

export const WALLET_ERROR_MESSAGES: Record<AddWalletError, string> = {
  invalid_address: "That doesn't look like an EVM address (0x + 40 hex characters).",
  duplicate: "You already added this wallet.",
  limit_reached: `You can add up to ${MAX_WALLETS} wallets.`,
  invalid_label: `Label must be ${MAX_LABEL_LENGTH} characters or fewer.`,
};

export function isAddWalletError(v: unknown): v is AddWalletError {
  return typeof v === "string" && Object.hasOwn(WALLET_ERROR_MESSAGES, v);
}

export interface WalletItem {
  id: string;
  address: string;
  label: string | null;
}

/** 0x1234…abcd, for lists; the full address goes in a title attribute. */
export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

interface DbError {
  message: string;
  code?: string;
}

function throwIf(error: DbError | null, what: string): void {
  if (error) throw new Error(`Failed to ${what}: ${error.message}`);
}

/** Maps a failed insert to a typed error, or null when it is not one the user can fix. */
function insertError(error: DbError): AddWalletError | null {
  if (error.code === "23505") return "duplicate";
  if (error.code === "23514") {
    // Both the per-user wallet limit (trigger) and the label length (column check) raise 23514.
    return /wallet limit/i.test(error.message) ? "limit_reached" : "invalid_label";
  }
  return null;
}

export async function insertWallet(db: SupabaseClient, input: { address: string; label?: string }): Promise<AddWalletResult> {
  const user = await requireUser();
  const address = (input.address ?? "").trim();
  if (!isEvmAddress(address)) return { ok: false, error: "invalid_address" };
  const label = (input.label ?? "").trim();
  // Code points, like the database's char_length (not UTF-16 units).
  if ([...label].length > MAX_LABEL_LENGTH) return { ok: false, error: "invalid_label" };
  const { error } = await db
    .from("wallets")
    .insert({ user_id: user.id, address: address.toLowerCase(), chain_family: "evm", label: label === "" ? null : label });
  if (error) {
    const typed = insertError(error);
    if (typed) return { ok: false, error: typed };
    throwIf(error, "add the wallet");
  }
  return { ok: true };
}

/** Deletes one of the signed-in user's wallets. Not an error when it does not exist (or belongs to someone else). */
export async function removeWallet(db: SupabaseClient, id: string): Promise<void> {
  const user = await requireUser();
  if (!isUuid(id)) throw new Error("Invalid wallet id");
  const { error } = await db.from("wallets").delete().eq("id", id).eq("user_id", user.id);
  throwIf(error, "delete the wallet");
}

/** The signed-in user's wallets, ordered by address. */
export async function listWallets(db: SupabaseClient): Promise<WalletItem[]> {
  const user = await requireUser();
  const { data, error } = await db
    .from("wallets")
    .select("id,address,label")
    .eq("user_id", user.id)
    .order("address", { ascending: true });
  throwIf(error, "load the wallets");
  return ((data ?? []) as { id: unknown; address: unknown; label: unknown }[]).map((r) => ({
    id: String(r.id),
    address: String(r.address),
    label: typeof r.label === "string" ? r.label : null,
  }));
}
