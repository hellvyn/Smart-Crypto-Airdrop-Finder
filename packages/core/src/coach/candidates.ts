// Coach candidates (coach and briefing spec §5.2): the projects the model may choose from, computed on the server
// before the model is called, so the model only picks and explains within a list that already passed curation.
import type { Tab, WorthLevel } from "../curate/types.js";
import type { RiskLevel } from "../types.js";
import type { CoachProfile } from "./profile.js";

/** One candidate project as the Coach sees it. Everything here is public pipeline data, nothing about a member. */
export interface Candidate {
  id: string;
  slug: string;
  name: string;
  risk: RiskLevel | null;
  worthLevel: WorthLevel;
  tab: Tab;
  /** Capital tag: free (Gratis), deposit (Butuh $, see `capitalMinUsd`) or unknown (modal belum jelas). */
  capital: "free" | "deposit" | "unknown";
  capitalMinUsd: number | null;
  chains: string[];
  minutesPerDay: number | null;
  /** Next deadline as an ISO date or timestamp; null when there is none. */
  nextDeadline: string | null;
  points: { text: string; quote: string; sourceUrl: string }[];
  steps: { text: string; cadence: string }[];
  /** Strength of the project's signals, a lower number is stronger; null when it has none. */
  signalRank: number | null;
}

/** The most candidates sent to the model. */
export const MAX_CANDIDATES = 25;

/** The largest stated minimum deposit (USD) a capital band allows; `free` allows no deposit at all. */
const DEPOSIT_CEILING_USD: Record<CoachProfile["capital_band"], number> = {
  free: -1,
  gas_only: 10,
  up_to_100: 100,
  up_to_1000: 1000,
  over_1000: Number.POSITIVE_INFINITY,
};

const WORTH_RANK: Record<WorthLevel, number> = { high: 0, medium: 1, low: 2, insufficient_data: 3 };

/** Why a listed project is not one to farm for a member; `null` when it is. */
export type UnfitReason = "ended" | "beginner_risk" | "capital_unknown" | "deposit_over" | "deposit_unstated";

function capitalUnfit(candidate: Candidate, profile: CoachProfile): UnfitReason | null {
  switch (candidate.capital) {
    case "free":
      return null;
    case "deposit":
      // Only a stated minimum can be compared with the band; a deposit with no stated minimum is not offered.
      if (candidate.capitalMinUsd === null) return "deposit_unstated";
      return candidate.capitalMinUsd <= DEPOSIT_CEILING_USD[profile.capital_band] ? null : "deposit_over";
    case "unknown":
      // "Modal belum jelas": never for a Pemula, never for "Gratis aja", otherwise labelled by the prompt.
      return profile.level !== "beginner" && profile.capital_band !== "free" ? null : "capital_unknown";
  }
}

/**
 * The first reason `candidate` is not one to farm for `profile`, or null when it fits: tab `live_now` or `early_bets`;
 * for a Pemula no `high` or `critical` risk; the capital table of §5.2. Without a profile only the tab counts.
 */
export function unfitReason(candidate: Candidate, profile: CoachProfile | null): UnfitReason | null {
  if (candidate.tab !== "live_now" && candidate.tab !== "early_bets") return "ended";
  if (profile === null) return null;
  if (profile.level === "beginner" && (candidate.risk === "high" || candidate.risk === "critical")) return "beginner_risk";
  return capitalUnfit(candidate, profile);
}

function eligible(candidate: Candidate, profile: CoachProfile): boolean {
  return unfitReason(candidate, profile) === null;
}

/**
 * The project a "Tanya AI" thread is about, from the listed projects, with why it does not fit the member (null when
 * it does, or when there is no profile). The profile never filters it out: the Coach answers about it. Null when it is
 * not listed.
 */
export function askedProject(
  all: Candidate[],
  profile: CoachProfile | null,
  projectId: string,
): { candidate: Candidate; unfit: UnfitReason | null } | null {
  const candidate = all.find((c) => c.id === projectId);
  return candidate === undefined ? null : { candidate, unfit: unfitReason(candidate, profile) };
}

/** `a - b` with nulls last. */
function compareNullable(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function deadlineMs(candidate: Candidate): number | null {
  if (candidate.nextDeadline === null) return null;
  const ms = Date.parse(candidate.nextDeadline);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The candidates for `profile`, best first and at most 25. `onlyProjectId` narrows to that one project (the project
 * page's "Tanya AI"), still through the same filters; an empty result means the project is not one to farm for this
 * member.
 *
 * Kept: tab `live_now` or `early_bets`; the capital table of §5.2; for a Pemula no `high` or `critical` risk.
 * Order: worth, then signal rank, then favourite chain first, then (goal `quick` only) nearest deadline, then name
 * and id so the same data always gives the same list.
 */
export function selectCandidates(all: Candidate[], profile: CoachProfile, onlyProjectId?: string): Candidate[] {
  const favourites = new Set(profile.chains.map((c) => c.toLowerCase()));
  const isFavourite = (c: Candidate): boolean => c.chains.some((chain) => favourites.has(chain.toLowerCase()));
  const quick = profile.goal === "quick";

  return all
    .filter((c) => onlyProjectId === undefined || c.id === onlyProjectId)
    .filter((c) => eligible(c, profile))
    .sort(
      (a, b) =>
        WORTH_RANK[a.worthLevel] - WORTH_RANK[b.worthLevel] ||
        compareNullable(a.signalRank, b.signalRank) ||
        Number(isFavourite(b)) - Number(isFavourite(a)) ||
        (quick ? compareNullable(deadlineMs(a), deadlineMs(b)) : 0) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, MAX_CANDIDATES);
}
