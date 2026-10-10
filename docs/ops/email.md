# Email operations guide

How email works in Smart Airdrop Finder, how to set up the provider (Brevo), and how to operate and verify it.
Related: the daily pipeline runbook (`docs/ops/pipeline.md`), the web app runbook (`docs/ops/web.md`), and
sections 8 (email) and 9 (privacy) of `docs/superpowers/specs/2026-10-10-smart-airdrop-finder-design.md`.

## 1. What the system sends

| Email | Sent by | Through |
|---|---|---|
| Sign-up verification and password recovery | Supabase Auth | Custom SMTP (Brevo SMTP relay, section 3) |
| Daily digest | the daily pipeline (`pipeline/src/steps/notify.ts`) | Brevo transactional API (`POST /v3/smtp/email`) |

Both kinds are sent from the same Brevo account, so they share one daily quota. On the free plan that is
300 emails per day (`email.dailyLimit` in `pipeline/src/config.ts`). The digest never uses all of it:
`reserveRatio` is 0.2, so the digest budget is `floor(300 x 0.8) = 240` per UTC day minus the digests already
sent that day, which leaves about 60 per day for auth emails. If you change the plan, change `dailyLimit` (and
if needed `reserveRatio`) in that file.

Digest rules, in short: at most one per user per UTC day, only to users with the digest turned on and a
**confirmed** email, and only when it has content. Sections, in order: deadlines within 48 hours, status or risk
changes since the last digest, and (only for users who opted in) new airdrops of the last 24 hours. When the
budget is too small, users with a deadline go first, then users with a risk change, then the rest. Every digest
has an unsubscribe link, and the copy is in English.

## 2. Brevo setup

1. Create a Brevo account (the Free plan is enough to start).
2. **Verify the sender domain.** In Brevo, add your domain under Senders, Domains & Dedicated IPs. Brevo shows
   the DNS records to create at your DNS provider (SPF, DKIM, and a DMARC record if you do not have one). Add them
   exactly as shown there, wait for Brevo to mark the domain as verified, and only then send. Without this, mail
   from your own domain is likely to land in spam or be rejected.
3. **Create an API key** (SMTP & API > API keys) and store it as the GitHub repository secret `BREVO_API_KEY`
   (Settings > Secrets and variables > Actions). Leaving `BREVO_API_KEY` unset turns the email digest off; the
   rest of the pipeline is unaffected.
4. **Set `EMAIL_FROM`** (GitHub secret): the verified sender, either `Name <addr@domain>` or just `addr@domain`.
   With only an address, the sender name is "Smart Airdrop Finder". The address must belong to the verified
   domain.
5. **Set `SITE_URL`** (GitHub secret): the public base URL of the web app, for example
   `https://airdrops.example.com`. It must be an absolute `http(s)` URL without query or fragment. Project links
   and the unsubscribe link in the digest are built only from it. Use the same value as `NEXT_PUBLIC_SITE_URL` in
   the web app.

Once `BREVO_API_KEY` is set, `EMAIL_FROM` and `SITE_URL` are required. A missing or invalid one fails the notify
stage only (`failed_step` 7, exit code 1); the other stages still run (see `docs/ops/pipeline.md` for how stage
failures are recorded).

**Values to read from the Brevo dashboard (do not guess them):** the SMTP host, port and login are shown on the
**SMTP & API** page in Brevo. The SMTP login is not necessarily your account email, and the SMTP password is a key
generated on that page (it is not the API key from step 3 and not your account password). Copy all of them from
there when you set up Supabase in the next section.

## 3. Supabase Auth: custom SMTP

Supabase's built-in email sender is rate-limited and meant for testing, so the hosted project must send through
Brevo. This is also what makes auth emails count against the Brevo quota described in section 1.

In the Supabase dashboard of the hosted project:

1. **Authentication > Emails > SMTP Settings** (the exact menu names move between dashboard versions): enable
   custom SMTP and fill in
   - Host, port, username and password: from the Brevo **SMTP & API** page (see above);
   - Sender email: the address part of `EMAIL_FROM` (it must be on the verified domain);
   - Sender name: the name part of `EMAIL_FROM`, for example "Smart Airdrop Finder".
2. **Authentication > Sign In / Providers > Email:** turn on **Confirm email**. With it off, users could sign up
   with an address they do not own, and the digest would not know which addresses are confirmed.
3. **Authentication > URL Configuration:** Site URL = `SITE_URL`. In Redirect URLs add `<SITE_URL>/auth/callback`
   (or `<SITE_URL>/**`).
4. **Authentication > Emails > Templates:** paste the templates from `supabase/templates/`. They link to the web
   app, not to Supabase:
   - Confirm signup: `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email`
   - Reset password: `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery`

   `/auth/callback` (`apps/web/app/auth/callback/route.ts`) verifies `token_hash` with `type=email` or
   `type=recovery`, the only two types the app accepts, then redirects (recovery to `/update-password`, a verified
   signup to `/watchlist`). It also accepts the PKCE `?code=` exchange (what the default `{{ .ConfirmationURL }}`
   templates produce), but that works only in the browser where the user signed up; the templates above use
   `token_hash`. Any other type, or an invalid or used link, goes to `/login?error=link`. Because the
   link starts with `{{ .SiteURL }}`, a wrong Site URL breaks every auth email.
5. Secure password change and the rest of the web auth settings are in `docs/ops/web.md`, sections 4 and 5.

Supabase may apply its own per-hour rate limit for auth emails once custom SMTP is on; check the Rate Limits page
of the dashboard if signups start failing with "email rate limit exceeded".

