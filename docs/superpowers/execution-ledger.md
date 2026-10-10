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
- P7 Task 2: complete (commits 96431c4..1a23920, review clean). Finding: `[auth.email] enable_signup = false` disables email login entirely, so signups are refused only by `[auth] enable_signup = false` (e2e proves the anon `signUp` returns `signup_disabled`). `siteUrl()` removed (no callers). `NEXT_PUBLIC_SITE_URL` kept.
- P7 Task 2: minor (deferred): `auth-form.tsx` `message` state branch has no caller now. `login/page.tsx` metadata title still "Smart Airdrop Finder" (Plan 6 translates old pages). `NEXT_PUBLIC_SITE_URL` is now read only by Playwright and CI.
- P7 Task 2: owner action: the hosted Supabase project must also disable signups (config.toml is local only). Covered in `docs/ops/web.md` (owner to-do).
- P7 Task 5: complete (commits 96431c4..5c8860b, review clean). Controller verified the docs against the merged T2: the 0007 object list and the config.toml signup line match.
- P7 Task 5: minor (deferred): the `web.md` curl fallback puts the new password in `-d` (visible in shell history). Use `-d @body.json`.
- G1-1b merged: 615393e, 2bb58a8. Stack restarted with the new config.toml. Tests: core 134, pipeline 203, web 244 unit · typecheck ok · pgTAP 110 · e2e 60/60.
- G1-1c ruling: landing anchors follow the locked mockup (`#cara`, `#jejak`; the header from T3 links them), not the plan's `#kenapa`. Ruling: mockup ids win — the brief says "persis mockup" and the header already uses them — costs one id rename if the owner prefers `#kenapa`.
- G1-1c ruling: the header "Track record" link points at a block Plan 6 Task 4 renders later, so until then it scrolls to the top. Ruling: keep the link — removing and re-adding it is churn — costs a dead anchor until Plan 6.
- G1-1c started: P7.T4 from 4287501 (workflow run wf_354ba2f1-eed)

---

# SDD ledger — plan: docs/superpowers/plans/2026-10-10-plan-4-data-and-ai-foundation.md

## Pre-flight scan (from the dependency map, rows checked against the plan text)

| Pair or task | Shared surface | Finding | Ruling |
|---|---|---|---|
| T3 × T4 | `pipeline/src/llm/extract.ts`, `pipeline/test/llm.test.ts` | T3 rekeys the breaker and adds `servedModel` in `extractWithFallback`. T4 rewrites `postProcess` | T3 in 2a, T4 in 2b |
| T3 × T5 | `supabase-repo.ts` trio, `0008` → `0009` | T5's pgTAP asserts `extractions.served_model` (0008) | T5 in 2c |
| T4 × T5/T6 | v3 schema | Real dependency | T5 and T6 in 2c |
| T2 × T7 | crt.sh fallback | `scam-set/run.ts` uses T2's enrichment | T7 in 2b |
| T5 × T9 | `0009_extraction_v3.sql`, `extraction_v3.test.sql`, `merge.ts` | T9 edits a migration T5 created | T9 in 2d. 0009 is not applied anywhere persistent between them, so editing it in the same wave is allowed |
| T8 × T9 | `pipeline/src/steps/collect.ts`, `config.ts` | Both edit `collectSources` | T8 in 2a, T9 in 2d |
| T1 × T9 | `pipeline/src/collectors/html-text.ts` | T1 changes the `embedLinks` `onVisit` signature. T9 adds the host filter | Sequential |
| T2 × T3 | `docs/ops/pipeline.md`, `run.test.ts` | Parallel in 2a. Different sections | Controller merges: union of the doc sections and the tests |
| T1 self | Files | `html-text.ts` `onVisit` receives only a URL, but the task needs `data-outbound-host` from the element | Changing `html-text.ts` (shared with `telegram.ts`) is in scope |
| T2 self | test helpers | `sequenceHttp` and the `CRT` constant in the snippet do not exist | Write them in the test |
| T3 self | Files | Step 3 edits `pipeline/eval/run-eval.ts`, which is not listed. Step 4's "114 pgTAP lama" count is stale (110 after P7) | Edit `run-eval.ts`. "All existing pgTAP pass" replaces the number |
| T6 self | Steps 4-5 | Need production Supabase credentials (export cases) and a live eval run. freellm and NVIDIA are reachable. Production DB credentials are not in this container | Steps 1-3 in full. Steps 4-5 are reported as blocked, with the exact command for the owner. No fake numbers |
| T7 self | arity, ignore, network | The interface says `toRiskInput(c, enrich)`, but the test calls it with 3 args. `.gitignore` does not cover `scam-set/cases/`. Step 4 needs crt.sh, which is blocked by the network policy | Follow the test (3 args). Add the ignore pattern. Run Step 4 with what is reachable (GitHub raw, GoPlus, RDAP) and report crt.sh as blocked |
| T8 self | Files | `collect.ts` must change (new `opts.now`, listing date in the document text) | In scope. Every DefiLlama doc hash changes once (expected) |
| T9 self | host checker | The plan says to extend the existing check that refuses airdrops.io, but no such function exists in `merge.ts` or core. The only one is `isAggregatorHost` in `html-text.ts` | One single non-project-host check, extended from `isAggregatorHost` (airdrops.io, alphadrops.net and the config intermediary hosts, exact host match), applied wherever an official URL or domain is derived. Its location is the implementer's call, but it must be one source |
| T9 self | network | `www.alphadrops.net` is blocked by the network policy (apex `alphadrops.net` answers 200) | Tests use fixtures. No live run is required by the plan |

