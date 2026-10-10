# Web app runbook

How to run, test and configure the Next.js dashboard (`apps/web`). It signs users in with Supabase Auth (email +
password, email verification, password reset). Spec: sections 9 (accounts, privacy, security) and 10 (web
dashboard) of `docs/superpowers/specs/2026-10-10-smart-airdrop-finder-design.md`.

## 1. Environment

The web app holds three settings, none of them secret (see `apps/web/.env.example`). They are inlined at build
time, so set them before `build`:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | project URL (`https://<ref>.supabase.co`; locally `http://127.0.0.1:54321`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the project's anon (public) key |
| `NEXT_PUBLIC_SITE_URL` | public base URL of the web app (locally `http://127.0.0.1:3000`); every auth email redirect URL is built from it, never from request headers |

The service role key never goes into the web app, its env or the browser. Row Level Security protects user data;
the anon key is meant to be public.

## 2. Run it locally

From the repo root:

```
npx -y supabase@2.120.0 start
npx -y supabase@2.120.0 status          # API URL and anon key
cp apps/web/.env.example apps/web/.env.local   # fill in the anon key
pnpm --filter web dev                   # http://127.0.0.1:3000
```

`dev` and `build` use webpack (`--webpack`): `@saf/core` is consumed from TypeScript source and imports its own
files as `./x.js`, which only webpack's `extensionAlias` can map to `./x.ts`.

Pages: the public airdrop list (`/`) and project pages (`/projects/<slug>`), `/login`, `/signup`,
`/reset-password`, `/update-password`, and the signed-in pages (`/watchlist`, `/wallets` and `/settings`, all linked
from the header). Signed-out visits to a signed-in page redirect to `/login?next=<page>`; after login the
user goes back there. `next` only accepts same-site paths and is used exactly as given (`apps/web/lib/safe-next.ts`;
anything that is, or normalises to, `//...` is replaced by `/watchlist`).

Auth email links land on `/auth/callback`, which verifies the token (`token_hash` with `type=email` or
`type=recovery`, the only types the app accepts; or a PKCE `code`), sets the session cookies and redirects: recovery
links to `/update-password`, a verified signup to `/watchlist`. Email links carry no `next` (the templates do not
pass one), so a page asked for before signup is not restored after verification. An invalid, used or unsupported
link (magic link, invite, email change) goes to `/login?error=link`.

## 3. Tests

- Unit (Vitest, part of `pnpm test`): `apps/web/lib/**/*.test.ts` and `apps/web/test/**/*.test.{ts,tsx}`.
- Database (pgTAP, not part of `pnpm test`): `supabase/tests/*.test.sql`, run against the local stack with
  `npx -y supabase@2.120.0 test db` (after `db reset` when migrations changed).
- End to end (Playwright, `apps/web/e2e/*.spec.ts`, not part of `pnpm test`): needs the local Supabase stack running.

  ```
  pnpm --filter web e2e
  ```

  The config builds the app and starts it with `next start --hostname 127.0.0.1 --port 3000` (the package's own
  `start` script is a plain `next start`) with `NEXT_PUBLIC_SITE_URL` set to that address (CI
  builds in its own step and exports the same value). It reads the URL, anon key
  and service role key from the environment or, if missing, from `supabase status`. The service role key is used
  only by the test harness (`apps/web/e2e/support/`) to create users and to generate the verification and
  recovery links Supabase would email (`auth.admin.generateLink`), because there is no inbox in CI. The web server
  is started with that key blanked out.

CI (`.github/workflows/ci.yml`, job `e2e`) starts Supabase without Mailpit and the other unneeded services, runs the
pgTAP tests (`supabase test db`), builds the app and runs Playwright with Chromium installed in
`PLAYWRIGHT_BROWSERS_PATH`.

## 4. Auth settings: local vs production

`supabase/config.toml` keeps **email confirmations off** locally: CI and the dev sandbox have no SMTP server, and
with confirmations on, signup fails with "Error sending confirmation email". Password-reset requests likewise
answer "Error sending recovery email" locally when Mailpit is not running; the form shows Supabase's message as-is.

The hosted project must be configured differently. In the Supabase dashboard (Authentication):

1. **Sign In / Providers > Email:** turn on **Confirm email**. With it on, signup shows "Check your email to confirm
   your account, then log in." and no session exists until the link is opened.
2. **Emails > SMTP Settings:** set up custom SMTP. The built-in sender is rate-limited and for testing only;
   the Brevo setup and the SMTP values are in [`docs/ops/email.md`](email.md).
3. **URL Configuration:** Site URL = the production web URL (same value as `NEXT_PUBLIC_SITE_URL`); add
   `https://<web-host>/**` to Redirect URLs.
4. **Emails > Templates:** use the link formats from `supabase/templates/` so links go through the web app's
   callback and work in any browser:
   - Confirm signup: `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email`
   - Reset password: `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery`
5. **Sign In / Providers > Email:** turn on **Secure password change** (`secure_password_change = true`), so changing
   the password needs a recent login (reauthentication). The recovery link creates a fresh session just before
   `/update-password`, which should satisfy it; re-run the reset flow once after turning it on. Locally it stays off.

`/auth/callback` also accepts the PKCE `code` that the default templates (`{{ .ConfirmationURL }}`) produce (signup
redirects to `<site>/auth/callback`, reset to `<site>/auth/callback?type=recovery`), but that only works in the
browser where the user signed up or asked for the reset (and is not covered by the e2e tests).

## 5. Deploy

Order matters: the web app expects the database objects of every migration, so the database goes first.

1. **Migrations.** Apply `supabase/migrations/0001` → `0004` to the hosted project before deploying the web app:

   ```
   npx -y supabase@2.120.0 link --project-ref <ref>
   npx -y supabase@2.120.0 db push
   ```

   `0004_wallet_rate_limit.sql` adds `claim_wallet_check()`, which the wallet activity API calls on every cache
   miss; a web build without it answers every uncached check with "Data unavailable, try again later.".
2. **Build-time env.** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SITE_URL` (the
   public `https://` URL of the web app) are inlined by `next build`: set them in the host's build environment, and
   rebuild after changing any of them. No other secret belongs in the web app (never the service role key).
3. **Build and start.** `pnpm --filter web build`, then `pnpm --filter web start` (plain `next start`; the host's
   `PORT` or `-- --port <n>` picks the port). Hosts that build Next.js themselves need the `--webpack` build script
   (see section 2).
4. **Supabase Auth (dashboard), before the first real signup** (details in section 4):
   - URL Configuration: Site URL = `NEXT_PUBLIC_SITE_URL`; the Redirect URLs allowlist must include
     `<SITE_URL>/auth/callback` (or `<SITE_URL>/**`).
   - Confirm email on, with custom SMTP set up (see [`docs/ops/email.md`](email.md)).
   - Secure password change on (`secure_password_change = true`).
   - Email templates from `supabase/templates/`.
5. **Check.** Every response carries `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`,
   `Referrer-Policy: strict-origin-when-cross-origin` and `X-Content-Type-Options: nosniff` (`apps/web/next.config.ts`);
   a host or proxy in front must not strip them. Then sign up, verify, add a wallet and run one wallet check.
