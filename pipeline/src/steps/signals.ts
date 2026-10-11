import { domainMatches, registrableDomain } from "@saf/core";
import type { NewSignal, SignalSource } from "@saf/core";
import type { DefillamaProtocol } from "../collectors/defillama.js";
import type { SourceKind } from "../collectors/types.js";
import type { PipelineConfig } from "../config.js";
import type { RaisePage, RaiseRound } from "../enrich/alphadrops-raises.js";
import type { DailyStats } from "../stats.js";
import type { PipelineRepo, ProjectForScoring, SignalKeep } from "../store/repo.js";

/**
 * Cached VC portfolios by registrable domain (loaded by the VC portfolio refresh). `checked` holds the ids of VCs
 * whose portfolio could be used this run, `failed` those that could not.
 */
export interface VcIndex {
  byDomain: Map<string, { vcId: string; name: string; tier: 1 | 2 }[]>;
  checked: Set<string>;
  failed: Set<string>;
}

/**
 * AlphaDrops raise pages of this run (loaded by `loadRaises`): fresh from the cache or fetched now, by slug.
 * `unchecked` holds the ids of projects with a raise page that could not be used this run.
 */
export interface AlphaRaises {
  pages: Record<string, RaisePage>;
  unchecked: ReadonlySet<string>;
}

/** What the `signals` stage matches projects against. Null = could not be fetched this run ("not checked"). */
export interface SignalContext {
  /** The full DefiLlama `/protocols` list from the collect stage. */
  protocols: DefillamaProtocol[] | null;
  vc: VcIndex | null;
  /** Missing or null: AlphaDrops raises were not checked this run. */
  raises?: AlphaRaises | null;
}

