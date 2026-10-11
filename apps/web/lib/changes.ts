// "Perubahan sejak kunjungan terakhir" (Plan 6 Task 7): turns the watched projects' `project_changes` rows and their
// near deadlines into what the member sees. Pure; lib/queries.ts reads the rows. Two groups: the changes since the
// member last pressed "Tandai sudah dibaca", and the near deadlines, which are reminders and never marked seen.
import type { RiskLevel, Status } from "@saf/core";
import { changes as copy } from "./copy";
import { RISK_LEVELS, STATUSES, isFirmPrecision, riskLabel, statusLabel, utcToday } from "./view";

export interface ChangeProject {
  slug: string;
  name: string;
}

/** One `project_changes` row with its project. Rows of one pipeline run share `changedAt` (the run's start). */
export interface ChangeRow {
  projectId: string;
  project: ChangeProject;
  field: string;
  oldValue: string | null;
  newValue: string;
  changedAt: string;
  seq: number;
}

export interface DeadlineRow {
  projectId: string;
  project: ChangeProject;
  kind: string;
  date: string;
  precision: string;
}

export const CHANGE_DEADLINE_KINDS = ["claim", "snapshot", "campaign_end"] as const;
export type ChangeDeadlineKind = (typeof CHANGE_DEADLINE_KINDS)[number];

/** `at` is the run's `changed_at` (ISO). */
export type ChangeItem =
  | { kind: "curated_in" | "curated_out" | "ended"; project: ChangeProject; at: string }
  | { kind: "status"; project: ChangeProject; from: Status; to: Status; at: string }
  | { kind: "risk"; project: ChangeProject; from: RiskLevel | null; to: RiskLevel | null; at: string }
  | { kind: "curated_in_many"; count: number; at: string };

/** A claim / snapshot / campaign-end deadline of a watched project in the next 48 hours. */
export interface DeadlineItem {
  project: ChangeProject;
  deadlineKind: ChangeDeadlineKind;
  date: string;
  approximate: boolean;
}

export interface ChangeFeed {
  changes: ChangeItem[];
  deadlines: DeadlineItem[];
}

export const EMPTY_CHANGE_FEED: ChangeFeed = { changes: [], deadlines: [] };

/** Each group shows at most this many items: the newest changes, the nearest deadlines. */
export const MAX_CHANGE_ITEMS = 20;
/**
 * A run with more first-time entries into the list (`curated` null -> "true") than this shows them as one
 * "{n} project masuk list" item. The first run after curation went live writes one for every passing project.
 */
export const MAX_SEPARATE_FIRST_ENTRIES = 3;
/** A deadline is near when its date is at most this far ahead. */
export const DEADLINE_WINDOW_MS = 48 * 60 * 60 * 1000;

function asStatus(v: string | null): Status {
  return STATUSES.includes(v as Status) ? (v as Status) : "unknown";
}

function asRisk(v: string | null): RiskLevel | null {
  return RISK_LEVELS.includes(v as RiskLevel) ? (v as RiskLevel) : null;
}

interface Collapsed {
  row: ChangeRow;
  from: string | null;
  to: string;
  run: number;
  seq: number;
}

/**
 * One change per project and field in each run: the old value of the first row and the new value of the last (seq
 * order), like the old digest did. A run is one `changed_at`, compared as a time so spellings do not split it.
 */
function collapse(changes: ChangeRow[]): Collapsed[] {
  const groups = new Map<string, Collapsed>();
  const ordered = [...changes].sort((a, b) => Date.parse(a.changedAt) - Date.parse(b.changedAt) || a.seq - b.seq);
  for (const row of ordered) {
    const run = Date.parse(row.changedAt);
    const key = `${run}\u0000${row.projectId}\u0000${row.field}`;
    const group = groups.get(key);
    if (group) {
      group.to = row.newValue;
      group.seq = row.seq;
    } else {
      groups.set(key, { row, from: row.oldValue, to: row.newValue, run, seq: row.seq });
    }
  }
  return [...groups.values()];
}

interface Sortable {
  item: ChangeItem;
  time: number;
  seq: number;
}

/**
 * A project that ended reads "Udah ended" only, never "Keluar dari list" (#40): its curated true -> false is left out
 * when it ended in the same run, or when its current status is ended (`endedNow`), whichever run the flip came in.
 */
