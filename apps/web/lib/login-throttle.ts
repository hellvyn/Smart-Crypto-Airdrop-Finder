import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAnonKey } from "./env";

/** Failed logins allowed per email and per client address in 15 minutes (the SQL functions of 0019 enforce it). */
export const MAX_LOGIN_ATTEMPTS = 5;

/** Keyed hashes of the email and of the client address, the only things the throttle ever stores. */
export type ThrottleKeys = { email: string; ip: string | null };

/**
 * The keys for one login. The key is LOGIN_THROTTLE_SECRET when set (server only), else the anon key: either way no
 * email or address is kept in the clear.
 */
export function throttleKeys(email: string, clientAddress: string | null): ThrottleKeys {
  const secret = process.env.LOGIN_THROTTLE_SECRET || supabaseAnonKey();
  const mac = (kind: string, value: string): string => createHmac("sha256", secret).update(`${kind}:${value}`).digest("hex");
  return { email: mac("email", email.trim().toLowerCase()), ip: clientAddress ? mac("ip", clientAddress) : null };
}

/** The client address from the proxy headers (first hop of x-forwarded-for, else x-real-ip), or null. */
export function clientAddress(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || null;
}

/** False when the email already has 5 failures (or the address 30) in 15 minutes. Fails open: a broken throttle must not lock everyone out. */
export async function loginAllowed(db: SupabaseClient, keys: ThrottleKeys): Promise<boolean> {
  try {
    const { data, error } = await db.rpc("login_throttle_allowed", { p_email_key: keys.email, p_ip_key: keys.ip });
    return error ? true : data !== false;
  } catch {
    return true;
  }
}

/** Counts one wrong-password attempt against every key. Never throws. */
export async function reportLoginFailure(db: SupabaseClient, keys: ThrottleKeys): Promise<void> {
  try {
    await db.rpc("login_throttle_fail", { p_email_key: keys.email, p_ip_key: keys.ip });
  } catch {
    // Not counted this time; the login answer does not depend on it.
  }
}
