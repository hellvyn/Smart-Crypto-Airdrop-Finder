# LLM extraction eval

Scores the extraction prompt and the model fallback chain against hand-labelled texts
(`ground-truth.json`, committed: it is our own labelling). 33 cases are labelled (2026-10-10), which meets the
"at least 30" of spec section 12 (G4 to G6); see "Labelling the new cases" below.

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

Where each labelled case comes from (texts are not in the repo):

- `aio_<slug>`: the airdrops.io page `https://airdrops.io/<slug with - for _>/`, as the pipeline's own collector
  (`collectAirdropsIo`, including the resolved visit links and the Overview block) produced it.
- `tg_<n>`: post `https://t.me/airdrops_io/<n>`, one post per case, as `collectTelegram` / `parseTelegramPage` parse it.
- The four original Telegram cases: `tg_flop` = post 7927, `tg_ink` = post 7921, `tg_ledger_negative` = post 7929,
  `tg_weekly_radar` = post 7932 (weekly radar Oct 3 to Oct 9). The original texts were never committed, so these
  posts were matched to the existing labels by content on 2026-10-10 (see "Label yang perlu review owner").

Pages change: a later fetch of an `aio_*` page can differ from the text the labels were made from (2026-10-10). If a
label no longer fits the current page, relabel it from the new text rather than keeping the old one.

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
  out (not `[]`) for a case you did not label, so it does not count toward the gate. `[]` means "labelled, the text
  states no such deadline". Not labelled on purpose (the model may still list them; extra deadlines cost nothing):
  dates that only name a period ("Q4 2026", "end of H1 2027", "end of October"), past facts that are not a deadline
  (launch, funding or announcement dates), and side events whose kind is a guess (NFT mints, whitelist windows).
- `officialDomains`: registrable domains (`example.xyz`, not `app.example.xyz`) of the project's own site, app and
  docs as the text links them. Never `airdrops.io`, `alphadrops.net`, or intermediary hosts (`t.me`, `linktr.ee`,
  `galxe.com`, `zealy.io`, `layer3.xyz`, `bit.ly`, `t.co`).

Target mix for the 30 cases: at least 12 airdrops.io pages with status live or announced, at least 5 speculative,
at least 5 Telegram posts, at least 2 negatives (`kind: "negative"`), plus the radar.

### Status of the labels

Labelled on 2026-10-10 from texts fetched that day: 33 cases.

- 23 airdrops.io pages: 4 original (`aio_deepbook`, `aio_variational`, `aio_abstract`, `aio_raycash`) and 19 new.
  Of the new ones, 14 are `live` and 5 `speculative`.
- 10 Telegram posts: the 4 original ones (2 speculative, 1 negative, the radar) and 6 new ones (`tg_7919` ended,
  `tg_7908`, `tg_7892` and `tg_7928` speculative, `tg_7832` announced, `tg_4899` negative).
- Every project case carries `deadlines` and `officialDomains` (18 labelled deadlines, 28 labelled domains in total).

The texts were fetched with the pipeline's own collectors (airdrops.io home, `/latest/` and `/speculative/` listings,
the `airdrops_io` Telegram channel and its search), not with `export-cases.ts`: the production service role key was
not available. The texts are what the daily job would have stored for the same pages that day.

### Label yang perlu review owner

The owner reviews all of the new labels anyway (plan prerequisite). These are the ones most likely to be wrong:

- `tg_flop`, `tg_ink`, `tg_ledger_negative`, `tg_weekly_radar`: source posts matched to the existing labels by
  content (7927, 7921, 7929, 7932); confirm these are the posts the labels were made from.
- `aio_czr` status `live`: the claim window in the text closed on 2026-10-05; `live` is what the text says, without
  knowing today's date.
- `aio_perptools` status `live`: the page header says "Airdrop unconfirmed" but the body says the airdrop is
  confirmed and points convert into $PERP while Season 2 runs. Labelled from the body.
- `aio_imperial` status `speculative`: the page header says "Airdrop confirmed" but the body says no token or TGE is
  announced. Labelled from the body.
- `aio_extended` status `live`: about 30% of EXT is set aside for points holders, but the docs say points carry no
  guaranteed entitlement. Could be read as `speculative`.
- `tg_7832` status `announced`: Arthur Hayes "confirmed the schedule" and 20% of supply for the testnet, which has
  not started yet.
- `aio_canopy` deadlines `[]`: the text gives "TGE Date: 07.09.26", which is ambiguous (7 Sep or 9 Jul); not labelled.
- `aio_perptools` deadlines `[]`: "Season 1 balances were snapshotted ... on October 2, 2026" could be a `snapshot`
  deadline; not labelled.
- `aio_mint_io` deadlines: only the TGE (2026-10-20); the Mint a Bear whitelist claim closing on 2026-10-27 is an NFT
  whitelist window and is not labelled.
- `aio_deepbook` deadline `campaign_end 2026-04-17`: Season 1 end date, a past event; `claim` is `null` because the
  text only says "30 days after the portal launched".
- Chains left `null` where the text's chain is not a plain chain name (own chain, "Orderly", "Lighter", "BSC" vs "BNB
  Chain", Extended's Starknet vs the header's Arbitrum/Ethereum). Chain is not a gate.
- `aio_acepyr` token `ACEPYR` and `aio_wick` token `WICK`: the text names the ticker of a token that does not exist
  yet; `token: null` would also be defensible.
