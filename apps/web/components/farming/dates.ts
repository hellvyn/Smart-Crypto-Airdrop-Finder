// Calendar helpers for the farming tracker's "YYYY-MM-DD" days. A day is a calendar date, not an instant, so every
// conversion goes through UTC midnight and the server's own time zone never shifts it.

const DAY_FORMAT = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const MONTH_FORMAT = new Intl.DateTimeFormat("id-ID", { month: "short", timeZone: "UTC" });

const toDate = (day: string): Date => new Date(`${day}T00:00:00Z`);

/** "10 Okt 2026". */
export function formatDay(day: string): string {
  return DAY_FORMAT.format(toDate(day));
}

/** "Okt". */
export function formatMonth(day: string): string {
  return MONTH_FORMAT.format(toDate(day));
}

/** Monday = 0 to Sunday = 6 (ISO weeks). */
export function isoWeekday(day: string): number {
  return (toDate(day).getUTCDay() + 6) % 7;
}
