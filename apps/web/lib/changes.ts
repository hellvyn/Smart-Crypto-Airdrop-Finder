// "Perubahan sejak kunjungan terakhir" (Plan 6 Task 7): turns the watched projects' `project_changes` rows and their
// near deadlines into the items the member sees. Pure; lib/queries.ts reads the rows.
import type { RiskLevel, Status } from "@saf/core";
import { RISK_LEVELS, STATUSES, isFirmPrecision, utcToday } from "./view";

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

/** `at` is when the item happened (ISO): the run's `changed_at`, or when a deadline came within 48 hours. */
export type ChangeItem =
  | { kind: "curated_in" | "curated_out" | "ended"; project: ChangeProject; at: string }
  | { kind: "status"; project: ChangeProject; from: Status; to: Status; at: string }
  | { kind: "risk"; project: ChangeProject; from: RiskLevel | null; to: RiskLevel | null; at: string }
  | { kind: "curated_in_many"; count: number; at: string }
  | {
      kind: "deadline";
      project: ChangeProject;
      deadlineKind: ChangeDeadlineKind;
      date: string;
      approximate: boolean;
      at: string;
    };

/** The feed shows at most this many items, newest first. */
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

function changeItems(changes: ChangeRow[]): Sortable[] {
  const groups = collapse(changes);
  // A project that ended in a run reads "Udah ended" only, even if it also left the list in that run (#40).
  const endedIn = new Set<string>();
  for (const g of groups) {
    if (g.row.field === "status" && asStatus(g.to) === "ended" && asStatus(g.from) !== "ended") {
      endedIn.add(`${g.run}\u0000${g.row.projectId}`);
    }
  }

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
        const entry = { item: { kind: "curated_in", project, at } as ChangeItem, time: g.run, seq: g.seq };
        if (g.from === null) firstEntries.set(g.run, [...(firstEntries.get(g.run) ?? []), entry]);
        else out.push(entry);
      } else if (g.to === "false" && g.from === "true" && !endedIn.has(`${g.run}\u0000${g.row.projectId}`)) {
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
 * once per project, kind and date (exact wins). A deadline counts as new when it came within 48 hours (its UTC day
 * minus 48 hours), so once marked seen after that it is not shown again.
 */
function deadlineItems(deadlines: DeadlineRow[], since: Date | null, now: Date): Sortable[] {
  const first = utcToday(now);
  const last = utcToday(new Date(now.getTime() + DEADLINE_WINDOW_MS));
  const byKey = new Map<string, Sortable & { item: Extract<ChangeItem, { kind: "deadline" }> }>();
  for (const d of deadlines) {
    if (!(CHANGE_DEADLINE_KINDS as readonly string[]).includes(d.kind) || !isFirmPrecision(d.precision)) continue;
    if (d.date < first || d.date > last) continue;
    const time = Date.parse(`${d.date}T00:00:00Z`) - DEADLINE_WINDOW_MS;
    if (since !== null && since.getTime() >= time) continue;
    const key = `${d.projectId}\u0000${d.kind}\u0000${d.date}`;
    const approximate = d.precision !== "exact";
    const existing = byKey.get(key);
    if (existing) {
      existing.item.approximate &&= approximate;
      continue;
    }
    byKey.set(key, {
      item: {
        kind: "deadline",
        project: d.project,
        deadlineKind: d.kind as ChangeDeadlineKind,
        date: d.date,
        approximate,
        at: new Date(time).toISOString(),
      },
      time,
      seq: 0,
    });
  }
  return [...byKey.values()];
}

/**
 * The feed: the changes (already limited to what the member has not marked seen) and the near deadlines not seen yet,
 * newest first (ties: later seq first), at most `MAX_CHANGE_ITEMS`.
 */
export function buildChangeItems(
  changes: ChangeRow[],
  deadlines: DeadlineRow[],
  since: Date | null,
  now: Date,
): ChangeItem[] {
  return [...changeItems(changes), ...deadlineItems(deadlines, since, now)]
    .sort((a, b) => b.time - a.time || b.seq - a.seq)
    .slice(0, MAX_CHANGE_ITEMS)
    .map((s) => s.item);
}
