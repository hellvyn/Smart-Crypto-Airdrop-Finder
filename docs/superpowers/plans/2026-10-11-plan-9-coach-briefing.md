# Plan 9: AI Farming Coach + Daily Briefing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Member-only AI Farming Coach (profile form → grounded 3–5 project plan with "Mulai garap" → follow-up chat,
"Tanya AI", "Jelasin langkah ini") and a daily AI Briefing at the top of `/airdrops`.

**Architecture:**
- The model code moves from `pipeline/src/llm` into a shared workspace package `@saf/llm`, used by both the pipeline and
  the web.
- The Coach runs in Next.js route handlers on Vercel. It uses the member's session and talks to the database only
  through RLS and quota RPCs.
- The Briefing is a new pipeline step that writes one row per day.
- All grounding, style and candidate logic is pure code in `@saf/core`, so it is unit-testable without network.

**Tech Stack:**
- Monorepo: pnpm, TypeScript.
- Model calls: `@anthropic-ai/sdk` (Claude Sonnet 5.5 first), then the freellm/NVIDIA chain.
- Web: Next.js 16 route handlers with streaming.
- Database: Supabase (Postgres, RLS), pgTAP.
- Tests: Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-11-coach-briefing-design.md` (decisions #61–#71). Read it before any task.

## Global Constraints

- Every Coach and Briefing surface is member-only. Anon has no grant on any new table or RPC (spec §4.4).
- There is no service role key in `apps/web`. Web DB access uses the member session and RLS/RPC only.
- Model keys are server-only env: `ANTHROPIC_API_KEY`, `LLM_API_KEY`, `LLM_BASE_URL`, `NVIDIA_API_KEY`. There is never a `NEXT_PUBLIC_` key.
- Quota: 20 user messages per member per day, reset at 00:00 Asia/Jakarta (WIB) for every member, whatever `profiles.timezone` says (owner 2026-10-11). Usage is counted from the append-only `coach_usage` table, so deleting a thread never returns quota. A user message counts while it has a reply, or while it is less than 2 minutes old (spec §4.4).
- Plans hold 3–5 recommendations. Each has 1–3 reasons, and every reason quote passes `quoteInSource` against the context. Candidates are capped at 25 (spec §5.2).
- A Pemula (`beginner`) never gets a project at risk level `high` or `critical`. Capital filters follow the spec §5.2 table exactly.
- Free text (anything that is not a quote) is checked by the same token/number/secret/payment guard as `stepTranslationGrounded`. Chat output is redacted with `[dihapus: info sensitif]` (spec §6).
- Style: no em dash, and no word from the shared banned list (the list currently in `apps/web/test/copy-style.test.ts`, moved to core in Task 1). Second person is "kamu" (spec §7).
- Retention: `coach_threads` and `briefings` older than 30 days are deleted by the pipeline purge step.
- Migrations use only create, alter-add, grant, revoke, and create-or-replace. No DROP and no mass UPDATE (the hosted connector refuses both). The next free number is `0017`.
- Never log emails, user ids, wallet addresses, prompts or model output text. Count-only logging.
- All user-visible strings go in `apps/web/lib/copy.ts`.

## Review Focus

1. A model answer that names a real, listed project but one that is not in this member's candidate list (for example a Pemula getting a `high` risk project). It must be dropped, not shown.
2. A follow-up chat question that coaxes the model into giving a claim URL or contract address ("kasih link claim-nya dong"). The output is redacted, and a link to our own project page is offered instead.
3. Two browser tabs sending messages at the same moment when one quota slot is left. Exactly one succeeds (row lock in `coach_begin`).
4. A member who changes `profiles.timezone` or deletes a thread. The quota count does not change (WIB day, append-only `coach_usage`).
5. Mobile at 360 px: the plan cards, the chat input and the Briefing box have no horizontal scroll, and the streamed answer wraps.

Each of these has a test in the owning task: 1 in Task 4, 2 in Task 5, 3 and 4 in Task 3, 5 in Task 6.

---

### Task 1: Shared style and grounding helpers in core

**Files:**
- Create: `packages/core/src/style.ts`, `packages/core/src/coach/glossary.ts`, `packages/core/src/coach/guard.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/src/curate/analyst.ts` (`stepTranslationGrounded` delegates to the guard), `apps/web/test/copy-style.test.ts` (imports `BANNED_WORDS`)
- Test: `packages/core/test/style.test.ts`, `packages/core/test/coach-guard.test.ts`

**Interfaces:**
- Produces:
  - `BANNED_WORDS: readonly string[]` (the exact list from copy-style.test.ts).
  - `findBanned(text: string): string[]`.
  - `cleanStyle(text: string): string` replaces each em dash with ", ".
  - `GLOSSARY: readonly { term: string; text: string }[]`, the 16 rows of spec §8, verbatim.
  - `groundedAgainst(text: string, context: string): boolean` is the `stepTranslationGrounded` rule generalised to any context string. `stepTranslationGrounded(step, translation)` becomes `groundedAgainst(translation, step)`.
  - `redactSensitive(text: string, context: string): { text: string; redactions: number }` replaces each host/URL, handle, address or secret/payment phrase not present in `context` with `[dihapus: info sensitif]`.

- [ ] **Step 1: Write failing tests**
  - `findBanned("Ini krusial dan seamless")` returns `["krusial","seamless"]`.
  - `cleanStyle("a — b")` returns `"a, b"`.
  - `GLOSSARY.length === 16`, and every `text` passes `findBanned(...).length === 0` with no "—".
  - `groundedAgainst("kirim ke 0xabc123def", "join the waitlist")` is false.
  - `groundedAgainst("buka jumper.exchange", "Visit jumper.exchange")` is true.
  - `redactSensitive("klaim di evil.xyz pakai seed phrase", "Jumper")` returns the text without `evil.xyz` and without "seed phrase", with `redactions: 2`.
  - All existing `stepTranslationGrounded` tests are unchanged and still pass.
- [ ] **Step 2: Run `pnpm --filter @saf/core test`.** Expected: FAIL (modules missing).
- [ ] **Step 3: Implement the five exports.** `copy-style.test.ts` imports `BANNED_WORDS` instead of its local array.
- [ ] **Step 4: Run `pnpm test` and `pnpm typecheck` at the root.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): shared style, glossary and grounding guard`.

