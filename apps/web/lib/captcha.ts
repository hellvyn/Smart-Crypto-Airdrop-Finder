/** The Cloudflare Turnstile site key (public). Without it the login form has no captcha and Supabase must not require one. */
export function captchaSiteKey(): string | null {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null;
}
