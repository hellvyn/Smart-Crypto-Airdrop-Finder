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
  posts were matched to the existing labels by content on 2026-10-10 (see "Label diaudit 2026-10-11 (agent, mandat
  owner)").

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
- 10 Telegram posts: the 4 original ones (`tg_ink` speculative, `tg_flop` announced since the audit, 1 negative, the
  radar) and 6 new ones (`tg_7919` ended, `tg_7908`, `tg_7892` and `tg_7928` speculative, `tg_7832` announced,
  `tg_4899` negative).
- Every project case carries `deadlines` and `officialDomains` (22 labelled deadlines since the audit, 28 labelled
  domains in total).

The texts were fetched with the pipeline's own collectors (airdrops.io home, `/latest/` and `/speculative/` listings,
the `airdrops_io` Telegram channel and its search), not with `export-cases.ts`: the production service role key was
not available. The texts are what the daily job would have stored for the same pages that day.

### Label diaudit 2026-10-11 (agent, mandat owner)

On 2026-10-11 the owner delegated the label review. An agent that did not write the labels checked every label of
all 33 cases (status, token, chain, deadlines with kind and date, `officialDomains`, radar slugs) against the case
text and the prompt's status definitions, and changed a label only where the text clearly supports another value.

Changed (5 labels in 4 cases; the last two were added after the review of the audit):

- `tg_flop` status `speculative` → `announced`. The post is an update "from Arthur Hayes and @Flop_Labs": "Genesis
  rewards for miners, agents, validators, builders and creators", "Rewards are designed around real contributions",
  and the top 1,000 validators "receive 1.2M $FLOP each". That is a team-confirmed token reward whose testnet has not
  started ("Launch expected within roughly a month"), which is `announced` by the prompt's definitions. It also
  matches `tg_7832` (the same project, an earlier post, labelled `announced`).
