# Handoff: AirdropIQ (Smart Airdrop Finder)

Last updated 2026-10-12. Read this first when starting a new session on this repo. Overview and layout: `README.md`. Rules and commands for any
agent: `AGENTS.md`.

## Where things stand

- Product name **AirdropIQ**, in beta ("Beta Version by Trisna" next to the logo). Paid product; members are added
  by hand. The public web works like AlphaDrops; the AI features are member-only (#45). No signup or payment CTA yet
  (#46).
- **Deployed and live** at https://smart-airdrop-finder.vercel.app (Vercel Hobby). The hosted Supabase has all
  migrations (`0001` to `0019`). The pipeline runs from GitHub Actions every 4 days at 23:00 UTC (06:00 WIB), cut from daily on 2026-10-12 to fit the free Actions minutes. The owner keeps the GitHub budget at $0, so when the minutes run out every workflow stops, CI included.
- Plans 4 to 9 are implemented: curation, AI analysis, membership, farming tracker, Indonesian web UI, and the AI
  Coach with the morning briefing. Progress, rulings and deferred items: `docs/superpowers/execution-ledger.md`.
- Since the first handoff (all merged to `main`):
  - Mobile-first pass over every page (plan table, header and phone menu, filters, 360px check).
  - Button colours: main actions green (Login, Mulai garap), negative actions red (Logout, Berhenti garap, Hapus).
  - "Tanya AI" on a project page answers about that project directly and does not use the profile form or its
    filter. Beta quota: 100 Coach messages per member per WIB day (migration `0018`).
  - Login protection: at most 5 wrong passwords per email per 15 minutes, plus a per-address limit, and a
    Cloudflare Turnstile captcha (migration `0019`). The captcha is **on** in production (Site Key in Vercel,
    secret key in Supabase Auth). Details: `docs/ops/web.md`.
  - Project page "Ringkasan" box: one deadline per kind, one link per domain with labels (X, Website, Telegram).
  - New logo (brain with a parachute), favicon and icons.
  - SEO basics: `robots.txt`, `sitemap.xml`, per-project title, description, canonical and share card. The signed-in
    pages and `/login` are noindex.
  - CI: typecheck and unit tests on every push; e2e (with pgTAP) is off and runs only on a manual dispatch.
- Not done on purpose: no comparison or guide content for SEO, no disclosure line about third-party AI providers on
  the Tanya AI page (owner decision 2026-10-12).

## Source of truth

| What | Where |
|---|---|
| Spec (decisions #1 to #54) | `docs/superpowers/specs/2026-10-10-curation-foundation-design.md` |
| Plans | `docs/superpowers/plans/` |
| Coach and briefing design | `docs/superpowers/specs/2026-10-11-coach-briefing-design.md` |
| Runbooks | `docs/ops/web.md`, `docs/ops/pipeline.md` |
| Locked design C "Sertifikat inspeksi" mockups | `docs/design/airdropiq-c/*.dc.html` |
| AlphaDrops research | `docs/research/2026-10-10-alphadrops-head-to-head.md` |
| UI copy | `apps/web/lib/copy.ts` (every string; `test/copy-style.test.ts` enforces the style rules: "kamu" tone, no em dash, banned words) |

## How we work here

- Owner: respond in Indonesian, casual "gue/lo". Label claims [FACT] / [INFERENCE] / [UNKNOWN]. Data first, no
  guessing, challenge assumptions.
- The owner is often away and has said: finish everything without asking, and debug properly. Still ask before
  anything that spends money, changes billing, or touches third-party accounts.
- Flow used so far: develop on `claude/dreamy-carson-vv0ru2`, open a PR to `main`, merge when CI is green.
- **Batch your pushes.** Vercel Hobby allows 100 deployments per day and every push to any branch is a preview
  deployment. When the limit is hit, merges to `main` produce no deployment (API error 402
  `api-deployments-free-per-day`). Always check the Deployments tab for the merge commit.
- GitHub Actions minutes are limited too (private repo, 2,000 per month; 90% was used by 2026-10-12, mostly CI and
  the pipeline). e2e and pgTAP no longer run automatically: dispatch the CI workflow by hand before a risky change
  (auth, quota, migrations).
- Tests must tolerate runs right after 00:00 WIB (fixtures near midnight have broken pgTAP and e2e before).

## Environment facts (re-check in a new container)

- Docker is installed but the daemon may need `dockerd &`. The `supabase` CLI is not installed; use
  `npx -y supabase@2.120.0 ...`.
- e2e: Playwright, one worker, port 3000, falls back to Chromium at `/opt/pw-browsers/chromium`. Run DB and e2e checks
  one at a time.
- The container proxy blocks some hosts (for example the GitHub artifact blob host), so the eval workflow prints its
  report to the job log.
- The hosted Supabase MCP tool can hang on a `delete` inside a function body; apply such migrations with
  `execute_sql` in pieces.

## Standing rules

- Never paste API keys in chat. Keys go to GitHub Secrets, Vercel env or Supabase.
- No service role key in `apps/web`.
- Never log emails, wallet addresses or user ids.
- Do not buy domains without explicit approval (airdropiq.ai not bought).
- No model identifiers in commit messages, PR text or code comments (product config in `packages/llm` is the
  exception).
- Use the commit trailers your session gives you.

## Owner to-dos (not code)

- Revoke `ANTHROPIC_API_KEY` after 2026-10-27, when the prepaid Claude credit expires. Without the key the Claude step
  is skipped and the chain starts at freellm, then NVIDIA (no code change). Note that the Tanya AI chat then runs
  entirely on the free router and NVIDIA.
- Submit `https://smart-airdrop-finder.vercel.app/sitemap.xml` to Google Search Console if you want search traffic.
- A permanent domain: add it to the Vercel project; the canonical URL follows `VERCEL_PROJECT_PRODUCTION_URL`
  (`lib/site-url.ts`). Do not buy one without approval.
- Consider Vercel Pro, or batch pushes, to avoid the daily deployment limit.
- Unverified in the repo [UNKNOWN]: signup disabled in Supabase, freellm auth on, the GitHub secrets
  (`LLM_API_KEY`, `NVIDIA_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_*`) all set, Vercel Hobby commercial-use terms.
- CoinGecko Demo key is in Vercel; the owner accepted the licence risk (Demo needs attribution and has no commercial
  licence). DefiLlama is the fallback; its terms are unverified.
- Supabase advisor lint "Security Definer View public.public_risk_checks" is intentional (it exposes only the public
  part of the checks). Accepted 2026-10-11; fixing it would mean a different view design.

## Next steps

1. Watch the daily runs: `pipeline_runs.stats` (including `ai_models_tripped`), `ai_analyses.model`, and the
   `/airdrops` tabs.
2. Triage the deferred items in the ledger ("minor (deferred)" and "parked" lines) with the owner.
3. Open product ideas, none planned: more card features (phase B), SEO content, competitor research.
