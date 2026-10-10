// Test-harness only. Accounts are created by an admin in production too (signups are off, nothing sends email), so
// the tests create their users through the admin API with the email already confirmed.
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