- `tg_flop` deadlines `[]` → `[snapshot null]`: "Final snapshot at the closing testnet block" names a snapshot without
  a date. The labelling rule above says such an event is labelled with `date: null` (as `aio_orbinum`'s "before its
  snapshot").
- `aio_mint_io` deadlines: added `snapshot null` next to the TGE. "The Season 1 snapshot happens shortly before the
  TGE in Q4 2026, with the exact date announced through MINT's official channels": a named snapshot without a date,
  same rule.
- `aio_satsuma` deadlines: added `snapshot null` next to the TGE. "If your wallet is in the Genesis snapshot" and "The
  Genesis snapshot is already taken, so airdrop eligibility is fixed": a named snapshot without a date, same rule.
  That it is already past does not exclude it: the prompt defines `snapshot` as the date the eligibility snapshot
  "is or was taken", and past dated events are labelled too (Satsuma's own TGE on 2026-06-04, DeepBook's
  `campaign_end 2026-04-17`); the past facts the rule leaves out are launch, funding and announcement dates.
- `aio_collector_crypt` deadlines: added `snapshot null` next to the TGE. "matter most before each snapshot" and
  "There is no fixed public date for the next one, and snapshot timing is kept undisclosed on purpose": the next
  quarterly snapshot is named, its date is not. No `claim` is added: the prompt defines `claim` as the last day to
  claim, and the text gives none (only that the next distribution has no public date).

Checked and kept (the doubtful ones listed before the audit, with the reason):

- `tg_flop`, `tg_ink`, `tg_ledger_negative`, `tg_weekly_radar` (posts 7927, 7921, 7929, 7932): which post the
  original labels were made from cannot be confirmed (those texts were never committed), so every label was judged
  against these posts instead. Each fits its post (after the `tg_flop` changes above), and all 28 radar slugs name a
  project the radar post mentions.
- `aio_czr` status `live`: the text says the claim is open until 2026-10-05. The model judges status from the text;
  expiry by date is `expireStatus` (spec §6.1), which reads the `claim 2026-10-05` deadline.
- `aio_perptools` status `live`: the body says "The PERPTools airdrop is confirmed" and points convert into $PERP
  while Season 2 runs; the header's "Airdrop unconfirmed" is the page template.
- `aio_imperial` status `speculative`: the body says "No token has been announced" and "nothing has been officially
  confirmed by the team"; the header's "Airdrop confirmed" is the page template.
- `aio_extended` status `live`: the text says Extended "publicly committed around 30% of EXT supply" to points
  holders and the points program is running. The "no guaranteed entitlement" in the docs is about an individual
  allocation, not whether a token airdrop exists.
- `tg_7832` status `announced`: "20% of the total supply is allocated to the testnet" and "to be eligible for the
  airdrop", with the testnet starting at the end of October 2026.
- `aio_canopy` deadlines `[]`: "TGE Date: 07.09.26" can be 7 Sep or 9 Jul, and the FAQ on the same page says the TGE
  date "has not been announced". Not clear enough to label.
- `aio_perptools` deadlines `[]`: "Season 1 balances were snapshotted and archived on October 2, 2026", but the text
  says archived points only "may be used for future rewards, the airdrop or TGE", so it is not clearly an eligibility
  snapshot.
- `aio_wick` deadlines `[]`: "if Wick ever takes a snapshot" is hypothetical, not a named snapshot. With this and
  `aio_perptools`, every case text that mentions a snapshot was checked (after review: `aio_satsuma` and
  `aio_collector_crypt` were labelled above).
- `aio_mint_io`: the Mint a Bear whitelist closing on 2026-10-27 stays unlabelled (NFT whitelist window).
- `aio_deepbook` `campaign_end 2026-04-17` (Season 1 "ran from January 22 to April 17, 2026") and `claim null`
  ("30 days after the portal launched") kept; `aio_variational` and `aio_extended` keep their `campaign_end` for the
  ended trading competitions (dated, and a campaign by the prompt's definition).
- Chains left `null` (own chain, "Orderly", "Lighter", "BSC" vs "BNB Chain", Extended's Starknet vs the header's
  Arbitrum/Ethereum) kept: not a gate.
- `aio_acepyr` token `ACEPYR` and `aio_wick` token `WICK` kept: the text names the ticker (`testnet $ACEPYR`, "the
  WICK token"), even though neither trades yet.
- Every `officialDomains` entry was checked against the links in its text; none changed. Hosts that are not the
  project's own (`docs.sui.io` on DeepBook, `gitbook.io`, `mirror.xyz`, `medium.com`, faucets, bridges) stay out.

## Quality gate tools (spec sections 12 and 13: G1 to G3, G7 to G13)

These scripts read the **production** database, so they take `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the
environment only (exit code 2 when either is missing). They never print keys, emails, wallet addresses or user ids, and
write only to git-ignored paths. Run them after at least one daily run with the curation code (Plan 5), and for G9
after 3 such runs.

| Gate | Tool | Command |
|---|---|---|
| G1, G2, G3, G9 | `quality-report.ts` | `pnpm --filter pipeline exec tsx eval/quality-report.ts` |
| G7, G8 | `scam-set/run.ts` (see `scam-set/README.md`) | `NODE_USE_ENV_PROXY=1 pnpm --filter pipeline exec tsx eval/scam-set/run.ts` |
| G10 | `worth-review.ts` | `pnpm --filter pipeline exec tsx eval/worth-review.ts` |
| G11, G13 | `ai-samples.ts` | `pnpm --filter pipeline exec tsx eval/ai-samples.ts` |

Set the two variables on the same command line as above, e.g. `SUPABASE_URL=<production url> SUPABASE_SERVICE_ROLE_KEY=<service role key> pnpm ...`.

- `quality-report.ts` computes G1, G2, G3 and G9 from the last 3 finished `pipeline_runs` and from the latest curation
  and risk assessment of each project, and prints the table of all gates with the targets of spec sections 12 and 13.
  The other gates show as "manual" with the tool that measures them. Exit code 0 (a report, not a CI gate); a gate it
  cannot measure (fewer than 3 runs, no curations, no project with a domain) is shown as FAIL, never as met.
  - G1 is `projects_with_official_domain / assessed` averaged over the runs. `pipeline_runs.stats` does not split the
    scored projects by status, so the denominator is every scored project, not only live/announced ones.
  - G2 is the weaker of `domain_age_ran` and `phishing_list_ran` over `projects_with_official_domain` (the other two key
    checks need no network call).
  - G3 counts passing curations outside the `ended` tab whose latest assessment did not run all four key checks
    (`dangerous_asks`, `lookalike`, `domain_age`, `phishing_list`). Ended projects are exempt (decision #40).
  - G9 is the mean `curation_passed_live_now` of the 3 runs.
- `worth-review.ts` prints the top 20 passing projects per tab (`live_now`, `early_bets`, `ended`): name, worth level,
  point total and the worth reasons. The owner marks the entries whose order makes no sense; the final weights and the reasons are
  then recorded by hand in spec section 6.3. The point total is `curations.worth_points` (migration 0012, written by the
  score step from `worth().points`; "poin n/a" for a curation stored before it existed, until the next daily run
  rewrites it). The order is worth level, then newest `last_seen` (the list view also uses signal strength and deadline
  as tie-breakers).
- `ai-samples.ts` writes the 20 newest `analyst` analyses (one per project) to `eval/cases/ai-samples.md` (git-ignored: it
  holds source quotes): verdict, points with quotes and source URL, the model that answered, and the forbidden style
  phrases found, with a line for the owner's rating. It prints only the count and the path. G11 needs at least 80% of 20
  or more samples rated sensible; G13 is the owner's rating of the Indonesian.