### Task 2: `@saf/llm` package (refactor plus chat streaming)

**Files:**
- Create: `packages/llm/package.json` (name `@saf/llm`, deps `@anthropic-ai/sdk`, `zod`), `packages/llm/src/{index,providers,nvidia,claude,chat,structured,circuit-breaker,stream}.ts`, `packages/llm/test/*`
- Move (git mv): `pipeline/src/llm/{nvidia,claude,chat,structured,circuit-breaker}.ts` and their tests, plus `loadProviders` from `pipeline/src/config.ts`
- Modify: pipeline imports (`pipeline/src/**`), `pipeline/package.json` (dep `@saf/llm`), `apps/web/package.json` (dep `@saf/llm`)
- Keep in pipeline: `pipeline/src/llm/{extract,prompt}.ts`, `prompts/*`, and `MODELS` / `ANALYZE_MODELS` in config.

**Interfaces:**
- Produces everything the pipeline used before, under the same names, from `@saf/llm`.
- New: `streamText(models: ModelConfig[], messages: ChatMessage[], deps): AsyncIterable<{ delta: string } | { done: { model: string; inputTokens: number | null; outputTokens: number | null } } | { failed: true }>`.
  - It tries models in order.
  - It falls back only before the first delta. A model that fails mid-stream ends with `failed`.
  - `stop_reason` `refusal` or `max_tokens` before any output counts as a failure.
- New: `COACH_MODELS = ANALYZE_MODELS` (Claude Sonnet first).

- [ ] **Step 1: Move files with `git mv`, update the imports, and run `pnpm test`.** Expected: pipeline still 727 (or the current count). Any test diff must be an import path only.
- [ ] **Step 2: Write failing tests for `streamText`.**
  - A Claude fake yields deltas, then `done` with model `anthropic:claude-sonnet-5-5`.
  - Claude throws a 400 credit error before output, then freellm yields: falls back.
  - A failure after the first delta gives `failed` with no fallback.
  - `refusal` before output falls back.
  - An empty `ANTHROPIC_API_KEY` skips Claude.
