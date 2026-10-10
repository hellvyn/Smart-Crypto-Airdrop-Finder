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
  purged: number;
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
    purged: 0,
  };
}
