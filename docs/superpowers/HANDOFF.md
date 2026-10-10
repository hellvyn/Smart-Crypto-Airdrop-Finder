# Handoff: AirdropIQ (Smart Airdrop Finder)

Last updated 2026-10-10. Read this first when starting a new session on this repo.

## Where things stand

- Product renamed **AirdropIQ**. Paid product; members are added manually. Public web works like AlphaDrops; the
  AI features are member-only (#45). No signup/payment CTA yet (#46).
- Owner: respond in Indonesian, casual "gue/lo". Label claims [FACT] / [INFERENCE] / [UNKNOWN]. Data first, no
  guessing, challenge the owner's assumptions.
- Branch: develop and push only on `claude/dreamy-carson-vv0ru2`. No PR unless the owner asks.
- The spec and all plans are written and pushed. **No implementation of Plans 4–8 has started yet.**

## Source of truth

| What | Where |
|---|---|
| Spec (decisions #1–#54) | `docs/superpowers/specs/2026-10-10-curation-foundation-design.md` (§3 decision table, §15 AlphaDrops, §16 design/copy) |
| Plans, execution order 7 → 4 → 8 → 5 → 6 | `docs/superpowers/plans/2026-10-10-plan-{7,4,8,5,6}-*.md` |
| Locked design C "Sertifikat inspeksi" mockups | `docs/design/airdropiq-c/*.dc.html` (landing, list, project, mobile, garapan) |
| Live mockup canvas (owner comments here) | https://claude.ai/artifact/S5QFoV14fkMUw2g4Xwuy5Y |
| AlphaDrops research | `docs/research/2026-10-10-alphadrops-head-to-head.md` |
| UI copy | Plan 6 Global Constraints glossary. Copy rules (#49): humanizer style, no AI clichés, no em dash, varied sentence length, casual, common English crypto terms OK |

Latest decisions (this session's tail):
- **#52** Capital sub-filter under the list tabs: "Modal:" Semua / Gratis / Butuh $. Row tags "Gratis",
  "Butuh ${x}+", "Butuh $", "Modal belum jelas". Uses the new extraction field `capital_min_usd`. Gas-only counts as
  Butuh $.
- **#53** "04 · Security check" is an inspection report:
  - stat strip, then 4 "Wajib lolos" cards with source + detail, then "Advanced check" rows;
  - show only checks that actually ran (token_security/contract_verified never ran, so they are hidden);
  - `risk_assessments.checks[].detail`.
- **#54** Advanced check results are member-only. Visitors see a "Member only" stamp. Found problems always stay
  public through risk reasons. Enforced in the DB:
  - revoke anon on `risk_assessments.checks`;
  - view `public_risk_checks`;
  - `ai_analyses` kind `scam` becomes authenticated-only.

## Next step: execute the plans with the Workflow tool (owner said "pakai workflow")

1. **Build the dependency map first.** Run the saved workflow `docs/superpowers/workflows/plan-dependency-map.js`
   (Workflow tool, `scriptPath`). It maps per task: files, symbols produced and consumed, migrations, deps, and
   security sensitivity. It also runs a critic pass. The previous run was stopped before finishing, so it has no
   results.
2. **Turn the map into execution waves and show the owner** before launching implementation. The draft from plan
   reading is:
   - Wave 1: P7 ∥ P4. They overlap on `pipeline/src/run.ts`, `stats.ts`, `store`, `config.ts`.
   - Wave 2: P8 ∥ P5. Small overlap: `packages/core/src/index.ts` and migrations.
   - Wave 3: P6.
   - Also fan out inside a plan where tasks are independent. Plan 4 Tasks 1/2/3/7/8/9 look independent.
3. **Review policy agreed with the owner.**
   - Per-task review for security-sensitive tasks (RLS/grants/auth/member gating). Lighter, grouped review for the
     rest.
   - Do not cut scope.
   - Use worktree isolation per parallel branch, merge locally, run all tests, then push only the designated branch.

## Environment facts (from the old container; re-check)

- 4 CPUs, which means Workflow concurrency is about 2 agents at once. That is the real limit on parallel speed. Tell
  the owner.
- Docker is installed but the daemon was not running. It was started with `dockerd &`. `supabase` CLI is not
  installed; CI uses `npx -y supabase@2.120.0 start` / `test db`. Whether image pulls work under this network policy
  is [UNKNOWN] (the test was stopped).
- e2e: Playwright, one worker, port 3000, falls back to Chromium at `/opt/pw-browsers/chromium`. Parallel e2e runs
  would fight over port 3000, so run DB/e2e checks one at a time.

## Standing rules

- Never paste API keys in chat. Keys go to GitHub Secrets / Vercel env / environment secrets.
- No service role key in `apps/web`.
- Never log emails, wallet addresses, or user ids.
- Do not buy domains without explicit approval (airdropiq.ai not bought).
- Commit trailers:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01MpHhByztfbBU3UNi7QKX9d`. A new session uses its own session link.
- No model identifiers in repo files.

## Owner to-dos (not code)

- Buy airdropiq.ai if wanted, and check the trademark.
- Disable signup and secure password change in Supabase.
- Turn on freellm auth.
- Add LLM secrets.
- Check Vercel Hobby commercial-use terms.
- Check CoinGecko free-API limits during implementation.
