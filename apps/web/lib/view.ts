// Pure view helpers and view-model types for the public pages. No I/O, so they run in Vitest without Supabase.
import type {
  CheckId,
  ContradictionsAnswer,
  CurationReason,
  DatePrecision,
  DeadlineKind,
  LinkCheckStatus,
  RiskCheck,
  RiskLevel,
  RiskReason,
  SignalKind,
  Status,
  StoredAnalyst,
  Tab,
  WorthLevel,
} from "@saf/core";
import { ENDED_SCORING_DAYS } from "@saf/core";
import { labels, notCurated } from "./copy";
import { LIST_PATH } from "./routes";

export type { Tab, WorthLevel } from "@saf/core";

/** A watched project with why it is not on the list (null when its latest curation passed). */
export interface WatchedItem extends ProjectListItem {
  notCuratedReason: string | null;
}

export interface ProjectListItem {
  slug: string;
  name: string;
  status: Status;
  riskLevel: RiskLevel | null;
  chains: string[];
  nextDeadline: { date: string; kind: string; precision: string } | null;
  lastSeen: string;
}

/** Repeating or one-off step (`tasks.cadence`, Analyst `steps_id`). */
export type Cadence = "daily" | "weekly" | "once";

/**
 * One risk check on the project page (#53). `detail` is what the check looked at (null on rows stored before details
 * existed, and for a visitor's advanced checks, which are member-only, #54). `flagged`: a warning of the assessment
 * came from this check (`CHECK_OF_REASON`).
 */
export interface DetailCheck extends Omit<RiskCheck, "detail"> {
  detail: Record<string, string | number | null> | null;
  flagged: boolean;
}

/** The latest curation. `worthLevel` and `reasons` are member-only: always null for a visitor (#45, #55). */
export interface DetailCuration {
  passed: boolean;
  worthLevel: WorthLevel | null;
  tab: Tab | null;
  reasons: CurationReason[] | null;
  publicFailReason: string | null;
  endedOn: string | null;
  /** `computed_at` ("Dicek ...", #44). */
  checkedAt: string;
}

/** One evidence row: a source's quote for a field, with the source document's URL. */
export interface EvidenceRow {
  field: string;
  value: string;
  quote: string;
  sourceUrl: string;
  at: string;
}

/** A link of the project with its check result (#42); null = never checked (no `link_checks` row). */
export interface DetailLink {
  url: string;
  kind: string;
  status: LinkCheckStatus | null;
}

/** A flag of the AI Scam Analyst (member-only, #54). */
export interface ScamFlag {
  pattern: string;
  quote: string;
  explanation: string;
}

export type Contradiction = ContradictionsAnswer["items"][number];

export interface ProjectDetail extends ProjectListItem {
  /** projects.id, for the watch button. */
  id: string;
  tokenSymbol: string | null;
  conflict: boolean;
  risk: { level: RiskLevel; reasons: RiskReason[]; checks: DetailCheck[]; computedAt: string } | null;
  curation: DetailCuration | null;
  /** Signals observed in the last 14 days, the ones curation used (like `public_list`). */
  signals: CuratedSignal[];
  /** Latest Analyst result (#54): member-only, never queried for a visitor; null when missing or unreadable. */
  analyst: StoredAnalyst | null;
  /** Latest Scam Analyst flags: member-only, never queried for a visitor (null). */
  scamFlags: ScamFlag[] | null;
  /** Latest contradiction analysis (public). */
  contradictions: Contradiction[];
  /** Source steps in `position` order; `text_id` (Indonesian) when there is one. */
  steps: { id?: string; text: string; cadence: Cadence }[];
  /** v3 extraction facts (key_parameter:*, source_rating:*, latest_update, claimed_backer, capital_required). */
  facts: EvidenceRow[];
  /** The `status` evidence rows (newest 100): the quotes of sources that disagree on the status. */
  evidence: EvidenceRow[];
  /** Distinct source document URLs among the evidence: the only URLs an AI `source_url` may link to. */
  sourceUrls: string[];
  deadlines: { kind: DeadlineKind; date: string | null; precision: DatePrecision; text: string }[];
  links: DetailLink[];
  /** "Claim open · link dicek" (#42): an open claim deadline and every claim link checked as official. */
  claimOpenChecked: boolean;
}

