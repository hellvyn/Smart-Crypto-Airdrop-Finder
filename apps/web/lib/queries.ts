// Read-only queries for the public pages. They use the anon client (or the signed-in user's session) and rely on the
// "public read" RLS policies; documents and extractions are not readable here and are never queried.
import type { RiskCheck, RiskLevel, RiskReason, Severity, Status } from "@saf/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  RISK_LEVELS,
  STATUSES,
  pickLastSuccessfulRun,
  pickLatestRisk,
  PAGE_SIZE,
  parseChain,
  pickNextDeadline,
  utcToday,
  type ListFilters,
  type ProjectDetail,
  type ProjectListItem,
} from "./view";

export type { ListFilters, ProjectDetail, ProjectListItem } from "./view";

const SEVERITIES: readonly string[] = ["critical", "high", "medium", "info"];
const DEADLINE_KINDS: readonly string[] = ["claim", "snapshot", "campaign_end", "withdraw_funds", "tge", "other"];
const PRECISIONS: readonly string[] = ["exact", "approximate", "month", "quarter"];

function asStatus(v: unknown): Status {
  return STATUSES.includes(v as Status) ? (v as Status) : "unknown";
}

function asRiskLevel(v: unknown): RiskLevel | null {
  return RISK_LEVELS.includes(v as RiskLevel) ? (v as RiskLevel) : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asReasons(v: unknown): RiskReason[] {
  if (!Array.isArray(v)) return [];
  const out: RiskReason[] = [];
  for (const r of v) {
    if (!isRecord(r) || typeof r.message !== "string") continue;
    out.push({
      code: typeof r.code === "string" ? r.code : "",
      severity: (SEVERITIES.includes(String(r.severity)) ? r.severity : "info") as Severity,
      message: r.message,
      source: typeof r.source === "string" ? r.source : "",
    });
  }
  return out;
}

function asChecks(v: unknown): RiskCheck[] {
  if (!Array.isArray(v)) return [];
  const out: RiskCheck[] = [];
  for (const c of v) {
    if (isRecord(c) && typeof c.id === "string") out.push({ id: c.id as RiskCheck["id"], ran: c.ran === true });
  }
  return out;
}

function throwIf(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`Failed to load ${what}: ${error.message}`);
}

export interface ProjectPage {
  items: ProjectListItem[];
  /** Number of projects matching the filters, across all pages. */
  total: number;
  page: number;
  pageSize: number;
}

export const LIST_COLUMNS =
  "id, slug, name, status, chains, last_seen, " +
  "next_deadline_date, next_deadline_kind, next_deadline_precision, latest_risk_level";

// Filters, ordering and paging all run in SQL against the `project_list` view (migration 0003), so the list never
// depends on PostgREST's row cap. Order: nearest firm deadline (nulls last), newest last_seen, then id.
interface Filterable {
  in(column: string, values: string[]): Filterable;
  contains(column: string, value: string): Filterable;
}

function applyFilters<T>(query: T, f: ListFilters): T {
  let q = query as unknown as Filterable;
  if (f.status && f.status.length > 0) q = q.in("status", f.status);
  if (f.risk && f.risk.length > 0) q = q.in("latest_risk_level", f.risk);
  // Re-validated here, and sent as a quoted array literal: postgrest-js would otherwise build `cs.{value}` unquoted.
  const chain = parseChain(f.chain);
  if (chain) q = q.contains("chains_lower", `{"${chain.replace(/[\\"]/g, "\\$&")}"}`);
  return q as unknown as T;
}

export function toListItem(row: Record<string, unknown>): ProjectListItem {
  return {
    slug: String(row.slug),
    name: String(row.name),
    status: asStatus(row.status),
    riskLevel: asRiskLevel(row.latest_risk_level),
    chains: Array.isArray(row.chains) ? (row.chains as unknown[]).map(String) : [],
    nextDeadline:
      typeof row.next_deadline_date === "string"
        ? {
            date: row.next_deadline_date,
            kind: String(row.next_deadline_kind),
            precision: String(row.next_deadline_precision),
          }
        : null,
    lastSeen: String(row.last_seen),
  };
}

export async function listProjects(db: SupabaseClient, f: ListFilters = {}, page = 1): Promise<ProjectPage> {
  const from = (page - 1) * PAGE_SIZE;
  const { data, error, count } = await applyFilters(db.from("project_list").select(LIST_COLUMNS, { count: "exact" }), f)
    .order("next_deadline_date", { ascending: true, nullsFirst: false })
    .order("last_seen", { ascending: false })
    .order("id", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);
  if (error?.code === "PGRST103") {
    // The page is past the end. Report the real total so the page can link back to the last page.
    const head = await applyFilters(db.from("project_list").select("id", { count: "exact", head: true }), f);
    throwIf(head.error, "projects");
    return { items: [], total: head.count ?? 0, page, pageSize: PAGE_SIZE };
  }
  throwIf(error, "projects");
  return {
    items: ((data ?? []) as unknown as Record<string, unknown>[]).map(toListItem),
    total: count ?? 0,
    page,
    pageSize: PAGE_SIZE,
  };
}

