import type { ExtractedDeadline } from "../schema/extraction.js";

// Years 1900-2099 only, so times such as "2300 UTC" are not mistaken for a year.
const FOUR_DIGIT_YEAR = /\b(?:19|20)\d{2}\b/;
// "~" is not a word character, so it cannot sit inside \b(...)\b; match it separately.
const APPROXIMATE_WORDS = /\b(?:approximately|approx\.?|around|about)\b|~/i;
const DATE_FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LEAP_SEARCH_YEARS = 8;

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** Builds YYYY-MM-DD, or null when the month/day does not exist in that year. */
function buildDate(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(2000, month - 1, day));
  d.setUTCFullYear(year);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** Earliest year whose month/day is on or after the cutoff (YYYY-MM-DD, UTC calendar date). */
function rollToCutoff(month: number, day: number, cutoff: Date): string | null {
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const startYear = cutoff.getUTCFullYear();
  // Feb 29 may need several years to land on a leap year; other dates settle within two.
  for (let year = startYear; year <= startYear + MAX_LEAP_SEARCH_YEARS; year++) {
    const candidate = buildDate(year, month, day);
    // ISO date strings of equal length compare correctly as text.
    if (candidate !== null && candidate >= cutoffIso) return candidate;
  }
  return null;
}

/**
 * Deterministic fix-ups for an LLM-extracted deadline. Returns a new object.
 * - Text without a 4-digit year: keep month+day and pick the earliest year on or
 *   after (publishedAt - 7 days), compared as UTC calendar dates.
 * - Hedging words ("approximately", "around", "~", ...): downgrade precision "exact" to "approximate".
 *   Month and quarter precision are already coarser and stay as they are.
 */
export function normalizeDeadline(d: ExtractedDeadline, publishedAt: Date | null): ExtractedDeadline {
  const out: ExtractedDeadline = { ...d };

  if (out.date !== null && publishedAt !== null && !FOUR_DIGIT_YEAR.test(out.text)) {
    const m = DATE_FORMAT.exec(out.date);
    if (m && !Number.isNaN(publishedAt.getTime())) {
      const cutoff = new Date(publishedAt.getTime() - 7 * DAY_MS);
      const rolled = rollToCutoff(Number(m[2]), Number(m[3]), cutoff);
      if (rolled !== null) out.date = rolled;
    }
  }

  if (out.precision === "exact" && APPROXIMATE_WORDS.test(out.text)) out.precision = "approximate";

  return out;
}