export interface ListFilters {
  status?: Status[];
  risk?: RiskLevel[];
  chain?: string;
}

/** Capital a project needs, from the `capital_required` facts of its sources (#52). */
export type Capital = "free" | "deposit" | "unknown";
/** The "Modal:" sub-filter of the list (#52). */
export type CapitalFilter = "all" | "free" | "deposit";

export interface CuratedFilters extends ListFilters {
  /** Member-only: ignored for visitors. */
  worth?: WorthLevel[];
  capital?: CapitalFilter;
}

/** One signal of a curated project, as curation used it (signals older than 14 days are left out by the view). */
export interface CuratedSignal {
  kind: SignalKind;
  value: Record<string, unknown>;
  /** Only a verified signal may get a "verified" badge; claimed and reported backers never are. */
  verified: boolean;
  source: string;
  observedAt: string;
}

/** Where a project's logo came from (`project_logos.source`, 0016). */
export type LogoSource = "defillama" | "x_avatar" | "favicon";
export const LOGO_SOURCES: readonly LogoSource[] = ["defillama", "x_avatar", "favicon"];

/** A row of the curated list (`public_list` for visitors, `curated_list` for members). */
export interface CuratedItem extends ProjectListItem {
  /** projects.id: the card's logo is served from `/logo/{id}`. */
  id: string;
  tab: Tab;
  /** `YYYY-MM-DD`, set when the project ended (#40). */
  endedOn: string | null;
  /** `computed_at` of the latest curation (#44). */
  checkedAt: string;
  signals: CuratedSignal[];
  /** An open claim deadline and every claim link checked as official (#42). */
  claimOpenChecked: boolean;
  capital: Capital;
  capitalMinUsd: number | null;
  /** How many of the 4 key checks ran in the latest risk assessment, 0 to 4 ("{k}/4 security check jalan"). */
  keyChecksRan: number;
  /** Member-only; always null for visitors. */
  worthLevel: WorthLevel | null;
  /** The stored logo's source, null without one (the card then shows a letter tile). */
  logoSource: LogoSource | null;
}

export const TABS: readonly Tab[] = ["live_now", "early_bets", "ended"];
export const WORTH_LEVELS: readonly WorthLevel[] = ["high", "medium", "low", "insufficient_data"];
export const SIGNAL_KINDS: readonly SignalKind[] = [
  "vc_backer",
  "tvl",
  "coingecko_listed",
  "curated_source",
  "claimed_backer",
  "reported_backer",
];
const CAPITAL_FILTERS: readonly CapitalFilter[] = ["all", "free", "deposit"];

/** `?tab=`: one of the three tabs, "Live sekarang" for anything else. */
export function parseTab(v: string | undefined): Tab {
  return (TABS as readonly string[]).includes(v ?? "") ? (v as Tab) : "live_now";
}

/** `?modal=`: all, free or deposit; "Semua" for anything else. */
export function parseCapital(v: string | undefined): CapitalFilter {
  return (CAPITAL_FILTERS as readonly string[]).includes(v ?? "") ? (v as CapitalFilter) : "all";
}

const USD = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

/** Row tag of the capital sub-filter (#52): "Gratis", "Butuh $1.000+", "Butuh $" or "Modal belum jelas". */
export function capitalLabel(capital: Capital, minUsd: number | null): string {
  if (capital === "free") return labels.capital.free;
  if (capital === "unknown") return labels.capital.unknown;
  return minUsd !== null && Number.isFinite(minUsd) && minUsd > 0
    ? labels.capital.depositMin(USD.format(minUsd))
    : labels.capital.deposit;
}

