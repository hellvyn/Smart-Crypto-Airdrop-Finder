# Daily pipeline runbook

How to set up, run and check the daily pipeline (`pipeline/`). It collects airdrops.io, Telegram, AlphaDrops and DefiLlama,
extracts with LLMs (freellm `auto` first, NVIDIA-hosted models as fallback; see section 7), merges into Supabase, scores risk and purges old text. It sends no email.
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
   policies; later files add users, web views and more, through `0007_manual_membership.sql`, which drops the email-digest tables and columns). Run it again after pulling a new migration.

   **Production project (`smart-airdrop-finder`, created 2026-10-10):** 0001–0006 were applied through the
   Supabase MCP connector, not `db push`, so the remote migration history holds timestamped entries (0002 split
   in parts; `delete_my_account()` was run in the SQL Editor and has no entry). Before the first `db push` of a
   new migration there (`0007` is the first), align the history once, then push:

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
| `LLM_API_KEY` | freellm key; may be left empty (then no `Authorization` header is sent) |
| `LLM_BASE_URL` | freellm base URL; may be left unset (default `https://freellm.hellvyn.id/v1`) |
| `NVIDIA_API_KEY` | NVIDIA API key (`integrate.api.nvidia.com`) |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | the `service_role` key from step 1.3 |

The workflow installs dependencies without these secrets and only passes them to the pipeline step. Only a
missing `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` stops the run with `{"config_error":1}` before anything is
collected. The pipeline reads no other secret (`pipeline/src/daily-job.ts` reads exactly these five, and
`.github/workflows/daily.yml` passes exactly these five). The email digest was removed: a leftover
`BREVO_API_KEY`, `EMAIL_FROM` or `SITE_URL` in the environment or in the repository secrets is ignored and can
be deleted.

## 3. Run it

- **Scheduled:** `.github/workflows/daily.yml` runs every day at 23:00 UTC (`cron: "0 23 * * *"`).
- **Manual:** Actions > **Daily pipeline** > **Run workflow** (`workflow_dispatch`), or
  `gh workflow run daily.yml`.
- Two runs never overlap (`concurrency: daily-pipeline`). The job has a 60-minute limit; extraction stops starting
  LLM calls after 35 minutes (`extractBudgetMinutes`, each call cut off after 180 s) and leaves the rest pending for
  the next run.
- Running it twice on the same day is safe: unchanged documents are not extracted again.

### GoPlus pacing and time budget

GoPlus (`api.gopluslabs.io/api/v1/phishing_site`) rate-limits with **HTTP 200 and `code: 4029`** in the body (not
only with 429). A live measurement (51 requests, harmless public domains) found: 30 back-to-back requests (about
3.5 per second) were answered, the 31st got 4029, and the first request 5 s later was answered again; 18 requests
one second apart all got `code: 1`. So `score` sends GoPlus requests one at a time with `GOPLUS_MIN_INTERVAL_MS`
(1.5 s) between them, and one retry after `GOPLUS_RETRY_MS` (5 s) when it still answers 429, 4029 or 5xx.

Budget: a request takes about 0.3 s, so each domain costs about 1.8 s. With about 150 domains the GoPlus part of
`score` takes about 4.5 minutes (the RDAP, crt.sh and DefiLlama lookups run alongside it and are shorter). The job
limit is 60 minutes and extraction stops starting LLM calls after 35 minutes (the last call can run up to 3 more),
so collect plus extraction plus `score` ends at about 45 minutes.

Two stops keep a slow or rate-limiting GoPlus inside the job limit (config in `pipeline/src/config.ts`):

- **Time budget** `goplusBudgetMinutes` (12): counted from the start of `score`; after it no new GoPlus request
  starts. At about 1.8 s per domain that is room for about 400 domains on a normal day.
- **Consecutive-failure stop** `goplusMaxConsecutiveFailures` (5): after 5 domains in a row without an answer
  (rate limited after the retry, timed out, 5xx or an unexpected answer), the remaining domains are not asked. One
  answered domain resets the count.

Domains not asked stay unchecked (the phishing check counts as not run, never as clean) and are counted in
`phishing_list_failed` and `phishing_list_skipped`; they are asked again in the next run. Without these stops, a GoPlus
that rate-limited every domain would cost about 7.1 s per domain (1.8 s + 5.3 s) and one that hangs about 21.5 s per
domain (20 s timeout, no retry), which for 250 domains is 30 or 90 minutes. With them, the worst case for the GoPlus
part is the 12-minute budget plus the last request (under a minute), so the whole job ends at about 54 minutes at most.

