import { domainMatches } from "@saf/core";
import type { NewSignal, SignalSource } from "@saf/core";
import type { DefillamaProtocol } from "../collectors/defillama.js";
import type { SourceKind } from "../collectors/types.js";
import type { PipelineConfig } from "../config.js";
import type { DailyStats } from "../stats.js";
import type { PipelineRepo, ProjectForScoring } from "../store/repo.js";

/**
 * Cached VC portfolios by registrable domain (loaded by the VC portfolio refresh). `checked` holds the ids of VCs
 * whose portfolio could be used this run, `failed` those that could not.
 */
export interface VcIndex {
  byDomain: Map<string, { vcId: string; name: string; tier: 1 | 2 }[]>;
  checked: Set<string>;
  failed: Set<string>;
}

/** What the `signals` stage matches projects against. Null = could not be fetched this run ("not checked"). */
export interface SignalContext {
  /** The full DefiLlama `/protocols` list from the collect stage. */
  protocols: DefillamaProtocol[] | null;
  vc: VcIndex | null;
}

/** Which signal sources were checked for this project; false means "not checked", never "none found". */
export interface SignalCoverage {
  defillama: boolean;
  vc: boolean;
}

/** Document source kinds that make a project a `curated_source` (DefiLlama lists protocols, it does not curate). */
const CURATED_SOURCES: Partial<Record<SourceKind, SignalSource>> = {
  airdrops_io: "airdrops_io",
  alphadrops: "alphadrops",
  telegram: "telegram",
};

/**
 * `tvl` and `coingecko_listed` from the DefiLlama protocols whose URL matches one of the project's official domains
 * (`domainMatches`; a name match never counts, so a project without official domains gets neither). When several
 * protocols match (versions or products of one project), the highest TVL is taken, and the CoinGecko id of the
 * matching protocol with the highest TVL that has one.
 */
function defillamaSignals(project: ProjectForScoring, protocols: DefillamaProtocol[]): NewSignal[] {
  if (project.officialDomains.length === 0) return [];
  const matches = protocols
    .filter((p) => p.url !== null && domainMatches(project.officialDomains, p.url))
    .sort((a, b) => (b.tvl ?? -1) - (a.tvl ?? -1));
  const signals: NewSignal[] = [];
  const tvl = matches.find((p) => p.tvl !== null)?.tvl;
  if (tvl !== undefined && tvl !== null) {
    signals.push({ kind: "tvl", value: { tvl_usd: tvl }, source: "defillama", verified: true });
  }
  const geckoId = matches.find((p) => p.geckoId !== null)?.geckoId;
  if (geckoId !== undefined && geckoId !== null) {
    signals.push({ kind: "coingecko_listed", value: { gecko_id: geckoId }, source: "defillama", verified: true });
  }
  return signals;
}

/** One `claimed_backer` per investor (trimmed, compared case-insensitively; the first quote wins). Never verified. */
function claimedBackers(project: ProjectForScoring): NewSignal[] {
  const seen = new Set<string>();
  const signals: NewSignal[] = [];
  for (const fact of project.facts) {
    if (fact.field !== "claimed_backer") continue;
    const investor = fact.value.trim();
    const key = investor.toLowerCase();
    if (investor === "" || seen.has(key)) continue;
    seen.add(key);
    signals.push({ kind: "claimed_backer", value: { investor, quote: fact.quote }, source: "llm_text", verified: false });
  }
  return signals;
}

/**
 * The signals of one project for this run (curation spec §5.2): verified DefiLlama `tvl`/`coingecko_listed` by
 * domain match, one `curated_source` per curated source kind among its documents, and its claimed backers.
 * `coverage` says which independent sources were checked.
 */
export function buildSignals(
  project: ProjectForScoring,
  ctx: SignalContext,
): { signals: NewSignal[]; coverage: SignalCoverage } {
  const signals: NewSignal[] = [];
  if (ctx.protocols !== null) signals.push(...defillamaSignals(project, ctx.protocols));
  for (const kind of project.sourceKinds) {
    const source = CURATED_SOURCES[kind];
    if (source !== undefined) {
      signals.push({ kind: "curated_source", value: { source_kind: kind }, source, verified: false });
    }
  }
  signals.push(...claimedBackers(project));
  return {
    signals,
    coverage: { defillama: ctx.protocols !== null, vc: ctx.vc !== null && ctx.vc.checked.size > 0 },
  };
}

/**
 * The `signals` stage: rewrites the signals of every project seen within `scoreActiveSinceDays`, all observed at
 * `now`. A project whose signals cannot be built or stored counts as `signals_failed`; the others continue.
 */
export async function refreshSignals(
  deps: { repo: PipelineRepo },
  config: PipelineConfig,
  now: Date,
  stats: DailyStats,
  ctx: SignalContext,
): Promise<void> {
  const projects = await deps.repo.listProjectsForScoring(config.scoreActiveSinceDays, now);
  for (const project of projects) {
    try {
      const { signals } = buildSignals(project, ctx);
      await deps.repo.replaceSignals(project.id, signals, now);
      stats.signals_tvl += signals.filter((s) => s.kind === "tvl").length;
      stats.signals_coingecko += signals.filter((s) => s.kind === "coingecko_listed").length;
    } catch {
      stats.signals_failed += 1;
    }
  }
}
