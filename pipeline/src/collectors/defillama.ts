import { z } from "zod";

export interface SpeculativeCandidate {
  name: string;
  slug: string;
  url: string | null;
  /** X (Twitter) handle without "@", or null when missing or not a valid handle. */
  twitter: string | null;
  chains: string[];
  tvl: number;
  change7d: number | null;
  category: string;
  /** When DefiLlama first listed the protocol, or null when it gave no usable listing time. */
  listedAt: Date | null;
  /** The descriptive fields the AI analyses read (description, audits, raises, ...); `EMPTY_DETAILS` when DefiLlama gave none. */
  details: DefillamaDetails;
}

/** One funding round of a DefiLlama protocol (`raises` of `/protocol/{slug}`). */
export interface DefillamaRaise {
  /** `YYYY-MM-DD`, or null. */
  date: string | null;
  round: string | null;
  /** USD, or null. DefiLlama gives the amount in millions of USD. */
  amountUsd: number | null;
  /** Lead investors first, then the others. */
  investors: string[];
}

/**
 * The DefiLlama fields the pipeline used to ignore. All of them are text written by the protocol or by DefiLlama's
 * contributors, so they are source text like any other: given to the analyses as data. Each is empty (null or [])
 * when DefiLlama gave nothing usable.
 */
export interface DefillamaDetails {
  description: string | null;
  methodology: string | null;
  /** Number of audits DefiLlama lists, or null when it did not say. */
  audits: number | null;
  /** At most `MAX_AUDIT_LINKS` http(s) links. */
  auditLinks: string[];
  /** GitHub organisations or repositories, at most `MAX_GITHUB`. */
  github: string[];
  /** The latest rounds first, at most `MAX_RAISES`. */
  raises: DefillamaRaise[];
}

export const EMPTY_DETAILS: DefillamaDetails = {
  description: null,
  methodology: null,
  audits: null,
  auditLinks: [],
  github: [],
  raises: [],
};

/** Most characters of the description and of the methodology that are kept. */
const MAX_DETAIL_TEXT_CHARS = 600;
const MAX_AUDIT_LINKS = 3;
const MAX_GITHUB = 5;
const MAX_RAISES = 5;
const MAX_INVESTORS_PER_RAISE = 8;
const MAX_FIELD_CHARS = 200;

