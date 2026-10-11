"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/auth-form";
import { loginErrorMessage } from "@/lib/auth";
import { captchaSiteKey } from "@/lib/captcha";
import { auth } from "@/lib/copy";
import { clientAddress, loginAllowed, reportLoginFailure, throttleKeys } from "@/lib/login-throttle";
import { safeNextPath } from "@/lib/safe-next";
import { createServerClient } from "@/lib/supabase/server";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Logs in with email and password. A refusal comes back as an Indonesian message (loginErrorMessage); Supabase's own
 * message and the email are never shown or logged. Before Supabase is asked, the throttle (migration 0019) refuses an
 * email or a client address with 5 wrong attempts in the last 15 minutes; a wrong password adds one. When a captcha is
 * configured the token is required and passed on to Supabase Auth, which verifies it.
 */
export async function logIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const supabase = await createServerClient();
  const email = field(formData, "email");
  const keys = throttleKeys(email, clientAddress(await headers()));
  const nonce = Date.now();
  if (!(await loginAllowed(supabase, keys))) return { error: auth.errors.throttled, nonce };
  const captchaToken = field(formData, "captchaToken");
  if (captchaSiteKey() && !captchaToken) return { error: auth.errors.captchaNeeded, nonce };
  let error: unknown;
  try {
    ({ error } = await supabase.auth.signInWithPassword({
      email,
      password: field(formData, "password"),
      ...(captchaToken ? { options: { captchaToken } } : {}),
    }));
  } catch (thrown) {
    error = thrown;
  }
  if (error) {
    if ((error as { code?: unknown } | null)?.code === "invalid_credentials") await reportLoginFailure(supabase, keys);
    return { error: loginErrorMessage(error), nonce };
  }
  redirect(safeNextPath(field(formData, "next")));
}

export async function signOut(): Promise<void> {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
