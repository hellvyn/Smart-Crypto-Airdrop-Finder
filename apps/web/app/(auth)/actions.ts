"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/auth-form";
import { safeNextPath } from "@/lib/safe-next";
import { createServerClient } from "@/lib/supabase/server";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Origin of the current request, for links Supabase puts in emails (checked against its redirect allow-list). */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "127.0.0.1:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
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
    options: {
      emailRedirectTo: `${await requestOrigin()}/auth/callback?${new URLSearchParams({ next }).toString()}`,
    },
  });
  if (error) return { error: error.message };
  // With email confirmations on (production), there is no session until the user opens the link.
  if (!data.session) return { message: "Check your email to confirm your account, then log in." };
  redirect(next);
}

export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await createServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(field(formData, "email"), {
    redirectTo: `${await requestOrigin()}/auth/callback?next=%2Fupdate-password`,
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
