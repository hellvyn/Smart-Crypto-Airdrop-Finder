import type { RunStats } from "./store/repo.js";

/** Counters of one daily run. Numbers only (spec section 9). */
export interface DailyStats extends RunStats {
  docs_collected: number;
  docs_changed: number;
  /** DefiLlama `/protocol/{slug}` details fetched for the speculative candidates (when the list lacks them), failed, and not asked (cap or budget). */
  defillama_details_fetched: number;
  defillama_details_failed: number;
  defillama_details_skipped: number;
  extract_ok: number;
  extract_failed: number;
  /** Pending documents left for the next run because the extraction budget ran out. */
  extract_deferred: number;
  /** Models skipped for part of the run after repeated failures (circuit breaker). */
  llm_models_tripped: number;
  not_airdrop: number;
  projects_created: number;
  projects_updated: number;
  /** Documents (or DefiLlama candidates) whose merge threw; such documents are stored as `merge_failed`. */
  merge_failed: number;
  assessed: number;
  /** Scored projects that have at least one official domain; the denominator of the two domain checks below. */
  projects_with_official_domain: number;
  /** Of those, projects where the domain-age lookup (RDAP, else crt.sh) answered for at least one official domain. */
  domain_age_ran: number;
  /** Domains whose age came from crt.sh because RDAP had no answer. */
  domain_age_from_crtsh: number;
  /** Domains RDAP gave no registration date for, for any reason; the next three are subsets of it. */
  domain_age_rdap_failed: number;
  /** Of those, domains RDAP still rate-limited (429) after the one retry. Not sent to crt.sh: retried next run. */
  domain_age_rdap_rate_limited: number;
  /**
   * Of those, domains rdap.org answered 404 for: a TLD without RDAP service, or a registry that does not know the
   * domain. Sent to crt.sh.
   */
  domain_age_no_rdap: number;
  /** Of those, domains never asked because the RDAP time budget ran out. */
  domain_age_rdap_skipped: number;
  /** Domains sent to crt.sh (an RDAP 404, or a 200 without a registration date) that crt.sh gave no age for. */
  domain_age_crtsh_failed: number;
  /** Of those, domains never asked because the crt.sh time budget ran out. */
  domain_age_crtsh_skipped: number;
  /** Of the projects with an official domain, those where the GoPlus phishing check answered for at least one. */
  phishing_list_ran: number;
  /** Domains the GoPlus phishing check gave no answer for, after its one retry. */
  phishing_list_failed: number;
  /** Of the failed domains, those GoPlus still rate-limited (429 or code 4029) after the one retry. */
  phishing_list_rate_limited: number;
  /** Of the failed domains, those never asked because the GoPlus time budget ran out or too many failed in a row. */
  phishing_list_skipped: number;
  /** Projects that got a verified DefiLlama `tvl` signal (domain-matched). */
  signals_tvl: number;
  /** Projects that got a verified `coingecko_listed` signal (domain-matched DefiLlama protocol with a CoinGecko id). */
  signals_coingecko: number;
  /** Projects that got at least one verified `vc_backer` this run (domain in a checked VC portfolio). */
  signals_vc_backer: number;
  /**
   * VCs whose portfolio page had to be fetched and failed (not 200, or no portfolio link in its HTML), or whose cache
   * could not be read. Such a VC still counts as checked when its cache is at most 14 days old.
   */
  vc_portfolios_failed: number;
  /** AlphaDrops raise pages fetched and usable this run (stored in the `alphadrops_raises` cache). */
  raises_fetched: number;
  /** Projects that got at least one `reported_backer` this run (official website of a raise page matched by domain). */
  raises_matched: number;
  /**
   * AlphaDrops raise requests that failed: `llms-full.txt` (not 200, or no fundraising entry) and raise pages (not
   * 200, a broken connection, or no funding round on the page). The run does not fail.
   */
  raises_failed: number;
  /** Projects whose signals could not be built or stored; they keep no signals until a later run succeeds. */
  signals_failed: number;
  /** AI analyses made and stored this run. */
  ai_analyses_run: number;
  /** AI analyses skipped because the stored one has the same input hash and prompt version. */
  ai_analyses_cached: number;
  /** AI analyses where every model failed or the analysis threw; the previous analysis stays the latest. */
  ai_analyses_failed: number;
  /** AI analyses not started (or stopped between models) because the analysis budget or limit ran out. */
  ai_analyses_deferred: number;
  /**
   * Models the `analyze` stage skipped for the rest of the run after repeated failures (its own circuit breaker, apart
   * from extraction's `llm_models_tripped`). A used-up or invalid Claude key shows here as 1.
   */
  ai_models_tripped: number;
  /**
   * New AI analyses whose Indonesian text uses a phrase the style rules forbid (`FORBIDDEN_PHRASES`). They are stored
   * all the same; the count is for the owner's review of AI writing (gate G13).
   */
  ai_style_violations: number;
  /**
   * Official website pages (`official_sites` stage, listed projects): pages fetched and kept; pages that failed (not 2xx,
   * a broken connection, or a redirect to another domain); and pages not used: a page that is not HTML, and sites
   * not started because the stage's budget or per-run cap was used up (the next run takes them).
   */
  official_pages_fetched: number;
  official_pages_failed: number;
  official_pages_skipped: number;
  /** Claim portal pages fetched this run (at most 20) for the AI Scam Analyst; pages read from the cache not counted. */
  claim_pages_read: number;
  /** Distinct claim/app links checked and written to `link_checks` this run. */
  link_checks_total: number;
  /** Of those, links on the phishing list (`phishing`; never rendered as a link, and the project's risk is high). */
  link_checks_phishing: number;
  /** Projects whose curation (`curate` + `worth`) was computed and stored this run. */
  curation_checked: number;
  /** Of those, the curations that passed, in all tabs and per tab (`live_now` is what gate G9 counts). */
  curation_passed: number;
  curation_passed_live_now: number;
  curation_passed_early_bets: number;
  curation_passed_ended: number;
  /**
   * Failed curations with an `insufficient_checks` reason (no official domain, or a key check did not run; domain age
   * and the phishing list count only when they answered for an official domain).
   */
  curation_hidden_insufficient_checks: number;
  /**
   * Track record (curation spec §15.3, #43): projects whose first passing curation came before their token traded
   * (`coingecko_listed`) and whose latest curation is in the `ended` tab or who were `high`/`critical` risk after their
   * first pass (whatever their latest curation); of those, the ones whose token trades now, the ones in the `ended`
   * tab without a traded token, and the ones that were `high`/`critical` risk after their first pass.
   */
  track_record_total: number;
  track_record_listed: number;
  track_record_no_token: number;
  track_record_risk_raised: number;
  /** Projects whose risk assessment or curation threw. */
  score_failed: number;
  source_failed: number;
  /** Collected documents that could not be stored (the other documents still were). */
  ingest_failed: number;
  purged: number;
  /** Items in the briefing saved this run (0 when there were no facts and nothing was saved). */
  briefing_items: number;
  /** 1 when this run's briefing came from the model, 0 when it is the version without the AI or none was saved. */
  briefing_ai: number;
  /** Coach threads deleted by retention (30 days); their messages go with them. */
  coach_threads_purged: number;
  /** Quota ledger rows (`coach_usage`) deleted by retention (2 days). */
  coach_usage_purged: number;
  /** Logos stored this run (`logos` stage), all sources together, and per source. */
  logos_fetched: number;
  logos_defillama: number;
  logos_x_avatar: number;
  logos_favicon: number;
  /** Projects due for a logo with at least one source to try where none gave a usable image (or it could not be stored). */
  logos_failed: number;
  /** Projects due for a logo that were not tried because the stage's time budget ran out; the next run tries them. */
  logos_skipped: number;
  /** unavatar.io requests this run (at most `logos.maxXAvatarsPerRun`), and of those the ones that gave no logo. */
  logos_x_avatar_requests: number;
  logos_x_avatar_failed: number;
  /** Projects whose X avatar was next but the per-run unavatar.io cap was reached; they went on to their favicon. */
  logos_x_avatar_deferred: number;
  /**
   * Seconds each stage took on the run's clock (one decimal), so a slow run shows where the time went. Flat keys:
   * run stats are numbers only. A stage that threw still reports its time.
   */
  stage_seconds_collect: number;
  stage_seconds_extract: number;
  stage_seconds_speculative: number;
  stage_seconds_signals: number;
  stage_seconds_official_sites: number;
  stage_seconds_analyze: number;
  stage_seconds_score: number;
  stage_seconds_briefing: number;
  stage_seconds_analyze_listed: number;
  stage_seconds_logos: number;
  stage_seconds_purge: number;
}