/** Which signal sources were checked for this project; false means "not checked", never "none found". */
export interface SignalCoverage {
  defillama: boolean;
  vc: boolean;
  alphadrops_raises: boolean;
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

/**
 * One verified `vc_backer` per VC whose cached portfolio holds the registrable domain of one of the project's
 * official domains. The lookup key is only a shortcut: each hit is confirmed with `domainMatches` (the trust
 * boundary, which also refuses platform hosts), so a name match or a claim never counts.
 */
function vcBackers(project: ProjectForScoring, vc: VcIndex): NewSignal[] {
  const signals: NewSignal[] = [];
  const seen = new Set<string>();
  for (const official of project.officialDomains) {
    const key = registrableDomain(`https://${official}`);
    if (key === null || !domainMatches(project.officialDomains, key)) continue;
    for (const entry of vc.byDomain.get(key) ?? []) {
      if (seen.has(entry.vcId)) continue;
      seen.add(entry.vcId);
      signals.push({
        kind: "vc_backer",
        value: { investor: entry.name, tier: entry.tier },
        source: "vc_portfolio",
        verified: true,
      });
    }
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

/** Rounds newest first (by date; undated rounds last), page order kept between equal dates. */
const newestFirst = (rounds: RaiseRound[]): RaiseRound[] =>
  [...rounds].sort((a, b) => {
    const [x, y] = [a.date ?? "", b.date ?? ""];
    return x === y ? 0 : x < y ? 1 : -1;
  });

/**
 * One `reported_backer` per investor (trimmed, compared case-insensitively) of every raise page whose official
 * website matches one of the project's official domains (`domainMatches`: the page was picked by name, but only the
 * domain decides). `lead` when the investor led any round; `round`, `round_date` and `source_url` are those of the
 * newest round it is in; `amount_usd` is the total of the page's disclosed round amounts (null when none is). Never
 * verified: it is what AlphaDrops reports.
 */
function reportedBackers(project: ProjectForScoring, raises: AlphaRaises): NewSignal[] {
  if (project.officialDomains.length === 0 || raises.unchecked.has(project.id)) return [];
  const backers = new Map<string, Record<string, unknown> & { lead: boolean }>();
  for (const slug of Object.keys(raises.pages).sort()) {
    const page = raises.pages[slug];
    if (!page?.officialDomain || !domainMatches(project.officialDomains, page.officialDomain)) continue;
    const amounts = page.rounds.flatMap((r) => (r.amountUsd === null ? [] : [r.amountUsd]));
    const total = amounts.length === 0 ? null : amounts.reduce((sum, a) => sum + a, 0);
    for (const round of newestFirst(page.rounds)) {
      const named = [...round.lead.map((i) => [i, true] as const), ...round.others.map((i) => [i, false] as const)];
      for (const [name, lead] of named) {
        const investor = name.trim();
        const key = investor.toLowerCase();
        if (investor === "") continue;
        const known = backers.get(key);
        if (known !== undefined) {
          known.lead ||= lead;
          continue;
        }
        backers.set(key, {
          investor,
          lead,
          amount_usd: total,
          round: round.round,
          round_date: round.date,
          source_url: round.sourceUrl,
        });
      }
    }
  }
  return [...backers.values()].map((value) => ({ kind: "reported_backer", value, source: "alphadrops", verified: false }));
}

/**
 * The signals of one project for this run (curation spec §5.2): verified DefiLlama `tvl`/`coingecko_listed` and
 * `vc_backer` by domain match, one `curated_source` per curated source kind among its documents, its claimed
 * backers, and the backers AlphaDrops reports for its domain. `coverage` says which independent sources were checked.
 */
export function buildSignals(
  project: ProjectForScoring,
  ctx: SignalContext,
): { signals: NewSignal[]; coverage: SignalCoverage } {
  const signals: NewSignal[] = [];
  const raises = ctx.raises ?? null;
  if (ctx.protocols !== null) signals.push(...defillamaSignals(project, ctx.protocols));
  if (ctx.vc !== null) signals.push(...vcBackers(project, ctx.vc));
  for (const kind of project.sourceKinds) {
    const source = CURATED_SOURCES[kind];
    if (source !== undefined) {
      signals.push({ kind: "curated_source", value: { source_kind: kind }, source, verified: false });
    }
  }
  signals.push(...claimedBackers(project));
  if (raises !== null) signals.push(...reportedBackers(project, raises));
  return {
    signals,
    coverage: {
      defillama: ctx.protocols !== null,
      vc: ctx.vc !== null && ctx.vc.checked.size > 0,
      alphadrops_raises: raises !== null && !raises.unchecked.has(project.id),
    },
  };
}

/**
 * The `vc_backer` signals a run must leave in place: all of them when no portfolio was loaded, otherwise those of
 * each listed VC whose portfolio was not checked (its page failed and its cache is over 14 days old). "Not checked"
 * is per VC: the backers of the checked VCs are rewritten, those of a VC no longer in the list are dropped.
 */
function keptVcBackers(vcs: PipelineConfig["vcs"], vc: VcIndex | null): SignalKeep[] {
  if (vc === null) return ["vc_portfolio"];
  return vcs.filter((v) => !vc.checked.has(v.id)).map((v) => ({ source: "vc_portfolio", investor: v.name }));
}

/**
 * The `signals` stage: rewrites the signals of every project seen within `scoreActiveSinceDays`, all observed at
 * `now`. A source not checked this run (spec §9: "not checked", never "none") keeps the project's earlier signals
 * with their own `observed_at` instead of deleting them: all `defillama` signals when DefiLlama was not fetched, the
 * `vc_backer` of each VC whose portfolio was not checked, and the `reported_backer` of a project whose AlphaDrops
 * raises were not checked (its AlphaDrops `curated_source` is still rewritten). A project whose signals cannot be
 * built or stored counts as `signals_failed`; the others continue.
 */
export async function refreshSignals(
  deps: { repo: PipelineRepo },
  config: PipelineConfig,
  now: Date,
  stats: DailyStats,
  ctx: SignalContext,
  /** The projects seen within `scoreActiveSinceDays`, when the caller already listed them. */
  active?: ProjectForScoring[],
): Promise<void> {
  const projects = active ?? (await deps.repo.listProjectsForScoring(config.scoreActiveSinceDays, now));
  const keepVc = keptVcBackers(config.vcs, ctx.vc);
  for (const project of projects) {
    try {
      const { signals, coverage } = buildSignals(project, ctx);
      const keep: SignalKeep[] = [...keepVc];
      if (!coverage.defillama) keep.push("defillama");
      if (!coverage.alphadrops_raises) keep.push({ source: "alphadrops", kind: "reported_backer" });
      await deps.repo.replaceSignals(project.id, signals, now, keep);
      stats.signals_tvl += signals.filter((s) => s.kind === "tvl").length;
      stats.signals_coingecko += signals.filter((s) => s.kind === "coingecko_listed").length;
      if (signals.some((s) => s.kind === "vc_backer")) stats.signals_vc_backer += 1;
      if (signals.some((s) => s.kind === "reported_backer")) stats.raises_matched += 1;
    } catch {
      stats.signals_failed += 1;
    }
  }
}