Ruling: T6 Steps 4-5 and T7's crt.sh part are reported blocked, not faked — the container has no production DB credentials and crt.sh is denied — costs an owner-run of two documented commands.
Ruling: one non-project-host check extended from `isAggregatorHost` — the plan's named check does not exist and two checks would drift — costs a move if the owner wants it in core.

## G1 tail (Plan 7)
- P7 Task 4: complete (commits 4287501..d48c1f8, review clean). The implementer could not write the shared report path, so the reviewer saw no test evidence. The controller copied the report and ran every gate on the merge itself (results below).
- P7 Task 4: real bug found by the RED e2e: a server-action POST after the session expired got a proxy 307 and showed Next's error page. Fix: the proxy lets server-action POSTs through, and `requireUser` redirects to `/login?next=<page>` (page from the proxy-set `x-airdropiq-path` header, sanitised by `safeNextPath`).
- Ruling: accept letting server-action POSTs through the proxy — the controller verified every exported action in `(app)` calls `requireUser`, the `(app)` layout and every page call `requireUser`/`getUser`, the proxy always overwrites the path header, and RLS still applies — costs a missed `requireUser` in a future action being caught only by RLS. Carried to Plan 8: `/garapan` actions must call `requireUser`.
- P7 Task 4: the pgTAP `is_empty` from the brief cannot work: anon has no privilege, so the select raises 42501 and aborts. Used a test-local helper that counts 42501 as 0 rows. Mutation-checked by the implementer. An anon REST e2e was added too.
- P7 Task 4: minor (deferred): `<main>` max-width 1240 px applies to every page, including login and settings. `legacyListRedirect` sends any query on `/` (for example `utm_*`) to `/airdrops`. The `/#jejak` anchor stays dead until Plan 6. The `landing.test.tsx` price regex matches "rp" inside words.
- G1-1c merged: dead693. Tests: core 134, pipeline 203, web 272 unit · typecheck ok · pgTAP 115 · e2e 66/66.
- Workflow fix: worktree agents cannot always write to the main checkout. Reports now live in each worktree (`.superpowers/reports/`), and their paths flow to reviewers and fixers.
- G1 wave review (opus): with_fixes. I1 `legacyListRedirect` sent `/?fbclid=`/`utm_*` to `/airdrops` → fixed: only the v1 list keys (status, risk, chain, page) redirect. I2 deleting update-password left members no way to change their password → fixed: "Ganti password" in `/settings` (`requireUser`, re-verify with `signInWithPassword`, `updateUser`; unit + e2e against real GoTrue). Re-review: both ADDRESSED. Commit a88c894.
- Ruling: keep the self-service password change built for I2 — without it a password the admin sent over DM can never be rotated — costs removing one form if the owner does not want it (owner to confirm; spec #32 left unchanged).
- G1: parked — a password change does not revoke the member's other sessions (`signOut({ scope: 'others' })`), so a session opened with the DM'd password stays valid — Ruling: real and small, but no second fix wave on a wave review; carried to P6 Task 2 (it rewrites settings) unless the owner wants it sooner — costs a window where an old session survives a password change.
- G1: minor (deferred to Plan 6 copy pass): tab titles still "Smart Airdrop Finder" on login/wallets/watchlist/settings; `.env.example` mentions email redirect URLs; `LinkStatus` has no fallback for an unknown status; Stamp README table vs `aria-label`; `web.md` deploy order should put the signup switch first; Ticket README note "no links inside Ticket".
- G1 complete. Tests at the merge: core 134, pipeline 203, web 284 unit · typecheck ok · pgTAP 115 · e2e 67/67.

## Progress (Plan 4)
- G2-2a started: P4.T1 ∥ P4.T2 ∥ P4.T3 ∥ P4.T8 from a79b089 (workflow run wf_b34d235b-3a6)
- P4 Task 1: complete (commits a79b089..eee00ce, review clean). `embedLinks` `onVisit` is now `(url, outboundHost)`. Telegram is unchanged.
- P4 Task 1: minor (deferred): `airdrops-io.ts:52` matches every Overview wrapper on the page (scope it to the first one so related cards cannot inject links). A bare-URL `li` gets the label "https". The aggregator-redirect fallback is undocumented.
- P4 Task 2: fix round 1/5 (1 addressed, 0 open — the crt.sh 5 MB cap was untested; commits 037f049..8d34837)
- P4 Task 2: complete (commits a79b089..8d34837). The run fixture has 3 projects with an official domain, not the brief's 2 (the DefiLlama project counts too). The concurrency bound is 5 because GoPlus has its own limiter.
- P4 Task 2: minor (deferred, watch in production): GoPlus is serial and status-0 timeouts are not retried. If GoPlus hangs, score can exceed the 60 min job budget, so consider a deadline or breaker in Plan 5. crt.sh `q=<domain>` matches the apex only. The `phishing_list_failed` and `_ran` denominators differ. `sequenceHttp` uses a shared-array index. The run fixture does not assert its body is over 5 MB.
- P4 Task 3: complete (commits a79b089..5e35911, review clean). `streamChat` `baseUrl` is now required. `ChatResult.servedModel` is required, so later fakes need `servedModel: null`. Controller verified that `MemoryRepo.saveExtraction` spreads the attempt, so `servedModel` is kept.
- P4 Task 3: minor (deferred): duplicate config import in `run.test.ts`. `pipeline.md:4` line width. A mid-stream failure loses the model that started answering. The `supabase-repo.test.ts` prompt literal looks like a stale version.
- P4 Task 8: complete (commits a79b089..1a42242, review clean). Every DefiLlama document hash changes once. Controller verified documents upsert on `url` and evidence on `(project,document,field,value)` with `ignoreDuplicates`, so nothing is duplicated.
- P4 Task 8: minor (deferred): garbled `listingDate` comment. `deadFrom: false/0` is treated as dead. No tests for `deadFrom: ""` and for the "n/a" listing date.
- G2-2a merged: f063f9e, 5dfc046, c625a11, 05e6278 (auto-merged `run.test.ts`, `config.ts`, `pipeline.md`). Tests: core 134, pipeline 245, web 284 unit · typecheck ok · pgTAP 119 · e2e 67/67.
- G2-2b started: P4.T4 ∥ P4.T7 from 9816aff (workflow run wf_53667bae-c23)
- P4 Task 4: complete (commits 9816aff..400ad2b, review clean). Defaults: `tasks` defaults to `[]`; an empty quote never matches; the quote check runs before referral stripping.
- P4 Task 4: minor (deferred): stored quotes have referral parts stripped after the check, so they must never be re-verified against raw source (carried to P4.T5). `latest_update.date` is not resolved against `publishedAt`. A redundant alias in the test.
- P4 Task 7: complete (commits 9816aff..0f3aeb1, review clean). Live run: 0/60 scam passed risk, 2/45 legit hidden (both `lookalike_domain` on a foundation claim domain). Domain age had data for only 2/60 scam and 3/49 legit, because crt.sh is blocked and RDAP is rate-limited, so G2 cannot be judged from this container. `cases/scam.json` is git-ignored (verified).
- P4 Task 7: minor (deferred): `brandOf` substring matching gives false brand attributions, which inflates the lookalike catch, so the scam set is partly circular. `legit.json` was written from memory and Polygon/Lido are doubtful "paid airdrop" picks: owner to spot-check. Duplicated helpers between `build.ts` and `run.ts`. `JSON.parse` of the cases file is not validated.
- P4 Task 7: note: the commit trailer names the model that ran that agent. Left as is (accurate attribution).
- Ruling: GoPlus answers HTTP 200 `code: 4029` when rate-limited (found live by P4.T7), so Review Focus 5 does not hold and most production domains would get `null` → `insufficient_checks` in Plan 5. This is load-bearing, so it gets a controller fix task FX1 (4029 = 429, paced requests calibrated by a capped live measurement, a rate-limited counter) in 2c — costs one extra task now versus an empty curated list later.
- Ruling: FX2 makes v3 defaulted fields accept `null` and drops a claimed backer whose name is not in its quote (P4.T4 review minors with real cost: a wasted fallback model and an invented investor) — costs a small core change in 2c.
- G2-2b merged: e4a5762, d3d3268. Tests: core 146, pipeline 276, web 284 unit · typecheck ok · pgTAP 119 · e2e 67/67.
- G2-2c started: P4.T5 ∥ P4.T6 ∥ P4.FX1 ∥ P4.FX2 from 3f79f4a (workflow run wf_e9181920-5fe)
- P4 Task 5: complete (commits 3f79f4a..70ffd6b, review clean). `ProjectInput.tasks` was replaced by `steps`. An older answer with `tasks` but no `steps` becomes `once` steps. Steps from several documents are ordered by `document_id`, then `position`.
- P4 Task 5: minor (deferred): fact field names are literals in both `run.ts` and `repo.ts` (export one constant). There are 9 sequential `deleteEvidence` calls per document (add a multi-field delete). The step order across documents has no meaning. A duplicate step with a different cadence keeps the first one.
- P4 Task 5: carried to P6 Task 5: the current project page renders the new v3 fact rows as generic public "Evidence" with raw labels (`key parameter:allocation`) and empty quotes. P6.T5's new facts section must take them out of the generic list.
- P4 Task 6: fix round 1/5 (1 addressed, 2 open — official-domain scoring re-filtered referral-cleaned URLs; commits 24a2f59..b45cb76)
- P4 Task 6: fix rounds 2-3/5: the fixer reported BLOCKED (no production credentials), with no new commit.
- P4 Task 6: fix round 4/5 (2 addressed, 0 open; commits b45cb76..42cd9b5). The fixer collected 33 real case texts live with the pipeline's own collectors (airdrops.io, Telegram) instead of `export-cases.ts`, labelled them, and recorded one real eval run.
- Ruling: accept the agent-made labels and the recorded run — the case texts are real (fetched live, not invented), the plan's Prasyarat already puts label review on the owner, and the spec text says the numbers wait on that review — costs a re-run if the owner changes labels.
- P4 Task 6: RESULT (one run, prompt 2026-10-10.3): G4 status 22/30 (73.3%) FAIL · G5 deadline 13/18 (72.2%) FAIL · G6 hallucinated URLs 0 PASS · official domains 28/28 PASS · v1 conditions: Abstract `ended` FAIL, radar recall 18/28 FAIL (needs 22). 29 cases answered by `freellm:auto`, 4 by NVIDIA. Case texts are copied to `pipeline/eval/cases/` in the main checkout (git-ignored, container-local).
- P4 Task 6: minor (deferred): an odd `--limit` exports limit+1 rows. A purged row with an unexpected id aborts the export. 8-hex ids can collide. Deadline matching is recall-only. The README intermediary host list differs from the config. The eval exits 1 until every gate is labelled.
- P4 FX1: complete (commits 3f79f4a..34bf903, review clean). Live measurement (51 of 60 requests): the 31st back-to-back request got 4029, and 18 requests 1 s apart were fine. Interval set to 1.5 s, rate-limit pause 5 s (one retry). GoPlus takes about 4.5 min for ~150 domains, and the whole job about 45 min (worst case about 58 min). New stat `phishing_list_rate_limited`. Watch it in production (an hourly or daily quota is unknown).
- P4 FX2: complete (commits 3f79f4a..c34f18f, review clean). Defaulted v3 fields (and v2 `tasks`) accept `null`. A claimed backer whose name is not in its quote is dropped.
- G2-2c merged: 9355d72, f799cc0, 14bc0cd, dd29e71. Tests: core 162, pipeline 320, web 284 unit · typecheck ok · pgTAP 133 · e2e 67/67.
- G2-2d started: P4.T9 (workflow next)
- P4 Task 9: complete (commits 54b83f7..77502cb, review clean). `isNonProjectHost` in `html-text.ts` is the single check. The intermediary host list lives only in `config.alphadrops.intermediaryHosts` and flows into `postProcess` and `mergeDocument`. Fixtures were trimmed from the apex host. A connection failure on a detail page stops the collector and keeps the documents so far. HTTP 404/500 still gives a listing-only document.
- Ruling: accept `cleanUrl` stripping the `r` query param for every source — the brief's verbatim test needs it and the spec says to use the one existing cleaner — costs a one-time hash change for documents with `?r=` and a stripped legitimate `?r=` on some official URL (owner to know).
- P4 Task 9: minor (deferred): invisible U+E000/E001 literals in `alphadrops.ts` (write them as escapes). The 4th `sleep` parameter is required, unlike the brief. `collect.ts` imports `defaultSleep` from the GoPlus module. Intermediary hosts are still stored as project links. The test duplicates the host list. Other referral forms (`?code=`, `?inviteCode=`, `/join/X`) still pass. Volatile redirect targets may re-extract daily.
- G2-2d merged. Tests: core 163, pipeline 366, web 284 unit · typecheck ok · pgTAP 136 · e2e 67/67.
- G2 wave review started (workflow run wf_7e452a48-6b5)

---

# SDD ledger — plan: docs/superpowers/plans/2026-10-10-plan-8-farming-tracker.md

## Pre-flight scan

| Pair or task | Shared surface | Finding | Ruling |
|---|---|---|---|
| T1 × T2 | none | DB versus pure core, independent | 3a in parallel |
| T3 × T1/T2/P4.T5 | `farming_*` tables and functions, `buildHeatmap`/`heatmapRange`, `tasks.cadence`/`position` | Real dependencies (P4.T5 is merged) | 3b |
| T4 × T3/P7.T3/P7.T4 | actions/queries, `components/ui/*`, `routes.ts`, header | Real dependencies (P7 is merged) | 3c |
| T2 self | range length | The prose says "max 364 days", but the no-deadline tests expect `start .. start+364` (365 cells, 2026-10-08 → 2027-10-07). The cap test (2026-01-02 .. 2026-12-31) is 364 cells. The tests are consistent with each other | Follow the tests: no deadline = `start + 364`. The cap applies only when a deadline makes the range longer |
| T3 self | step text | "text_id after Plan 5": no owner in P8 | Use `tasks.description` now. P5.T6 owns the switch to `text_id` (plan amended) |
| T3 self | `endedOn` | null in this plan | P6.T3 wires it |
| T3 self | actions | G1 ruling: the proxy lets server-action POSTs through | Every `/garapan` action calls `requireUser` (the brief already says so; the reviewer checks it) |
| T3 self | step order | P4.T5 returns steps ordered by `document_id`, then `position` | Use the order the repo/query returns |
| T4 self | Files | The FarmButton goes next to WatchButton, which lives in `projects/[slug]/page.tsx` (not listed). The e2e needs a seeded daily source task with cadence (`e2e/support/seed.ts`, not listed) | Both are in scope |

## G2 tail (Plan 4)
- G2 wave review (opus): with_fixes. I1: the GoPlus queue had no time budget, so persistent 4029 or a hung GoPlus could push the job past 60 min before any assessment was saved. Fixed with a 12 min GoPlus budget and a 5-consecutive-failure breaker. Skipped domains are null ("not run"). New stat `phishing_list_skipped`. I2: v3 facts were listed as generic public "Evidence" (claimed backers without the §8 wording). Fixed: the web query filters fact fields out until P6.T5. Re-review: both ADDRESSED. Commits cf9de29, a10f35e.
- G2: parked: RDAP and crt.sh lookups have no time budget either (concurrency 4, much less severe than GoPlus). Ruling: watch run duration in production and add a budget in Plan 5 if needed — costs a possible long run if both are slow.
- G2: parked: the web filter repeats the 4 plain fact names from the pipeline `FACT_FIELDS` (a comment links them). A new non-prefixed fact field would leak until P6.T5 replaces the filter. Carried to P6.T5. The LIKE `_` wildcard is harmless.
- G2: minor (deferred to the final review): `pipeline.md:151` still mentions a status baseline. The scam-set README, `run.ts:21` and spec :464 still say GoPlus retries only 429/5xx. `key_parameters`/`source_ratings` accept trivial quotes. Schema enum or int edge cases (cadence "monthly", `capital_min_usd` 0, month-only date) fail the whole extraction. An AlphaDrops listing with no recognised status returns 0 docs without `failed`.
- G2: recommendations for the owner: run the eval once with NVIDIA first on the same cases, to separate model from prompt effects. Clean up existing `official_domains` that hold now-refused hosts (merge never rewrites a non-empty list).
- G2 complete. Tests at the merge: core 163, pipeline 369, web 285 unit · typecheck ok · pgTAP 136 · e2e 67/67.

## Progress (Plan 8)
- G3-3a started: P8.T1 ∥ P8.T2 from a583164
- P8 Task 1: fix round 1/5 (1 addressed, 0 open — the column grants broke the plan's `startFarming` upsert; the fix amended the plan's Task 3 interface to insert-or-unarchive; commits 587cb7e..601351d)
- P8 Task 1: complete (commits a583164..601351d). The T3 brief was regenerated after the merge so it carries the amended contract.
- Ruling: drop the `farming_checks` delete grant and policy — spec §14 and the Plan 8 constraints say only today can change, while the brief text granted delete — costs nothing, because toggle is SECURITY DEFINER and cascades need no grant. Done in FX3.
- Ruling: FX3 also blocks tasks on an archived farming project and lets a re-insert of an existing project skip the 50-project limit — both were P8.T1 review minors that P8.T3 would otherwise trip over — costs one small migration edit in the same wave.
- P8 Task 1: note for P8.T3: `toggle_farming_check` for a weekly task returns `p_done`. After an uncheck that is false, even when another day of the same ISO week is still checked. The UI must compute "done this week" from the checks (`weeklyDone`), not from the return value.
- P8 Task 2: complete (commits a583164..bedbce6, review clean). The no-deadline range is 365 cells (ruled).
- P8 Task 2: minor (deferred): the unused `_today` param. `toMs`/`fromMs` do not validate input. `localDay` produces garbage when a part is missing.
- G3-3a merged. Tests: core 194, pipeline 369, web 285 unit · typecheck ok · pgTAP 209 · e2e 67/67.