/** The audience's time zone (WIB). The pipeline runs at 06.00 WIB, which is still the previous day in UTC. */
const CHECK_ZONE = "Asia/Jakarta";
const DAY_MS = 24 * 60 * 60 * 1000;
/** "Dicek ..." turns into a warning past this age (#44). */
const CHECK_STALE_AFTER_MS = 48 * 60 * 60 * 1000;

const zoneDay = new Intl.DateTimeFormat("en-CA", { timeZone: CHECK_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const shortDate = new Intl.DateTimeFormat("id-ID", { timeZone: CHECK_ZONE, day: "numeric", month: "short" });
const longDate = new Intl.DateTimeFormat("id-ID", { timeZone: CHECK_ZONE, day: "numeric", month: "short", year: "numeric" });

/** "7 Okt", or "30 Des 2025" when the year is not the current one (WIB). */
function checkDate(d: Date, now: Date): string {
  return zoneDay.format(d).slice(0, 4) === zoneDay.format(now).slice(0, 4) ? shortDate.format(d) : longDate.format(d);
}

/**
 * "Dicek ..." of a curated project (#44), by calendar day in WIB: "Dicek hari ini", "Dicek kemarin",
 * "Dicek {n} hari lalu"; more than 48 hours ago "Belum dicek lagi sejak {tanggal}"; a frozen ended project (no longer
 * re-checked) "Last check {tanggal}".
 */
export function checkedLabel(checkedAt: Date, now: Date, frozen: boolean): string {
  if (frozen) return labels.checked.frozen(checkDate(checkedAt, now));
  if (isCheckStale(checkedAt, now)) return labels.checked.staleSince(checkDate(checkedAt, now));
  const days = Math.round((Date.parse(zoneDay.format(now)) - Date.parse(zoneDay.format(checkedAt))) / DAY_MS);
  if (days <= 0) return labels.checked.today;
  if (days === 1) return labels.checked.yesterday;
  return labels.checked.daysAgo(days);
}

/** Over 48 hours since the last check: "Belum dicek lagi sejak ..." in the warning colour (#44). */
export function isCheckStale(checkedAt: Date, now: Date): boolean {
  return now.getTime() - checkedAt.getTime() > CHECK_STALE_AFTER_MS;
}

/**
 * Whether a row's check time is frozen ("Last check {tanggal}", #44): only in the ended tab, once `ended_on` lies before
 * the UTC day `ENDED_SCORING_DAYS` (90) back, the cut the pipeline stops re-checking at (ruling 6). Without an end date
 * the project is still checked.
 */
export function isCheckFrozen(tab: Tab, endedOn: string | null, now: Date): boolean {
  if (tab !== "ended" || endedOn === null) return false;
  return endedOn < new Date(now.getTime() - ENDED_SCORING_DAYS * DAY_MS).toISOString().slice(0, 10);
}

const calendarDay = new Intl.DateTimeFormat("id-ID", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

/**
 * "5 Okt 2026" from a `YYYY-MM-DD` calendar day (formatted in UTC, so the day never shifts); anything else as it is.
 * Every date of a list row uses it: "Ended {tanggal}" and the next deadline.
 */
export function dayLabel(day: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? calendarDay.format(new Date(`${day}T00:00:00Z`)) : day;
}

/** "Ended 5 Okt 2026" from a `YYYY-MM-DD` end date. */
export function endedLabel(endedOn: string): string {
  return labels.endedOn(dayLabel(endedOn));
}

/**
 * Why a project is not on the curated list, or null when it is (its latest curation passed, in any tab: one that
 * passed and then ended is not failed, #40). Only the public reason is used (#55): `reasons` is member-only. No
 * curation at all counts as failed ("belum dinilai").
 */
export function notCuratedReason(curation: { passed: boolean; publicFailReason: string | null } | null): string | null {
  if (curation === null) return notCurated.unrated;
  if (curation.passed) return null;
  return curation.publicFailReason?.trim() || notCurated.noReason;
}

const ONE_DECIMAL = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });

/** A dollar amount in short Indonesian units, without the "$": "45 jt", "210,4 jt", "1,3 M", "850 rb". */
export function compactUsd(n: number): string {
  const u = labels.usdUnits;
  if (n >= 1e9) return `${ONE_DECIMAL.format(n / 1e9)} ${u.billion}`;
  if (n >= 1e6) return `${ONE_DECIMAL.format(n / 1e6)} ${u.million}`;
  if (n >= 1e3) return `${ONE_DECIMAL.format(n / 1e3)} ${u.thousand}`;
  return ONE_DECIMAL.format(n);
}

export const STATUSES: readonly Status[] = ["live", "announced", "speculative", "ended", "unknown"];
export const RISK_LEVELS: readonly RiskLevel[] = ["low", "medium", "high", "critical", "insufficient_data"];

/** The data is stale when the last successful pipeline run finished more than this long ago. */
export const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

export function isStale(lastRunAt: Date | null, now: Date): boolean {
  if (!lastRunAt) return true;
  return now.getTime() - lastRunAt.getTime() > STALE_AFTER_MS;
}

/** An unknown status reads "Belum pasti". */
export function statusLabel(s: Status): string {
  return labels.status[s] ?? labels.status.unknown;
}

/** Risk is shown as a level only, never as a number and never as "safe". */
export function riskLabel(l: RiskLevel | null): string {
  return l === null ? labels.notAssessed : (labels.risk[l] ?? labels.notAssessed);
}

/** The label for `key` when the map has one; data from the database may hold keys the types do not know. */
function lookup(map: Record<string, string>, key: string): string | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined;
}

