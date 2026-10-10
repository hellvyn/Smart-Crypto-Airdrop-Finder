# Execution ledger: Plans 7 → 4 → 8 → 5 → 6

The recovery map for executing the plans. When resuming, trust this file and `git log` over memory. A line
`<Plan> Task <N>: complete` means DONE: do not re-dispatch it. Resume at the first sub-step without completion lines.

## How it runs

- Controller: the main session. Implementation happens in Workflow agents. Each parallel branch is in its own git
  worktree (`isolation: worktree`) and starts from the sub-step's BASE. The controller merges the heads locally on
  `claude/dreamy-carson-vv0ru2`, then runs `pnpm test`, `pnpm typecheck`, pgTAP and e2e. It pushes only that branch,
  and only after everything passes.
- Workflow script: `docs/superpowers/workflows/execute-step.js`. Per-plan scratch (briefs, reports, review packages)
  is in `.superpowers/sdd/<plan>/` (git-ignored, lost with the container).
- DB and e2e share one local Supabase stack and port 3000. Agents use only the lock wrappers in `.superpowers/bin/`:
  `dbtest <dir>`, `dbreset <dir>`, `e2e <dir> [spec]`. These are git-ignored, so recreate them if the container is
  new. Supabase starts with the same `-x` list as CI, because mailpit has to stay off for the auth tests.
- Review: per task for security-sensitive tasks (RLS, grants, auth, member gating, phishing links, secrets), grouped
  per sub-step for the rest. Each fix loop runs at most 5 rounds. Each wave ends with one whole-wave review on the
  most capable model.

## Owner decisions (2026-10-10, this session)

- #55 (K1a): one public fail reason, in `curations.public_fail_reason`. Full `reasons`, `coverage` and `worth` stay
  member-only.
- #56 (K2b): claim-portal pages are fetched in `analyze`, before the scam analyst. The GoPlus phishing check stays in
  `score`.
- #57 (K3): Plan 6 Task 7 uses `0014_changes_seen.sql` and Task 8 uses `0015_farming_results.sql`. No task edits
  another task's migration.
- #58: the strong AI scam patterns (`secret_request`, `payment_request`, `impersonation`, `fake_support`) fail
  `curate()` with `scam_pattern`. The other patterns stay risk reasons only.
- #54 reaffirmed: `ai_analyses` kind `scam` is member-only. The stale Plan 5 lines that made it public were fixed.

## Wave plan (from the dependency map, `docs/superpowers/workflows/plan-dependency-map.js`)

| Wave | Sub-steps (∥ = parallel, → = after) |
|---|---|
| G1 · P7 | 1a T1 ∥ T3 → 1b T2 ∥ T5 → 1c T4 |
| G2 · P4 | 2a T1 ∥ T2 ∥ T3 ∥ T8 → 2b T4 ∥ T7 → 2c T5 ∥ T6 → 2d T9 |
| G3 · P8 | 3a T1 ∥ T2 → 3b T3 → 3c T4 |
| G4 · P5 | 4a T1 ∥ T2 → 4b T3 ∥ T5 ∥ T8 → 4c (T4 → T11) ∥ (T6 → T7) → 4d T9 → 4e (T12 → T13) ∥ T10 |
| G5 · P6 | 5a T1 ∥ T3 → 5b T2 → 5c T4 ∥ T5 ∥ T8 → 5d T7 → 5e T6 |

Migration order: 0007 P7 · 0008/0009 P4 · 0010 P8 · 0011 P5 · 0012/0013/0014/0015 P6. Push to production in
number order only, after every wave is merged.

## Baseline (before G1, HEAD 4699164)

pgTAP 114 tests ok · unit tests core 194, pipeline 261, web 242 ok · typecheck ok · e2e 57/57 ok (Supabase started
with the CI `-x` list).

---

# SDD ledger — plan: docs/superpowers/plans/2026-10-10-plan-7-manual-membership.md

## Pre-flight scan

