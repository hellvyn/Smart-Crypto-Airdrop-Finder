# Scam and legit test set (risk engine)

Measures the risk engine (`assessRisk` in `@saf/core`) on two sets: fake-airdrop domains from public phishing
lists, and airdrops that paid out. It feeds spec section 12, gates G7 (scam that passes) and G8 (legit that is
hidden), in the risk-only version. `curate()` is not part of this yet; Plan 5 adds it to `run.ts`.

## Files

- `legit.json` (committed, our own labelling): 45 airdrops that paid out, `{ name, officialDomain, claimDomain? }`.
  `claimDomain` is only set where the claim happened on another registrable domain than the official one.
  The domains were written from memory and have not been checked one by one: check them before relying on a
  single entry.
- `build.ts`: downloads the MetaMask `eth-phishing-detect` `src/config.json` (`blacklist` array) and the
  ScamSniffer `scam-database` `blacklist/domains.json` (array of strings), keeps apex domains that look like a
  fake airdrop and name a project from `legit.json`, and writes `cases/scam.json`. 60 cases, at most 3 per
  brand, picked by a hash of the domain so the choice is stable and does not favour early letters.
- `run.ts`: runs the real enrichment (GoPlus phishing check, RDAP domain age with the crt.sh fallback) and
  `assessRisk` on every case and prints a report. The exit code is always 0: it is a report, not a CI gate.
- `cases/` is **gitignored**. It holds the scam domains. Never commit domain lists from third parties; only
  numbers go into the repo (this file and the spec).

## Running

```
NODE_USE_ENV_PROXY=1 pnpm --filter pipeline exec tsx eval/scam-set/build.ts
NODE_USE_ENV_PROXY=1 pnpm --filter pipeline exec tsx eval/scam-set/run.ts
```

`NODE_USE_ENV_PROXY=1` is only needed behind an HTTP proxy. A run takes a few minutes: GoPlus and RDAP run one
request at a time.

## How a case becomes a risk input (`toRiskInput`)

- Scam: a project named after the imitated brand, one `claim` link on the scam domain. The official domain is the
  brand's real domain from `legit.json`.
- Legit: the project's name, a `website` link on its official domain and a `claim` link on its claim domain (or
  the official domain).
- Everything that is not a link check is the same for both kinds and neutral: two sources, an official social
  account, status `live`, no tasks, no token, no hack lookup. So the set measures the domain, age and phishing
  list checks only, and says nothing about the checks that need a token, a contract or the source text.

## What the numbers mean, and what they do not

- The scam domains come from phishing lists and GoPlus reads similar lists, so the "phishing_listed" catch is
  close to circular. The report therefore also prints the result with the GoPlus answer removed.
- A scam is only in the set if its domain contains a project name from `legit.json`. That is also what the
  lookalike check looks for, so the lookalike catch rate is optimistic. Fake airdrops that use only a generic
  word ("claim", "reward") and no project name are left out, because without a brand there is no project to
  build. The set does not tell how such a scam would be scored.
- Every scam in the set has a known official domain. In production that is not always the case (gate G1).
- The phishing list entries are often dead or expired, so RDAP and crt.sh may have nothing for them.

## Results (2026-10-10, risk engine only)

Run from a cloud container where crt.sh was blocked by the network policy and several RDAP servers were not
reachable, so the domain age check had almost no data (see Coverage).

| Measure | Result |
|---|---|
| Scam cases | 60 |
| Scam that passed risk (level low or medium) | 0 of 60 |
| Scam with `insufficient_data` | 0 of 60 |
| Scam caught (high or critical) | 60 of 60 |
| Same, with the GoPlus answer removed | 0 passed, 6 `insufficient_data`, 54 caught |
| Legit cases | 45 |
| Legit hidden by risk (high or critical) | 2 of 45 (4.4%) |
| Legit with `insufficient_data` | 0 of 45 |

Reasons found: scam, `phishing_listed` 60 and `lookalike_domain` 54; legit, `lookalike_domain` 2.

Coverage (domains with an answer): phishing check 60/60 scam and 49/49 legit; domain age 2/60 scam and 3/49 legit;
domain age from crt.sh 0 (blocked here).

### Patterns to hand to Plan 5

- **No scam passed risk**, so there is no pass-through pattern to report. This is a weak result: see the limits
  above. Without GoPlus, 6 of 60 end as `insufficient_data` (the lookalike check did not match and fewer than 4
  checks ran). All 6 imitate a 4-letter project name (Jito, Lido, Ondo, Safe, Pyth) glued to another word in the same label (name plus a word such as lending, coin or finance). The lookalike rule only matches a 3 to 4 letter name when it is a whole label or a whole `-` separated token, so these are missed. Plan 5 can use this when it looks at short names.
- **Legit false positives (both of the 2 hidden):** the claim happened on a foundation domain that is not in the
  project's official domains (`<brand>.foundation`), and the lookalike rule reads it as an imitation: `high`.
  Both flip to `insufficient_data` when the claim domain is the official domain. So for curation the official
  domain list must include the project's foundation or claim domain, or the lookalike rule must not fire on a
  claim domain that the project's own source links to.
- **Domain age is nearly empty here.** In this environment `rdap.org` has no RDAP service for `.io` and `.ag`
  (HTTP 404), the redirect for `.technology` pointed at a host the proxy blocks, requests for some other TLDs
  (`.domains`, `.fi`) failed to connect, and several RDAP requests in a row were answered with 429. crt.sh is the fallback for exactly these domains and was blocked. Gate G2
  (key checks run for >= 95% of projects with a domain) cannot be judged from this run.
- **GoPlus rate limit:** GoPlus answers HTTP 200 with `{"code":4029,"message":"too many requests"}` after about
  30 requests in a row. `checkPhishingSite` only retries on HTTP 429/5xx, so this answer becomes `null` with no
  retry. A first run without the runner's own retries had the phishing check for only 30 of 60 scam domains and 0
  of 49 legit domains. The runner asks again after 15 seconds (up to 4 tries); the pipeline does not.