export function deadlineKindLabel(kind: string): string {
  return lookup(labels.deadlineKind, kind) ?? kind.replaceAll("_", " ");
}

export function precisionLabel(precision: string): string {
  return lookup(labels.precision, precision) ?? precision;
}

/** Only exact and approximate dates count as a deadline for sorting, "next deadline" and notifications. */
export function isFirmPrecision(precision: string): boolean {
  return precision === "exact" || precision === "approximate";
}

/** Every risk check the pipeline runs (`CheckId` of @saf/core, `ai_review` included), in display order. */
const CHECK_IDS = Object.keys(labels.checks) as CheckId[];

/**
 * "7/9 cek jalan. Belum bisa dicek: Umur domain, Review AI." A check that did not run is never counted as
 * passed, and a check missing from the row counts as not run.
 */
export function coverageLine(checks: RiskCheck[]): string {
  const total = Math.max(checks.length, CHECK_IDS.length);
  const ran = checks.filter((c) => c.ran).length;
  const missing = CHECK_IDS.filter((id) => !checks.some((c) => c.id === id && c.ran));
  return labels.coverage(ran, total, missing.map((id) => labels.checks[id]));
}

export function evidenceFieldLabel(field: string): string {
  return lookup(labels.evidenceField, field) ?? field.replaceAll("_", " ");
}

