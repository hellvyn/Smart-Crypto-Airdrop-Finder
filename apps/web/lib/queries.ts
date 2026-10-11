// Read-only queries for the public pages. They use the anon client (or the signed-in user's session) and rely on the
// "public read" RLS policies; documents and extractions are not readable here and are never queried.
import type { RiskCheck, RiskLevel, RiskReason, Severity, Status } from "@saf/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import {
  RISK_LEVELS,
  SIGNAL_KINDS,
  STATUSES,
  WORTH_LEVELS,
  pickLastSuccessfulRunWithStats,
  pickLatestRisk,
  PAGE_SIZE,
  parseChain,
  parseTab,
  pickNextDeadline,
  utcToday,
  type Capital,
  type CapitalFilter,
  type CuratedFilters,
  type CuratedItem,
  type CuratedSignal,
  type ListFilters,
  type ProjectDetail,
  type ProjectListItem,
  type Tab,
  type WorthLevel,
} from "./view";

export type { CuratedFilters, CuratedItem, ListFilters, ProjectDetail, ProjectListItem } from "./view";

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
  eq(column: string, value: string): Filterable;
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

// ---- Curated list (Plan 6; curation spec §4.5, §7.1, §15.5) ----

export interface CuratedPage {
  items: CuratedItem[];
  /** Projects matching the tab and every filter (the capital one included), across all pages. */
  total: number;
  page: number;
  pageSize: number;
  /** Per "Modal:" option: projects in the same tab after the other filters, before the capital filter (#52). */
  capitalCounts: { all: number; free: number; deposit: number };
}

const CURATED_COLUMNS =
  `${LIST_COLUMNS}, tab, ended_on, checked_at, signals, claim_open_checked, capital, capital_min_usd, key_checks_ran`;
const CAPITALS: readonly Capital[] = ["free", "deposit", "unknown"];

function asSignals(v: unknown): CuratedSignal[] {
  if (!Array.isArray(v)) return [];
  const out: CuratedSignal[] = [];
  for (const s of v) {
    if (!isRecord(s) || !(SIGNAL_KINDS as readonly unknown[]).includes(s.kind) || !isRecord(s.value)) continue;
    out.push({
      kind: s.kind as CuratedSignal["kind"],
      value: s.value,
      verified: s.verified === true,
      source: String(s.source),
      observedAt: String(s.observed_at),
    });
  }
  return out;
}

function asNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

/** A `public_list` / `curated_list` row. `worthLevel` is read only for members. */
export function toCuratedItem(row: Record<string, unknown>, member: boolean): CuratedItem {
  return {
    ...toListItem(row),
    tab: parseTab(typeof row.tab === "string" ? row.tab : undefined),
    endedOn: typeof row.ended_on === "string" ? row.ended_on : null,
    checkedAt: String(row.checked_at),
    signals: asSignals(row.signals),
    claimOpenChecked: row.claim_open_checked === true,
    capital: CAPITALS.includes(row.capital as Capital) ? (row.capital as Capital) : "unknown",
    capitalMinUsd: asNumber(row.capital_min_usd),
    keyChecksRan: Math.min(4, Math.max(0, Math.trunc(asNumber(row.key_checks_ran) ?? 0))),
    worthLevel: member && WORTH_LEVELS.includes(row.worth_level as WorthLevel) ? (row.worth_level as WorthLevel) : null,
  };
}

/**
 * One page of the curated list (spec §7.1). Visitors read `public_list` (no worth anywhere: the `worth` filter is
 * ignored and the order is "Baru dicek": newest check, then name). Members read `curated_list`, ordered "Paling worth
 * it": worth (high first), strongest signal (VC, TVL, CoinGecko, curated source), nearest deadline, newest last_seen.
 * The ended tab is "Baru ended" for both: newest ended date, then name, with no age limit (#40). Filters, order and
 * paging run in SQL; ties end on id so pages never overlap.
 */
export async function listCurated(
  db: SupabaseClient,
  tab: Tab,
  f: CuratedFilters,
  page: number,
  member: boolean,
): Promise<CuratedPage> {
  const view = member ? "curated_list" : "public_list";
  const filtered = <T>(query: T): T => {
    let q = applyFilters(query, f) as unknown as Filterable;
    q = q.eq("tab", tab);
    if (member && f.worth && f.worth.length > 0) q = q.in("worth_level", f.worth);
    return q as unknown as T;
  };
  const count = async (capital: CapitalFilter): Promise<number> => {
    let q = filtered(db.from(view).select("id", { count: "exact", head: true }));
    if (capital !== "all") q = q.eq("capital", capital);
    const { error, count: n } = await q;
    throwIf(error, "curated projects");
    return n ?? 0;
  };

  const capital = f.capital ?? "all";
  let q = filtered(db.from(view).select(member ? `${CURATED_COLUMNS}, worth_level` : CURATED_COLUMNS));
  if (capital !== "all") q = q.eq("capital", capital);
  if (tab === "ended") {
    q = q.order("ended_on", { ascending: false, nullsFirst: false }).order("name", { ascending: true });
  } else if (member) {
    q = q
      .order("worth_rank", { ascending: true, nullsFirst: false })
      .order("signal_rank", { ascending: true, nullsFirst: false })
      .order("next_deadline_date", { ascending: true, nullsFirst: false })
      .order("last_seen", { ascending: false });
  } else {
    q = q.order("checked_at", { ascending: false }).order("name", { ascending: true });
  }
  const from = (page - 1) * PAGE_SIZE;
  const [result, all, free, deposit] = await Promise.all([
    q.order("id", { ascending: true }).range(from, from + PAGE_SIZE - 1),
    count("all"),
    count("free"),
    count("deposit"),
  ]);
  const capitalCounts = { all, free, deposit };
  // PGRST103: the page is past the end; the counts still give the real total so the page can link back.
  if (result.error?.code !== "PGRST103") throwIf(result.error, "curated projects");
  const rows = result.error ? [] : ((result.data ?? []) as unknown as Record<string, unknown>[]);
  return {
    items: rows.map((row) => toCuratedItem(row, member)),
    total: capitalCounts[capital],
    page,
    pageSize: PAGE_SIZE,
    capitalCounts,
  };
}

