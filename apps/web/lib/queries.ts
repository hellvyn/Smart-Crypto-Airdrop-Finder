// Read-only queries for the public pages. They use the anon client (or the signed-in user's session) and rely on the
// "public read" RLS policies; documents and extractions are not readable here and are never queried.
import { contradictionsSchema, scamSchema, storedAnalystSchema } from "@saf/core";
import type { CheckId, CurationReason, LinkCheckStatus, RiskLevel, RiskReason, Severity, Status } from "@saf/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import {
  CHANGE_DEADLINE_KINDS,
  DEADLINE_WINDOW_MS,
  EMPTY_CHANGE_FEED,
  buildChangeFeed,
  type ChangeFeed,
  type ChangeProject,
} from "./changes";
import { claimOpenChecked, isCheckedKind, isFlagged } from "./detail";
import { isUuid } from "./uuid";
import {
  LOGO_SOURCES,
  RISK_LEVELS,
  SIGNAL_KINDS,
  STATUSES,
  TABS,
  WORTH_LEVELS,
  pickLastSuccessfulRunWithStats,
  PAGE_SIZE,
  parseChain,
  parseTab,
  pickNextDeadline,
  utcToday,
  type Capital,
  type CapitalFilter,
  type CuratedFilters,
  type CuratedItem,
  type Cadence,
  type CuratedSignal,
  type DetailCheck,
  type DetailCuration,
  type EvidenceRow,
  type ListFilters,
  type LogoSource,
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
  `${LIST_COLUMNS}, tab, ended_on, checked_at, signals, claim_open_checked, capital, capital_min_usd, key_checks_ran, ` +
  "logo_source";
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
    id: String(row.id),
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
    // A logo is only linked for a project id the logo route accepts.
    logoSource:
      isUuid(row.id) && LOGO_SOURCES.includes(row.logo_source as LogoSource) ? (row.logo_source as LogoSource) : null,
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

// ---- Project page (Plan 6 Task 5; spec §7.2, #45, #53, #54) ----

/**
 * v3 extraction facts shown in their own sections (curation spec §4.6), read with their own query so no other
 * evidence can push them out of a row window.
 */
const FACT_FILTER =
  "field.in.(latest_update,claimed_backer,capital_required),field.like.key_parameter:*,field.like.source_rating:*";
/** Row windows of the evidence queries, newest first: status quotes, facts, and the source URL allow-list. */
const STATUS_QUOTES_LIMIT = 100;
const FACTS_LIMIT = 200;
const SOURCE_URLS_LIMIT = 1000;
/**
 * A URL `.in()` can send: postgrest-js quotes a value with `,` or parentheses but does not escape `"` or `\` inside
 * it. A link URL with any of these is left out of the `link_checks` lookup, so it reads as not checked.
 */
const IN_SAFE = /^[^",()\\]*$/;

const CADENCES: readonly Cadence[] = ["daily", "weekly", "once"];
const LINK_STATUSES: readonly LinkCheckStatus[] = ["official", "different_domain", "phishing", "unchecked"];
/** The columns of `curations` anon may read (0011): a visitor's query names only these (#45, #55). */
const PUBLIC_CURATION_COLUMNS = "passed, tab, public_fail_reason, ended_on, computed_at, seq";
/** A signal last checked longer ago than this was not used by curation (like `public_list`, 0012). */
const SIGNAL_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function asDetail(v: unknown): Record<string, string | number | null> | null {
  if (!isRecord(v)) return null;
  const out: Record<string, string | number | null> = {};
  for (const [k, x] of Object.entries(v)) {
    if (typeof x === "string" || (typeof x === "number" && Number.isFinite(x)) || x === null) out[k] = x;
  }
  return out;
}

/** Stored checks (a member's read of `risk_assessments.checks`), flagged by the assessment's warnings. */
function asDetailChecks(v: unknown, reasons: RiskReason[]): DetailCheck[] {
  if (!Array.isArray(v)) return [];
  const out: DetailCheck[] = [];
  for (const c of v) {
    if (!isRecord(c) || typeof c.id !== "string") continue;
    const id = c.id as CheckId;
    out.push({ id, ran: c.ran === true, detail: asDetail(c.detail), flagged: isFlagged(id, reasons) });
  }
  return out;
}

/**
 * A visitor's checks from `public_risk_checks` (0013): the key checks with their detail (flagged by the public
 * reasons, like a member's), the advanced checks with `ran` and the view's `flagged` only, never a detail (#54).
 */
function asPublicChecks(row: Record<string, unknown> | undefined, reasons: RiskReason[]): DetailCheck[] {
  if (!row) return [];
  const key = asDetailChecks(row.key_checks, reasons);
  const advanced: DetailCheck[] = [];
  for (const c of Array.isArray(row.advanced_checks) ? row.advanced_checks : []) {
    if (!isRecord(c) || typeof c.id !== "string") continue;
    advanced.push({ id: c.id as CheckId, ran: c.ran === true, detail: null, flagged: c.flagged === true });
  }
  return [...key, ...advanced];
}

function asCurationReasons(v: unknown): CurationReason[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((r) =>
    isRecord(r) && typeof r.message === "string" && ["pass", "fail", "worth"].includes(String(r.kind))
      ? [{ code: String(r.code ?? ""), message: r.message, kind: r.kind as CurationReason["kind"] }]
      : [],
  );
}

/** The latest row of a history (greatest at, ties broken by greatest seq), when the query returned any. */
function first(data: unknown): Record<string, unknown> | undefined {
  return Array.isArray(data) && isRecord(data[0]) ? data[0] : undefined;
}

/**
 * Everything the project page shows. `member` decides what is read, not only what is shown (#45, #54): for a visitor
 * the queries never name `risk_assessments.checks` (the checks come from `public_risk_checks`), the member-only
 * `curations` columns (worth, reasons), or the `analyst` and `scam` AI analyses, so none of it reaches the page.
 */
export async function getProjectDetail(
  db: SupabaseClient,
  slug: string,
  { member, now = new Date() }: { member: boolean; now?: Date },
): Promise<ProjectDetail | null> {
  const { data: p, error } = await db
    .from("projects")
    .select("id, slug, name, status, chains, last_seen, token_symbol, conflict")
    .eq("slug", slug)
    .maybeSingle();
  throwIf(error, "project");
  if (!p) return null;
  const id = p.id as string;

  const latestAi = (kind: "analyst" | "scam" | "contradictions") =>
    db.from("ai_analyses").select("result, created_at").eq("project_id", id).eq("kind", kind)
      .order("created_at", { ascending: false }).order("seq", { ascending: false }).limit(1);
  const none = Promise.resolve({ data: null, error: null });

  const [risks, publicChecks, curations, signals, analyst, scam, contradictions, deadlines, tasks, links, statusQuotes, facts, sources] =
    await Promise.all([
      db.from("risk_assessments")
        .select(member ? "level, reasons, checks, computed_at, seq" : "level, reasons, computed_at, seq")
        .eq("project_id", id)
        .order("computed_at", { ascending: false }).order("seq", { ascending: false }).limit(1),
      member ? none : db.from("public_risk_checks").select("key_checks, advanced_checks").eq("project_id", id).limit(1),
      db.from("curations")
        .select(member ? `${PUBLIC_CURATION_COLUMNS}, worth_level, reasons` : PUBLIC_CURATION_COLUMNS)
        .eq("project_id", id)
        .order("computed_at", { ascending: false }).order("seq", { ascending: false }).limit(1),
      db.from("project_signals").select("kind, value, verified, source, observed_at").eq("project_id", id)
        .gte("observed_at", new Date(now.getTime() - SIGNAL_MAX_AGE_MS).toISOString()),
      member ? latestAi("analyst") : none,
      member ? latestAi("scam") : none,
      latestAi("contradictions"),
      db.from("deadlines").select("kind, date, precision, text").eq("project_id", id),
      db.from("tasks").select("description, text_id, cadence, position").eq("project_id", id)
        .order("position", { ascending: true }).order("document_id", { ascending: true }),
      db.from("links").select("url, kind").eq("project_id", id),
      db.from("evidence").select("field, value, quote, source_url, at, seq").eq("project_id", id).eq("field", "status")
        .order("at", { ascending: false }).order("seq", { ascending: false }).limit(STATUS_QUOTES_LIMIT),
      db.from("evidence").select("field, value, quote, source_url, at, seq").eq("project_id", id).or(FACT_FILTER)
        .order("at", { ascending: false }).order("seq", { ascending: false }).limit(FACTS_LIMIT),
      db.from("evidence").select("source_url").eq("project_id", id)
        .order("at", { ascending: false }).order("seq", { ascending: false }).limit(SOURCE_URLS_LIMIT),
    ]);
  throwIf(risks.error, "risk");
  throwIf(publicChecks.error, "risk checks");
  throwIf(curations.error, "curation");
  throwIf(signals.error, "signals");
  throwIf(analyst.error, "AI analysis");
  throwIf(scam.error, "AI analysis");
  throwIf(contradictions.error, "AI analysis");
  throwIf(deadlines.error, "deadlines");
  throwIf(tasks.error, "tasks");
  throwIf(links.error, "links");
  throwIf(statusQuotes.error, "evidence");
  throwIf(facts.error, "evidence");
  throwIf(sources.error, "evidence");

  const linkRows = ((links.data ?? []) as Record<string, unknown>[]).map((l) => ({ url: String(l.url), kind: String(l.kind) }));
  const checkedUrls = linkRows.filter((l) => isCheckedKind(l.kind) && IN_SAFE.test(l.url)).map((l) => l.url);
  const linkChecks = checkedUrls.length > 0
    ? await db.from("link_checks").select("url, status").in("url", checkedUrls)
    : { data: [], error: null };
  throwIf(linkChecks.error, "link checks");
  const statusOf = new Map(
    ((linkChecks.data ?? []) as Record<string, unknown>[]).map((r) => [String(r.url), r.status as LinkCheckStatus]),
  );

  const latest = first(risks.data);
  const riskLevel = latest ? asRiskLevel(latest.level) : null;
  const reasons = latest ? asReasons(latest.reasons) : [];

  const c = first(curations.data);
  const curation: DetailCuration | null = c
    ? {
        passed: c.passed === true,
        worthLevel: member && WORTH_LEVELS.includes(c.worth_level as WorthLevel) ? (c.worth_level as WorthLevel) : null,
        tab: typeof c.tab === "string" && (TABS as readonly string[]).includes(c.tab) ? (c.tab as Tab) : null,
        reasons: member ? asCurationReasons(c.reasons) : null,
        publicFailReason: typeof c.public_fail_reason === "string" ? c.public_fail_reason : null,
        endedOn: typeof c.ended_on === "string" ? c.ended_on : null,
        checkedAt: String(c.computed_at),
      }
    : null;

  const analystRow = member ? storedAnalystSchema.safeParse(first(analyst.data)?.result) : null;
  const scamRow = member ? scamSchema.safeParse(first(scam.data)?.result) : null;
  const contradictionsRow = contradictionsSchema.safeParse(first(contradictions.data)?.result);

  const deadlineRows = (deadlines.data ?? []).map((d) => ({
    kind: (DEADLINE_KINDS.includes(String(d.kind)) ? d.kind : "other") as ProjectDetail["deadlines"][number]["kind"],
    date: typeof d.date === "string" ? d.date : null,
    precision: (PRECISIONS.includes(String(d.precision)) ? d.precision : "quarter") as ProjectDetail["deadlines"][number]["precision"],
    text: typeof d.text === "string" ? d.text : "",
  }));
  deadlineRows.sort((a, b) => (a.date ?? "9999-12-31").localeCompare(b.date ?? "9999-12-31"));

  const detailLinks = linkRows.map((l) => {
    const status = statusOf.get(l.url);
    return { ...l, status: status !== undefined && LINK_STATUSES.includes(status) ? status : null };
  });

  const evidenceRows = (data: unknown): EvidenceRow[] =>
    ((data ?? []) as Record<string, unknown>[]).map((e) => ({
      field: String(e.field),
      value: String(e.value),
      quote: String(e.quote),
      sourceUrl: String(e.source_url),
      at: String(e.at),
    }));

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
        ? {
            level: riskLevel,
            reasons,
            checks: member ? asDetailChecks(latest.checks, reasons) : asPublicChecks(first(publicChecks.data), reasons),
            computedAt: String(latest.computed_at),
          }
        : null,
    curation,
    signals: asSignals(signals.data),
    analyst: analystRow?.success ? analystRow.data : null,
    scamFlags: scamRow ? (scamRow.success ? scamRow.data.flags : []) : null,
    contradictions: contradictionsRow.success ? contradictionsRow.data.items : [],
    steps: ((tasks.data ?? []) as Record<string, unknown>[]).map((t) => ({
      text: typeof t.text_id === "string" && t.text_id.trim() !== "" ? t.text_id : String(t.description),
      cadence: CADENCES.includes(t.cadence as Cadence) ? (t.cadence as Cadence) : "once",
    })),
    facts: evidenceRows(facts.data),
    evidence: evidenceRows(statusQuotes.data),
    sourceUrls: [...new Set(((sources.data ?? []) as Record<string, unknown>[]).map((e) => String(e.source_url)))],
    deadlines: deadlineRows,
    links: detailLinks,
    claimOpenChecked: claimOpenChecked(deadlineRows, detailLinks, utcToday(now)),
  };
}

type SuccessfulRun = { at: Date; stats: Record<string, unknown> };

/**
 * The latest successful pipeline run (finished, with no `run_error` key in its stats): finish time and stats.
 * SQL drops rows without the key; the JS check also drops a key present with a null value. Cached per request and per
 * client (React `cache`), so a page that shows the stale banner, the run summary and the track record reads it once.
 */
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

// ---- "Perubahan sejak kunjungan terakhir" (Plan 6 Task 7) ----

/** Without a `changes_seen_at`, the feed covers the changes recorded in this last stretch. */
const CHANGES_DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Row window of the changes query, newest first: enough for every watched project's changes in one run. */
const CHANGES_LIMIT = 500;

/** When the member last marked the changes seen (`profiles.changes_seen_at`), or null. */
export async function getChangesSeenAt(db: SupabaseClient, userId: string): Promise<Date | null> {
  const { data, error } = await db.from("profiles").select("changes_seen_at").eq("user_id", userId).maybeSingle();
  throwIf(error, "changes seen");
  const at = isRecord(data) && typeof data.changes_seen_at === "string" ? Date.parse(data.changes_seen_at) : Number.NaN;
  return Number.isNaN(at) ? null : new Date(at);
}

function asChangeProject(v: unknown): ChangeProject | null {
  if (!isRecord(v) || typeof v.slug !== "string" || typeof v.name !== "string") return null;
  return { slug: v.slug, name: v.name };
}

/**
 * The signed-in member's feed: `project_changes` of the projects on their watchlist recorded after `since` (the last 7
 * days without one), plus their claim / snapshot / campaign-end deadlines in the next 48 hours (exact or approximate,
 * shown whatever `since` is). The watchlist is read with the member's own id, and RLS ("own watchlist read", and the
 * `project_changes` policy of 0014) keeps both reads to the member's own watched projects as a second barrier.
 */
export async function listChangesSince(
  db: SupabaseClient,
  userId: string,
  since: Date | null,
  now: Date,
): Promise<ChangeFeed> {
  const watched = await db.from("watchlist").select("project_id, project:projects(status)").eq("user_id", userId);
  throwIf(watched.error, "watchlist");
  const watchedRows = (watched.data ?? []) as unknown as Record<string, unknown>[];
  const ids = watchedRows.map((r) => String(r.project_id));
  if (ids.length === 0) return EMPTY_CHANGE_FEED;
  const endedNow = new Set(
    watchedRows.filter((r) => isRecord(r.project) && r.project.status === "ended").map((r) => String(r.project_id)),
  );

  const after = since ?? new Date(now.getTime() - CHANGES_DEFAULT_WINDOW_MS);
  const [changes, deadlines] = await Promise.all([
    db.from("project_changes")
      .select("project_id, field, old_value, new_value, changed_at, seq, project:projects(slug, name)")
      .in("project_id", ids)
      .gt("recorded_at", after.toISOString())
      .order("changed_at", { ascending: false })
      .order("seq", { ascending: false })
      .limit(CHANGES_LIMIT),
    db.from("deadlines")
      .select("project_id, kind, date, precision, project:projects(slug, name)")
      .in("project_id", ids)
      .in("kind", [...CHANGE_DEADLINE_KINDS])
      .in("precision", ["exact", "approximate"])
      .gte("date", utcToday(now))
      .lte("date", utcToday(new Date(now.getTime() + DEADLINE_WINDOW_MS))),
  ]);
  throwIf(changes.error, "changes");
  throwIf(deadlines.error, "deadlines");

  const changeRows = ((changes.data ?? []) as unknown as Record<string, unknown>[]).flatMap((r) => {
    const project = asChangeProject(r.project);
    return project && typeof r.new_value === "string"
      ? [{
          projectId: String(r.project_id),
          project,
          field: String(r.field),
          oldValue: typeof r.old_value === "string" ? r.old_value : null,
          newValue: r.new_value,
          changedAt: String(r.changed_at),
          seq: Number(r.seq),
        }]
      : [];
  });
  const deadlineRows = ((deadlines.data ?? []) as unknown as Record<string, unknown>[]).flatMap((r) => {
    const project = asChangeProject(r.project);
    return project && typeof r.date === "string"
      ? [{
          projectId: String(r.project_id),
          project,
          kind: String(r.kind),
          date: r.date,
          precision: String(r.precision),
        }]
      : [];
  });
  return buildChangeFeed(changeRows, deadlineRows, endedNow, now);
}

/**
 * The feed for a page: `changes_seen_at`, then `listChangesSince`. Any failure gives an empty feed, so the page still
 * renders without the panel (nothing is logged: the error could carry the member's data).
 */
export async function getChangeFeed(db: SupabaseClient, userId: string, now: Date): Promise<ChangeFeed> {
  try {
    return await listChangesSince(db, userId, await getChangesSeenAt(db, userId), now);
  } catch {
    return EMPTY_CHANGE_FEED;
  }
}