- [ ] **Step 3: Implement `streamText`.** Use the SDK `messages.stream()` for Claude and the existing SSE parsing for OpenAI-compatible providers.
- [ ] **Step 4: Run `pnpm test` and `pnpm typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** `refactor(llm): shared @saf/llm package with streaming chat`.

### Task 3: Migration 0017 (Coach tables, quota RPCs, briefings)

**Files:**
- Create: `supabase/migrations/0017_coach_briefing.sql`, `supabase/tests/coach_briefing.test.sql`

**Interfaces (SQL, spec §4.4 verbatim):**
- Tables `coach_profiles`, `coach_threads`, `coach_messages`, `briefings`, with the columns and checks of spec §4.4.
  - `coach_profiles.chains`: ≤ 10 items, each ≤ 40 chars, enforced by a check using a helper or `cardinality`.
- `coach_begin(p_thread_id uuid, p_kind text, p_content text) returns uuid`.
  - Locks the caller's `coach_profiles` row (or an advisory lock on the uid) so concurrent calls serialise.
  - The day is today's date in `Asia/Jakarta` for every member (owner ruling 2026-10-11); `profiles.timezone` is not read.
  - Raises `P0001 'quota'` at the 21st counted message, and `P0001 'thread'` for a thread that is not the caller's.
- `coach_finish(p_user_message_id uuid, p_content text, p_model text, p_in int, p_out int, p_cache_read int, p_cache_write int) returns uuid`. `coach_messages` gets `cache_read_tokens` and `cache_creation_tokens` int null.
- `coach_save_plan(p_thread_id uuid, p_plan jsonb) returns void`.
- `coach_new_thread(p_project_id uuid) returns uuid`.
- All four are security definer with `search_path = ''`, EXECUTE revoked from public and anon, granted to authenticated.

- [ ] **Step 1: Write the failing pgTAP file.**
  - Anon has no privilege on the 4 tables or the 4 functions.
  - A cannot read or delete B's threads or messages.
  - Authenticated cannot insert into `coach_messages` directly (42501).
  - 20 `coach_begin` calls succeed and the 21st raises `quota`.
  - A user message older than 2 minutes with no reply is not counted (backdate `created_at` as postgres).
  - Usage from yesterday WIB is not counted.
  - Changing `profiles.timezone` does not change the count.
  - Deleting a thread does not return quota.
  - `coach_finish` on another user's message, or on an already answered one, raises.
  - Authenticated can select `briefings`; anon cannot.
- [ ] **Step 2: Run `.superpowers/bin/dbtest /home/user/Smart-Airdrop-Finder`.** Expected: FAIL.
- [ ] **Step 3: Write `0017_coach_briefing.sql`.**
- [ ] **Step 4: Run dbtest.** Expected: PASS, with every earlier file still passing.
- [ ] **Step 5: Concurrency test.** Two connections each call `coach_begin` with one slot left; exactly one succeeds. Use `dblink` if available in the local stack; otherwise a Vitest test against the local DB with two clients in `apps/web/test/coach-quota.int.test.ts`, skipped only when the local stack is down (match the existing integration-test pattern). Run it and expect PASS.
- [ ] **Step 6: Commit** `feat(db): coach tables, quota RPCs and briefings (0017)`.

### Task 4: Coach domain logic in core

**Files:**
- Create: `packages/core/src/coach/{profile,candidates,plan,prompt}.ts`
- Test: `packages/core/test/coach-{profile,candidates,plan,prompt}.test.ts`

**Interfaces:**
- `coachProfileSchema` (zod), with the exact enums and ranges of spec §5.1 and §4.4. `wallet_count` is required when `has_wallet`, and must be null otherwise.
- `type Candidate`:
  - `{ id, slug, name, risk: RiskLevel | null, worthLevel, tab, capital: "free"|"deposit"|"unknown", capitalMinUsd: number|null, chains: string[], minutesPerDay: number|null, nextDeadline: string|null, points: { text, quote, sourceUrl }[], steps: { text, cadence }[], signalRank: number|null }`
- `selectCandidates(all: Candidate[], profile: CoachProfile, onlyProjectId?: string): Candidate[]`
  - Applies the spec §5.2 capital table.
  - A Pemula excludes `high`/`critical` risk and `unknown` capital.
  - Keeps only tabs `live_now`/`early_bets`.
  - Sort order: worth rank, then signal rank, then favourite chain first, then nearest deadline when the goal is `quick`.
  - Caps at 25.
- `coachPlanAnswerSchema`: 3–5 `{ project_id, reasons: { text, quote }[1..3], minutes_per_day: int 1..240, capital_note }`.
- `validatePlan(answer, candidates, profile): { recommendations: ValidPlanItem[]; dropped: number }`. It drops:
  - an unknown `project_id`;
  - a reason whose quote is not found by `quoteInSource` in that candidate's points/steps text;
  - a reason whose text fails `groundedAgainst` against that candidate's context.

  It applies `cleanStyle`, trims to 5, and enforces that the sum of `minutes_per_day` ≤ the profile's `minutes_per_day`. Over budget, it drops from the end.
- `buildCoachSystemPrompt(profile, candidates): { shared: string; member: string }`. `shared` is byte-identical for every member and every request (style rules, glossary, data marker, topic lock; no date, no profile). `member` holds the profile, the candidate JSON and today's date, with candidates in a stable order and keys sorted, so the same member and day render the same bytes. Contents:
  - the spec §7 style rules and the `GLOSSARY`;
  - the data-not-instructions marker;
  - the topic lock;
  - for a Pemula: short sentences, explain terms, a security reminder;
  - for `has_wallet` false: start with the "Langkah 0" text from spec §5.1.

  No email, user id or wallet address ever appears in it. Assert this in a test with a profile that carries none.

- [ ] **Step 1: Write failing tests.**
  - The capital table, row by row.
  - A Pemula never gets a `high`/`critical` candidate or an `unknown`-capital one.
  - A Pemula with capital `free` gets only `free`.
  - `validatePlan` drops an answer naming a listed project that is not in this member's candidates (Review Focus 1).
  - `validatePlan` drops a fake quote.
  - `validatePlan` drops a reason containing `0x...`.
  - `validatePlan` trims the plan to the minute budget.
  - The prompt contains every glossary term and does not contain "—".
- [ ] **Step 2: Run `pnpm --filter @saf/core test`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `pnpm test`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): coach profile, candidates, plan validation and prompt`.