/** "Tingkat tinggi" for a risk reason's severity; an unknown severity is shown as stored. */
export function severityLabel(severity: string): string {
  return lookup(labels.severity, severity) ?? severity;
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

/** `2026-10-10 12:00 UTC`. */
export function formatDateTime(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// ---- Row selection helpers (pure, used by lib/queries.ts) ----

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

/** The latest run that finished without a `run_error` in its stats: its finish time and stats. */
export function pickLastSuccessfulRunWithStats(
  runs: { finishedAt: string | null; stats: unknown }[],
): { at: Date; stats: Record<string, unknown> } | null {
  let best: { at: Date; stats: Record<string, unknown> } | null = null;
  for (const r of runs) {
    if (!r.finishedAt) continue;
    const stats = r.stats;
    if (stats && typeof stats === "object" && "run_error" in stats) continue;
    const d = new Date(r.finishedAt);
    if (Number.isNaN(d.getTime())) continue;
    if (!best || d > best.at) {
      best = { at: d, stats: stats && typeof stats === "object" && !Array.isArray(stats) ? (stats as Record<string, unknown>) : {} };
    }
  }
  return best;
}

/** Finish time of the latest run that finished without a `run_error` in its stats. */
export function pickLastSuccessfulRun(runs: { finishedAt: string | null; stats: unknown }[]): Date | null {
  return pickLastSuccessfulRunWithStats(runs)?.at ?? null;
}

// ---- Paging ----

export const PAGE_SIZE = 50;

/** `?page=N`, 1-based. Anything that is not a positive whole number (or is absurdly large) means page 1. */
export function parsePage(raw: string | undefined): number {
  if (raw === undefined || !/^[1-9]\d{0,6}$/.test(raw)) return 1;
  return Number(raw);
}

/**
 * Query string for the list page that keeps the filters: status, risk, chain, worth (only a member's filters carry
 * it), modal; "Semua" and page 1 are left out. Empty string when there is nothing to say.
 */
export function listQueryString(f: CuratedFilters, page: number): string {
  const sp = new URLSearchParams();
  for (const s of f.status ?? []) sp.append("status", s);
  for (const r of f.risk ?? []) sp.append("risk", r);
  if (f.chain) sp.set("chain", f.chain);
  for (const w of f.worth ?? []) sp.append("worth", w);
  if (f.capital && f.capital !== "all") sp.set("modal", f.capital);
  if (page > 1) sp.set("page", String(page));
  return sp.toString();
}

/** A link to a tab of the list that keeps the filters: `/airdrops?tab=early_bets&risk=low&modal=free`. */
export function curatedHref(tab: Tab, f: CuratedFilters, page = 1): string {
  const qs = listQueryString(f, page);
  return `${LIST_PATH}?tab=${tab}${qs ? `&${qs}` : ""}`;
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

/**
 * Filters of the curated list from the query string: the v1 filters, `?modal=` and, for members only, `?worth=`. A
 * visitor's `worth` is dropped here, so it never reaches a query or a link (#45).
 */
export function parseCuratedFilters(sp: SearchParams, member: boolean): CuratedFilters {
  const f: CuratedFilters = { ...parseFilters(sp), capital: parseCapital(many(sp.modal)[0]) };
  if (member) f.worth = many(sp.worth).filter((w): w is WorthLevel => (WORTH_LEVELS as readonly string[]).includes(w));
  return f;
}

/** The `chain` value as typed (trimmed, lowercased), valid or not, so the filter form can keep showing it. */
export function rawChainParam(sp: SearchParams): string | undefined {
  const raw = many(sp.chain)[0]?.trim().toLowerCase();
  return raw || undefined;
}

/** Colours of the letter tile (design C tokens; white text on each is at least 4.5:1). */
export type LogoTone = "ink" | "pass" | "ended" | "caution" | "accent" | "ink-2";
const LOGO_TONES: readonly LogoTone[] = ["ink", "pass", "ended", "caution", "accent", "ink-2"];

/**
 * The letter tile of a project without a logo: the first letter or digit of its name, upper case (the first character
 * when there is none, "?" for an empty name).
 */
export function logoLetter(name: string): string {
  const chars = [...name.trim()];
  const first = chars.find((c) => /[\p{L}\p{N}]/u.test(c)) ?? chars[0] ?? "?";
  return first.toLocaleUpperCase("id-ID");
}

/** The tile colour of a slug: the sum of its UTF-16 code units, modulo the number of tones. Same slug, same colour. */
export function logoTone(slug: string): LogoTone {
  let sum = 0;
  for (let i = 0; i < slug.length; i++) sum += slug.charCodeAt(i);
  return LOGO_TONES[sum % LOGO_TONES.length]!;
}

/** Where the web serves a project's stored logo (app/logo/[projectId]/route.ts). */
export function logoPath(projectId: string): string {
  return `/logo/${encodeURIComponent(projectId)}`;
}