## 4. Operating

### Reading the counters

Each pipeline run prints one JSON line of numbers and stores the same numbers in `pipeline_runs.stats`
(`docs/ops/pipeline.md`, section 4). The email counters appear only when email is enabled:

| Counter | Meaning |
|---|---|
| `digests_sent` | digests Brevo accepted (HTTP 201) and that were logged |
| `digests_empty` | recipients with nothing to report today (no email sent) |
| `digests_skipped_quota` | digests left out because today's budget ran out |
| `digests_failed` | digests that could not be built, sent or logged |
| `digests_already_sent` | recipients who already got today's digest (an earlier run, or a concurrent one that logged it first) |

The `digests_*` counters are absent from the stats entirely when `BREVO_API_KEY` is unset (email disabled), so a
missing `digests_sent` usually means the secret is not set or not reaching the job.

Logs and stats contain numbers only: never email addresses, user ids or Brevo response bodies.

### Checking the quota

Brevo shows what was sent under **Transactional > Logs** (and statistics) in the dashboard. Count both the
digest and the auth emails there. The pipeline only knows its own digests: it subtracts the digests it logged
today from the 240 budget, and it cannot see auth emails.

### When to upgrade

If `digests_skipped_quota` is above 0 on 3 consecutive days, the free plan is too small for the user base.
Upgrade the Brevo plan, then raise `email.dailyLimit` in `pipeline/src/config.ts` to the new daily limit and
deploy. Skipped digests are not retried automatically (a manual rerun the same day tries them again if budget remains), but users with a deadline were served first, so the damage
is limited to the lowest-priority recipients.

### `digests_failed` above 0

The job turns red (exit code 1) when `digests_failed` is above 0. Look in Brevo (Transactional > Logs) for rejected
sends, then check that the API key and the `EMAIL_FROM` sender are still valid. A digest that failed to send is
not logged, so the next run sends it again (as long as it still has content).

### Known edge cases

- **Timeout after Brevo accepted the mail.** A send is cut off after 10 seconds and then counted as failed and not
  logged. If Brevo had in fact accepted it, the user can get the same digest again on the next run.
- **Sent but not logged.** If the email was accepted but writing the log row failed, it counts as
  `digests_failed` (the job goes red). Re-running the workflow the same day can then send that user a second
  digest. If you see this, check the database before re-running.
- **Which UTC day.** "Today" for the one-digest-per-day rule is the UTC date taken when the notify stage starts,
  after the earlier stages. The scheduled run starts at 23:00 UTC, so it normally finishes the same day, but a
  very long run that crosses 00:00 UTC logs its digests under the next date.
- **Same-day reruns are safe** otherwise: `notification_log` has one row per user per UTC day, so users who
  already got a digest are skipped (`digests_already_sent`).
- Users who have not confirmed their email never get a digest.
- A digest is only an email: a failed or skipped one has no effect on collecting, scoring or purging.

## 5. Unsubscribe

Every digest contains a link to `<SITE_URL>/unsubscribe?token=<secret>`, where the token is the user's private
unsubscribe token. The flow is built to survive mail clients and link scanners (Outlook and Gmail safe links)
that open links automatically:

- **GET** `/unsubscribe?token=...` only shows a page with an "Unsubscribe from daily digest" button. It changes
  nothing and does not look the token up.
- **POST** (the button) turns the digest off for that profile (`unsubscribe_digest` database function, callable
  without signing in) and redirects to `/unsubscribe?done=1`, which says "You are unsubscribed." Repeating it is
  harmless. A malformed or unknown token shows "This link is invalid or already used."

To turn the digest back on, the user signs in and ticks **Email me a daily digest** in **Settings**. A signed-in
visitor also sees a "Turn it back on in Settings" link on the confirmation page.

## 6. Owner verification checklist

The pipeline code is tested with fake HTTP, so nothing above has been run against the real Brevo account or the
real Supabase project. Do this once after setup:

1. **Apply the migrations** to the hosted project: `npx -y supabase@2.120.0 link --project-ref <ref>` then
   `npx -y supabase@2.120.0 db push`, so everything through `0006_project_changes_seq.sql` is applied. Without
   `0005` there is no `notification_log` or `unsubscribe_digest`, and the notify stage and the unsubscribe page fail.
   Then complete sections 2 and 3, including the GitHub secrets `BREVO_API_KEY`, `EMAIL_FROM` and `SITE_URL`.
2. **Auth email:** sign up a test account on the real web app. The verification email must arrive from the Brevo
   sender (check the From header and that it is not in spam), and its link must land on `/watchlist` after
   `/auth/callback`. Also request a password reset and confirm the recovery link reaches `/update-password`.
3. **Digest:** with that account, watch a project that has a deadline within the next 48 hours (check the project
   page). Make sure Settings has the daily digest on.
4. Run the workflow: Actions > **Daily pipeline** > **Run workflow** (or `gh workflow run daily.yml`).
5. Expect one digest email in the inbox listing that deadline, and in the job log a stats line with
   `"digests_sent"` at least 1 (these counters only exist when `BREVO_API_KEY` is set, see section 4) and `"digests_failed"` 0 (the same numbers are in `pipeline_runs.stats`).
6. Run the workflow again: no second email, and `digests_already_sent` is at least 1.
7. **Unsubscribe:** click the link in the digest, press the button, and see "You are unsubscribed." In the
   Supabase table editor, the test user's `profiles.digest_enabled` must now be `false`. Tick the setting in
   Settings to turn it on again.
8. In Brevo (Transactional > Logs) confirm both the auth email and the digest appear, and note the quota used.
