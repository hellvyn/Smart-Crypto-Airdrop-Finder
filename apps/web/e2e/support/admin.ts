// Test-harness only. There is no inbox in CI or the sandbox, so the tests get the verification and recovery
// links that Supabase would email by calling the admin API (`generateLink`), then open them the way the email
// templates in supabase/templates/ build them: /auth/callback?token_hash=<hashed_token>&type=email|recovery
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let admin: SupabaseClient | undefined;

export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env not loaded (see e2e/support/supabase-env.ts)");
  admin ??= createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return admin;
}

const createdEmails = new Set<string>();

export function uniqueEmail(tag: string): string {
  const email = `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  createdEmails.add(email);
  return email;
}

/** A confirmed account, as if the user had already verified their email. */
export async function createConfirmedUser(email: string, password: string): Promise<void> {
  const { error } = await adminClient().auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
}

/**
 * Does what a signup does when email confirmations are on (the production setting): creates an unconfirmed
 * account and returns the link from the confirmation email.
 */
export async function signupVerificationLink(email: string, password: string): Promise<string> {
  const { data, error } = await adminClient().auth.admin.generateLink({ type: "signup", email, password });
  if (error) throw error;
  return callbackPath(data.properties.hashed_token, "email"); // as supabase/templates/confirmation.html
}

/** The link from the password-reset email. */
export async function recoveryLink(email: string): Promise<string> {
  const { data, error } = await adminClient().auth.admin.generateLink({ type: "recovery", email });
  if (error) throw error;
  return callbackPath(data.properties.hashed_token, "recovery"); // as supabase/templates/recovery.html
}

function callbackPath(tokenHash: string, type: string): string {
  return `/auth/callback?${new URLSearchParams({ token_hash: tokenHash, type }).toString()}`;
}

export async function deleteCreatedUsers(): Promise<void> {
  if (createdEmails.size === 0) return;
  const client = adminClient();
  const { data, error } = await client.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  for (const user of data.users) {
    if (user.email && createdEmails.has(user.email)) await client.auth.admin.deleteUser(user.id);
  }
  createdEmails.clear();
}