### AlphaDrops pacing

The AlphaDrops collector (`pipeline/src/collectors/alphadrops.ts`, config `alphadrops`) reads the listing
`https://alphadrops.net/airdrops` and keeps the `active`, `upcoming` and `claimable` items (about 70 on 2026-10-10).
It fetches their detail pages one at a time with a 1.5 s pause before each (`delayMs`), at most 80 per run
(`maxDetails`), with the same User-Agent as the other collectors. That is about 2 to 3 minutes before extraction
starts; the extraction budget counts from the start of extraction, so it adds to the job time. Website links are
cleaned of referral parts and their redirects followed (at most 3); a link that ends on `alphadrops.net` or on one of
`intermediaryHosts` (exact host: `s.kaito.ai`, `linktr.ee`, `galxe.com`, ...) is left out of the document. The same
hosts never become a project's official domain (`isNonProjectHost` in `pipeline/src/collectors/html-text.ts`).

A changed listing (no Next.js payload, no items) or a connection that breaks during the detail pages counts in
`source_failed`; the documents built before the break are still stored and the other sources run as usual.

### AlphaDrops raises ("Menurut AlphaDrops", `reported_backer`)

The `signals` stage gives a project one `reported_backer` per investor (`{investor, lead, amount_usd, round,
round_date, source_url}`, source `alphadrops`, **always `verified = false`**) from the AlphaDrops fundraising data
(`pipeline/src/enrich/alphadrops-raises.ts`):

1. It reads `https://alphadrops.net/llms-full.txt` once per run and takes the "All tracked fundraising projects"
   section (name and slug of about 880 projects).
2. A project with an official domain whose normalized name equals an entry's name gets that entry's page
   `/raises/<slug>`. The name **only chooses which page to read**.
3. A page cached in `alphadrops_raises` (service role only) at most 7 days ago is used as it is. Other pages are
   fetched: never-cached pages first, then the oldest, at most `maxRaisePages` (40) per run. A fetched page with at
   least one round replaces the cache.