### Task 5: Coach server (data layer and route handlers)

**Files:**
- Create: `apps/web/lib/coach.ts`, `apps/web/app/api/coach/plan/route.ts`, `apps/web/app/api/coach/chat/route.ts`
- Test: `apps/web/test/coach-lib.test.ts`, `apps/web/test/coach-routes.test.ts`

**Interfaces:**
- `getCoachProfile(db, userId)` and `saveCoachProfile(db, userId, input): Promise<{ ok: true } | { ok: false; error: CoachError }>`.
- `loadCandidates(db, now): Promise<Candidate[]>`, built from:
  - `curated_list`;
  - the latest `analyst` ai_analyses, parsed with `storedAnalystSchema`, giving points and effort minutes;
  - `tasks` (`text_id` with fallback to `text`).
- `POST /api/coach/plan` with body `{}`:
  1. `requireUser`;
  2. profile;
  3. candidates (none: return a 200 with an empty-state result and no RPC call);
  4. `coach_new_thread`, then `coach_begin(kind 'plan')`;
  5. `callStructured` with `COACH_MODELS`;
  6. `validatePlan` (zero left: return the "Coach belum bisa bikin rencana" state);
  7. `coach_save_plan`, then `coach_finish`.

  It returns `{ threadId, recommendations, remaining }`.
- Prompt caching (Claude only; the freellm/NVIDIA fallbacks ignore it):
  - `system` is two text blocks, `shared` then `member`. Each carries an explicit `cache_control: { type: "ephemeral" }` (5-minute TTL).
  - The conversation turns use automatic caching (top-level `cache_control`), so follow-ups reuse the prior prefix.
  - Nothing that changes per request goes before the breakpoints.
  - `coach_finish` stores `cache_read_tokens` and `cache_creation_tokens`, so the hit rate can be measured. Add both columns in Task 3.
  - Tests: the two system blocks are byte-identical across two calls for the same member and day; `shared` is identical across two different members; no timestamp appears in `shared`.
- `POST /api/coach/chat` with body `{ threadId: uuid, message: string ≤ 1000, kind: 'chat' | 'explain_step', stepId?: uuid }`.
  - `coach_begin`, then `streamText`. The response is `text/plain` streamed. The stream is passed through `redactSensitive` and `cleanStyle` per completed sentence; the full text is redacted again before `coach_finish`.
  - Project names among the candidates come back as separate JSON metadata (`x-coach-links` header or a trailing event) so the client can link them. They are never parsed from the model text.
- Errors map to `copy.coach.errors`: `quota`, `unavailable`, `bad_input`, `not_member`.
- Every route calls `requireUser` and returns 401 JSON for visitors.

