import type { EmailOtpType } from "@supabase/supabase-js";
import { safeNextPath } from "./safe-next";

const EMAIL_OTP_TYPES: readonly EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/** The `type` of a `token_hash` email link, or null when it is not one Supabase issues. */
export function parseEmailOtpType(raw: string | null): EmailOtpType | null {
  return EMAIL_OTP_TYPES.find((t) => t === raw) ?? null;
}

/** Where /auth/callback sends the user after a successful verification. Recovery always sets a new password. */
export function callbackDestination(type: EmailOtpType | null, next: string | null): string {
  if (type === "recovery") return "/update-password";
  return safeNextPath(next);
}
