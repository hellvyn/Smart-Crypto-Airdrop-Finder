// trackRecord(): the public track record of curated airdrops (curation spec §15.3, #43). Pure.
import type { Tab } from "./types.js";

/** One project's curation history, as the track record needs it. */
export interface TrackRecordProject {
  /** `computed_at` of the project's first passing curation; null when it never passed. */
  firstPassAt: string | null;
  /**
   * The project had a verified `coingecko_listed` signal at its first pass; null when that is unknown (DefiLlama was
   * not checked on that run and no listing was known), which keeps the project out of the population.
   */
  listedAtFirstPass: boolean | null;
  /** Tab of the project's latest curation (null when it failed). */
  tab: Tab | null;
  /** The project has a verified `coingecko_listed` signal now. */
  coingeckoListed: boolean;
  /** A risk assessment after the first pass was `high` or `critical`. */
  riskRaisedAfterPass: boolean;
}

/** Counts behind the public track record; no project names. Shown only from a total of 10 (Plan 6). */
export interface TrackRecord {
  /** Population: passed before the token traded (`coingecko_listed`), and now in the `ended` tab (#40). */
  total: number;
  /** Of the population, projects whose token trades now. */
  listed: number;
  /** Of the population, projects that ended without a traded token. */
  noToken: number;
  /** Of the population, projects that were `high`/`critical` risk at some point after their first pass. */
  riskRaised: number;
}

export function trackRecord(projects: TrackRecordProject[]): TrackRecord {
  const population = projects.filter((p) => p.firstPassAt !== null && p.listedAtFirstPass === false && p.tab === "ended");
  const listed = population.filter((p) => p.coingeckoListed).length;
  return {
    total: population.length,
    listed,
    noToken: population.length - listed,
    riskRaised: population.filter((p) => p.riskRaisedAfterPass).length,
  };
}