- [ ] **Step 1: Write failing tests.** Use a fake `@saf/llm` and a fake db.
  - A visitor gets 401.
  - A quota error from the RPC gives 429 with the `quota` copy.
  - A plan answer with a non-candidate project id: that item is dropped.
  - All models failing gives 503 with `unavailable`, and `coach_finish` is not called.
  - When the first text delta arrives, call `coach_mark_used(userMessageId)` before forwarding any text, so an aborted, truncated or timed-out answer still counts (Task 3 re-review). Cut the final reply to 16000 characters before `coach_finish`, and cap `max_tokens` so a normal answer fits. If `coach_mark_used` raises (`expired`), stop the stream and forward nothing. The plan route (non-streaming `callStructured`) calls `coach_mark_used` as soon as the model returns an answer, before `validatePlan`, so a plan the validator rejects still counts.
  - Chat output "claim di https://evil.xyz" is streamed and stored with `[dihapus: info sensitif]` (Review Focus 2).
  - The prompt sent to the fake never contains the user's email.
- [ ] **Step 2: Run `pnpm --filter web test`.** Expected: FAIL.
- [ ] **Step 3: Implement.** Measure route duration on a Vercel preview with a real key only during Task 10. Here, set `export const maxDuration = 60` and stream.
- [ ] **Step 4: Run `pnpm test` and `pnpm typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): coach data layer and plan/chat routes`.

### Task 6: `/coach` page

**Files:**
- Create: `apps/web/app/(app)/coach/page.tsx`, `apps/web/components/coach/{ProfileForm,PlanCards,CoachChat,ThreadList}.tsx`
- Modify: `apps/web/components/site-header.tsx` (member nav "Coach"), `apps/web/lib/copy.ts` (`coach` area), `apps/web/app/globals.css`
- Test: `apps/web/test/components/coach/*.test.tsx`, `apps/web/e2e/coach.spec.ts`

**Interfaces:**
- Consumes the Task 5 routes and the existing `startFarmingAction(projectId)` from `app/(app)/garapan/actions.ts`.

Requirements:
- The form follows spec §5.1. The Pemula hint text is verbatim. "Belum punya wallet" hides wallet count.
- `PlanCards` reuse the list card visuals (logo, name, risk, capital). Each card shows:
  - its reasons with quotes;
  - its minutes;
  - a "Mulai garap" form posting `startFarmingAction`;
  - for a Pemula, the security reminder above the cards;
  - "mungkin tetap butuh sedikit gas kalau di mainnet" on `free` capital.
- `CoachChat` shows "Sisa X/20 pesan hari ini" and the disclaimer "Bukan nasihat keuangan. Tetap DYOR.". It renders streamed text as plain text and turns candidate names into links from the metadata.
- `ThreadList` covers the last 30 days and has a delete action.
- The visitor branch redirects to login, matching the other `(app)` pages.

- [ ] **Step 1: Write failing e2e tests** with a seeded member and the stub model server, following the existing e2e stub pattern for prices.
  - Fill the form, get a plan, click "Mulai garap", and the project appears on `/garapan`.
  - Send a chat and see a streamed answer.
  - The quota-exhausted message appears after 20.
  - A visitor is redirected.
  - At 360 px there is no horizontal scroll (Review Focus 5).
  - Component tests: the form validation messages, and that the plan cards render no `<a>` for external hosts.
- [ ] **Step 2: Run** `.superpowers/bin/e2e /home/user/Smart-Airdrop-Finder e2e/coach.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the unit tests and that spec.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): coach page with profile form, plan and chat`.

### Task 7: "Tanya AI" and "Jelasin langkah ini" on the project page

**Files:**
- Modify: `apps/web/components/ProjectDetailView.tsx`, `apps/web/components/detail/StepsList.tsx`, `apps/web/lib/copy.ts`
- Create: `apps/web/components/coach/ExplainStep.tsx`
- Test: component tests, `apps/web/e2e/projects.spec.ts`

Requirements:
- "Tanya AI" is a member-only link to `/coach?project={id}`. The coach page starts a thread with `onlyProjectId`.
- For a project that did not pass, the page shows the public fail reason instead of a plan (spec §5.4).
- "Jelasin langkah ini" is member-only, per step. It posts kind `explain_step` with `stepId`, and renders the answer inline below the step.
- Visitors see the "Member only" box.
- Visitor HTML contains neither control (raw-HTML assertion, as in Plan 6 T5).

