# Smart Crypto Airdrop Finder

A curated crypto airdrop list for Indonesian users, with the scams filtered out before you see them.

Every few days a pipeline collects airdrops from several sources, cross-checks them, runs security checks and an AI
review, and only the projects that pass make it onto the public list. The web app is branded **AirdropIQ**.

**Live:** https://smart-airdrop-finder.vercel.app · **Status:** beta · **License:** MIT

> Not financial advice. Always do your own research before connecting a wallet.

## Features

- **Curated list.** Live, early and ended airdrops, sorted and filtered by worth, risk, cost and status.
- **Security checks on every project.** Dangerous asks (seed phrase, pay first), lookalike domains, domain age (RDAP),
  phishing databases (GoPlus), hack history (DefiLlama) and source cross-checks. A project that fails any required
  check is not shown.
- **AI verdict.** Garap / Pantau / Skip, with the reasons, the contradictions between sources and the estimated effort.
- **Farming tracker.** Log the tasks you do per project and see your activity heatmap and results.
- **Wallet activity.** Add EVM wallet *addresses* (read-only, never keys) and see their on-chain activity.
- **Watchlist and daily briefing.** Follow projects and get a summary of what changed.
- **AI Coach ("Tanya AI").** Ask questions and get a personal plan. Messages that look like a seed phrase or private
  key are refused before they reach the database or the model.

The member features (AI verdict, tracker, watchlist, briefing, Coach) are for members added by hand.

## How it works

```
sources: airdrops.io · Telegram · AlphaDrops · DefiLlama
   │
   ▼
pipeline: extract (LLM) → merge → risk checks → curation → AI analysis
   │
   ▼
Supabase (Postgres + row-level security)
   │
   ▼
web app (Next.js on Vercel)
```

## Tech stack

TypeScript · pnpm workspaces · Next.js 16 (App Router) · React 19 · Supabase · Claude and NVIDIA models · Zod ·
Vitest · Playwright · pgTAP

## Repository layout

| Path | What it is |
|---|---|
| `apps/web` | Next.js web app, unit tests and Playwright e2e |
| `pipeline` | The collect-and-curate job and the LLM eval |
| `packages/core` | Pure domain logic: curation, risk, Coach prompt and guards (no I/O) |
| `packages/llm` | Model providers, streaming, fallback chain, circuit breaker |
| `supabase` | SQL migrations and pgTAP tests |
| `docs/ops` | Runbooks for the web app and the pipeline, UI glossary |
| `docs/design` | HTML design mockups |

## Getting started

Requirements: Node (version in `.nvmrc`), pnpm 10, Docker (for the local Supabase stack).

```bash
pnpm install
npx -y supabase@2.120.0 start
npx -y supabase@2.120.0 status                  # shows the API URL and anon key
cp apps/web/.env.example apps/web/.env.local    # fill in the anon key
pnpm --filter web dev                           # http://127.0.0.1:3000
```

Run the pipeline locally: see `docs/ops/pipeline.md`. Environment variables and member management: `docs/ops/web.md`.

## Tests

```bash
pnpm typecheck
pnpm test                                       # unit tests of every package
npx -y supabase@2.120.0 test db                 # pgTAP (needs the local stack)
pnpm --filter web e2e                           # Playwright (needs the stack and a build)
```

## Security

- Secrets live in GitHub Secrets, Vercel and Supabase, never in the repo. `.env.example` holds no values.
- The Supabase service role key is only used by the pipeline and the tests, never by the web app.
- The app never asks for a seed phrase or private key and never asks you to sign a transaction.

Found a security issue? Please open a private security advisory on GitHub instead of a public issue.

## Contributing

Read `AGENTS.md` first: it has the commands and the rules that must hold (security, copy style, tests). The UI text is
Indonesian (casual "kamu" tone); code, docs and commit messages are English.

## License

MIT. See `LICENSE`.
