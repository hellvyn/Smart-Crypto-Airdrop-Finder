"use server";

import { redirect } from "next/navigation";
import type { FormState } from "@/components/auth-form";
import { loginErrorMessage } from "@/lib/auth";
import { safeNextPath } from "@/lib/safe-next";
import { createServerClient } from "@/lib/supabase/server";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Logs in with email and password. A refusal comes back as an Indonesian message (loginErrorMessage); Supabase's own
 * message and the email are never shown or logged.
 */
export async function logIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await createServerClient();
  let error: unknown;
  try {
    ({ error } = await supabase.auth.signInWithPassword({
      email: field(formData, "email"),
      password: field(formData, "password"),
    }));
  } catch (thrown) {
    error = thrown;
  }
  if (error) return { error: loginErrorMessage(error) };
  redirect(safeNextPath(field(formData, "next")));
}

export async function signOut(): Promise<void> {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
