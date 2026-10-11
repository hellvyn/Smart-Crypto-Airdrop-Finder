# Web app runbook

How to run, test, configure and manage members of the Next.js dashboard (`apps/web`). It signs users in with
Supabase Auth (email + password), but there is no self-service signup and no email at all: the owner adds each
member by hand in the Supabase Dashboard (section 4). Spec: decisions #31 to #34 and section 15.5 of
`docs/superpowers/specs/2026-10-10-curation-foundation-design.md`. Sections 8 and 9 of
`docs/superpowers/specs/2026-10-10-smart-airdrop-finder-design.md` (email digest, signup, verification and
password-reset emails) are superseded by it.

## 1. Environment

The web app reads two settings, none of them secret (see `apps/web/.env.example`). They are inlined at build
time, so set them before `build`. The third, `NEXT_PUBLIC_SITE_URL`, is only for the e2e tests:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | project URL (`https://<ref>.supabase.co`; locally `http://127.0.0.1:54321`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the project's anon (public) key |
| `NEXT_PUBLIC_SITE_URL` | base URL of the web app (locally `http://127.0.0.1:3000`). The app no longer reads it: only the Playwright config and CI set it, to the e2e server's address |
| `COINGECKO_API_KEY` | optional, **secret, server-side only**: the CoinGecko Demo API key for token prices (section 6). Read at runtime, never inlined, never a `NEXT_PUBLIC_` name |

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

Public pages: `/` (landing), `/airdrops`, `/projects/<slug>` and `/login`. The signed-in pages (`/watchlist`,
`/wallets` and `/settings`) redirect a signed-out visit to `/login?next=<page>`; after login the user goes back
there. `next` only accepts same-site paths and is used exactly as given (`apps/web/lib/safe-next.ts`; anything that
is, or normalises to, `//...` is replaced by `/watchlist`).

There is no page to register, to ask for a password reset, or to confirm an email address, and the old
email-link URLs (`/auth/callback`, `/unsubscribe`) answer 404. A person without access sees only the login form and
the text "Belum punya akses? Hubungi admin.".

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
  only by the test harness (`apps/web/e2e/support/`) to create already-confirmed test users
  (`auth.admin.createUser` with `email_confirm: true`), the same state "Auto Confirm User" gives a member in the
  Dashboard. The web server is started with that key blanked out.

CI (`.github/workflows/ci.yml`, job `e2e`) starts Supabase without Mailpit and the other unneeded services, runs the
pgTAP tests (`supabase test db`), builds the app and runs Playwright with Chromium installed in
`PLAYWRIGHT_BROWSERS_PATH`.

## 4. Manage members

Members exist only because the owner created them. Do all of this in the Supabase Dashboard of the production
project, **Authentication**. Nothing here sends an email, and no step needs the service role key outside the
Dashboard.

**One-time setup** (before the first real member; the hosted project must differ from the local config here):

1. **Sign In / Providers:** turn off **Allow new users to sign up**. Without this, anyone can still create an
   account through the Auth API with the public anon key, even though the web app has no signup page.
2. **Sign In / Providers > Email:** turn off **Secure password change**. It is off because reauthentication needs
   an email, which this project cannot send, and because the app has no password change at all (owner decision #60).
   Decision #60 is UI-only: a member could still change their own password through the Supabase Auth API with their
   own session. That is an accepted risk.
3. Leave **Confirm email** as it is: users are created confirmed (below), so it never has to deliver anything.
   No custom SMTP and no email templates are needed; remove any that were set up for the old flow.

**Add a member:** Authentication > Users > **Add user** > **Create new user**. Enter the email and a password, tick
**Auto Confirm User**, then create. Send the password to the member yourself (Telegram or DM). The member logs in
at `/login` right away. A database trigger creates the member's `profiles` row, so nothing else is needed. Without
Auto Confirm the account stays unconfirmed and login fails. Members cannot change their own password: the app has no
form for it (owner decision #60), so a member who wants a new one asks you, and you reset it as below.

**Reset a password:** open the user in Authentication > Users and set a new password there, then tell the member
in person. Do not use "Send password recovery": there is no SMTP, and the app has no page to receive the link.
If your Dashboard version has no way to set a password, use the Auth Admin API from your own machine (keep the
service role key out of shell history and out of any repo):

```
curl -X PUT "https://<ref>.supabase.co/auth/v1/admin/users/<user-id>" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -d '{"password":"<new password>"}'
```

**Delete a member:** Authentication > Users > the user's menu > **Delete user**. The user's `profiles`, `watchlist`
and `wallets` rows go with the account (foreign keys with `on delete cascade`). Members can also delete their own
account in `/settings`, which removes the same data.

**Local stack.** `supabase/config.toml` has signup off, **Secure password change** off and email
confirmations off, so Mailpit is not needed. Create a local user in the local Studio
(`http://127.0.0.1:54323`, Authentication > Users, **Auto Confirm User** ticked). The e2e tests create their own
users.

## 5. Deploy

Order matters: signup is shut before anything else, and the web app expects the database objects of every migration,
so the database goes before the web build.

1. **Signup off (Supabase Dashboard, before anything else).** Authentication > Sign In / Providers: turn off
   **Allow new users to sign up**. Until this is off, anyone can create an account through the Auth API with the
   public anon key.
2. **Migrations.** Apply `supabase/migrations/0001` through `0007` to the hosted project before deploying the web app:

   ```
   npx -y supabase@2.120.0 link --project-ref <ref>
   npx -y supabase@2.120.0 db push
   ```

   `0004_wallet_rate_limit.sql` adds `claim_wallet_check()`, which the wallet activity API calls on every cache
   miss; a web build without it answers every uncached check with "Data lagi gak tersedia. Coba lagi nanti.".
   `0007_manual_membership.sql` removes what only the email flow used (`notification_log`, `unsubscribe_digest()` and the
   `profiles` columns for the email preferences and the unsubscribe token). Existing user data stays. The previous
   web build still reads those columns, so deploy the new build right after applying it. See
   `docs/ops/pipeline.md` section 1 for aligning the production migration history before the first `db push`.
3. **Build-time env.** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are inlined by `next build`:
   set them in the host's build environment, and rebuild after changing either of them. `NEXT_PUBLIC_SITE_URL` is
   not needed for a deploy. The only secret the web app may hold is `COINGECKO_API_KEY` (section 6), a runtime
   server env var; never the service role key.
4. **Build and start.** `pnpm --filter web build`, then `pnpm --filter web start` (plain `next start`; the host's
   `PORT` or `-- --port <n>` picks the port). Hosts that build Next.js themselves need the `--webpack` build script
   (see section 2).
5. **Supabase Auth (dashboard), before announcing the site** (details in section 4): check that **Allow new users to
   sign up** is still off, and turn off **Secure password change**. Then add the first member with Auto Confirm User.
6. **Check.** Every response carries `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`,
   `Referrer-Policy: strict-origin-when-cross-origin` and `X-Content-Type-Options: nosniff` (`apps/web/next.config.ts`);
   a host or proxy in front must not strip them. Then, signed out: `/` and `/airdrops` open and `/watchlist`
   redirects to `/login`. Log in as the member you added, add a wallet and run one wallet check.

## 6. Token prices for "Hasil garapan"

On "Garapan saya" a member enters what an ended airdrop gave them (`farming_results`, migration
`0015_farming_results.sql`). The web stores the USD value at the claim date and shows today's value next to it. The
token is found by the CoinGecko id the pipeline stores in `project_signals` (`coingecko_listed`, `value.gecko_id`);
a project without that signal simply has no price. Code: `apps/web/lib/prices.ts` (server-side only).

**Providers, in order:**

1. **CoinGecko Demo**, only when `COINGECKO_API_KEY` is set. `https://api.coingecko.com/api/v3`, key in the
   `x-cg-demo-api-key` header (never in a URL). Price on a day: `/coins/{id}/history?date=dd-mm-yyyy&localization=false`,
   field `market_data.current_price.usd`. Price now: `/simple/price?ids={id}&vs_currencies=usd`.
2. **DefiLlama coins** (keyless), the fallback when there is no key or CoinGecko answers with an error, a 429, any
   other non-200 or an unexpected shape. Coin key `coingecko:{id}`. Price on a day (00:00 UTC):
   `https://coins.llama.fi/prices/historical/{unixSeconds}/coingecko:{id}`; price now:
   `https://coins.llama.fi/prices/current/coingecko:{id}`; field `coins["coingecko:{id}"].price`.

When both fail the price is `null`, nothing throws, and the member sees "Harga belum ketemu, jumlah token tetap
tersimpan." The token amount is saved anyway; "Ubah" + "Simpan" later computes the value again. Answers are cached by
Next's data cache: 24 hours for a past day, 1 hour for the current price (only HTTP 200 answers are cached). Every
request has a 5 second timeout. Nothing in this path logs a user id, an amount or a key.

**`COINGECKO_API_KEY`:** a server-side Vercel environment variable for Production and Preview. The owner adds it in
the Vercel project settings; it is never committed, never put in `.env.example`, and never pasted into chat. Without
it the site runs on DefiLlama alone.

**Attribution and licence.** The CoinGecko Demo plan requires attribution, so wherever a USD value from these prices
is shown (the result box and the "Total hasil garapan" summary) the page shows "Data harga: CoinGecko, DefiLlama"
with links to both. Which provider priced a stored value is not recorded, so both are named. Per third-party sources
the Demo plan carries no commercial licence, and AirdropIQ is a paid membership: the owner accepts that risk
(decision 2026-10-11).

**What is known and what is not:**

- Verified from the build container on 2026-10-11, without a key: `GET /coins/bitcoin/history?date=01-10-2026&localization=false`
  answered 200 with `market_data.current_price.usd` (response header `cache-control: max-age=30, public,
  must-revalidate, s-maxage=1800`), and `GET /simple/price?ids=bitcoin&vs_currencies=usd` answered 200 with
  `{"bitcoin":{"usd":...}}`. An unkeyed request earlier the same day answered 429.
- [UNKNOWN] CoinGecko Demo rate limits, monthly call allowance and how far back `/history` reaches on the Demo plan.
  Not verified; no keyed request was made.
- [UNKNOWN] DefiLlama's live response shape and rate limits: `coins.llama.fi` is blocked by the build container's
  proxy, so the shape above is the documented one, parsed defensively (anything else counts as no price).
- [UNKNOWN] DefiLlama's commercial terms for this use. Not verified.

**Member average.** `farming_result_stats(project)` (security definer, members only) counts the results whose owner
ticked "Boleh dipakai anonim buat rata-rata hasil member" and that have a USD value ("Gak dapet" counts as $0). It
returns only that count and the average, and the average stays empty below 5 members. A member writes their own
`usd_at_claim` (the web computes it, but the column is the member's), so one member can skew the average of a project
with few contributors.

**e2e.** The Playwright config starts `apps/web/e2e/support/prices-stub.mjs` on `127.0.0.1:3101` and points the web
server at it with `PRICES_API_BASE`. `lib/prices.ts` honours that variable only for a plain `http://127.0.0.1` or
`http://localhost` address, so it cannot redirect production requests elsewhere. Do not set it in a deploy.
