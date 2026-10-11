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
- G3-3b started: P8.T3 ∥ P8.FX3 from 772ec41
- P8 Task 3: complete (commits 772ec41..baa5462, review clean). Steps are copied only in the call that created or resumed the row (no double copy across tabs). Texts over 200 chars are cut. The copy stops at the 30-task limit. Fixable errors redirect to `/garapan?error=<code>`. Controller verified: no direct `farming_checks` delete, and unarchive runs before the step copy.
- P8 FX3: complete (commits 772ec41..0c753ee, review clean). `farming_checks` are written and removed only through `toggle_farming_check`. Task inserts into a stopped project raise 23514. A re-insert of an existing project skips the limit.
- Ruling: a source step the member archived by hand comes back on "Ambil ulang step dari source" — that button is an explicit request to re-take source steps — costs a re-archive click if unwanted.
- Ruling: park the trigger existence oracle (inserting with another user's id returns 23514 or 42501 depending on their project state) — it needs two guessed UUIDs and reveals only a stopped flag — costs a one-line early return later if wanted.
- Carried to P8.T4: the empty state for a farmed project with no tasks must offer "Ambil ulang step dari source" (`syncSourceSteps` is not atomic with the start). Map the toggle's 22023 (task or project archived in another tab) to a friendly code in `actions.ts`. Render `/garapan?error=` messages. The UI archives ("Berhenti garap", archive task) and never deletes a task or project, because a delete cascades away past-day checks (spec §14 history).
- P8: minor (deferred): the board reads every check without a lower bound (limit to `day >= range.start`). Test gaps around the resume race guard and 23514 on resume. `farming.ts` is 458 lines. Stale test-number comments in `farming.test.sql`. The on-conflict exists check runs outside the advisory lock.
- G3-3b merged. Tests: core 194, pipeline 369, web 318 unit · typecheck ok · pgTAP 218 · e2e 67/67.
- G3-3c started: P8.T4

---

# SDD ledger — plan: docs/superpowers/plans/2026-10-10-plan-5-curation-and-ai-analysis.md

## Sub-steps (refined from the wave plan; my workflow runs each sub-step as one parallel batch)
4a T1 ∥ T2 → 4b T3 ∥ T5 ∥ T8 → 4c1 T4 ∥ T6 → 4c2 T11 ∥ T7 → 4d T9 → 4e1 T12 ∥ T10 → 4e2 T13

## Pre-flight scan (rows from the dependency map, checked against the amended plan)

| Pair or task | Shared surface | Finding | Ruling |
|---|---|---|---|
| T2 × T8 | `NewSignal`, `CurationReason`, `Tab`, `WorthLevel` | `@saf/core` cannot import pipeline types | T2 declares `NewSignal`/`SignalKind`/`SignalSource`/`AiKind` and the curation types in `packages/core/src/curate/types.ts` and exports them. T8 fills in the logic |
| T3 × T4 | `VcIndex`, `signals.ts` | T3's `buildSignals` takes a `VcIndex` that T4 defines | T3 declares the `VcIndex` type. T4 implements the portfolio loading. Sequential (4b, 4c1) |
| T4 × T11 | `signals.ts`, `signals.test.ts`, `config.ts` | Same file | Sequential (4c1, 4c2) |
| T6 × T7 | `analyze.ts`, `analyze.test.ts` | Same file | Sequential (4c1, 4c2) |
| T12 × T13 | `score.ts`, `run.test.ts` | Same function | Sequential (4e1, 4e2) |
| T7 × T12 | `assess.ts` | Both add reasons | Sequential (4c2, 4e1) |
| T1 × P4.T5/P4.T2 | `ProjectForScoring`, `score.ts` | Merged already | — |
| T3 self | Files | `ProjectForScoring.sourceKinds` needs the repo trio, which is not listed | In scope |
| T5 self | Files | `listProjectSourceTexts` (repo trio) and moving the fallback loop out of `extractWithFallback` (`extract.ts`) are not listed | In scope. Keep P4.T3's breaker and provider logic intact |
| T6 self | `tasks.text_id` writer, tracker text | No repo method is named for it. The plan was amended so T6 also switches `apps/web/lib/farming.ts` to `text_id` | T6 adds a repo method (for example `saveStepTranslations`) and the farming switch. T6 owns the `ai_style_violations` stat (Global Constraints, no other owner) |
| T9 self | signals into score | No interface carries the signals stage output to score | `ProjectForScoring.signals` is loaded from `project_signals` (written earlier in the same run). Coverage comes from the assessment checks. Stats add per-tab passed counts (`curation_passed_live_now`, `_early_bets`, `_ended`) for T10/G9 |
| T13 self | `listedAtFirstPass` | `project_signals` is replaced every run and `curations` stores no listing flag | T13 appends a nullable `coingecko_listed boolean` to `curations` in 0011 (created in this wave, not applied anywhere). `saveCuration` writes it, and the track record reads it from the first passing curation |
| T11 self | AlphaDrops budget | P4.T9 allows 80 detail pages. T11 adds up to 40 raise pages plus `llms-full.txt` | Combined cap of 120 AlphaDrops requests per run at ≥ 1.5 s each, documented in `pipeline.md` with the job-time arithmetic |
| T12 self | GoPlus reuse | Phishing checks for claim links reuse the per-domain GoPlus results | Never call GoPlus outside the paced, budgeted queue from G2. The claim portal is fetched in `analyze` (#56) |
| T4 self | Step 3 | Live check of 15 VC portfolio pages | Run what is reachable, keep fixtures small, and report unreachable ones as blocked |
| T10 self | Step 5 | Needs a production run and owner review | Code and tests in full. Step 5 is reported blocked with the command |
| T2/T8/T9 | owner decisions | #55 `public_fail_reason`, #58 `scam_pattern`, #54 scam member-only | Already in the amended plan text |

Ruling: `ProjectForScoring.signals` is loaded from `project_signals` — the plan has no other channel from signals to score — costs a query per run.
Ruling: `curations.coingecko_listed` is added in 0011 for the track record — otherwise listing history is lost every run — costs one column.
Ruling: AlphaDrops is capped at 120 requests per run — two caps that were never reconciled — costs up to 40 detail pages if raise pages crowd them out.
- P8 Task 4: fix round 1/5 (1 addressed, 0 open — visitors saw a "Mulai garap" login link, but the brief says the button is for signed-in users only; commits 4c81c38..b0592b5)
- Ruling: the brief wins over my dispatch note (I wrote that a signed-out click goes to login) — the brief carries the plan text — costs nothing, because visitors see no farm button.
- P8 Task 4: complete (commits ecb57ac..b0592b5). FarmButton sits next to WatchButton in `projects/[slug]/page.tsx` (controller ruling). Ended cards keep "Berhenti garap" so they do not hold an active slot. A weekly task already done earlier this week shows its status without a checkbox. The 22023 error maps to `task_inactive`. Tasks are archive-only.
- P8 Task 4: minor (deferred): FarmingCard uses a custom `.farm-card` instead of `Ticket`/`SectionCard` (looks the same). The page summary counts locked tasks of ended cards. A stale `?error=` stays after later success. A 42501 after a cascade delete hits the error boundary. The e2e was written after the code (no red run). About 490 lines were added to `globals.css`.
- G3-3c merged. Tests: core 194, pipeline 369, web 348 unit · typecheck ok · pgTAP 218 · e2e 73/73.

## G3 tail (Plan 8)
- G3 wave review (opus): with_fixes. I1: `heatmapRange` ignored today. With a passed snapshot (common until Plan 6 wires `endedOn`), a deadline more than a year away, or a year of farming without a deadline, the window excluded today, the heatmap froze and the streak always showed 0. Fixed: the window always holds today while the project is open, `HeatmapRange.endsOn` keeps the countdown date, and `streak(tasks, checks, today)` counts over all checks. Re-review: ADDRESSED. Commit b34155f.
- Ruling: accept the I1 fix although it departs from the #39 wording ("end = earliest snapshot/campaign_end ≥ start") — a tracker that freezes once a snapshot passes defeats #39's purpose — costs an owner confirmation. Plan 8's interface text was aligned with the code so the Plan 6 briefs carry the new `heatmapRange`/`streak` signatures. Owner to confirm: once every deadline has passed, there is no countdown and the window is a rolling year; for a far deadline, the window ends before the deadline while the countdown names it.
- G3: carried to P6.T8 (it touches farming code and creates `0015_farming_results.sql`): redirect to `/garapan` on success so a stale `?error=` clears. Map RPC 42501 "task not found" (after a cascade delete) to `task_inactive`. A BEFORE UPDATE trigger stamps `archived_at = now()` on `farming_tasks`/`farming_projects`, because the column grant lets a member backdate it and rewrite past heatmap totals (same invariant as FX3). The invalid-timezone 22023 is not mapped to `task_inactive`. `FarmingCard.nextDeadline` is computed but never rendered.
- G3: parked: `createdDay`/`archivedDay`/start are recomputed in the current timezone, so a timezone change can shift boundary days by one. Ruling: accept for now — checks themselves keep their stored day (Review Focus 1 holds for checked days) — costs an off-by-one at a boundary after a timezone change. The trigger existence oracle stays parked (earlier ruling).
- G3: declined by the reviewer and accepted by the controller: delete grants on `farming_projects`/`farming_tasks` (plan-mandated, own data, the UI never deletes); stopped days show 0% instead of grey (product choice); concurrent refresh duplicates (archivable).
- G3 complete. Tests at the merge: core 203, pipeline 369, web 350 unit · typecheck ok · pgTAP 218 · e2e 74/74.

## Progress (Plan 5)
- G4-4a started: P5.T1 ∥ P5.T2 from 0c7f28d
- P5 Task 1: complete (commits 0c7f28d..4c1de0c, review clean). Minor (deferred): expiry bumps `last_seen` via `updateProject`. Pipeline-level expiry tests cover only `live`. No stat for expired projects. The Supabase `deadlines` embed is not exercised by a unit test (it is exercised through e2e/smoke).
- P5 Task 2: complete (commits 0c7f28d..ca2a94c, review clean). pgTAP mutation-checked (anon given SELECT on all of curations → 5 assertions fail). The first passing curation writes `curated` null→"true". `public_fail_reason` is null when the curation passes.
- P5 Task 2: carried: to P6.T7, the change feed must accept `old_value` null for `curated`, and the first run writes a null→true row for every passing project (feed flood: show "baru masuk list" or cap it). To P5.T4, `saveVcPortfolio` is a non-atomic delete+insert and 0 domains caches nothing, so treat an empty fetch as failed. To P5.T13 (it appends to 0011), add `check (passed or tab is null)` to curations.
- P5 Task 2: minor (deferred): `saveCuration` and its `project_changes` insert are not in one transaction (same as `saveRiskAssessment`). `replaceSignals` is non-atomic. MemoryRepo copies AI analyses shallowly. Stray stderr from `FarmingCard.test.tsx`.
- G4-4a merged: P5.T2, then P5.T1 with a CONFLICT in the import lists of `repo.ts` and `supabase-repo.ts`, resolved by hand as the union (no logic involved). Tests: core 213, pipeline 392, web 350 unit · typecheck ok · pgTAP Tests=279 · e2e 74/74.
- G4-4b started: P5.T3 ∥ P5.T5 ∥ P5.T8
- P5 Task 3: fix round 1/5 (1 addressed, 0 open — a DefiLlama outage wiped earlier verified tvl/coingecko rows, so curate would flip true→false; now `replaceSignals(..., keepSources)` carries `source='defillama'` rows forward when `/protocols` fails; commits ae15dec..e79a2b2)
- P5 Task 3: complete (commits 9fa1026..e79a2b2). Several matching protocols: the highest TVL wins (not the sum). `curated_source` is unverified. `signals_failed` now makes the exit code 1, like `score_failed` (an extra, accepted).
- Ruling: carried DefiLlama rows get a staleness cutoff in T9: older than 14 days (`observed_at`) counts as "not checked" — this matches the 14-day VC cache fallback — costs a few projects dropping a legit signal after a long DefiLlama outage.
- P5 Task 3: carried to T9: per-run coverage (defillama, vc) is not passed to score yet, so T9 persists `curations.coverage`. To T4: `keepSources` works per source, while VC "not checked" is per VC, so handle partially failed VC fetches.
- P5 Task 3: minor (deferred): projects × ~6k protocols are tldts-parsed per run (precompute a map). A host with a port is a safe false negative. The core platform list duplicates `merge.ts` `PLATFORM_DOMAINS`. An all-malformed `/protocols` array counts as checked. Stats doc wording.
- P5 Task 8: complete (commits 9fa1026..b6d4011, review clean). `messages.ts` keeps the Indonesian copy in one place, per my dispatch ruling. riskLevel null counts as `risk_too_high` for open projects. tvl/vc/coingecko need `verified`. Controller verified that T3 emits domain-matched `tvl`/`coingecko_listed` with `verified: true`.
- P5 Task 8: minor (deferred): `hasPotentialSignal` counts an unverified `coingecko_listed`, unlike curate. `in OPEN_TAB` matches prototype keys. No test for an ended project with riskLevel null. A vc tier that is not a number scores +2. TVL copy says "di atas" although the check is inclusive.
- P5 Task 5: complete (commits 9fa1026..d46d14b, review clean). `callStructured` returns attempts too; the breaker is optional. The input hash covers status, steps, facts and sources. The #56 seam is `AnalyzeDeps.extraSources(project, kind)`.
- P5 Task 5: carried to T6/T7: an analyzer whose prompt uses fields outside the hash (domains, deadlines, links, name) keeps stale cached analyses, so hash them or keep them out of the prompt. Cap total source size per prompt. When an analyzer is registered, update the "scoring fails at stage level" run test (it throws on every `listProjectsForScoring`). Add `console.warn` with the project id and kind on analysis failure.
- G4-4b merged: T3, T8 clean. T5 had CONFLICTS in `run.ts`, `stats.ts`, `memory-repo.test.ts` and `run.test.ts`, all additions on both sides. Resolved by the controller: STEP holds signals 8 and analyze 9, signals runs before analyze, both stat groups and both test blocks are kept, and the analyze `failed_step` test now fails the 2nd `listProjectsForScoring` call. Flag for the G4 wave review: this resolution was not task-reviewed. Tests: core 300, pipeline 458, web 350 unit · typecheck ok · pgTAP 279 · e2e 74/74.
- G4-4c1 started: P5.T4 ∥ P5.T6
- P5 Task 4: fix round 1/5 (1 addressed, 0 open — 15 unverified VC portfolio URLs shipped enabled; now `VC_LIST` is empty and the 15 sit in `VC_CANDIDATES` until checked; commits 02aeda5..3ed2bd9)
- P5 Task 4: complete (commits 5335178..3ed2bd9). Step 3 BLOCKED: every one of the 15 VC portfolio hosts got proxy CONNECT 403 from this container. Per-VC "not checked" uses `replaceSignals` `keep: SignalKeep[]` (a source, or `{source, investor}`). An empty parse counts as a failed fetch and never overwrites the cache.
- Ruling: ship `VC_LIST` empty — no page was inspected, and a wrong page would hand out verified-backer badges — costs the `vc_backer` signal being off in production until the owner runs `scripts/vc-portfolio-check.ts` from an open network (or allows the hosts) and moves verified VCs into `VC_LIST`.
- P5 Task 4: minor (deferred): `NON_PORTFOLIO_DOMAINS` duplicates the core list. `VcConfig.aliases` is unused (reserved). The smoke test lacks an investor name with a backslash. The `domainMatches` check on own-domain keys only filters platforms. A changed page with stray links replaces a good cache. Removing a VC from `VC_LIST` drops its old rows on the next rewrite (intended).
- P5 Task 6: complete (commits 5335178..973c804, review clean). Analyst input hash includes the project name. Source cap is 24,000 chars (own choice). `ai_style_violations` counts forbidden phrases in the raw answer. The tracker uses `text_id` when present.
- P5 Task 6: carried to P5.T7 (same files): restore a run test that asserts `failed_step 5` for a score-stage failure (throw only on the score listing). Write `text_id` only when every `steps_id[i].cadence` equals `project.steps[i].cadence` (count-only alignment can put translations on the wrong public rows). Count `ai_style_violations` on the post-processed (stored) text.
- P5 Task 6: minor (deferred): once `text_id` changes, refresh archives the member's source task and adds a new one (streak continuity restarts, product note). `saveStepTranslations` is per-row and non-atomic. A per-prompt random source delimiter (optional). A cached analysis never rewrites `text_id` after an identical re-extract.
- G4-4c1 merged (no conflicts). Tests: core 319, pipeline 508, web 352 unit · typecheck ok · pgTAP 279 · e2e 74/74.
- G4-4c2 started: P5.T11 ∥ P5.T7
- P5 Task 11: complete (commits 15efd01..bb65efd, review clean). `SignalKeep` gained `{source, kind}`, so earlier `reported_backer` rows are kept without keeping the AlphaDrops `curated_source`. The 120-request AlphaDrops cap limits the raise part (the collector itself makes at most ~81).
- Ruling: 40 raise pages per run with a 7-day page refresh (the brief and its test), although spec §15.1 says "max 40 per week" — the per-page refresh keeps each page about weekly, but the weekly total can exceed 40 — costs extra polite requests. Owner to confirm, or lower the per-run cap to 6 (~42/week).
- P5 Task 11: minor (deferred): no negative cache, so permanently broken raise pages are refetched first every run and can starve stale refreshes. A page loads only when a name picks it, so a differently named project on the same domain flaps. The fallback to `heading.parent()` can read sidebar h3s as rounds. The GoPlus pacing test now runs with AlphaDrops off.
- P5 Task 7: complete (commits 15efd01..ca4749b, review clean). Includes the carried T6 fixes: a `failed_step 5` test restored, `text_id` written only when the cadences align, and `ai_style_violations` counted on the stored text. The asymmetry matrix has 8 base inputs × 10 AI answers.
- Ruling: accept `RiskInput.aiFlags.scam: {pattern,quote}[] | null` (null = no scam analysis), so `ai_review.ran` is honest — costs T9 mapping null to `aiScamPatterns: []`. One `ai_scam_pattern` reason per distinct pattern (the public message cannot carry the quote, #54). `ai_review` is excluded from the minimum checks, so the AI can never relax curation.
- P5 Task 7: carried to P6.T1/T2: `apps/web/lib/view.ts` `CHECK_LABELS` needs `ai_review` (the view shows "N/9 checks ran"). Minor (deferred): `in AI_SCAM_MESSAGE` matches prototype keys. Shared prompt helpers live in `analyst.ts` (move them to `prompts/common.ts`). `ai-flags.ts` `same()` copies the `quoteInSource` normalisation. A test duplicates STRICTNESS. `maxAnalysesPerRun=60` is shared by 3 kinds.
- G4-4c2 merged (no conflicts). Tests: core 439, pipeline 568, web 352 unit · typecheck ok · pgTAP 279 · e2e 74/74.
- G4-4d started: P5.T9
- P5 Task 9: complete (commits 5f95f56..d3d2435, review clean). Signals older than 14 days are not given to curate/worth. Coverage is persisted from the per-run `SignalCoverage`. `aiScamPatterns` is `[]` when there is no scam analysis. Per-tab passed stats are added. The ended-project window is based on `ended_on`. The ended-project and signals queries were checked against real local PostgREST.
- Ruling: `curations.coverage` comes from the signals stage's per-run coverage, superseding the pre-flight line "coverage comes from the assessment checks" — that coverage is what knows whether DefiLlama/VC/AlphaDrops were checked — costs nothing.
- P5 Task 9: carried to P6.T5: a stored analyst result can have `points: []` (postProcess drops unsupported points), but `analystSchema` requires at least 1 point. Score reads only the verdict (`pick`), so Plan 6 must parse stored results with a schema that allows empty points.
- P5 Task 9: minor (deferred): the ended-candidates query reads every passing curation in 90 days plus an N+1 `latestCuration`, with an unbounded `in.(...)` (a latest-curation view or RPC later). There are no runDaily-level tests for "ended, never passed, stays hidden" or "domain checks stop after the end" (core covers both).
- G4-4d merged. Tests: core 439, pipeline 585, web 352 unit · typecheck ok · pgTAP 279 · e2e 74/74.
- G4-4e1 started: P5.T12 ∥ P5.T10
- OWNER DECISION 2026-10-11: AlphaDrops raise pages are capped at 6 per run, following spec §15.1 (~42 per week). This replaces my T11 ruling (40 per run). Done as FX5 in 4e2, in parallel with P5.T13.
- OWNER DECISION 2026-10-11 (#60): no self-service password change. The G1 "Ganti password" form is removed in FX6 (4e2). The parked "revoke other sessions after a password change" item is moot.
- OWNER DELEGATION 2026-10-11: the heatmap rule, VC access and the eval/legit review are left to the controller.
- Ruling (#59): keep the G3 heatmap rule (the window always holds today, and streak is counted from checks). The spec §14 and decision table were updated — a frozen tracker defeats #39 — costs one core function if ever reversed.
- Ruling: keep `VC_LIST` empty until the portfolio pages can be checked. The owner action stays documented (allow the 15 hosts or run `scripts/vc-portfolio-check.ts` on an open network) — no verified badge from an unread page — costs the `vc_backer` signal being off.
- Ruling: an independent agent audits the 33 eval labels and `legit.json`, then re-runs the eval twice (default order and NVIDIA first). Done as FX7 in 4e2 — the owner delegated the review, and an independent pass is more honest than the labeller grading itself — costs one opus task and two eval runs.
- P5 Task 12: complete (commits a7eb5be..a6ba780, review clean). Adds a `claim_pages` table (service role only) in 0011 for the 7-day cache. A skipped or failed GoPlus domain classifies as `unchecked`, never `official` (my dispatch ruling wins over the brief's rule order). Shared URLs store the most cautious status. `fetchUntrusted` allows only http(s) to named non-private hosts, with a 1 MB cap, a 10 s timeout and no cookies.
- P5 Task 12: minor (deferred): one failed `saveClaimPage` fails the whole analyze stage (catch per page). The SSRF guard is name-only (no DNS rebinding check, any port). The body is always decoded as UTF-8. The claim fetch is outside `analyzeBudgetMinutes`. No negative cache. `claim_pages` is never purged. The run test does not isolate `phishing_claim_link`.
- P5 Task 10: fix round 1/5 (1 addressed, 0 open — worth points were not stored, so worth-review could not print them; commits 7c0fafc..22a79f9)
- P5 Task 10: complete (commits a7eb5be..22a79f9). Step 5 BLOCKED (production run and credentials). Live scam set: G7 0/60 passed (set near-circular). G8 44/45 legit hidden, all `insufficient_checks`, because domain age answered for 1/49 here, so it cannot be judged from this container. Both are recorded with their limits.
- Ruling: the T10 fix created `0012_worth_points.sql`, which collides with Plan 6's `0012_curated_list.sql`. Fold the `worth_points` column into 0011 (this wave, not applied anywhere) and delete 0012_worth_points.sql. Done by P5.T13, which appends to 0011 anyway — costs nothing.
- Ruling: park G12 (AI scam analyst flags ≥ 80% of the scam set) — the scam set is a list of phishing domains without page texts, so there is nothing for the analyzer to read, and fetching live phishing pages is not something to automate — costs G12 staying unmeasured until a text corpus exists (owner).
- P5 Task 10: minor (deferred): G9 averages runs with `run_error` as 0. `meanRatio` can pass G1/G2 on one run. G3 pairs the latest curation with the latest assessment. A duplicated main entrypoint. The header prints TOP_N. Flagged steps are not printed. Full-history reads.
- G4-4e1 merged: T12 clean. T10 had a CONFLICT in the `curation.test.sql` `plan()` count, resolved by the controller (61+7+1=69). Tests: core 450, pipeline 652, web 352 unit · typecheck ok · pgTAP 287 · e2e 74/74.
- OWNER 2026-10-11: allowed the 15 VC hosts. Probe: 7 answer 200, 5 return 404 (path moved), Dragonfly/Hack VC redirect to hosts that are not allowed yet, Coinbase returns 403 (bot protection). FX8 verifies and fills `VC_LIST`.
- G4-4e2 started: P5.T13 ∥ FX5 (raise 6/run) ∥ FX6 (remove password change) ∥ FX7 (eval label audit + re-runs) ∥ FX8 (VC list)
- OWNER DECISION 2026-10-11: G5 (Plan 6) runs as plain subagent-driven development: one task at a time with the Agent tool on the branch (no parallel worktrees). The implementer is resumed for fix rounds 1-3. Same briefs, ledger, review policy (per-task opus review for security tasks, a whole-wave review at the end) and test gates. G4 finishes with the workflow (4e2 + the G4 wave review).
