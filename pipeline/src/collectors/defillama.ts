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
}

/** One entry of the full DefiLlama `/protocols` list, as the `signals` stage matches it to projects by domain. */
export interface DefillamaProtocol {
  name: string;
  url: string | null;
  /** Current TVL in USD, or null when missing or not a finite number. */
  tvl: number | null;
  /** CoinGecko id (the protocol has a listed token), or null. */
  geckoId: string | null;
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
