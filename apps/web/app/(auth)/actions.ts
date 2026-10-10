"use server";

import { redirect } from "next/navigation";
import type { FormState } from "@/components/auth-form";
import { siteUrl } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-next";
import { createServerClient } from "@/lib/supabase/server";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function logIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await createServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: field(formData, "email"),
    password: field(formData, "password"),
  });
  if (error) return { error: error.message };
  redirect(safeNextPath(field(formData, "next")));
}

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  const next = safeNextPath(field(formData, "next"));
  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: field(formData, "email"),
    password: field(formData, "password"),
    // Only used by a default-template (PKCE) email; the app's templates link to /auth/callback directly. No `next`:
    // email links do not carry it, a verified user lands on /watchlist.
    options: { emailRedirectTo: `${siteUrl()}/auth/callback` },
  });
  if (error) return { error: error.message };
  // With email confirmations on (production), there is no session until the user opens the link.
  if (!data.session) return { message: "Check your email to confirm your account, then log in." };
  redirect(next);
}

export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await createServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(field(formData, "email"), {
    // `type=recovery` pins a PKCE (`code`) redirect to /update-password like the template's token_hash link.
    redirectTo: `${siteUrl()}/auth/callback?type=recovery`,
  });
  if (error) return { error: error.message };
  return { message: "If an account exists for this email, a password reset link is on its way." };
}

export async function updatePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await createServerClient();
  const { error } = await supabase.auth.updateUser({ password: field(formData, "password") });
  if (error) return { error: error.message };
  redirect("/watchlist");
}

export async function signOut(): Promise<void> {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
