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
});

const TWITTER_HANDLE = /^[A-Za-z0-9_]{1,15}$/;

/** A bare X handle ("@" and surrounding spaces removed), or null when it is not a valid handle. */
function twitterHandle(raw: string | null | undefined): string | null {
  const handle = (raw ?? "").trim().replace(/^@/, "");
  return TWITTER_HANDLE.test(handle) ? handle : null;
}

/**
 * Picks DefiLlama protocols that look like pre-token ("speculative") airdrop candidates:
 * no CoinGecko id, no ticker symbol, TVL above the threshold, and not in an excluded category.
 * Sorted by 7-day TVL change (desc, nulls last), ties broken by TVL (desc), then limited.
 */
export function selectSpeculativeCandidates(
  protocols: unknown[],
  opts: { minTvl: number; excludedCategories: string[]; limit: number },
): SpeculativeCandidate[] {
  const excluded = new Set(opts.excludedCategories.map((c) => c.toLowerCase()));
  const candidates: SpeculativeCandidate[] = [];

  for (const raw of protocols) {
    const parsed = protocolSchema.safeParse(raw);
    if (!parsed.success) continue;
    const p = parsed.data;

    if (p.gecko_id) continue;
    if (p.symbol !== "-") continue;
    if (typeof p.tvl !== "number" || !Number.isFinite(p.tvl) || p.tvl <= opts.minTvl) continue;
    if (excluded.has(p.category.toLowerCase())) continue;

    candidates.push({
      name: p.name,
      slug: p.slug,
      url: p.url ? p.url : null,
      twitter: twitterHandle(p.twitter),
      chains: p.chains,
      tvl: p.tvl,
      change7d: typeof p.change_7d === "number" && Number.isFinite(p.change_7d) ? p.change_7d : null,
      category: p.category,
    });
  }

  candidates.sort((a, b) => {
    if (a.change7d !== b.change7d) {
      if (a.change7d === null) return 1;
      if (b.change7d === null) return -1;
      return b.change7d - a.change7d;
    }
    return b.tvl - a.tvl;
  });

  return candidates.slice(0, Math.max(0, opts.limit));
}
