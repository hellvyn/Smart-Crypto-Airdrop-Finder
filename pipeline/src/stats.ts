import type { RunStats } from "./store/repo.js";

/** Counters of one daily run. Numbers only (spec section 9). */
export interface DailyStats extends RunStats {
  docs_collected: number;
  docs_changed: number;
  extract_ok: number;
  extract_failed: number;
  not_airdrop: number;
  projects_created: number;
  projects_updated: number;
  assessed: number;
  source_failed: number;
  purged: number;
}

export function emptyStats(): DailyStats {
  return {
    docs_collected: 0,
    docs_changed: 0,
    extract_ok: 0,
    extract_failed: 0,
    not_airdrop: 0,
    projects_created: 0,
    projects_updated: 0,
    assessed: 0,
    source_failed: 0,
    purged: 0,
  };
}
