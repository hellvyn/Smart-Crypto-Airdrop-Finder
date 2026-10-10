# Daily pipeline runbook

How to set up, run and check the daily pipeline (`pipeline/`). It collects airdrops.io, Telegram and DefiLlama,
extracts with NVIDIA-hosted models, merges into Supabase, scores risk and purges old text. It sends no email.
Spec: section 4 (pipeline), 5 (data model), 9 (privacy) and 11 (errors and testing) of
`docs/superpowers/specs/2026-10-10-smart-airdrop-finder-design.md`.

## 1. Create the Supabase project

1. Create a project in the Supabase dashboard (Free plan is enough). Note the **project ref** (the
   `<ref>` in `https://<ref>.supabase.co`) and the database password.
2. From the repo root, link the CLI and push the schema:

   ```
   npx -y supabase@2.120.0 login
   npx -y supabase@2.120.0 link --project-ref <ref>
   npx -y supabase@2.120.0 db push
   ```

   `db push` applies everything in `supabase/migrations/` (`0001_pipeline.sql`: tables, RLS, public read
   policies; later files add users, web views and more, through `0006_project_changes_seq.sql`). Run it again after pulling a new migration.

   **Production project (`smart-airdrop-finder`, created 2026-10-10):** 0001–0006 were applied through the
   Supabase MCP connector, not `db push`, so the remote migration history holds timestamped entries (0002 split
   in parts; `delete_my_account()` was run in the SQL Editor and has no entry). Before the first `db push` of a
   new migration there, align the history once, then push:

   ```
   npx -y supabase@2.120.0 migration repair --status reverted 20261010140453 20261010141009 20261010141033 \
     20261010141045 20261010141237 20261010141244 20261010141250 20261010141256
   npx -y supabase@2.120.0 migration repair --status applied 0001 0002 0003 0004 0005 0006
   npx -y supabase@2.120.0 migration list   # local and remote columns should match
   ```
3. In **Project Settings > API**, copy the project URL and the `service_role` key. The service role key bypasses
   RLS: it goes only into GitHub Secrets, never into the web app or a browser.

## 2. GitHub secrets

In **Settings > Secrets and variables > Actions**, add repository secrets:

| Secret | Value |
|---|---|
| `NVIDIA_API_KEY` | NVIDIA API key (`integrate.api.nvidia.com`) |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | the `service_role` key from step 1.3 |

The workflow installs dependencies without these secrets and only passes them to the pipeline step. Only a
missing `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` stops the run with `{"config_error":1}` before anything is
collected. The pipeline reads no other secret: a leftover `BREVO_API_KEY`, `EMAIL_FROM` or `SITE_URL` in the
environment or in the repository secrets is ignored and can be deleted.

## 3. Run it

- **Scheduled:** `.github/workflows/daily.yml` runs every day at 23:00 UTC (`cron: "0 23 * * *"`).
- **Manual:** Actions > **Daily pipeline** > **Run workflow** (`workflow_dispatch`), or
  `gh workflow run daily.yml`.
- Two runs never overlap (`concurrency: daily-pipeline`). The job has a 60-minute limit; extraction stops starting
  LLM calls after 35 minutes (`extractBudgetMinutes`, each call cut off after 180 s) and leaves the rest pending for
  the next run.
- Running it twice on the same day is safe: unchanged documents are not extracted again.

## 4. Read the result

The job log contains exactly one JSON line of numeric counters (never URLs, text, names, emails or wallets).
The same counters are stored in `pipeline_runs.stats` with `started_at`/`finished_at`.

| Counter | Meaning |
|---|---|
| `docs_collected` / `docs_changed` | documents seen / new or changed (only these go to the LLM) |
| `extract_ok` / `extract_failed` | extractions that passed the schema / documents where every model failed (retried next run) |
| `extract_deferred` | pending documents left for the next run because the 35-minute budget ran out (or every model's circuit was open) |
| `llm_models_tripped` | models skipped for the rest of the run after 3 consecutive failures (timeouts, 5xx, rate limits past their retries) |
| `not_airdrop` | documents the model judged not about an airdrop |
| `projects_created` / `projects_updated` | merge results |
| `assessed` | projects that got a new risk assessment |
| `source_failed` | sources that failed or returned nothing usable (often a changed page structure) |
| `ingest_failed` / `merge_failed` / `score_failed` | single documents or projects that could not be stored, merged or assessed |
| `purged` | documents whose text passed the 90-day retention and was blanked |
| `run_error`, `failed_step` | a whole stage failed (1 collect, 2 extract and merge, 4 DefiLlama merge, 5 score, 6 purge, in run order); the other stages still ran |

Exit code (shown as the workflow status): **failed** when `run_error`, `source_failed`, `ingest_failed`,
`merge_failed` or `score_failed` is above 0, or when the Supabase settings are missing (`{"config_error":1}`). Everything is
persisted before the job exits. `extract_failed` and `extract_deferred` alone do not fail the job.

What to do:

- `source_failed` > 0 on several days: the source page structure probably changed; update the collector and its
  hand-trimmed fixture in `pipeline/test/fixtures/`.
- `merge_failed` > 0: the document is stored as `merge_failed` and is retried only when its content changes. Look at
  `documents` where `extraction_status = 'merge_failed'` in the Supabase SQL editor.
- `extract_deferred` > 0 every day: lower `maxDocumentsPerRun` or check model latency in `extractions.latency_ms`.
- `llm_models_tripped` > 0: a model endpoint failed repeatedly (see `extractions.error`, e.g. `http_0` = 180 s
  timeout). The run continues on the remaining models; if it repeats for days, reorder or replace the model in
  `pipeline/src/config.ts`.

## 5. LLM eval (after changing the prompt or a model)

Fill `pipeline/eval/cases/` (gitignored; see `pipeline/eval/README.md`) and run:

```
NVIDIA_API_KEY=... pnpm --filter pipeline eval
```

Behind a proxy that injects the key, use `NODE_USE_ENV_PROXY=1 pnpm --filter pipeline eval`. Exit code 0 = all
pass conditions hold (0 hallucinated URLs, Ledger negative rejected, Abstract `ended`, status accuracy at least the
baseline in `ground-truth.json`, radar recall). Bump `PROMPT_VERSION` in `pipeline/src/llm/prompt.ts` whenever the
prompt changes.

## 6. Local smoke tests

Both scripts refuse to run against anything but `localhost`/`127.0.0.1`.

```
npx -y supabase@2.120.0 start      # needs Docker
npx -y supabase@2.120.0 db reset   # fresh schema from supabase/migrations
npx -y supabase@2.120.0 status     # prints API URL, anon key and service_role key

export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_SERVICE_ROLE_KEY=<service_role key from status>
export SUPABASE_ANON_KEY=<anon key from status>   # optional: enables the RLS checks

pnpm --filter pipeline exec tsx scripts/repo-smoke.ts    # SupabaseRepo against the real schema
pnpm --filter pipeline exec tsx scripts/daily-smoke.ts   # two runDaily runs with fake HTTP and LLM

npx -y supabase@2.120.0 stop
```

`daily-smoke.ts` reuses fixed URLs, so run it right after `db reset`. Unit tests need no database:
`pnpm test && pnpm typecheck`.