4. The rounds of a page become signals only when the registrable domain of the page's "Official Website" link equals
   one of the project's official domains (`domainMatches`). A scam using the name of a project in the fundraising list
   gets nothing: its domain differs. `amount_usd` is the total of the page's disclosed rounds (worth +1 at $5M or more,
   never added to a verified `vc_backer`); `lead` is true when the investor led any round; `round`, `round_date` and
   `source_url` (the round's "Announcement Source") are those of the newest round the investor is in.

"Not checked" is never "none": when `llms-full.txt` fails or lists nothing, when AlphaDrops is disabled
(`alphadrops.enabled: false`), or for a project whose page is neither fresh in the cache nor fetched this run (not
reached, failed, or stale and not refreshed), the project's earlier `reported_backer` rows stay with their own
`observed_at`; its AlphaDrops `curated_source` is still rewritten. A broken connection or HTTP 429 stops the raise
fetching for the run.

**Request budget.** All AlphaDrops requests of a run share `maxRequestsPerRun` (120): the collector's listing and
detail pages come first (at most 1 + 80 = 81), and the raise part gets what is left (at most `llms-full.txt` + 38
pages on a day with 80 detail pages; 40 pages when fewer detail pages were fetched). Every AlphaDrops request goes out
with the same User-Agent and a 1.5 s pause (`delayMs`) before it.

**Job time.** Measured on 2026-10-11 from the development container (apex `alphadrops.net`): `llms-full.txt`
(94 KB) answered in 0.5 s, raise pages (about 130 KB, rendered on request) in about 2.5 s. So a raise page costs about
4 s with its pause, and the raise part at most about 2 s + 38 x 4 s = 2.6 minutes on top of the collector's 2 to 3
minutes. Most days fetch far fewer pages: each page is fetched again only after 7 days. A broken connection or 429
stops the part at once (worst case one 20 s timeout). There is no time budget for an AlphaDrops that answers every
request slowly: at the 20 s timeout per request that would be 39 x 21.5 s = 14 minutes for the raise part. If runs
come close to the job limit (`finished_at` - `started_at` in `pipeline_runs`), lower `maxRaisePages`.

### Daftar VC (VC portfolio cross-check)

The `signals` stage gives a project a verified `vc_backer` (`{investor, tier}`, source `vc_portfolio`) when the
registrable domain of one of its official domains is linked from the portfolio page of a verified VC (`VC_LIST`)
(`pipeline/src/config.ts`). A name match or a "backed by" claim never counts. The page's outbound `<a href>` links are
reduced to registrable domains (`parsePortfolioDomains` in `pipeline/src/enrich/vc-portfolios.ts`; the VC's own
domain and social, hiring and aggregator hosts are left out) and only the domains are cached in `vc_portfolios`.

- A cache up to 7 days old is used without a request, so each page is fetched about once a week (one request per
  VC in `VC_LIST`).
- A page that fails (not 200, or no portfolio link in its HTML, e.g. rendered by JavaScript) never overwrites the
  cache: a cache up to 14 days old is still used; with an older or no cache that VC is "not checked". Its earlier
  `vc_backer` signals stay with their own `observed_at`, while the signals of the VCs that were checked are rewritten.
  Each failed page counts once in `vc_portfolios_failed`; the run does not fail.

Candidates (curation plan 5 Task 4; tier 1: a16z crypto, Paradigm, Polychain, Pantera, Multicoin, Dragonfly,
Coinbase Ventures, YZi Labs; tier 2: Framework Ventures, Variant, Electric Capital, Hack VC, Placeholder, Delphi
Ventures, Jump Crypto) are in `VC_CANDIDATES`. Only the VCs in `VC_LIST` (the verified ones) are fetched and can give a
`vc_backer`.

A candidate moves to `VC_LIST` only when **all** of these hold:

1. its page answers 200 to the pipeline's HTTP client (same User-Agent, no JavaScript);
2. its outbound links, after `parsePortfolioDomains`, are overwhelmingly its portfolio companies, not navigation,
   products, articles, press or sister sites (spot-check at least 10 domains);
3. at least ~10 portfolio domains are in the HTML (a list that only appears with JavaScript does not count);
4. neither its `robots.txt` (for that path) nor its terms forbid reading the page automatically. A VC whose terms
   forbid it is not used (spec §5.2), and a VC whose terms could not be read is not used either.

To check, run (from a network that reaches the VC hosts):

```
pnpm --filter pipeline exec tsx scripts/vc-portfolio-check.ts
```

It prints each VC's list (`verified` or `candidate`), HTTP status, the number of portfolio domains in its HTML and the
domains; conditions 2 and 4 are checked by hand. Fix a candidate's `portfolioUrl` first if the page moved. A candidate
that fails a condition stays in `VC_CANDIDATES` with a one-line reason comment in `config.ts`. Add a host to
`NON_PORTFOLIO_DOMAINS` in `vc-portfolios.ts` when a page that moves to `VC_LIST` links to it outside its portfolio.
Record every result in the table below.

**Check of 2026-10-11** (pipeline client, through the development egress proxy after the owner allowed the VC hosts):
no candidate passed every condition, so **`VC_LIST` stays empty and the pipeline gives no `vc_backer` yet.**
Five pages pass conditions 1–3 and `robots.txt` but their terms forbid automated reading (Paradigm, Variant, Electric
Capital) or limit the site to personal, noncommercial use (Framework, Placeholder). Two pages pass conditions 1–3 and
`robots.txt` but their terms are on hosts the proxy still refuses (CONNECT 403): a16z crypto (terms on `a16z.com`) and
Jump Crypto (terms on `jumptrading.com`). If those terms allow automated reading, they can move to `VC_LIST`; before
that, add the non-portfolio links their pages carry to `NON_PORTFOLIO_DOMAINS` (a16z crypto links its sister site
`a16z.com`; Jump Crypto links its parent `jumptrading.com` and its web agency in the footer).

| VC | Tier | Status (2026-10-11) | Reason |
|---|---|---|---|
| a16z crypto | 1 | ditunda | terms not checked: they are on `a16z.com`, refused by the egress proxy (CONNECT 403). Page 200, 122 domains, `robots.txt` allows |
| Paradigm | 1 | ditunda | terms forbid accessing or collecting data from the site by automated means. Page moved to `/investments` (200, 95 domains) |
| Polychain Capital | 1 | ditunda | 404: no portfolio page on `polychain.capital` (the homepage links only to job boards) |
| Pantera Capital | 1 | ditunda | JavaScript-rendered: the list is not in the HTML (3 domains, all investor-portal links) |
| Multicoin Capital | 1 | ditunda | JavaScript-rendered: 0 domains in the HTML |
| Dragonfly | 1 | ditunda | JavaScript-rendered: `dragonfly.xyz` redirects to the `dragonfly.com` homepage, whose portfolio section has no company link in the HTML |
| Coinbase Ventures | 1 | ditunda | 403 from the site's bot protection (not worked around) |
| YZi Labs | 1 | ditunda | 404: no portfolio page linked from the homepage |
| Framework Ventures | 2 | ditunda | terms license the site for personal, noncommercial use only and forbid downloading any part. Page 200, 12 domains |
| Variant | 2 | ditunda | terms forbid any robot, spider or other automatic means to access the site. Page 200, 48 domains |
| Electric Capital | 2 | ditunda | terms forbid automated data collection without express permission. Page moved to `/investments/` (200, 80 domains) |
| Hack VC | 2 | ditunda | no company domains: the list (`www.hack.vc/portfolio`) links only to Hack VC's own detail pages |
| Placeholder | 2 | ditunda | terms: personal, noncommercial use only, any other use needs written permission. The list is on the homepage (200, 28 domains) |
| Delphi Ventures | 2 | ditunda | JavaScript-rendered: `/portfolio-crypto` has only the first 10 companies in the HTML, the rest load with "Load More" |
| Jump Crypto | 2 | ditunda | terms not checked: they are on `jumptrading.com`, refused by the egress proxy (CONNECT 403). List at `/invest` (200, 21 domains), `robots.txt` allows |

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
| `projects_with_official_domain` | scored projects that have at least one official domain (the denominator for the two `*_ran` counters) |
| `domain_age_ran` | of those, projects where the domain-age lookup (RDAP, else the first crt.sh certificate) answered for at least one official domain |
| `domain_age_from_crtsh` | domains whose age came from crt.sh because RDAP had no answer (`.io` and some other TLDs have none) |
| `phishing_list_ran` | of the projects with an official domain, those where the GoPlus phishing check answered for at least one |
| `phishing_list_failed` | domains the GoPlus check gave no answer for, after one retry (429, HTTP 200 with code 4029, or 5xx; 5 s pause) |
| `phishing_list_rate_limited` | of those, domains GoPlus still rate-limited (429 or code 4029) after the retry |
| `phishing_list_skipped` | of those, domains never asked because the GoPlus time budget ran out or 5 domains in a row had no answer |
| `signals_vc_backer` | projects that got at least one verified `vc_backer` this run (official domain in a checked VC portfolio) |
| `vc_portfolios_failed` | VC portfolio pages that had to be fetched and failed (not 200 or no portfolio link), or whose cache could not be read; see "Daftar VC" |
| `raises_fetched` | AlphaDrops raise pages fetched this run with at least one round (stored in `alphadrops_raises`) |
| `raises_matched` | projects that got at least one `reported_backer` this run (raise page's official website matched by domain) |
| `raises_failed` | AlphaDrops raise requests that failed: `llms-full.txt` (not 200 or no fundraising entry) and raise pages (not 200, broken connection, or no round on the page) |
| `link_checks_total` | distinct claim/app links checked in `score` and written to `link_checks` (status from the GoPlus answers of the run, no extra request) |
| `link_checks_phishing` | of those, links on the phishing list: never rendered as a link, and the project's risk is high (`phishing_claim_link`) |
| `claim_pages_read` | claim portal pages fetched in `analyze` for the AI Scam Analyst (at most 20 per run; pages fetched in the last 7 days come from `claim_pages`) |
| `track_record_total` / `_listed` / `_no_token` / `_risk_raised` | the public track record (#43); see "Track record" below |
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
- `domain_age_ran` low compared to `projects_with_official_domain`: look at `domain_age_from_crtsh`. If it is 0, crt.sh
  is probably unreachable or too slow from the runner (the check is then counted as not run, never as an error); if
  it is above 0 but `domain_age_ran` is still low, the remaining TLDs have neither RDAP nor certificates.
  `phishing_list_failed` high: GoPlus is rate-limiting; the domains stay unchecked until the next run. Check
  `phishing_list_rate_limited`: if it is close to `phishing_list_failed`, raise `GOPLUS_MIN_INTERVAL_MS` in
  `pipeline/src/enrich/goplus.ts`; if it is 0, the failures are timeouts or errors, not the rate limit.
  `phishing_list_skipped` > 0: the GoPlus queue was stopped early (budget or 5 failures in a row). If it happens on
  normal days with `phishing_list_rate_limited` near 0, the domain count has outgrown `goplusBudgetMinutes`.
- `vc_portfolios_failed` > 0 on several runs: a VC page moved or changed; run `scripts/vc-portfolio-check.ts`
  ("Daftar VC") and fix its `portfolioUrl` or strike it. After 14 days without a good fetch that VC is "not checked".
- `raises_failed` > 0 on several runs with `raises_fetched` = 0: AlphaDrops changed `llms-full.txt` or its raise page
  layout ("Funding Rounds History", "Official Website"); update `alphadrops-raises.ts` and the fixture
  `pipeline/test/fixtures/alphadrops-raise.html`. Until then the earlier `reported_backer` rows stay.
- `link_checks_phishing` > 0: a listed project linked a claim page on the GoPlus phishing list; it drops out of the
  curated list through `risk_too_high`. `link_checks` keeps the status per URL (public read); the web must never render
  a `phishing` URL as a link.
- `claim_pages_read` = 20 every day: more claim/app links are due than one run reads; the rest are read on the next
  runs (the cached text, up to 14 days old, is still given to the scam analyst meanwhile). Claim pages are fetched with
  a plain GET (no scripts, 1 MB, 10 s in all, at most 3 redirects to public http(s) hosts), 4 at a time, so they add
  at most about 50 s to `analyze`.
- `llm_models_tripped` > 0: a model endpoint failed repeatedly (see `extractions.error`, e.g. `http_0` = 180 s
  timeout). The run continues on the remaining models; if it repeats for days, reorder or replace the model in
  `pipeline/src/config.ts`.

### Track record (#43)

Counted at the end of `score` from the whole curation history (`listCurationHistoryForTrackRecord`), so ended projects
that are no longer scored (more than 90 days after they ended) still count. The population (`track_record_total`) is
every project whose **first passing curation** had `curations.coingecko_listed = false` (no verified CoinGecko listing
while DefiLlama was checked on that run) and whose **latest curation** is in the `ended` tab. Of those:

- `track_record_listed`: projects with a verified `coingecko_listed` signal now (the token trades);
- `track_record_no_token`: the rest, ended without a traded token;
- `track_record_risk_raised`: projects with a `high` or `critical` risk assessment after their first pass.

`coingecko_listed` is null on a run where DefiLlama was not checked and no listing was known; a project whose first pass
has null is left out (unknown is never counted as "before the token traded"). A project that turned risky and is still
out of the list (latest curation failed) is not in the population, so `track_record_risk_raised` only counts the ones
that came back. The web (Plan 6) reads these counters from the latest successful run and shows them only from a total
of 10. A failed read of the history is a stage error (`failed_step` 5) and that run is skipped by the web.

## 5. LLM eval (after changing the prompt or a model)

Fill `pipeline/eval/cases/` (gitignored; see `pipeline/eval/README.md`) and run:

```
LLM_API_KEY=... NVIDIA_API_KEY=... pnpm --filter pipeline eval
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

## 7. LLM providers and the model that answered

Extraction tries these models in order (`MODELS` in `pipeline/src/config.ts`; curation spec decision #30), all with
streaming (both providers return 502 after about 30 s without it):

1. `freellm:auto`: the owner's freellm router (`LLM_BASE_URL`, `LLM_API_KEY`), which picks a free model per request.
2. `nvidia:z-ai/glm-5.3-flash`
3. `nvidia:moonshotai/kimi-k3`
4. `nvidia:google/gemma-4-31b-it`

A model that answers HTTP 200 with something unusable (not JSON, wrong schema, cut off) hands the same document to the
next model at once; that does not count against its circuit breaker. Only timeouts, non-200 replies and rate limits
past their retries do; after 3 in a row the model is skipped for the rest of the run (`llm_models_tripped`). The
breaker keys by `<provider>:<id>`.

Every attempt is a row in `extractions`: `model` is the configured `<provider>:<id>`, `served_model` is the `model`
field the provider streamed back (for `freellm:auto` the model the router chose, e.g. `gpt-oss:120b`; null for a
failed request and for rows from before migration `0008_served_model.sql`). To see which models answered recently
and how they did, in the Supabase SQL editor:

```sql
select model, served_model, count(*) as attempts, count(*) filter (where error is null) as ok,
       round(avg(latency_ms)) as avg_ms
from extractions
where created_at > now() - interval '7 days'
group by 1, 2
order by attempts desc;
```

A drop in quality (eval or `extract_failed`) that lines up with one `served_model` points at that model.
