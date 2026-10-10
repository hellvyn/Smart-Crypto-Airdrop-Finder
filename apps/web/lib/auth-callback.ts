import type { EmailOtpType } from "@supabase/supabase-js";
import { safeNextPath } from "./safe-next";

// Only the link types the app's email templates produce (supabase/templates/): signup confirmation (`email`) and
// password recovery. Magic links, invites and email changes are not features of this app, so their links are refused.
const EMAIL_OTP_TYPES: readonly EmailOtpType[] = ["email", "recovery"];

/** The `type` of a `token_hash` email link, or null when it is not one this app uses. */
export function parseEmailOtpType(raw: string | null): EmailOtpType | null {
  return EMAIL_OTP_TYPES.find((t) => t === raw) ?? null;
}

/** Where /auth/callback sends the user after a successful verification. Recovery always sets a new password. */
export function callbackDestination(type: EmailOtpType | null, next: string | null): string {
  if (type === "recovery") return "/update-password";
  return safeNextPath(next);
}
