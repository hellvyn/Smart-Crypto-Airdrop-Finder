# Web app runbook

How to run, test and configure the Next.js dashboard (`apps/web`). It signs users in with Supabase Auth (email +
password, email verification, password reset). Spec: sections 9 (accounts, privacy, security) and 10 (web
dashboard) of `docs/superpowers/specs/2026-10-10-smart-airdrop-finder-design.md`.

## 1. Environment

The web app holds exactly two settings (see `apps/web/.env.example`):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | project URL (`https://<ref>.supabase.co`; locally `http://127.0.0.1:54321`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the project's anon (public) key |

The service role key never goes into the web app, its env or the browser. Row Level Security protects user data;
the anon key is meant to be public.

## 2. Run it locally

From the repo root:

```
npx -y supabase@2.120.0 start
npx -y supabase@2.120.0 status          # API URL and anon key
cp apps/web/.env.example apps/web/.env.local   # fill in the two values
pnpm --filter web dev                   # http://127.0.0.1:3000
```

`dev` and `build` use webpack (`--webpack`): `@saf/core` is consumed from TypeScript source and imports its own
files as `./x.js`, which only webpack's `extensionAlias` can map to `./x.ts`.

Pages: `/login`, `/signup`, `/reset-password`, `/update-password`, and the signed-in pages (`/watchlist`, later
`/wallets` and `/settings`). Signed-out visits to a signed-in page redirect to `/login?next=<page>`; after login the
user goes back there. `next` only accepts same-site paths (`apps/web/lib/safe-next.ts`).

Auth email links land on `/auth/callback`, which verifies the token (`token_hash` + `type`, or a PKCE `code`),
sets the session cookies and redirects: recovery links to `/update-password`, everything else to `next` or
`/watchlist`. An invalid or used link goes to `/login?error=link`.

## 3. Tests

- Unit (Vitest, part of `pnpm test`): `apps/web/lib/**/*.test.ts`.
- End to end (Playwright, not part of `pnpm test`): needs the local Supabase stack running.

  ```
  pnpm --filter web e2e
  ```

  The config builds and starts the app on `127.0.0.1:3000` (CI builds in its own step). It reads the URL, anon key
  and service role key from the environment or, if missing, from `supabase status`. The service role key is used
  only by the test harness (`apps/web/e2e/support/`) to create users and to generate the verification and
  recovery links Supabase would email (`auth.admin.generateLink`), because there is no inbox in CI. The web server
  is started with that key blanked out.

CI (`.github/workflows/ci.yml`, job `e2e`) starts Supabase without Mailpit and the other unneeded services, builds
the app and runs Playwright with Chromium installed in `PLAYWRIGHT_BROWSERS_PATH`.

## 4. Auth settings: local vs production

`supabase/config.toml` keeps **email confirmations off** locally: CI and the dev sandbox have no SMTP server, and
with confirmations on, signup fails with "Error sending confirmation email". Password-reset requests likewise
answer "Error sending recovery email" locally when Mailpit is not running; the form shows Supabase's message as-is.

The hosted project must be configured differently. In the Supabase dashboard (Authentication):

1. **Sign In / Providers > Email:** turn on **Confirm email**. With it on, signup shows "Check your email to confirm
   your account, then log in." and no session exists until the link is opened.
2. **Emails > SMTP Settings:** set up custom SMTP. The built-in sender is rate-limited and for testing only
   (Plan 3 Task 6 sets up the email provider).
3. **URL Configuration:** Site URL = the production web URL; add `https://<web-host>/**` to Redirect URLs.
4. **Emails > Templates:** use the link formats from `supabase/templates/` so links go through the web app's
   callback and work in any browser:
   - Confirm signup: `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email`
   - Reset password: `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery`

`/auth/callback` also accepts the PKCE `code` that the default templates (`{{ .ConfirmationURL }}`) produce, but that
only works in the browser where the user signed up or asked for the reset (and is not covered by the e2e tests).
