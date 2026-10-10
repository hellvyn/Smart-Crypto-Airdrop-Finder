import type { DatePrecision, DeadlineKind } from "../types.js";

// Pure farming-tracker maths. Days are plain "YYYY-MM-DD" strings (the member's local day), so
// ordering is string comparison and the host time zone never leaks in: all calendar arithmetic
// goes through UTC midnights.

export type HeatLevel = 0 | 1 | 2 | 3 | null;

export interface TrackerTask {
  id: string;
  cadence: "once" | "daily" | "weekly";
  /** Local day the task was created. */
  createdDay: string;
  /** Local day the task was archived (no longer active on that day), or null. */
  archivedDay: string | null;
}

export interface TrackerCheck {
  taskId: string;
  day: string;
}

export interface HeatmapRange {
  /** First cell of the heatmap. */
  start: string;
  /** Last cell of the heatmap. */
  end: string;
  endKind: "snapshot" | "campaign_end" | "ended" | null;
  /**
   * The day `endKind` names (the deadline, or the day the project ended); null without an end kind.
   * Equal to `end` unless the deadline is too far ahead to show in one window together with today.
   */
  endsOn: string | null;
}

export interface HeatmapCell {
  day: string;
  level: HeatLevel;
  done: number;
  total: number;
  upcoming: boolean;
}

const DAY_MS = 86_400_000;
const toMs = (day: string): number => {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
};
const fromMs = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const addDays = (day: string, n: number): string => fromMs(toMs(day) + n * DAY_MS);
const diffDays = (later: string, earlier: string): number => Math.round((toMs(later) - toMs(earlier)) / DAY_MS);

const isActiveOn = (t: TrackerTask, day: string): boolean =>
  t.createdDay <= day && (t.archivedDay === null || day < t.archivedDay);

/** A once task is "main" progress: done once it has any check row. Archived once tasks are left out. */
export function mainProgress(tasks: TrackerTask[], checks: TrackerCheck[]): { done: number; total: number } {
  const checked = new Set(checks.map((c) => c.taskId));
  const active = tasks.filter((t) => t.cadence === "once" && t.archivedDay === null);
  return { done: active.filter((t) => checked.has(t.id)).length, total: active.length };
}

/**
 * Heatmap window. While the project has not ended, the window always holds `today`.
 *
 * `start` is the project's start day. `end` is the earliest snapshot or campaign_end deadline
 * (exact or approximate, dated) on or after both `start` and `today`, so a passed deadline gives
 * way to the next one. With none, `end` is `start + 364` days (365 cells, one year), rolled forward
 * to `today` after a year (`start` then follows, keeping 365 cells).
 *
 * A deadline can make the window longer than 364 cells: then `start` is moved up to `end - 363`
 * days. When that would start after `today`, the 364 cells start at `start` instead (or end on
 * `today` after a year of farming), so the window ends before the deadline; `endsOn` keeps it.
 *
 * A project that ended (`endedOn >= start` and before `end`) ends the window there as "ended",
 * even when that is before today.
 */
export function heatmapRange(
  startedDay: string,
  deadlines: { kind: DeadlineKind; date: string | null; precision: DatePrecision }[],
  today: string,
  endedOn: string | null = null,
): HeatmapRange {
  let end = addDays(startedDay, 364);
  if (end < today) end = today;
  let endKind: HeatmapRange["endKind"] = null;
  for (const d of deadlines) {
    if (d.kind !== "snapshot" && d.kind !== "campaign_end") continue;
    if (d.precision !== "exact" && d.precision !== "approximate") continue;
    if (d.date === null || d.date < startedDay || d.date < today) continue;
    // Earliest date wins; on the same date a snapshot is reported over a campaign end.
    const wins = endKind === null || d.date < end || (d.date === end && d.kind === "snapshot");
    if (wins) {
      end = d.date;
      endKind = d.kind;
    }
  }
  if (endedOn !== null && endedOn >= startedDay && endedOn < end) {
    end = endedOn;
    endKind = "ended";
  }
  const endsOn = endKind === null ? null : end;
  const notBeforeStart = (day: string): string => (day > startedDay ? day : startedDay);
  if (endKind === null) return { start: notBeforeStart(addDays(end, -364)), end, endKind, endsOn };
  let start = notBeforeStart(addDays(end, -363));
  if (start > today) {
    start = notBeforeStart(addDays(today, -363));
    end = addDays(start, 363);
  }
  return { start, end, endKind, endsOn };
}

