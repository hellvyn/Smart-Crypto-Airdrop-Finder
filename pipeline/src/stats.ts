import type { RunStats } from "./store/repo.js";

/** Counters of one daily run. Numbers only (spec section 9). */
export interface DailyStats extends RunStats {
  docs_collected: number;
  docs_changed: number;
  extract_ok: number;
  extract_failed: number;
  /** Pending documents left for the next run because the extraction budget ran out. */
  extract_deferred: number;
  not_airdrop: number;
  projects_created: number;
  projects_updated: number;
  /** Documents (or DefiLlama candidates) whose merge threw; such documents are stored as `merge_failed`. */
  merge_failed: number;
  assessed: number;
  /** Projects whose risk assessment threw. */
  score_failed: number;
  source_failed: number;
  /** Collected documents that could not be stored (the other documents still were). */
  ingest_failed: number;
  purged: number;
  // The notify counters (`NotifyStats`: digests_*) are added only when email is enabled.
}

export function emptyStats(): DailyStats {
  return {
    docs_collected: 0,
    docs_changed: 0,
    extract_ok: 0,
    extract_failed: 0,
    extract_deferred: 0,
    not_airdrop: 0,
    projects_created: 0,
    projects_updated: 0,
    merge_failed: 0,
    assessed: 0,
    score_failed: 0,
    source_failed: 0,
    ingest_failed: 0,
    purged: 0,
  };
}

/**
 * Process exit code for a finished run: 1 (the scheduled workflow shows as failed) when a stage failed or any
 * source, document ingest, merge, assessment or digest failed; 0 otherwise. Model failures (`extract_failed`),
 * budget deferrals and digests skipped for quota are retried or expected and do not fail the job.
 */
export function runExitCode(stats: RunStats): 0 | 1 {
  const failed = ["run_error", "source_failed", "ingest_failed", "merge_failed", "score_failed", "digests_failed"].some(
    (counter) => (stats[counter] ?? 0) > 0,
  );
  return failed ? 1 : 0;
}