/**
 * Distinct trimmed, lowercase chain names across all projects, for the chain filter. Only names `parseChain` accepts
 * unchanged are listed: any other option (e.g. "bnb chain (bsc)") would silently apply no filter when picked.
 */
export async function listChains(db: SupabaseClient): Promise<string[]> {
  const { data, error } = await db.from("project_chains").select("chain").order("chain", { ascending: true });
  throwIf(error, "chains");
  return ((data ?? []) as { chain: unknown }[])
    .map((r) => String(r.chain))
    .filter((chain) => parseChain(chain) === chain);
}

/**
 * The pipeline's v3 extraction facts (`FACT_FIELDS` in `pipeline/src/store/repo.ts`: these four plus every
 * `key_parameter:*` and `source_rating:*`) are unverified, and a claimed backer must carry the spec's fixed wording
 * ("Diklaim project, belum terverifikasi"). Until the project page gives them their own section (Plan 6), they are
 * left out of the evidence query, so they neither show up as generic evidence nor take rows from its window.
 */
const HIDDEN_FACT_FIELDS = ["claimed_backer", "capital_required", "capital_min_usd", "latest_update"];

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
      .not("field", "in", `(${HIDDEN_FACT_FIELDS.join(",")})`)
      .not("field", "like", "key_parameter:*")
      .not("field", "like", "source_rating:*")
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

/**
 * The latest successful pipeline run (finished, with no `run_error` key in its stats): finish time and stats.
 * SQL drops rows without the key; the JS check also drops a key present with a null value. Cached per request and per
 * client (React `cache`), so a page that shows the stale banner, the run summary and the track record reads it once.
 */
type SuccessfulRun = { at: Date; stats: Record<string, unknown> };

const getLastSuccessfulRun = cache(async (db: SupabaseClient): Promise<SuccessfulRun | null> => {
  const { data, error } = await db
    .from("pipeline_runs")
    .select("finished_at, stats")
    .not("finished_at", "is", null)
    .is("stats->>run_error", null)
    .order("finished_at", { ascending: false })
    .limit(10);
  throwIf(error, "pipeline runs");
  return pickLastSuccessfulRunWithStats(
    (data ?? []).map((r) => ({ finishedAt: (r.finished_at as string | null) ?? null, stats: r.stats as unknown })),
  );
});

/** Finish time of the latest successful pipeline run, or null. */
export async function getLastSuccessfulRunAt(db: SupabaseClient): Promise<Date | null> {
  return (await getLastSuccessfulRun(db))?.at ?? null;
}

/** The stats counters, when every one of them is a whole number from 0 up; null otherwise. */
function counters<K extends string>(stats: Record<string, unknown>, keys: readonly K[]): Record<K, number> | null {
  const out = {} as Record<K, number>;
  for (const key of keys) {
    const v = stats[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return null;
    out[key] = v;
  }
  return out;
}

/** The track record is shown only from this population on (#43). */
const TRACK_RECORD_MIN_TOTAL = 10;

/**
 * "Track record kami" (#43) from the latest successful run. `listed` and `noToken` need not add up to `total`: a
 * project that turned risky after passing counts in `total` and `riskRaised` even before it ends. Null while the
 * population is below 10, or when the run has no track record numbers.
 */
export async function getTrackRecord(
  db: SupabaseClient,
): Promise<{ total: number; listed: number; noToken: number; riskRaised: number } | null> {
  const run = await getLastSuccessfulRun(db);
  const n = run
    ? counters(run.stats, ["track_record_total", "track_record_listed", "track_record_no_token", "track_record_risk_raised"])
    : null;
  if (!n || n.track_record_total < TRACK_RECORD_MIN_TOTAL) return null;
  return {
    total: n.track_record_total,
    listed: n.track_record_listed,
    noToken: n.track_record_no_token,
    riskRaised: n.track_record_risk_raised,
  };
}

/** "Update hari ini": projects curation checked and passed in the latest successful run, and when it finished. */
export async function getRunSummary(db: SupabaseClient): Promise<{ checked: number; passed: number; at: Date } | null> {
  const run = await getLastSuccessfulRun(db);
  const n = run ? counters(run.stats, ["curation_checked", "curation_passed"]) : null;
  return run && n ? { checked: n.curation_checked, passed: n.curation_passed, at: run.at } : null;
}