/** One line of at most `max` characters (code points): control characters and whitespace runs become one space. */
function oneLine(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
  if (text === "") return null;
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max).join("").trimEnd()}…` : text;
}

const stringsOf = (value: unknown, max: number, keep: (s: string) => boolean = () => true): string[] =>
  Array.isArray(value)
    ? value
        .map((v) => oneLine(v, MAX_FIELD_CHARS))
        .filter((v): v is string => v !== null && keep(v))
        .slice(0, max)
    : [];

function auditCount(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 1000 ? n : null;
}

function parseRaise(raw: unknown): DefillamaRaise | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const date = listingDate(typeof r.date === "number" ? r.date : null);
  const amount = typeof r.amount === "number" && Number.isFinite(r.amount) && r.amount > 0 ? r.amount : null;
  const investors = [
    ...stringsOf(r.leadInvestors, MAX_INVESTORS_PER_RAISE),
    ...stringsOf(r.otherInvestors, MAX_INVESTORS_PER_RAISE),
  ];
  const raise: DefillamaRaise = {
    date: date === null ? null : date.toISOString().slice(0, 10),
    round: oneLine(r.round, MAX_FIELD_CHARS),
    amountUsd: amount === null ? null : Math.round(amount * 1_000_000),
    investors: [...new Set(investors)].slice(0, MAX_INVESTORS_PER_RAISE),
  };
  return raise.date === null && raise.round === null && raise.amountUsd === null && raise.investors.length === 0
    ? null
    : raise;
}

/**
 * The descriptive fields of a `/protocols` list entry or of a `/protocol/{slug}` answer (same names in both). Never
 * throws: a missing or wrongly typed field is left empty, so a strange answer costs the field, not the candidate.
 */
export function parseProtocolDetail(raw: unknown): DefillamaDetails {
  if (typeof raw !== "object" || raw === null) return EMPTY_DETAILS;
  const p = raw as Record<string, unknown>;
  const raises = (Array.isArray(p.raises) ? p.raises : [])
    .map(parseRaise)
    .filter((r): r is DefillamaRaise => r !== null)
    // Latest first (ISO dates sort as text); rounds without a date last.
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, MAX_RAISES);
  const auditLinks = stringsOf(p.audit_links, MAX_AUDIT_LINKS, (s) => /^https?:\/\//i.test(s));
  return {
    description: oneLine(p.description, MAX_DETAIL_TEXT_CHARS),
    methodology: oneLine(p.methodology, MAX_DETAIL_TEXT_CHARS),
    audits: auditCount(p.audits) ?? (auditLinks.length > 0 ? auditLinks.length : null),
    auditLinks,
    github: stringsOf(p.github, MAX_GITHUB),
    raises,
  };
}

/** `base` with every field `over` has a value for taken from `over` (the detail endpoint wins over the list). */
export function mergeDetails(base: DefillamaDetails, over: DefillamaDetails): DefillamaDetails {
  return {
    description: over.description ?? base.description,
    methodology: over.methodology ?? base.methodology,
    audits: over.audits ?? base.audits,
    auditLinks: over.auditLinks.length > 0 ? over.auditLinks : base.auditLinks,
    github: over.github.length > 0 ? over.github : base.github,
    raises: over.raises.length > 0 ? over.raises : base.raises,
  };
}

/** `$12.5M` for 12,500,000; `$750K` below a million; whole dollars below a thousand. */
function usd(amount: number): string {
  if (amount >= 1_000_000) return `$${Number((amount / 1_000_000).toFixed(2))}M`;
  if (amount >= 1_000) return `$${Number((amount / 1_000).toFixed(1))}K`;
  return `$${amount}`;
}

/**
 * The labelled text lines of the details, for the DefiLlama document: only the fields DefiLlama filled, in a fixed
 * order. Nothing in them moves from day to day (no TVL), so the document hash changes only when DefiLlama's data does.
 */
export function detailLines(d: DefillamaDetails): string[] {
  const lines: string[] = [];
  if (d.description !== null) lines.push(`Description: ${d.description}`);
  if (d.methodology !== null) lines.push(`Methodology: ${d.methodology}`);
  if (d.audits !== null) lines.push(`Audits: ${d.audits}`);
  if (d.auditLinks.length > 0) lines.push(`Audit links: ${d.auditLinks.join(", ")}`);
  if (d.github.length > 0) lines.push(`GitHub: ${d.github.join(", ")}`);
  if (d.raises.length > 0) {
    lines.push("Raises:");
    for (const r of d.raises) {
      const parts = [r.round ?? "Round n/a", r.amountUsd === null ? "amount n/a" : usd(r.amountUsd)];
      if (r.date !== null) parts.push(r.date);
      if (r.investors.length > 0) parts.push(`investors: ${r.investors.join(", ")}`);
      lines.push(`- ${parts.join(", ")}`);
    }
  }
  return lines;
}

/**
 * Whether the `/protocols` list itself carries the detail-only fields (`methodology`, `raises`, `github`): true when
 * any entry has one of those keys, even as null. Then the detail endpoint is not asked.
 */
export function listCarriesDetails(raw: unknown[]): boolean {
  return raw.some(
    (e) => typeof e === "object" && e !== null && ["methodology", "raises", "github"].some((key) => key in e),
  );
}

/** One entry of the full DefiLlama `/protocols` list, as the `signals` stage matches it to projects by domain. */
export interface DefillamaProtocol {
  name: string;
  url: string | null;
  /** Current TVL in USD, or null when missing or not a finite number. */
  tvl: number | null;
  /** CoinGecko id (the protocol has a listed token), or null. */
  geckoId: string | null;
  /** Logo URL as DefiLlama gives it (any host: the logo stage only downloads from icons.llama.fi), or null. */
  logo: string | null;
}

const nonEmptyString = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/**
 * Every protocol of a `/protocols` answer, tokened ones included (unlike `selectSpeculativeCandidates`). Entries
 * without a name are skipped; missing, empty or wrongly typed fields become null. Not an array: [].
 */
export function parseProtocols(raw: unknown): DefillamaProtocol[] {
  if (!Array.isArray(raw)) return [];
  const protocols: DefillamaProtocol[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const p = entry as Record<string, unknown>;
    const name = nonEmptyString(p.name);
    if (name === null) continue;
    protocols.push({
      name,
      url: nonEmptyString(p.url),
      tvl: typeof p.tvl === "number" && Number.isFinite(p.tvl) ? p.tvl : null,
      geckoId: nonEmptyString(p.gecko_id),
      logo: nonEmptyString(p.logo),
    });
  }
  return protocols;
}

const protocolSchema = z.object({
  name: z.string(),
  slug: z.string(),
  url: z.string().nullish(),
  twitter: z.string().nullish(),
  chains: z.array(z.string()),
  tvl: z.number().nullish(),
  change_7d: z.number().nullish(),
  category: z.string(),
  gecko_id: z.string().nullish(),
  symbol: z.string(),
  /** Unix seconds. */
  listedAt: z.number().nullish(),
  rugged: z.boolean().nullish(),
  deadFrom: z.unknown().nullish(),
  misrepresentedTokens: z.boolean().nullish(),
});

const TWITTER_HANDLE = /^[A-Za-z0-9_]{1,15}$/;

/** A bare X handle ("@" and surrounding spaces removed), or null when it is not a valid handle. */
function twitterHandle(raw: string | null | undefined): string | null {
  const handle = (raw ?? "").trim().replace(/^@/, "");
  return TWITTER_HANDLE.test(handle) ? handle : null;
}

const DAY_MS = 86_400_000;

/** A Date for a DefiLlama unix-seconds listing time, or null when it is missing not a positive finite number, or out of Date range. */
function listingDate(seconds: number | null | undefined): Date | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Picks DefiLlama protocols that look like pre-token ("speculative") airdrop candidates (spec 15.1):
 * no CoinGecko id, no ticker symbol, TVL of at least the threshold, not in an excluded category, and not
 * flagged rugged, dead or misrepresented. Protocols listed within `newWithinDays` of `now` come first, then
 * 7-day TVL change (desc, nulls last), then TVL (desc); the result is limited.
 */
export function selectSpeculativeCandidates(
  protocols: unknown[],
  opts: { minTvl: number; excludedCategories: string[]; limit: number; newWithinDays: number; now: Date },
): SpeculativeCandidate[] {
  const excluded = new Set(opts.excludedCategories.map((c) => c.toLowerCase()));
  const candidates: SpeculativeCandidate[] = [];

  for (const raw of protocols) {
    const parsed = protocolSchema.safeParse(raw);
    if (!parsed.success) continue;
    const p = parsed.data;

    if (p.gecko_id) continue;
    if (p.symbol !== "-") continue;
    if (typeof p.tvl !== "number" || !Number.isFinite(p.tvl) || p.tvl < opts.minTvl) continue;
    if (excluded.has(p.category.toLowerCase())) continue;
    if (p.rugged === true || p.misrepresentedTokens === true) continue;
    if (p.deadFrom !== null && p.deadFrom !== undefined && p.deadFrom !== "") continue;

    candidates.push({
      name: p.name,
      slug: p.slug,
      url: p.url ? p.url : null,
      twitter: twitterHandle(p.twitter),
      chains: p.chains,
      tvl: p.tvl,
      change7d: typeof p.change_7d === "number" && Number.isFinite(p.change_7d) ? p.change_7d : null,
      category: p.category,
      listedAt: listingDate(p.listedAt),
      details: parseProtocolDetail(raw),
    });
  }

  const youngSince = opts.now.getTime() - opts.newWithinDays * DAY_MS;
  const isYoung = (c: SpeculativeCandidate): boolean => c.listedAt !== null && c.listedAt.getTime() >= youngSince;

  candidates.sort((a, b) => {
    if (isYoung(a) !== isYoung(b)) return isYoung(a) ? -1 : 1;
    if (a.change7d !== b.change7d) {
      if (a.change7d === null) return 1;
      if (b.change7d === null) return -1;
      return b.change7d - a.change7d;
    }
    return b.tvl - a.tvl;
  });

  return candidates.slice(0, Math.max(0, opts.limit));
}