export function emptyStats(): DailyStats {
  return {
    docs_collected: 0,
    docs_changed: 0,
    defillama_details_fetched: 0,
    defillama_details_failed: 0,
    defillama_details_skipped: 0,
    extract_ok: 0,
    extract_failed: 0,
    extract_deferred: 0,
    llm_models_tripped: 0,
    not_airdrop: 0,
    projects_created: 0,
    projects_updated: 0,
    merge_failed: 0,
    assessed: 0,
    projects_with_official_domain: 0,
    domain_age_ran: 0,
    domain_age_from_crtsh: 0,
    domain_age_rdap_failed: 0,
    domain_age_rdap_rate_limited: 0,
    domain_age_no_rdap: 0,
    domain_age_rdap_skipped: 0,
    domain_age_crtsh_failed: 0,
    domain_age_crtsh_skipped: 0,
    phishing_list_ran: 0,
    phishing_list_failed: 0,
    phishing_list_rate_limited: 0,
    phishing_list_skipped: 0,
    signals_tvl: 0,
    signals_coingecko: 0,
    signals_vc_backer: 0,
    vc_portfolios_failed: 0,
    raises_fetched: 0,
    raises_matched: 0,
    raises_failed: 0,
    signals_failed: 0,
    ai_analyses_run: 0,
    ai_analyses_cached: 0,
    ai_analyses_failed: 0,
    ai_analyses_deferred: 0,
    ai_models_tripped: 0,
    ai_style_violations: 0,
    official_pages_fetched: 0,
    official_pages_failed: 0,
    official_pages_skipped: 0,
    claim_pages_read: 0,
    link_checks_total: 0,
    link_checks_phishing: 0,
    curation_checked: 0,
    curation_passed: 0,
    curation_passed_live_now: 0,
    curation_passed_early_bets: 0,
    curation_passed_ended: 0,
    curation_hidden_insufficient_checks: 0,
    track_record_total: 0,
    track_record_listed: 0,
    track_record_no_token: 0,
    track_record_risk_raised: 0,
    score_failed: 0,
    source_failed: 0,
    ingest_failed: 0,
    purged: 0,
    briefing_items: 0,
    briefing_ai: 0,
    coach_threads_purged: 0,
    coach_usage_purged: 0,
    logos_fetched: 0,
    logos_defillama: 0,
    logos_x_avatar: 0,
    logos_favicon: 0,
    logos_failed: 0,
    logos_skipped: 0,
    logos_x_avatar_requests: 0,
    logos_x_avatar_failed: 0,
    logos_x_avatar_deferred: 0,
    stage_seconds_collect: 0,
    stage_seconds_extract: 0,
    stage_seconds_speculative: 0,
    stage_seconds_signals: 0,
    stage_seconds_official_sites: 0,
    stage_seconds_analyze: 0,
    stage_seconds_score: 0,
    stage_seconds_briefing: 0,
    stage_seconds_analyze_listed: 0,
    stage_seconds_logos: 0,
    stage_seconds_purge: 0,
  };
}

/**
 * Process exit code for a finished run: 1 (the scheduled workflow shows as failed) when a stage failed or any
 * source, document ingest, merge, signal write or assessment failed; 0 otherwise. Model failures (`extract_failed`) and
 * budget deferrals are retried or expected and do not fail the job.
 */
export function runExitCode(stats: RunStats): 0 | 1 {
  const failed = ["run_error", "source_failed", "ingest_failed", "merge_failed", "signals_failed", "score_failed"].some(
    (counter) => (stats[counter] ?? 0) > 0,
  );
  return failed ? 1 : 0;
}
