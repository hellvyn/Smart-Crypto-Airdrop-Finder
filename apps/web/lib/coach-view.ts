// What the /coach page reads about a member's own threads and about the projects a plan names (spec §5.2, §5.4,
// §5.5). Member session only: `curated_list` is member-only, and the thread tables are visible to their owner through
// RLS. Nothing here is written, and nothing is logged.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RiskLevel } from "@saf/core";
import type { PlanRecommendation } from "./coach-client";
import { notCuratedReason, RISK_LEVELS, LOGO_SOURCES, type Capital, type LogoSource } from "./view";
import { coach } from "./copy";
import { isUuid } from "./uuid";

const THREAD_DAYS = 30;
const DAY_MS = 86_400_000;
const THREAD_LIMIT = 100;

function throwIf(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`Failed to load ${what}: ${error.message}`);
}

/** What a plan card needs to look like a list card: the logo, the risk and the capital tag. */
export interface PlanCardInfo {
  id: string;
  slug: string;
  name: string;
  riskLevel: RiskLevel | null;
  capital: Capital;
  capitalMinUsd: number | null;
  logoSource: LogoSource | null;
}

function asCapitalMin(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

/** The card info of `ids` that are on the member's curated list now. A project that left the list is just absent. */
export async function getPlanCards(db: SupabaseClient, ids: string[]): Promise<PlanCardInfo[]> {
  const wanted = [...new Set(ids.filter(isUuid))].slice(0, 25);
  if (wanted.length === 0) return [];
  const { data, error } = await db
    .from("curated_list")
    .select("id, slug, name, latest_risk_level, capital, capital_min_usd, logo_source")
    .in("id", wanted);
  throwIf(error, "the plan cards");
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    slug: String(r.slug),
    name: String(r.name),
    riskLevel: (RISK_LEVELS as readonly unknown[]).includes(r.latest_risk_level) ? (r.latest_risk_level as RiskLevel) : null,
    capital: r.capital === "free" || r.capital === "deposit" ? r.capital : "unknown",
    capitalMinUsd: asCapitalMin(r.capital_min_usd),
    logoSource: (LOGO_SOURCES as readonly unknown[]).includes(r.logo_source) ? (r.logo_source as LogoSource) : null,
  }));
}

// ---- Threads ----

export interface ThreadRow {
  id: string;
  createdAt: string;
  /** "Rencana garapan", "Percakapan" or the project's name, resolved by the list. */
  kind: "plan" | "chat" | "project";
  projectName: string | null;
}

/** The member's threads of the last 30 days, newest first. */
export async function listThreads(db: SupabaseClient, now: Date): Promise<ThreadRow[]> {
  const since = new Date(now.getTime() - THREAD_DAYS * DAY_MS).toISOString();
  const { data, error } = await db
    .from("coach_threads")
    .select("id, project_id, plan, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(THREAD_LIMIT);
  throwIf(error, "the coach threads");
  const rows = (data ?? []) as unknown as { id: string; project_id: string | null; plan: unknown; created_at: string }[];
  const projectIds = [...new Set(rows.map((r) => r.project_id).filter((id): id is string => id !== null))];
  const names = new Map<string, string>();
  if (projectIds.length > 0) {
    const projects = await db.from("projects").select("id, name").in("id", projectIds);
    throwIf(projects.error, "the thread projects");
    for (const p of (projects.data ?? []) as unknown as { id: string; name: string }[]) names.set(p.id, p.name);
  }
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    kind: r.project_id !== null ? "project" : r.plan !== null ? "plan" : "chat",
    projectName: r.project_id !== null ? (names.get(r.project_id) ?? null) : null,
  }));
}

export interface ThreadView {
  id: string;
  projectId: string | null;
  recommendations: PlanRecommendation[];
  /** Earlier answered chat turns, oldest first. */
  messages: { role: "user" | "assistant"; text: string }[];
}

function asRecommendations(plan: unknown): PlanRecommendation[] {
  const list = (plan as { recommendations?: unknown } | null)?.recommendations;
  return Array.isArray(list) ? (list as PlanRecommendation[]) : [];
}

/** One of the member's threads with its stored plan and its answered chat turns, or null when it is not theirs. */
export async function getThread(db: SupabaseClient, threadId: string): Promise<ThreadView | null> {
  if (!isUuid(threadId)) return null;
  const thread = await db.from("coach_threads").select("id, project_id, plan").eq("id", threadId).maybeSingle();
  throwIf(thread.error, "the thread");
  if (thread.data == null) return null;
  const row = thread.data as unknown as { id: string; project_id: string | null; plan: unknown };
  const messages = await db
    .from("coach_messages")
    .select("id, role, kind, reply_to, content, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(200);
  throwIf(messages.error, "the thread messages");
  // The newest 200 rows, back in order: reopening an old thread shows its latest answers, not its first ones.
  const all = ((messages.data ?? []) as unknown as { id: string; role: string; kind: string; reply_to: string | null; content: string }[]).reverse();
  const answered = new Set(all.filter((m) => m.role === "assistant" && m.reply_to).map((m) => m.reply_to));
  const chatIds = new Set(all.filter((m) => m.role === "user" && m.kind === "chat" && answered.has(m.id)).map((m) => m.id));
  return {
    id: row.id,
    projectId: row.project_id,
    recommendations: asRecommendations(row.plan),
    messages: all
      .filter((m) => (m.role === "user" ? chatIds.has(m.id) : m.reply_to !== null && chatIds.has(m.reply_to)))
      .map((m) => ({ role: m.role as "user" | "assistant", text: m.content })),
  };
}

// ---- "Tanya AI" on a project ----

export type ProjectGate =
  | { state: "ok"; id: string; name: string; slug: string }
  | { state: "not_listed"; name: string; slug: string; reason: string }
  | { state: "missing" };

/**
 * Whether the Coach may talk about a project: it must be on the member's list now (latest curation passed, tab Live
 * sekarang or Early). Otherwise the page shows the public reason from the curation data (spec §5.4), and nothing is
 * sent to a model. The reason is `public_fail_reason`, never the member-only `reasons`.
 */
export async function getProjectGate(db: SupabaseClient, projectId: string): Promise<ProjectGate> {
  if (!isUuid(projectId)) return { state: "missing" };
  const listed = await db
    .from("curated_list")
    .select("id, slug, name")
    .eq("id", projectId)
    .in("tab", ["live_now", "early_bets"])
    .maybeSingle();
  throwIf(listed.error, "the project");
  if (listed.data != null) {
    const r = listed.data as unknown as { id: string; slug: string; name: string };
    return { state: "ok", id: r.id, name: r.name, slug: r.slug };
  }
  const project = await db.from("projects").select("slug, name").eq("id", projectId).maybeSingle();
  throwIf(project.error, "the project");
  if (project.data == null) return { state: "missing" };
  const curation = await db
    .from("curations")
    .select("passed, public_fail_reason")
    .eq("project_id", projectId)
    .order("computed_at", { ascending: false })
    .order("seq", { ascending: false })
    .limit(1);
  throwIf(curation.error, "the curation");
  const c = ((curation.data ?? []) as unknown as { passed: boolean; public_fail_reason: string | null }[])[0];
  const p = project.data as unknown as { slug: string; name: string };
  const reason = notCuratedReason(c ? { passed: c.passed === true, publicFailReason: c.public_fail_reason ?? null } : null);
  // A project that passed and then ended has no failure to explain: say that it is not on the list now.
  return { state: "not_listed", name: p.name, slug: p.slug, reason: reason ?? coach.project.endedReason };
}
