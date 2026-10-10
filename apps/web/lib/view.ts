// Pure view helpers and view-model types for the public pages. No I/O, so they run in Vitest without Supabase.
import type {
  DatePrecision,
  DeadlineKind,
  RiskCheck,
  RiskLevel,
  RiskReason,
  Status,
} from "@saf/core";

export interface ProjectListItem {
  slug: string;
  name: string;
  status: Status;
  riskLevel: RiskLevel | null;
  chains: string[];
  nextDeadline: { date: string; kind: string; precision: string } | null;
  lastSeen: string;
}

export interface ProjectDetail extends ProjectListItem {
  /** projects.id, for the watch button. */
  id: string;
  tokenSymbol: string | null;
  conflict: boolean;
  risk: { level: RiskLevel; reasons: RiskReason[]; checks: RiskCheck[]; computedAt: string } | null;
  deadlines: { kind: DeadlineKind; date: string | null; precision: DatePrecision; text: string }[];
  tasks: string[];
  links: { url: string; kind: string }[];
  evidence: { field: string; value: string; quote: string; sourceUrl: string; at: string }[];
}

export interface ListFilters {
  status?: Status[];
  risk?: RiskLevel[];
  chain?: string;
}

export const STATUSES: readonly Status[] = ["live", "announced", "speculative", "ended", "unknown"];
export const RISK_LEVELS: readonly RiskLevel[] = ["low", "medium", "high", "critical", "insufficient_data"];

/** The data is stale when the last successful pipeline run finished more than this long ago. */
export const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

export function isStale(lastRunAt: Date | null, now: Date): boolean {
  if (!lastRunAt) return true;
  return now.getTime() - lastRunAt.getTime() > STALE_AFTER_MS;
}

const STATUS_LABELS: Record<Status, string> = {
  live: "Live",
  announced: "Announced",
  speculative: "Speculative",
  ended: "Ended",
  unknown: "Unconfirmed",
};

export function statusLabel(s: Status): string {
  return STATUS_LABELS[s] ?? "Unconfirmed";
}

const RISK_LABELS: Record<RiskLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
  insufficient_data: "Insufficient data",
};

/** Risk is shown as a level only, never as a number and never as "safe". */
export function riskLabel(l: RiskLevel | null): string {
  return l === null ? "Not assessed" : (RISK_LABELS[l] ?? "Not assessed");
}

const DEADLINE_KIND_LABELS: Record<string, string> = {
  claim: "Claim",
  snapshot: "Snapshot",
  campaign_end: "Campaign end",
  withdraw_funds: "Withdraw funds",
  tge: "TGE",
  other: "Other",
};

export function deadlineKindLabel(kind: string): string {
  return DEADLINE_KIND_LABELS[kind] ?? kind.replaceAll("_", " ");
}

const PRECISION_LABELS: Record<string, string> = {
  exact: "exact date",
  approximate: "approximate date",
  month: "month only",
  quarter: "quarter only",
};

export function precisionLabel(precision: string): string {
  return PRECISION_LABELS[precision] ?? precision;
}

/** Only exact and approximate dates count as a deadline for sorting, "next deadline" and notifications. */
export function isFirmPrecision(precision: string): boolean {
  return precision === "exact" || precision === "approximate";
}

function time(value: string): number {
  const t = Date.parse(value);
  return Number.isNaN(t) ? 0 : t;
}

const CHECK_LABELS: Record<string, string> = {
  dangerous_asks: "dangerous-ask scan",
  phishing_list: "phishing list",
  domain_age: "domain age",
  lookalike: "lookalike domain",
  token_security: "token security",
  contract_verified: "contract verification",
  hack_history: "hack history",
  corroboration: "source corroboration",
};

const TOTAL_CHECKS = Object.keys(CHECK_LABELS).length;

/** "4/8 checks ran; domain age, phishing list unavailable". A check that did not run is never counted as passed. */
export function coverageLine(checks: RiskCheck[]): string {
  const total = Math.max(checks.length, TOTAL_CHECKS);
  const ran = checks.filter((c) => c.ran).length;
  const missing = Object.keys(CHECK_LABELS).filter((id) => !checks.some((c) => c.id === id && c.ran));
  const base = `${ran}/${total} checks ran`;
  return missing.length > 0 ? `${base}; ${missing.map((id) => CHECK_LABELS[id]).join(", ")} unavailable` : base;
}

const EVIDENCE_FIELD_LABELS: Record<string, string> = {
  status: "Status",
  defillama_listing: "DefiLlama listing",
  dangerous_ask: "Dangerous ask",
};

