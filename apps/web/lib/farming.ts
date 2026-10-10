// The signed-in member's farming tracker ("Garapan saya", curation spec §14). Every function verifies the user itself
// with requireUser(), filters by that user's id, and relies on RLS ("own farming ...") and the column grants of
// 0010_farming.sql as the other barriers. Checks are written only through toggle_farming_check(), which takes the
// member's local "today" on the server; this module never sends a date.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildHeatmap,
  daysLeft,
  heatmapRange,
  localDay,
  mainProgress,
  streak,
  weeklyDone,
  type DatePrecision,
  type DeadlineKind,
  type HeatmapCell,
  type HeatmapRange,
  type TrackerCheck,
  type TrackerTask,
} from "@saf/core";
import { requireUser } from "./auth";
import { isValidTimezone } from "./settings";
import { isUuid } from "./uuid";

export type Cadence = "once" | "daily" | "weekly";
const CADENCES: readonly Cadence[] = ["once", "daily", "weekly"];

/** Same limits as 0010_farming.sql: the farming_tasks text check and the per-project active task trigger. */
const MAX_TEXT = 200;
const MAX_ACTIVE_TASKS = 30;
/** PostgREST's max_rows (supabase/config.toml): longer reads are paged. */
const PAGE_SIZE = 1000;

/** Why a farming request was refused; anything else is thrown as a plain Error. */
export type FarmingErrorCode = "project_limit" | "task_limit" | "invalid_task" | "not_farming" | "task_inactive";

export const FARMING_ERROR_MESSAGES: Record<FarmingErrorCode, string> = {
  project_limit: "Kamu udah garap 50 project. Berhentiin salah satu dulu sebelum mulai yang baru.",
  task_limit: "Satu project maksimal 30 task aktif. Arsipkan task yang udah gak kamu pakai dulu.",
  invalid_task: "Teks task wajib diisi, maksimal 200 karakter.",
  not_farming: "Kamu lagi gak garap project ini.",
  task_inactive: "Task itu udah diarsipkan, atau project-nya udah berhenti kamu garap. Checklist di bawah udah yang terbaru.",
};

export function isFarmingErrorCode(v: unknown): v is FarmingErrorCode {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(FARMING_ERROR_MESSAGES, v);
}

export class FarmingError extends Error {
  constructor(public readonly code: FarmingErrorCode) {
    super(FARMING_ERROR_MESSAGES[code]);
    this.name = "FarmingError";
  }
}

export interface FarmingTask {
  id: string;
  text: string;
  cadence: Cadence;
  origin: "source" | "custom";
}

export interface FarmingCard {
  projectId: string;
  name: string;
  slug: string;
  /** The member's local day the card was built for (YYYY-MM-DD). */
  today: string;
  /** Earliest exact/approximate deadline of any kind from the member's today on, or null. */
  nextDeadline: { kind: DeadlineKind; date: string; precision: DatePrecision } | null;
  /** Active tasks in checklist order. */
  tasks: FarmingTask[];
  /** Ids of active tasks whose box is ticked now: daily/weekly checked today, once checked at any time. */
  checkedToday: string[];
  range: HeatmapRange;
  heatmap: HeatmapCell[];
  daysLeft: number | null;
  streak: number;
  /** Per active weekly task: checked in the current ISO week. */
  weeklyDone: Record<string, boolean>;
  mainProgress: { done: number; total: number };
}

type DbError = { message: string; code?: string } | null;

function throwIf(error: DbError, what: string): void {
  if (error) throw new Error(`Failed to ${what}: ${error.message}`);
}

function requireUuid(id: unknown, what: string): asserts id is string {
  if (!isUuid(id)) throw new Error(`Invalid ${what} id`);
}

