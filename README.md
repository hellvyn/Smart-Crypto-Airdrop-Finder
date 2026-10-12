# AirdropIQ (Smart Airdrop Finder)

A curated crypto airdrop list for Indonesian users. A daily pipeline collects airdrops from several sources, checks
each project (security checks, source cross-checks, AI analysis), and only projects that pass curation appear on the
public list. Members (added by hand) also get the AI features: the full AI verdict, the farming tracker, the watchlist,
the daily briefing and the AI Coach ("Tanya AI").

The web UI is in Indonesian (casual tone). Code, docs and commit messages are in English.

Status: beta. Live at https://smart-airdrop-finder.vercel.app.

## How it works

```
sources (airdrops.io, Telegram, AlphaDrops, DefiLlama)
   -> pipeline (daily, GitHub Actions, 06:00 WIB)
      extract with LLMs -> merge -> risk checks -> curation -> AI analyses
   -> Supabase (Postgres, RLS)
   -> web app (Next.js, Vercel)
```

## Repository layout

| Path | What it is |
|---|---|
| `packages/core` | `@saf/core`: pure domain logic (curation, risk, Coach prompt and guards). No I/O. |
| `packages/llm` | Model providers (Claude, freellm router, NVIDIA), streaming, fallback chain, circuit breaker. |
| `pipeline` | The daily job and the LLM eval (`pnpm --filter pipeline eval`). |
| `apps/web` | Next.js 16 app (App Router, Supabase SSR) with unit tests and Playwright e2e. |
| `supabase` | SQL migrations and pgTAP tests. |
| `docs` | Runbooks (`docs/ops`), specs and plans (`docs/superpowers`), research and design mockups. |
| `.github/workflows` | `ci.yml` (tests), `daily.yml` (pipeline, cron 23:00 UTC), `eval.yml` (manual model eval). |

## Run it locally

Requirements: Node, pnpm 10, Docker (for the local Supabase stack).

```
pnpm install
npx -y supabase@2.120.0 start
npx -y supabase@2.120.0 status                  # API URL and anon key
cp apps/web/.env.example apps/web/.env.local    # fill in the anon key
pnpm --filter web dev                           # http://127.0.0.1:3000
```

Full steps, environment variables and member management: `docs/ops/web.md`. The pipeline: `docs/ops/pipeline.md`.

## Tests

```
pnpm typecheck
pnpm test                                       # unit tests of every package
npx -y supabase@2.120.0 test db                 # pgTAP (needs the local stack)
pnpm --filter web e2e                           # Playwright (needs the stack and a build)
```

CI runs typecheck and unit tests on every push. The slow e2e job (local Supabase, pgTAP, build, Playwright) runs only
on `main`, on manual dispatch, or when a commit message contains `[e2e]`.

## Operations

- Daily pipeline: `.github/workflows/daily.yml`; can also be started by hand from the Actions tab.
- Deploy: Vercel (Hobby plan, 100 deployments per day; see `docs/ops/web.md`). Database: hosted Supabase.
- Secrets live in GitHub Secrets, Vercel env and Supabase, never in the repo. The service role key never goes into
  `apps/web`.
- A new person or session should read `docs/superpowers/HANDOFF.md` first.

## License

MIT. See `LICENSE`.
