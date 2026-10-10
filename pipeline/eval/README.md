# LLM extraction eval

Scores the extraction prompt and the model fallback chain against hand-labelled texts
(`ground-truth.json`, committed: it is our own labelling). Today 8 cases are labelled; the quality gates of spec
section 12 (G4 to G6) need at least 30, see "Labelling the new cases" below.

## Filling `cases/`

`eval/cases/` is **gitignored**. The repo is public and the sources' terms of use are unknown, so never commit
third-party texts.

### From production (owner, needs the production service role key)

`export-cases.ts` copies the newest `airdrops_io` and `telegram` documents whose text has not been purged yet:

```
SUPABASE_URL=<production url> SUPABASE_SERVICE_ROLE_KEY=<service role key> pnpm --filter pipeline exec tsx eval/export-cases.ts --limit 40
```

It reads both values from the environment only, writes only into `eval/cases/`, and prints only the case ids it
wrote (never texts, URLs or keys). `--limit N` is split evenly between the two sources (rounded up per source), so
`--limit 40` gives up to 20 airdrops.io pages and 20 Telegram posts. Ids look like `aio_<8 hex>` and `tg_<8 hex>`
(the first 8 digits of the document id); `<id>.meta.json` holds the source URL, which is how you find the page again.
Documents older than the text retention window are purged and are skipped, so run it soon after a daily run.

### By hand

For each case id in `ground-truth.json` create two files:

- `cases/<id>.txt`: the plain text exactly as the collector would hand it to the LLM (airdrops.io page text for
  `aio_*`, one Telegram post for `tg_*`).
- `cases/<id>.meta.json`: `{"source": "<url>", "published": "<ISO date>" | null}`.

The original case ids (texts are not in the repo; copy them from the sources by hand): `aio_deepbook`,
`aio_variational`, `aio_abstract`, `aio_raycash`, `tg_flop`, `tg_ink`, `tg_ledger_negative`, `tg_weekly_radar`.

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

The table has one row per case: status, token, chain, `dlines` (deadlines matched/expected), `domains` (official
domains matched/expected), hallucinated URLs, negative, radar recall, time and model. `-` means the case is not
labelled for that column.

## Pass conditions (spec section 12, G4 to G6)

- Hallucinated URLs: 0. Counts every `official_urls` entry the model output (before referral cleanup and before the
  pipeline drops unknown URLs) that does not appear verbatim in the case text.
- `tg_ledger_negative` is rejected (`is_airdrop_content: false`).
- `aio_abstract` has status `ended`.
- Status accuracy: at least 90% of the status-scored cases have the right status (G4).
- Deadline accuracy: at least 90% of the labelled deadlines are matched (G5). A labelled deadline is matched when
  the extracted project has a deadline with the same `kind` and the same `date` (`null` matches only `null`).
- Official domain accuracy: at least 80% of the labelled `officialDomains` are matched. An expected domain counts
  when the registrable domain of an extracted `official_urls` entry equals it. Those entries were already source-checked
  (and referral-cleaned) by the pipeline's post-processing, so they are not re-checked against the text; an invented
  URL is caught by the separate "no hallucinated URLs" condition.
- `tg_weekly_radar` recall is at least `minRecall` (22 of 28 project slugs).

A deadline or domain gate with nothing labelled **fails** ("nothing labelled, cannot be measured") rather than
passing: an unmeasured gate must not look like a met one. Until the owner labels deadlines and domains, a run
reports FAIL on those two lines even if everything else is right.

Matching: an extracted project belongs to an expected project when their normalized names (`normalizeName`) contain
one another; if several match, the one with the expected status is used. Tokens compare case-insensitively without
`$`; the expected chain must appear (case-insensitive) in `chains`.

## Labelling the new cases

Label from the case text only, never from memory. In `ground-truth.json` a project case takes two optional fields
besides `project`, `status`, `token` and `chain`:

```json
"aio_example": {
  "kind": "project", "project": "example", "status": "live", "token": "EXA", "chain": "ethereum",
  "deadlines": [{ "kind": "claim", "date": "2026-10-05" }, { "kind": "tge", "date": null }],
  "officialDomains": ["example.xyz", "example.io"]
}
```

- `deadlines`: every deadline the text states, `kind` one of `claim`, `snapshot`, `campaign_end`, `withdraw_funds`,
  `tge`, `other`; `date` is `YYYY-MM-DD`, or `null` when the text names the event but gives no date. Leave the field
  out (not `[]`) for a case you did not label, so it does not count toward the gate.
- `officialDomains`: registrable domains (`example.xyz`, not `app.example.xyz`) of the project's own site, app and
  docs as the text links them. Never `airdrops.io`, `alphadrops.net`, or intermediary hosts (`t.me`, `linktr.ee`,
  `galxe.com`, `zealy.io`, `layer3.xyz`, `bit.ly`, `t.co`).

Target mix for the 30 cases: at least 12 airdrops.io pages with status live or announced, at least 5 speculative,
at least 5 Telegram posts, at least 2 negatives (`kind: "negative"`), plus the radar.

### Status of the labels (what the owner still has to do)

- Labelled today: 8 cases (4 `aio_*`, 3 `tg_*` project or negative cases, 1 radar), 6 of them status-scored.
- **22 more cases must be added** to reach 30; the case texts must come from the production export above, which
  needs the production service role key. Nothing in this repository can produce them.
- The 6 existing project cases have no `deadlines` or `officialDomains` yet. They need those fields added from their
  texts, or the G5 and official-domain gates cannot be measured.

### Label yang perlu review owner

Mark every label you are unsure about here (case id and field, one line each) so the owner can check it against
the source page before the numbers go into spec section 12. Empty until the new cases are labelled; the owner
reviews all of the new labels anyway (plan prerequisite).