/** Reads every row of a query, PAGE_SIZE rows at a time. The query must have a total order. */
async function fetchAll<Row>(
  what: string,
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: DbError }>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    throwIf(error, what);
    const batch = (data ?? []) as Row[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

/** Trimmed text clipped to MAX_TEXT code points (Postgres char_length), with "…" marking a cut. */
function clip(text: string): string {
  const chars = [...text.trim()];
  return chars.length <= MAX_TEXT ? chars.join("") : `${chars.slice(0, MAX_TEXT - 1).join("")}…`;
}

const textKey = (text: string): string => text.trim().toLowerCase();

/** The member's farming_projects row for the project: null (never farmed), archived or active. */
async function farmingState(db: SupabaseClient, userId: string, projectId: string): Promise<"none" | "archived" | "active"> {
  const { data, error } = await db
    .from("farming_projects")
    .select("archived_at")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .maybeSingle();
  throwIf(error, "read the farming project");
  if (!data) return "none";
  return (data as { archived_at: unknown }).archived_at == null ? "active" : "archived";
}

async function requireActive(db: SupabaseClient, userId: string, projectId: string): Promise<void> {
  if ((await farmingState(db, userId, projectId)) !== "active") throw new FarmingError("not_farming");
}

/**
 * The project's steps as the source gives them (once, daily and weekly), grouped by document in step order, with
 * texts clipped and case-insensitive duplicates dropped (first one wins). The text is `tasks.description` until
 * Plan 5 adds the translated `text_id`.
 */
async function sourceSteps(db: SupabaseClient, projectId: string): Promise<{ text: string; cadence: Cadence }[]> {
  const { data, error } = await db
    .from("tasks")
    .select("description, cadence")
    .eq("project_id", projectId)
    .in("cadence", [...CADENCES])
    .order("document_id")
    .order("position");
  throwIf(error, "read the source steps");
  const seen = new Set<string>();
  const steps: { text: string; cadence: Cadence }[] = [];
  for (const row of (data ?? []) as { description: unknown; cadence: unknown }[]) {
    const text = clip(String(row.description ?? ""));
    const cadence = row.cadence as Cadence;
    if (text === "" || !CADENCES.includes(cadence) || seen.has(textKey(text))) continue;
    seen.add(textKey(text));
    steps.push({ text, cadence });
  }
  return steps;
}

interface ActiveTask {
  id: string;
  text: string;
  origin: string;
  position: number;
}

async function activeTasks(db: SupabaseClient, userId: string, projectId: string): Promise<ActiveTask[]> {
  const { data, error } = await db
    .from("farming_tasks")
    .select("id, text, origin, position")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .is("archived_at", null);
  throwIf(error, "read the farming tasks");
  return ((data ?? []) as ActiveTask[]).map((t) => ({ ...t, position: Number(t.position) }));
}

const nextPosition = (tasks: ActiveTask[]): number => tasks.reduce((max, t) => Math.max(max, t.position + 1), 0);

async function insertTasks(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  items: { text: string; cadence: Cadence }[],
  origin: "source" | "custom",
  firstPosition: number,
): Promise<void> {
  if (items.length === 0) return;
  const { error } = await db.from("farming_tasks").insert(
    items.map((item, i) => ({
      user_id: userId,
      project_id: projectId,
      text: item.text,
      cadence: item.cadence,
      origin,
      position: firstPosition + i,
    })),
  );
  if (error?.code === "23514") throw new FarmingError("task_limit");
  throwIf(error, "add the farming tasks");
}

/**
 * Brings the active checklist of a farmed project in line with the source: source steps whose text no active task
 * has are appended (up to the active task limit), and, with `archiveMissing`, active source tasks whose text the
 * source no longer has are archived first. Custom tasks are never archived here.
 */
async function syncSourceSteps(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  archiveMissing: boolean,
): Promise<{ added: number; archived: number }> {
  const [steps, active] = await Promise.all([sourceSteps(db, projectId), activeTasks(db, userId, projectId)]);
  const sourceKeys = new Set(steps.map((s) => textKey(s.text)));
  const gone = archiveMissing ? active.filter((t) => t.origin === "source" && !sourceKeys.has(textKey(t.text))) : [];
  if (gone.length > 0) {
    const { error } = await db
      .from("farming_tasks")
      .update({ archived_at: new Date().toISOString() })
      .eq("user_id", userId)
      .in("id", gone.map((t) => t.id))
      .is("archived_at", null);
    throwIf(error, "archive the farming tasks");
  }
  const kept = active.filter((t) => !gone.includes(t));
  const keptKeys = new Set(kept.map((t) => textKey(t.text)));
  const fresh = steps.filter((s) => !keptKeys.has(textKey(s.text))).slice(0, Math.max(0, MAX_ACTIVE_TASKS - kept.length));
  await insertTasks(db, userId, projectId, fresh, "source", nextPosition(kept));
  return { added: fresh.length, archived: gone.length };
}

/**
 * "Mulai garap". Not an upsert: the column grants allow inserting (user_id, project_id) and updating archived_at only.
 * No row: insert it (a duplicate key means another tab just did, which counts as success). Archived: resume it.
 * Active: nothing changes. The call that created or resumed the row then copies the source steps the active
 * checklist does not have yet; resuming comes first because tasks cannot be added to a stopped project.
 * The 50-active-projects limit is thrown as FarmingError "project_limit".
 */
export async function startFarming(db: SupabaseClient, projectId: string): Promise<void> {
  const user = await requireUser();
  requireUuid(projectId, "project");
  const state = await farmingState(db, user.id, projectId);
  if (state === "active") return;

  if (state === "none") {
    const { error } = await db.from("farming_projects").insert({ user_id: user.id, project_id: projectId });
    if (error?.code === "23505") return;
    if (error?.code === "23514") throw new FarmingError("project_limit");
    throwIf(error, "start farming");
  } else {
    const { data, error } = await db
      .from("farming_projects")
      .update({ archived_at: null })
      .eq("user_id", user.id)
      .eq("project_id", projectId)
      .not("archived_at", "is", null)
      .select("project_id");
    if (error?.code === "23514") throw new FarmingError("project_limit");
    throwIf(error, "resume farming");
    // Nothing updated: another tab resumed it a moment ago and copies the steps itself.
    if (!Array.isArray(data) || data.length === 0) return;
  }
  await syncSourceSteps(db, user.id, projectId, false);
}

/** "Berhenti garap": archives the farming project. Tasks and checks stay for the history. */
export async function stopFarming(db: SupabaseClient, projectId: string): Promise<void> {
  const user = await requireUser();
  requireUuid(projectId, "project");
  const { error } = await db
    .from("farming_projects")
    .update({ archived_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("project_id", projectId)
    .is("archived_at", null);
  throwIf(error, "stop farming");
}

/** Adds the member's own task at the end of the checklist. Text is trimmed; 1 to 200 characters. */
export async function addCustomTask(db: SupabaseClient, projectId: string, text: string, cadence: Cadence): Promise<void> {
  const user = await requireUser();
  requireUuid(projectId, "project");
  const trimmed = typeof text === "string" ? text.trim() : "";
  const length = [...trimmed].length;
  if (length === 0 || length > MAX_TEXT || !CADENCES.includes(cadence)) throw new FarmingError("invalid_task");
  await requireActive(db, user.id, projectId);
  const active = await activeTasks(db, user.id, projectId);
  await insertTasks(db, user.id, projectId, [{ text: trimmed, cadence }], "custom", nextPosition(active));
}

/** Archives one task. Its past checks stay, so earlier heatmap days do not change. */
export async function archiveTask(db: SupabaseClient, taskId: string): Promise<void> {
  const user = await requireUser();
  requireUuid(taskId, "task");
  const { error } = await db
    .from("farming_tasks")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", taskId)
    .eq("user_id", user.id)
    .is("archived_at", null);
  throwIf(error, "archive the farming task");
}

/** "Ambil ulang step dari source": adds new source steps and archives source tasks the source dropped. */
export async function refreshFromSource(db: SupabaseClient, projectId: string): Promise<{ added: number; archived: number }> {
  const user = await requireUser();
  requireUuid(projectId, "project");
  await requireActive(db, user.id, projectId);
  return syncSourceSteps(db, user.id, projectId, true);
}

/**
 * Checks (`done`) or unchecks a task for the member's today through toggle_farming_check(), and returns the state it
 * set. For a weekly task that is today's box only: whether the week is done comes from the stored checks. A task
 * archived, or a project stopped, in another tab (22023) is refused as FarmingError "task_inactive".
 */
export async function setCheck(db: SupabaseClient, taskId: string, done: boolean): Promise<boolean> {
  await requireUser();
  requireUuid(taskId, "task");
  const { data, error } = await db.rpc("toggle_farming_check", { p_task_id: taskId, p_done: done });
  if (error?.code === "22023") throw new FarmingError("task_inactive");
  throwIf(error, "update the check");
  return data === true;
}

/** Whether the member is farming the project now (an archived row does not count). */
export async function isFarming(db: SupabaseClient, projectId: string): Promise<boolean> {
  const user = await requireUser();
  requireUuid(projectId, "project");
  return (await farmingState(db, user.id, projectId)) === "active";
}

interface ProjectRow {
  project_id: string;
  started_at: string;
  projects: { name: unknown; slug: unknown } | null;
}
interface TaskRow {
  id: string;
  project_id: string;
  text: string;
  cadence: Cadence;
  origin: "source" | "custom";
  position: number;
  created_at: string;
  archived_at: string | null;
}
interface DeadlineRow {
  project_id: string;
  kind: DeadlineKind;
  date: string | null;
  precision: DatePrecision;
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(key(row)) ?? [];
    list.push(row);
    map.set(key(row), list);
  }
  return map;
}

/**
 * One card per project the member is farming now, oldest start first. Days are the member's local dates in
 * profiles.timezone (UTC when unset). `endedOn` is not known yet (curations come with Plan 5), so it is null.
 */
export async function getFarmingBoard(db: SupabaseClient, now: Date): Promise<FarmingCard[]> {
  const user = await requireUser();
  const [profile, farmed] = await Promise.all([
    db.from("profiles").select("timezone").eq("user_id", user.id).maybeSingle(),
    db
      .from("farming_projects")
      .select("project_id, started_at, projects(name, slug)")
      .eq("user_id", user.id)
      .is("archived_at", null)
      .order("started_at")
      .order("project_id"),
  ]);
  throwIf(profile.error, "load the time zone");
  throwIf(farmed.error, "load the farming projects");
  const projects = ((farmed.data ?? []) as unknown as ProjectRow[]).filter((p) => p.projects != null);
  if (projects.length === 0) return [];

  const zone = (profile.data as { timezone?: unknown } | null)?.timezone;
  const timeZone = isValidTimezone(zone) ? zone : "UTC";
  const dayOf = (timestamp: string): string => localDay(new Date(timestamp), timeZone);
  const today = localDay(now, timeZone);
  const ids = projects.map((p) => p.project_id);

  const [tasks, checks, deadlines] = await Promise.all([
    fetchAll<TaskRow>("load the farming tasks", (from, to) =>
      db
        .from("farming_tasks")
        .select("id, project_id, text, cadence, origin, position, created_at, archived_at")
        .eq("user_id", user.id)
        .in("project_id", ids)
        .order("id")
        .range(from, to),
    ),
    fetchAll<{ task_id: string; day: string }>("load the farming checks", (from, to) =>
      db
        .from("farming_checks")
        .select("task_id, day, farming_tasks!inner(project_id)")
        .eq("user_id", user.id)
        .in("farming_tasks.project_id", ids)
        .order("task_id")
        .order("day")
        .range(from, to),
    ),
    fetchAll<DeadlineRow>("load the deadlines", (from, to) =>
      db.from("deadlines").select("project_id, kind, date, precision").in("project_id", ids).order("id").range(from, to),
    ),
  ]);

  const tasksByProject = groupBy(tasks, (t) => t.project_id);
  const projectOfTask = new Map(tasks.map((t) => [t.id, t.project_id]));
  const checksByProject = groupBy(
    checks.filter((c) => projectOfTask.has(c.task_id)),
    (c) => projectOfTask.get(c.task_id)!,
  );
  const deadlinesByProject = groupBy(deadlines, (d) => d.project_id);

  return projects.map((p): FarmingCard => {
    const rows = tasksByProject.get(p.project_id) ?? [];
    const trackerTasks: TrackerTask[] = rows.map((t) => ({
      id: t.id,
      cadence: t.cadence,
      createdDay: dayOf(t.created_at),
      archivedDay: t.archived_at === null ? null : dayOf(t.archived_at),
    }));
    const trackerChecks: TrackerCheck[] = (checksByProject.get(p.project_id) ?? []).map((c) => ({ taskId: c.task_id, day: c.day }));
    const projectDeadlines = deadlinesByProject.get(p.project_id) ?? [];

    const range = heatmapRange(dayOf(p.started_at), projectDeadlines, today, null);
    const heatmap = buildHeatmap(trackerTasks, trackerChecks, range, today);
    const active = rows
      .filter((t) => t.archived_at === null)
      .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    const onceIds = new Set(rows.filter((t) => t.cadence === "once").map((t) => t.id));
    const ticked = new Set(trackerChecks.filter((c) => c.day === today || onceIds.has(c.taskId)).map((c) => c.taskId));
    const upcoming = projectDeadlines
      .filter((d) => d.date !== null && d.date >= today && (d.precision === "exact" || d.precision === "approximate"))
      .sort((a, b) => a.date!.localeCompare(b.date!))[0];

    return {
      projectId: p.project_id,
      name: String(p.projects!.name),
      slug: String(p.projects!.slug),
      today,
      nextDeadline: upcoming ? { kind: upcoming.kind, date: upcoming.date!, precision: upcoming.precision } : null,
      tasks: active.map((t) => ({ id: t.id, text: t.text, cadence: t.cadence, origin: t.origin })),
      checkedToday: active.filter((t) => ticked.has(t.id)).map((t) => t.id),
      range,
      heatmap,
      daysLeft: daysLeft(range, today),
      streak: streak(trackerTasks, trackerChecks, today),
      weeklyDone: weeklyDone(trackerTasks, trackerChecks, today),
      mainProgress: mainProgress(trackerTasks, trackerChecks),
    };
  });
}
