// Daily digest builder: pure. Dates are compared as UTC YYYY-MM-DD strings.
import type { DatePrecision, DeadlineKind, RiskLevel, Status } from "../types.js";

export interface DigestProject {
  id: string;
  slug: string;
  name: string;
  status: Status;
  riskLevel: RiskLevel | null;
  firstSeen: Date;
}
export interface DigestInput {
  now: Date;
  /** When the user last got a digest (null = never). The repo selects `changes` after it; not used to filter here. */
  lastDigestAt: Date | null;
  watched: DigestProject[];
  deadlines: { projectId: string; kind: DeadlineKind; date: string; precision: DatePrecision; text: string }[];
  changes: {
    projectId: string;
    field: "status" | "risk_level";
    oldValue: string | null;
    newValue: string;
    changedAt: Date;
  }[];
  newProjects: DigestProject[] | null; // null = user did not opt in
}
export interface Digest {
  deadlinesSoon: {
    project: DigestProject;
    kind: DeadlineKind;
    date: string;
    precision: DatePrecision;
    isToday: boolean;
  }[];
  changes: { project: DigestProject; field: "status" | "risk_level"; oldValue: string | null; newValue: string }[];
  newProjects: DigestProject[];
  priority: 0 | 1 | 2;
}

const DIGEST_KINDS: ReadonlySet<DeadlineKind> = new Set(["claim", "snapshot", "campaign_end", "withdraw_funds"]);
const DIGEST_PRECISIONS: ReadonlySet<DatePrecision> = new Set(["exact", "approximate"]);
const HOUR_MS = 3_600_000;

const utcDate = (d: Date): string => d.toISOString().slice(0, 10);

export function buildDigest(input: DigestInput): Digest | null {
  const { now } = input;
  const watched = new Map(input.watched.map((p) => [p.id, p]));
  const today = utcDate(now);
  const windowEnd = utcDate(new Date(now.getTime() + 48 * HOUR_MS));

  const deadlinesSoon: Digest["deadlinesSoon"] = [];
  for (const d of input.deadlines) {
    const project = watched.get(d.projectId);
    if (!project) continue;
    if (!DIGEST_KINDS.has(d.kind) || !DIGEST_PRECISIONS.has(d.precision)) continue;
    if (!d.date || d.date < today || d.date > windowEnd) continue;
    deadlinesSoon.push({ project, kind: d.kind, date: d.date, precision: d.precision, isToday: d.date === today });
  }

  // A change made in the run that created the project (changedAt <= firstSeen, e.g. its first risk level or a
  // same-run merge) is part of it being new, not a change; any later change is kept.
  const sorted = input.changes
    .filter((c) => {
      const p = watched.get(c.projectId);
      return p !== undefined && c.changedAt.getTime() > p.firstSeen.getTime();
    })
    .sort((x, y) => x.changedAt.getTime() - y.changedAt.getTime());

  // Collapse per (project, field): oldValue of the earliest, newValue of the latest.
  const collapsed = new Map<string, { c: DigestInput["changes"][number]; oldValue: string | null }>();
  for (const c of sorted) {
    const key = `${c.projectId}\u0000${c.field}`;
    const prev = collapsed.get(key);
    // Re-insert so Map order follows the latest change of each group.
    collapsed.delete(key);
    collapsed.set(key, { c, oldValue: prev ? prev.oldValue : c.oldValue });
  }
  const changes: Digest["changes"] = [];
  for (const { c, oldValue } of collapsed.values()) {
    if (oldValue === c.newValue) continue;
    const project = watched.get(c.projectId);
    if (!project) continue;
    changes.push({ project, field: c.field, oldValue, newValue: c.newValue });
  }

  const newProjects = input.newProjects ?? [];
  if (deadlinesSoon.length === 0 && changes.length === 0 && newProjects.length === 0) return null;

  const priority: 0 | 1 | 2 =
    deadlinesSoon.length > 0 ? 0 : changes.some((c) => c.field === "risk_level") ? 1 : 2;
  return { deadlinesSoon, changes, newProjects, priority };
}
