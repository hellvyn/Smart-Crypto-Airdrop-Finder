# AGENTS.md

Instructions for any coding agent working in this repo (Claude Code, Codex, Cursor, and others). Humans can read it
too. Start here, then read `docs/superpowers/HANDOFF.md` (current state and open items) and `README.md` (overview).

## What this is

AirdropIQ: a curated crypto airdrop list for Indonesian users. A daily pipeline collects and checks airdrops; the web
app shows the ones that pass curation. Members (added by hand) also get AI features (verdict, farming tracker,
watchlist, briefing, AI Coach). The UI text is Indonesian. Code, docs and commit messages are English.

## Commands

Run from the repo root (pnpm 10, Node from `.nvmrc`):

| Task | Command |
|---|---|
| Install | `pnpm install` |
| Typecheck everything | `pnpm typecheck` |
| Unit tests, all packages | `pnpm test` |
| One package | `pnpm --filter web test`, `--filter @saf/core`, `--filter pipeline` |
| One test file (web) | `cd apps/web && pnpm exec vitest run test/<file>` |
| Web dev server | `pnpm --filter web dev` (http://127.0.0.1:3000, webpack) |
| Local database | `npx -y supabase@2.120.0 start` (Docker; the CLI is not installed globally) |
| pgTAP tests | `npx -y supabase@2.120.0 test db` (`db reset` first if migrations changed) |
| e2e (Playwright) | `pnpm --filter web e2e` (needs the local stack; slow) |
| LLM model eval | `pnpm --filter pipeline eval` (needs model keys; costs money) |

Run only what your change needs. Typecheck plus the unit tests of the touched package is the normal bar. e2e takes a
long time and costs Actions minutes; use it when you change a user flow, auth, the Coach, quota or data.

## Layout and boundaries

- `packages/core` (`@saf/core`): pure domain logic. No I/O, no network, no database. Curation, risk, Coach prompt and
  guards. Keep it that way.
- `packages/llm`: providers and the model chain (`src/models.ts`): Claude Sonnet first when `ANTHROPIC_API_KEY` is
  set, then the freellm router, then NVIDIA models. Streaming, per-request circuit breaker.
- `pipeline`: the daily job (`src/main.ts`) and the eval. Runs in GitHub Actions (`daily.yml`, every 4 days at 23:00 UTC).
- `apps/web`: Next.js 16 App Router, Supabase SSR. `lib/` holds server logic and queries, `components/` the UI,
  `lib/copy.ts` every user-facing string, `proxy.ts` the session middleware. `dev` and `build` use `--webpack` on
  purpose (`@saf/core` is consumed from TypeScript source).
- `supabase/migrations`: numbered SQL, latest is `0019`. `supabase/tests`: pgTAP.
- `docs/ops/web.md` and `docs/ops/pipeline.md`: runbooks. Specs and plans under `docs/superpowers/`. The
  `execution-ledger.md` there records owner decisions and deferred items.

## Rules that must hold

Security and privacy:
- No service role key in `apps/web`, its env, or the browser. Row Level Security protects user data.
- Secrets live in GitHub Secrets, Vercel env and Supabase. Never in the repo, never in chat, never in logs.
- Never log emails, wallet addresses, user ids, prompts or model answers.
- The Coach never forwards a seed phrase or private key: `looksLikeSecret` runs before any database or model call.
- Wallet addresses are never sent to third-party checkers.
- Advanced check results and the scam analysis are member-only and enforced in the database (column revokes, the
  `public_risk_checks` view, grants). The AI verdict is member-only too and is never queried for a visitor
  (`lib/queries.ts`). Do not move any of that into the client.

Database:
- Any schema change is a new numbered migration. Never edit an applied one. Add or update a pgTAP test with it.
- Time-of-day dependent tests have broken at 00:00 WIB before (WIB is the quota day). Make fixtures tolerate that.
- Applying migrations to the hosted project changes production data: ask the owner first.
- The hosted Supabase MCP tool can hang on a `delete` inside a function body; apply such migrations with
  `execute_sql` in pieces.

Copy (UI text):
- All strings go in `apps/web/lib/copy.ts`, in Indonesian, "kamu" tone, casual.
- `apps/web/test/copy-style.test.ts` enforces: no banned words (`BANNED_WORDS` in `@saf/core`), no em dash, straight
  quotes only. Run it after touching copy.

UI:
- Mobile first: check 360px width. No horizontal page scroll.
- Colours are tokens in `apps/web/app/globals.css`. Main actions are green (`Button variant="primary"`), negative
  actions are red (`variant="danger"`, for example Logout, Berhenti garap, Hapus). Keep that consistent site-wide.
- The brand lockup (logo, "AirdropIQ" with orange "IQ", Beta label) is in `components/site-header.tsx`; the owner has
  fixed its layout. Do not change it without being asked.

Code:
- Match the surrounding style, comment density and naming. Prefer small, focused files.
- Add a test with a behavior change. Do not skip, disable or loosen a test to get green.
- No model identifiers in commit messages, PR text or code comments (product config in `packages/llm` is the exception).

## Git, CI and deploy

- Work on a feature branch and open a PR to `main`; merge when CI is green. Do not push to `main` directly. Do not
  open a PR or merge unless the owner (or the task) asks for it.
- CI (`ci.yml`) runs on push: typecheck and unit tests always. The slow `e2e` job (with pgTAP) is **off**: it
  runs only on a manual dispatch of the CI workflow, because GitHub Actions minutes are limited (private repo, 2,000 a
  month). Run it by hand before a risky change (auth, quota, migrations). Docs-only pushes skip CI.
- **Vercel Hobby allows 100 deployments per day, and every push to any branch is a preview deployment.** When the
  limit is hit, Vercel refuses to deploy and a merge to `main` produces no production deployment (error 402
  `api-deployments-free-per-day`). Batch your pushes. Always check the Deployments tab for the merge commit; do not
  assume it deployed. `[skip ci]` is not honored by Vercel.
- Production: https://smart-airdrop-finder.vercel.app. Env vars named `NEXT_PUBLIC_*` are inlined at build time, so a
  change needs a new deployment.
- The daily pipeline can be run by hand from the Actions tab (`workflow_dispatch`).

## Access you will need

The repo holds no credentials. For anything beyond reading and editing code you need your own access to GitHub
(PRs, Actions), Vercel (deployments, env) and Supabase (database, Auth settings), plus the model keys for the eval.
If you do not have it, say so and stop; do not work around it. Environment variables are listed in
`docs/ops/web.md` section 1 and `docs/ops/pipeline.md` section 2.

## Working with the owner

- Reply in Indonesian, casual "gue/lo", direct, no fluff.
- Data first. Label claims `[FACT]` (supported by data), `[INFERENCE]` (likely), `[UNKNOWN]` (cannot be known from
  what you have). Do not invent facts, numbers or results. Challenge assumptions; the owner prefers truth over
  agreement.
- The owner is often away and has said: finish everything without asking, and debug properly. Still ask before
  anything that spends money, changes billing or plans, buys a domain, rotates or revokes keys, or changes
  third-party accounts.
- Do not add features or content that was not asked for (examples declined so far: SEO guide content, competitor
  research, a third-party AI disclosure line on the Tanya AI page).

## Common pitfalls

- Pushing many small commits burns the Vercel deployment quota and cancels in-flight CI runs.
- A passing local typecheck is not enough when copy changes: run `copy-style`.
- `proxy.ts` (not `middleware.ts`) is the Next.js 16 middleware file here.
- The container network may block some hosts; do not disable TLS checks to get around it.
- Hosted Supabase and production are shared and live: reads are fine, writes need the owner's approval.