export function evidenceFieldLabel(field: string): string {
  return EVIDENCE_FIELD_LABELS[field] ?? field.replaceAll("_", " ");
}

/** The URL normalised, if (and only if) it is http(s). Anything else must be shown as plain text, never linked. */
export function safeHttpUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** `2026-10-10` (UTC) from a date or timestamp string. */
export function formatDay(value: string): string {
  const t = Date.parse(value);
  return Number.isNaN(t) ? value : new Date(t).toISOString().slice(0, 10);
}

/** `2026-10-10 12:00 UTC`. */
export function formatDateTime(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// ---- Row selection helpers (pure, used by lib/queries.ts) ----

/** The latest risk assessment: greatest `computedAt`, ties broken by greatest `seq`. */
export function pickLatestRisk<T extends { computedAt: string; seq: number }>(rows: T[]): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (!best) best = r;
    else {
      const dt = time(r.computedAt) - time(best.computedAt);
      if (dt > 0 || (dt === 0 && r.seq > best.seq)) best = r;
    }
  }
  return best;
}

/** `YYYY-MM-DD` of `now` in UTC. */
export function utcToday(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** The earliest deadline on or after today (UTC) with an exact or approximate date. */
export function pickNextDeadline(
  rows: { date: string | null; kind: string; precision: string }[],
  today: string,
): { date: string; kind: string; precision: string } | null {
  let best: { date: string; kind: string; precision: string } | null = null;
  for (const r of rows) {
    if (!r.date || !isFirmPrecision(r.precision) || r.date < today) continue;
    if (!best || r.date < best.date) best = { date: r.date, kind: r.kind, precision: r.precision };
  }
  return best;
}

/** Finish time of the latest run that finished without a `run_error` in its stats. */
export function pickLastSuccessfulRun(
  runs: { finishedAt: string | null; stats: unknown }[],
): Date | null {
  let best: Date | null = null;
  for (const r of runs) {
    if (!r.finishedAt) continue;
    const stats = r.stats;
    if (stats && typeof stats === "object" && "run_error" in stats) continue;
    const d = new Date(r.finishedAt);
    if (Number.isNaN(d.getTime())) continue;
    if (!best || d > best) best = d;
  }
  return best;
}

// ---- Paging ----

export const PAGE_SIZE = 50;

/** `?page=N`, 1-based. Anything that is not a positive whole number (or is absurdly large) means page 1. */
export function parsePage(raw: string | undefined): number {
  if (raw === undefined || !/^[1-9]\d{0,6}$/.test(raw)) return 1;
  return Number(raw);
}

/** Query string for the list page that keeps the filters; page 1 is left out. Empty string when there is nothing to say. */
export function listQueryString(f: ListFilters, page: number): string {
  const sp = new URLSearchParams();
  for (const s of f.status ?? []) sp.append("status", s);
  for (const r of f.risk ?? []) sp.append("risk", r);
  if (f.chain) sp.set("chain", f.chain);
  if (page > 1) sp.set("page", String(page));
  return sp.toString();
}

// ---- Query-string parsing ----

const CHAIN_PATTERN = /^[a-z0-9][a-z0-9 ._-]{0,48}$/;

/**
 * A chain filter value, trimmed and lowercased, or null when it is not a plain chain name. Anything with commas, braces,
 * quotes or backslashes would corrupt the array literal sent to PostgREST, so it is dropped instead of being escaped.
 */
export function parseChain(raw: string | undefined | null): string | null {
  const chain = raw?.trim().toLowerCase();
  if (!chain || chain === "null" || !CHAIN_PATTERN.test(chain)) return null;
  return chain;
}

type SearchParams = Record<string, string | string[] | undefined>;

function many(v: string | string[] | undefined): string[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

/** Filters from the query string: ?status=live&status=announced&risk=high&chain=ethereum. Unknown values are dropped. */
export function parseFilters(sp: SearchParams): ListFilters {
  const status = many(sp.status).filter((s): s is Status => (STATUSES as readonly string[]).includes(s));
  const risk = many(sp.risk).filter((r): r is RiskLevel => (RISK_LEVELS as readonly string[]).includes(r));
  const chain = parseChain(many(sp.chain)[0]);
  return { status, risk, chain: chain ?? undefined };
}

/** The `chain` value as typed (trimmed, lowercased), valid or not, so the filter form can keep showing it. */
export function rawChainParam(sp: SearchParams): string | undefined {
  const raw = many(sp.chain)[0]?.trim().toLowerCase();
  return raw || undefined;
}