- [ ] **Step 1: Write failing tests.**
  - A member sees both controls; a visitor sees neither, checked in the raw HTML.
  - Explain on a stubbed model shows the answer under the step.
  - "Tanya AI" on a failed project shows the fail reason and no "Mulai garap".
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the unit tests and `e2e/projects.spec.ts`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): Tanya AI and Jelasin langkah ini`.

### Task 8: Pipeline briefing step and retention

**Files:**
- Create: `pipeline/src/steps/briefing.ts`, `pipeline/src/llm/prompts/briefing.ts`, `packages/core/src/coach/briefing.ts`
- Modify: `pipeline/src/run.ts` (step after score/curation, before logos), `pipeline/src/steps/purge.ts`, `pipeline/src/store/{repo,memory-repo,supabase-repo}.ts`, `pipeline/src/stats.ts`
- Test: `pipeline/test/briefing.test.ts`, `packages/core/test/coach-briefing.test.ts`

**Interfaces:**
- `briefingInputs(changes, deadlines, curated): BriefingFact[]` (core, pure). A fact is one of:
  - newly curated today;
  - a status change;
  - a risk raise;
  - a claim/snapshot/campaign_end deadline within 48 h.

  Each fact has `{ projectId, slug, name, kind, text }`.
- `validateBriefing(answer, facts): BriefingItem[]` keeps at most 5 items. Each must name a fact's `projectId` and pass `groundedAgainst` against that fact's text. It also passes through `cleanStyle` and `findBanned`.
- `fallbackBriefing(facts): BriefingItem[]` is the no-AI version, using the fact texts as-is, max 5.
- Repo: `saveBriefing(day, items, model, ai)`, `purgeCoachAndBriefings(olderThan: Date)`.
- Stats: `briefing_items`, `briefing_ai` (bool), `coach_threads_purged`.

Requirements:
- One model call per run.
- A banned word triggers one rewrite, then the fallback.
- No facts: no model call, and nothing is saved (keep yesterday's).

- [ ] **Step 1: Write failing tests.**
  - Facts are built from seeded changes.
  - A model answer naming an unknown project is dropped.
  - "krusial" is rewritten once, then falls back.
  - Zero facts means no call.
  - Purge removes threads older than 30 days and keeps newer ones.
  - Stats are set.
- [ ] **Step 2: Run `pnpm --filter pipeline test`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `pnpm test` and `pnpm typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(pipeline): daily briefing and coach retention`.

### Task 9: Briefing box on `/airdrops`

**Files:**
- Create: `apps/web/components/BriefingBox.tsx`
- Modify: `apps/web/app/(public)/airdrops/page.tsx`, `apps/web/lib/queries.ts` (`getLatestBriefing`), `apps/web/lib/copy.ts`
- Test: component tests, `apps/web/e2e/projects.spec.ts`

Requirements (spec §5.6):
- Member only. The box sits above the list together with the T7 changes panel.
- It shows the AI items, each linking to its project, plus the personal part (watchlist changes and the nearest garapan deadlines).
- The header reads "Briefing pagi · {tanggal}" (id-ID). When no briefing exists for today, it uses the latest one with its date.
- It is collapsible. The state is kept in localStorage inside try/catch.
- A failed query degrades to no box.

- [ ] **Step 1: Write failing tests.**
  - A member sees the box with a seeded briefing; a visitor does not, checked in the raw HTML.
  - An older briefing shows its own date.
  - Collapse persists across a reload.
  - A query failure hides the box.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): morning briefing box`.

### Task 10: Ops, samples for owner review (G13), capacity check (G14)

**Files:**
- Create: `pipeline/eval/coach-samples.ts`, which generates 20 coach answers and 5 briefings into `pipeline/eval/out/` (gitignored).
- Modify: `docs/ops/web.md` (Vercel env vars, the 0017 deploy step, the Segera removal rule), `docs/ops/pipeline.md` (briefing step, stats), `apps/web/lib/copy.ts` (keep "Segera" until the owner signs off)

Requirements:
- The script uses the real provider chain only when keys are present. It records latency and failure rate per model for G14, and prints a summary.
- The docs say the "Segera" labels come off only after the G13 review (≥ 80% of 20 Coach answers and 5 Briefings judged good) and the G14 numbers.

- [ ] **Step 1: Write a failing test for the script's summary function** (pure, with fake results).
- [ ] **Step 2: Implement it and run `pnpm test`.** Expected: PASS.
- [ ] **Step 3: Commit** `chore: coach samples and capacity script, ops docs`.
