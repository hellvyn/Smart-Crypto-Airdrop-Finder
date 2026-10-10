# LLM extraction eval

Scores the extraction prompt and the model fallback chain against 8 hand-labelled texts
(`ground-truth.json`, committed: it is our own labelling).

## Filling `cases/`

`eval/cases/` is **gitignored**. The repo is public and the sources' terms of use are unknown, so never commit
third-party texts. For each case id in `ground-truth.json` create two files:

- `cases/<id>.txt`: the plain text exactly as the collector would hand it to the LLM (airdrops.io page text for
  `aio_*`, one Telegram post for `tg_*`).
- `cases/<id>.meta.json`: `{"source": "<url>", "published": "<ISO date>" | null}`.

Case ids: `aio_deepbook`, `aio_variational`, `aio_abstract`, `aio_raycash`, `tg_flop`, `tg_ink`,
`tg_ledger_negative`, `tg_weekly_radar`.

## Running

```
LLM_API_KEY=... NVIDIA_API_KEY=... pnpm --filter pipeline eval
```

Cases run one at a time through `extractWithFallback` with the default models from `src/config.ts`. It prints a
metrics table (no case text) and which model answered each case (`<provider>:<id>`, e.g. `freellm:auto`).
Providers come from the same environment as the daily job (`loadProviders`): `LLM_BASE_URL` (optional) and
`LLM_API_KEY` (may be empty) for freellm, `NVIDIA_API_KEY` for the NVIDIA fallback models.

If `NVIDIA_API_KEY` is empty the script prints a notice and continues, since a proxy may inject the key. In
proxy-only environments set `NODE_USE_ENV_PROXY=1` so Node's `fetch` goes through the proxy.

Exit codes: `0` pass, `1` a pass condition failed, `2` `cases/` is missing or empty.

## Pass conditions (spec section 11)

- Hallucinated URLs: 0. Counts every `official_urls` entry the model output (before referral cleanup and before the
  pipeline drops unknown URLs) that does not appear verbatim in the case text.
- `tg_ledger_negative` is rejected (`is_airdrop_content: false`).
- `aio_abstract` has status `ended`.
- Status accuracy over the 6 status-scored cases is at least `baselineStatusAccuracy` (6).
- `tg_weekly_radar` recall is at least `minRecall` (22 of 28 project slugs).

Matching: an extracted project belongs to an expected project when their normalized names (`normalizeName`) contain
one another; if several match, the one with the expected status is used. Tokens compare case-insensitively without
`$`; the expected chain must appear (case-insensitive) in `chains`.