function changeItems(changes: ChangeRow[], endedNow: ReadonlySet<string>): Sortable[] {
  const groups = collapse(changes);
  const endedIn = new Set<string>();
  for (const g of groups) {
    if (g.row.field === "status" && asStatus(g.to) === "ended" && asStatus(g.from) !== "ended") {
      endedIn.add(`${g.run}\u0000${g.row.projectId}`);
    }
  }
  const ended = (g: Collapsed) => endedNow.has(g.row.projectId) || endedIn.has(`${g.run}\u0000${g.row.projectId}`);

  const out: Sortable[] = [];
  const firstEntries = new Map<number, Sortable[]>();
  for (const g of groups) {
    const { project, changedAt: at } = g.row;
    let item: ChangeItem | null = null;
    if (g.row.field === "status") {
      const from = asStatus(g.from);
      const to = asStatus(g.to);
      if (to === "ended" && from !== "ended") item = { kind: "ended", project, at };
      else if (from !== to) item = { kind: "status", project, from, to, at };
    } else if (g.row.field === "risk_level") {
      const from = asRisk(g.from);
      const to = asRisk(g.to);
      if (from !== to) item = { kind: "risk", project, from, to, at };
    } else if (g.row.field === "curated") {
      if (g.to === "true" && g.from !== "true") {
        const entry: Sortable = { item: { kind: "curated_in", project, at }, time: g.run, seq: g.seq };
        if (g.from === null) firstEntries.set(g.run, [...(firstEntries.get(g.run) ?? []), entry]);
        else out.push(entry);
      } else if (g.to === "false" && g.from === "true" && !ended(g)) {
        item = { kind: "curated_out", project, at };
      }
    }
    if (item) out.push({ item, time: g.run, seq: g.seq });
  }

  for (const [run, entries] of firstEntries) {
    if (entries.length > MAX_SEPARATE_FIRST_ENTRIES) {
      const seq = Math.max(...entries.map((e) => e.seq));
      out.push({ item: { kind: "curated_in_many", count: entries.length, at: entries[0]!.item.at }, time: run, seq });
    } else {
      out.push(...entries);
    }
  }
  return out;
}

/**
 * Claim, snapshot and campaign-end deadlines with an exact or approximate date from today (UTC) to 48 hours ahead,
 * once per project, kind and date (exact wins), nearest first. They are reminders: shown for as long as they are in
 * the window, whatever the member marked seen.
 */
function deadlineItems(deadlines: DeadlineRow[], now: Date): DeadlineItem[] {
  const first = utcToday(now);
  const last = utcToday(new Date(now.getTime() + DEADLINE_WINDOW_MS));
  const byKey = new Map<string, DeadlineItem>();
  for (const d of deadlines) {
    if (!(CHANGE_DEADLINE_KINDS as readonly string[]).includes(d.kind) || !isFirmPrecision(d.precision)) continue;
    if (d.date < first || d.date > last) continue;
    const key = `${d.projectId}\u0000${d.kind}\u0000${d.date}`;
    const approximate = d.precision !== "exact";
    const existing = byKey.get(key);
    if (existing) existing.approximate &&= approximate;
    else byKey.set(key, { project: d.project, deadlineKind: d.kind as ChangeDeadlineKind, date: d.date, approximate });
  }
  return [...byKey.values()]
    .sort((a, b) => a.date.localeCompare(b.date) || a.project.name.localeCompare(b.project.name))
    .slice(0, MAX_CHANGE_ITEMS);
}

/**
 * The feed: the changes (already limited to what the member has not marked seen) newest first (ties: later seq
 * first), and the near deadlines nearest first, each at most `MAX_CHANGE_ITEMS`. `endedNow` holds the watched
 * projects whose current status is ended.
 */
export function buildChangeFeed(
  changes: ChangeRow[],
  deadlines: DeadlineRow[],
  endedNow: ReadonlySet<string>,
  now: Date,
): ChangeFeed {
  return {
    changes: changeItems(changes, endedNow)
      .sort((a, b) => b.time - a.time || b.seq - a.seq)
      .slice(0, MAX_CHANGE_ITEMS)
      .map((s) => s.item),
    deadlines: deadlineItems(deadlines, now),
  };
}

/** The words of one change of the feed (everything but the collapsed first-run line, which links to the watchlist). */
export function changeText(item: Exclude<ChangeItem, { kind: "curated_in_many" }>): string {
  switch (item.kind) {
    case "curated_in":
      return copy.curatedIn;
    case "curated_out":
      return copy.curatedOut;
    case "ended":
      return copy.ended;
    case "status":
      return copy.status(statusLabel(item.from), statusLabel(item.to));
    case "risk":
      return copy.risk(riskLabel(item.from), riskLabel(item.to));
  }
}