| Pair or task | Shared surface | Finding | Ruling |
|---|---|---|---|
| T1 × T5 | `docs/ops/pipeline.md` | T5 documents the secrets that T1 removes | T5 runs after T1 (1b) |
| T2 × T3 | `site-header.tsx`, `e2e/settings.spec.ts` | Both edit the header | Sequential: T3 in 1a, T2 in 1b |
| T2 × T4 | `supabase/tests/manual_membership.test.sql`, `e2e/auth.spec.ts`, settings | Both "Create" the pgTAP file | Sequential. T4 appends to the file T2 creates |
| T3 × T4 | `components/ui/*` (T3 produces, T4 consumes), header | Real dependency | T4 in 1c, after T3 |
| T1 self | Step 4 grep | `grep -rniE "brevo\|digest"` can never be empty: `merge.ts:59` and `collect.ts:20` call crypto `.digest("hex")` | The check passes when the only hits are crypto `.digest(` calls |
| T1 self | Files block | `pipeline/test/supabase-repo.test.ts`, `pipeline/scripts/daily-smoke.ts` and `pipeline/scripts/repo-smoke.ts` use digest code but are not listed | Update them too (not scope growth: required for the removal) |
| T2 self | `(auth)/actions.ts` | Plan says it keeps `logIn` + `logOut`, but the existing export is `signOut` (imported by `site-header.tsx`) | Keep the name `signOut`. The plan wording is the error |
| T2 self | tests not listed | `supabase/tests/users_rls.test.sql:44` selects the dropped columns. `e2e/auth.spec.ts`, `e2e/settings.spec.ts` and `test/settings.test.ts` test removed features | Update them. Tests of removed features are deleted with those features, which is not skipping |
| T2 self | `lib/env.ts siteUrl()` | Has no callers after T2 | Remove it if grep shows no callers. Keep `NEXT_PUBLIC_SITE_URL` in CI (Playwright uses it) |
| T4 self | test path | `apps/web/test/routes.test.ts` does not exist. The routes test is `apps/web/lib/routes.test.ts` | Use the existing file |
| T4 self | `/login` with a user | No such behaviour exists today | A signed-in visit to `/login` redirects to a safe `next`, else `/airdrops`. `DEFAULT_NEXT` after login is unchanged |
| T4 self | delete account | `settings/actions.ts:46` redirects to `/?deleted=1`, and the banner is on the old list page | `/?deleted=1` stays on the landing (not redirected to `/airdrops`), and the landing shows the account-deleted notice |
| Plan header | migrations "0008–0012" | Stale (P6 adds 0013–0015) | Docs only. No action |

Ruling: keep `signOut` — the existing export, and renaming it buys nothing — costs a rename later if the owner wanted `logOut`.
Ruling: the T1 grep ignores crypto `.digest(` — those calls are hashing, not email — costs nothing.
Ruling: a signed-in `/login` goes to `next` or `/airdrops`; post-login default stays `/watchlist` — the plan names only the signed-in visit — costs one line if the owner wants `/airdrops` after login too.
Ruling: `/?deleted=1` stays on the landing with a notice — keeps the delete-account flow and its e2e working — costs a small copy change if unwanted.

## Progress
- G1-1a started: P7.T1 ∥ P7.T3 from a38c192 (workflow run wf_3a0df074-9f4)
- P7 Task 1: complete (commits a38c192..a48e6b0, review clean). Moved `main()` body into `pipeline/src/daily-job.ts` so the Brevo-in-env test is real. Deleted `pipeline/test/config.test.ts` and `supabase-repo.test.ts`: verified they only covered removed email code (`loadEmailEnv`, `listConfirmedEmails`).
- P7 Task 1: minor (deferred): `docs/ops/web.md:81,120` link the deleted `docs/ops/email.md`, and `:109-110` still describe `notification_log`. Carried to P7.T5.
- P7 Task 1: minor (deferred): `daily-job.ts:32-38` builds real clients before overrides (no I/O). `run.test.ts:1088` fetch spy only catches Brevo calls made directly in `runDailyJob`.
- P7 Task 1: note: `pipeline/scripts/repo-smoke.ts` still names `notification_log` in its anon RLS check. Carried to P7.T2 (0007 drops the table). The smoke scripts are typechecked only (manual scripts, not in CI).
- P7 Task 3: fix round 1/5 (1 addressed, 0 open — dark button hover hid the Login label; commits 79ed0c3..03562b0)
- P7 Task 3: complete (commits a38c192..03562b0, review clean after fix round 1). Added an optional `href` to `Button` for the header Login link.
- P7 Task 3: minor (deferred): `Button` drops a caller's `className` (and the `href` branch drops other props). `Ticket` renders `<a>`, so nesting links inside it is invalid (document in the README). `WorthBadge` has no `insufficient_data` level. Header test overlaps `wallet-section.test.tsx`. Header "Wallets/Settings/Sign out" are still English (Plan 6). No RED run recorded for `layout.spec.ts`.
- P7 Task 3: carried to P7.T4: the header links `/airdrops`, `/#cara` and `/#jejak` need T4's routes and ids. `<main>` is still max-width 48rem (T4 widens it to 1240 px with the 3 px container).
- G1-1a merged: e6429b5, 9d2a066. Tests: core 134, pipeline 203, web 273 unit · typecheck ok · pgTAP 114 · e2e 63/63.
- G1-1b started: P7.T2 ∥ P7.T5 from 96431c4 (workflow run wf_a2dd4ed7-55e)
