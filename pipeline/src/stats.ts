import type { RunStats } from "./store/repo.js";

/** Counters of one daily run. Numbers only (spec section 9). */
export interface DailyStats extends RunStats {
  docs_collected: number;
  docs_changed: number;
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
  /** Of the projects with an official domain, those where the GoPlus phishing check answered for at least one. */
  phishing_list_ran: number;
  /** Domains the GoPlus phishing check gave no answer for, after its one retry. */
  phishing_list_failed: number;
  /** Of the failed domains, those GoPlus still rate-limited (429 or code 4029) after the one retry. */
  phishing_list_rate_limited: number;
  /** Projects whose risk assessment threw. */
  score_failed: number;
  source_failed: number;
  /** Collected documents that could not be stored (the other documents still were). */
  ingest_failed: number;
  purged: number;
}

export function emptyStats(): DailyStats {
  return {
    docs_collected: 0,
    docs_changed: 0,
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
    phishing_list_ran: 0,
    phishing_list_failed: 0,
    phishing_list_rate_limited: 0,
    score_failed: 0,
    source_failed: 0,
    ingest_failed: 0,
    purged: 0,
  };
}

/**
 * Process exit code for a finished run: 1 (the scheduled workflow shows as failed) when a stage failed or any
 * source, document ingest, merge or assessment failed; 0 otherwise. Model failures (`extract_failed`) and
 * budget deferrals are retried or expected and do not fail the job.
 */
export function runExitCode(stats: RunStats): 0 | 1 {
  const failed = ["run_error", "source_failed", "ingest_failed", "merge_failed", "score_failed"].some(
    (counter) => (stats[counter] ?? 0) > 0,
  );
  return failed ? 1 : 0;
}