/** Distinct lowercase chain names across all projects, for the chain filter. */
export async function listChains(db: SupabaseClient): Promise<string[]> {
  const { data, error } = await db.from("project_chains").select("chain").order("chain", { ascending: true });
  throwIf(error, "chains");
  return ((data ?? []) as { chain: unknown }[]).map((r) => String(r.chain));
}

export async function getProjectDetail(db: SupabaseClient, slug: string, now: Date = new Date()): Promise<ProjectDetail | null> {
  const { data: p, error } = await db
    .from("projects")
    .select("id, slug, name, status, chains, last_seen, token_symbol, conflict")
    .eq("slug", slug)
    .maybeSingle();
  throwIf(error, "project");
  if (!p) return null;
  const id = p.id as string;

  const [risks, deadlines, tasks, links, evidence] = await Promise.all([
    db.from("risk_assessments").select("level, reasons, checks, computed_at, seq").eq("project_id", id)
      .order("computed_at", { ascending: false }).order("seq", { ascending: false }).limit(5),
    db.from("deadlines").select("kind, date, precision, text").eq("project_id", id),
    db.from("tasks").select("description").eq("project_id", id),
    db.from("links").select("url, kind").eq("project_id", id),
    db.from("evidence").select("field, value, quote, source_url, at, seq").eq("project_id", id)
      .order("at", { ascending: false }).order("seq", { ascending: false }).limit(100),
  ]);
  throwIf(risks.error, "risk");
  throwIf(deadlines.error, "deadlines");
  throwIf(tasks.error, "tasks");
  throwIf(links.error, "links");
  throwIf(evidence.error, "evidence");

  const latest = pickLatestRisk(
    (risks.data ?? []).map((r) => ({
      level: r.level as unknown,
      reasons: r.reasons as unknown,
      checks: r.checks as unknown,
      computedAt: String(r.computed_at),
      seq: Number(r.seq),
    })),
  );
  const riskLevel = latest ? asRiskLevel(latest.level) : null;

  const deadlineRows = (deadlines.data ?? []).map((d) => ({
    kind: (DEADLINE_KINDS.includes(String(d.kind)) ? d.kind : "other") as ProjectDetail["deadlines"][number]["kind"],
    date: typeof d.date === "string" ? d.date : null,
    precision: (PRECISIONS.includes(String(d.precision)) ? d.precision : "quarter") as ProjectDetail["deadlines"][number]["precision"],
    text: typeof d.text === "string" ? d.text : "",
  }));
  deadlineRows.sort((a, b) => (a.date ?? "9999-12-31").localeCompare(b.date ?? "9999-12-31"));

  return {
    id,
    slug: String(p.slug),
    name: String(p.name),
    status: asStatus(p.status),
    riskLevel,
    chains: Array.isArray(p.chains) ? (p.chains as unknown[]).map(String) : [],
    nextDeadline: pickNextDeadline(deadlineRows, utcToday(now)),
    lastSeen: String(p.last_seen),
    tokenSymbol: typeof p.token_symbol === "string" ? p.token_symbol : null,
    conflict: p.conflict === true,
    risk:
      latest && riskLevel
        ? { level: riskLevel, reasons: asReasons(latest.reasons), checks: asChecks(latest.checks), computedAt: latest.computedAt }
        : null,
    deadlines: deadlineRows,
    tasks: (tasks.data ?? []).map((t) => String(t.description)),
    links: (links.data ?? []).map((l) => ({ url: String(l.url), kind: String(l.kind) })),
    evidence: (evidence.data ?? []).map((e) => ({
      field: String(e.field),
      value: String(e.value),
      quote: String(e.quote),
      sourceUrl: String(e.source_url),
      at: String(e.at),
    })),
  };
}

/** Finish time of the latest successful pipeline run (finished, with no `run_error` key in its stats), or null.
 * SQL drops rows without the key; the JS check also drops a key present with a null value. */
export async function getLastSuccessfulRunAt(db: SupabaseClient): Promise<Date | null> {
  const { data, error } = await db
    .from("pipeline_runs")
    .select("finished_at, stats")
    .not("finished_at", "is", null)
    .is("stats->>run_error", null)
    .order("finished_at", { ascending: false })
    .limit(10);
  throwIf(error, "pipeline runs");
  return pickLastSuccessfulRun(
    (data ?? []).map((r) => ({ finishedAt: (r.finished_at as string | null) ?? null, stats: r.stats as unknown })),
  );
}