/** One cell per day from `range.start` to `range.end`; days after `today` are upcoming with no level. */
export function buildHeatmap(
  tasks: TrackerTask[],
  checks: TrackerCheck[],
  range: { start: string; end: string },
  today: string,
): HeatmapCell[] {
  const progressOn = dailyProgress(tasks, checks);
  const cells: HeatmapCell[] = [];
  for (let day = range.start; day <= range.end; day = addDays(day, 1)) {
    const { done, total } = progressOn(day);
    const upcoming = day > today;
    let level: HeatLevel = null;
    if (!upcoming && total > 0) level = done === 0 ? 0 : done === total ? 3 : done * 2 < total ? 1 : 2;
    cells.push({ day, level, done, total, upcoming });
  }
  return cells;
}

/** For a day: the daily tasks active on it (`total`) and how many of them have a check on it (`done`). */
function dailyProgress(tasks: TrackerTask[], checks: TrackerCheck[]): (day: string) => { done: number; total: number } {
  const dailies = tasks.filter((t) => t.cadence === "daily");
  const checkedByDay = new Map<string, Set<string>>();
  for (const c of checks) {
    const set = checkedByDay.get(c.day) ?? new Set<string>();
    set.add(c.taskId);
    checkedByDay.set(c.day, set);
  }
  return (day) => {
    const active = dailies.filter((t) => isActiveOn(t, day));
    const checked = checkedByDay.get(day);
    return { done: checked ? active.filter((t) => checked.has(t.id)).length : 0, total: active.length };
  };
}

/** Days from `today` to `range.endsOn`, both inclusive. Null without an end kind or once the end passed. */
export function daysLeft(range: HeatmapRange, today: string): number | null {
  if (range.endsOn === null || range.endsOn < today) return null;
  return diffDays(range.endsOn, today) + 1;
}

/**
 * Consecutive days with every active daily task checked (level 3), ending today, or yesterday when
 * today is not complete yet. Counted from the tasks and checks themselves, so the heatmap window
 * never cuts it short.
 */
export function streak(tasks: TrackerTask[], checks: TrackerCheck[], today: string): number {
  const progressOn = dailyProgress(tasks, checks);
  const complete = (day: string): boolean => {
    const { done, total } = progressOn(day);
    return total > 0 && done === total;
  };
  let day = complete(today) ? today : addDays(today, -1);
  let n = 0;
  while (complete(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

/**
 * Per weekly task active on `today`: has it a check in the ISO week (Monday to Sunday) containing
 * `today`? Other cadences and tasks already archived are not reported.
 */
export function weeklyDone(tasks: TrackerTask[], checks: TrackerCheck[], today: string): Record<string, boolean> {
  const isoDow = (new Date(toMs(today)).getUTCDay() + 6) % 7; // Monday = 0
  const monday = addDays(today, -isoDow);
  const sunday = addDays(monday, 6);
  const checked = new Set(checks.filter((c) => c.day >= monday && c.day <= sunday).map((c) => c.taskId));
  const result: Record<string, boolean> = {};
  for (const t of tasks) {
    if (t.cadence === "weekly" && isActiveOn(t, today)) result[t.id] = checked.has(t.id);
  }
  return result;
}

/** The calendar day of `now` in the IANA `timeZone`, as YYYY-MM-DD. */
export function localDay(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
