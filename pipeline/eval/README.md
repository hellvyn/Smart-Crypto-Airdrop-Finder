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
NVIDIA_API_KEY=... pnpm --filter pipeline eval
```

Cases run one at a time through `extractWithFallback` with the default models from `src/config.ts`. It prints a
metrics table (no case text) and which model answered each case.

Exit codes: `0` pass, `1` a pass condition failed, `2` `cases/` is missing or empty.

## Pass conditions (spec section 11)

- Hallucinated URLs: 0 (every `official_urls` entry must appear in the case text).
- `tg_ledger_negative` is rejected (`is_airdrop_content: false`).
- `aio_abstract` has status `ended`.
- Status accuracy over the 6 status-scored cases is at least `baselineStatusAccuracy` (5).
- `tg_weekly_radar` recall is at least `minRecall` (22 of 28 project slugs).

Matching: an extracted project belongs to an expected project when their normalized names (`normalizeName`) contain
one another; if several match, the one with the expected status is used. Tokens compare case-insensitively without
`$`; the expected chain must appear (case-insensitive) in `chains`.
