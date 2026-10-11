import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { NewSignal } from "@saf/core";
import type { DefillamaProtocol } from "../src/collectors/defillama.js";
import { defaultConfig } from "../src/config.js";
import type { PipelineConfig, VcConfig } from "../src/config.js";
import { parseRaisePage } from "../src/enrich/alphadrops-raises.js";
import type { RaisePage, RaiseRound } from "../src/enrich/alphadrops-raises.js";
import { emptyStats } from "../src/stats.js";
import { buildSignals, refreshSignals } from "../src/steps/signals.js";
import type { AlphaRaises, VcIndex } from "../src/steps/signals.js";
import { MemoryRepo } from "../src/store/memory-repo.js";
import type { NewProject, ProjectForScoring } from "../src/store/repo.js";

const NOW = new Date("2026-10-10T03:00:00Z");

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

function project(overrides: Partial<ProjectForScoring> = {}): ProjectForScoring {
  return {
    id: "p-1",
    slug: "arcus",
    name: "Arcus",
    nameKey: "arcus",
    tokenSymbol: null,
    chains: [],
    officialDomains: ["arcus.xyz"],
    status: "live",
    conflict: false,
    lookalikeOf: null,
    firstSeen: NOW,
    lastSeen: NOW,
    tasks: [],
    steps: [],
    facts: [],
    deadlines: [],
    links: [],
    sourceCount: 0,
    sourceKinds: [],
    lookalikeOfName: null,
    lookalikeOfDomains: [],
    sourceAsks: [],
    signals: [],
    ...overrides,
  };
}

const kinds = (r: { signals: NewSignal[] }): string[] => r.signals.map((s) => s.kind);

const ARCUS: DefillamaProtocol = { name: "Arcus", url: "https://arcus.xyz", tvl: 45_000_000, geckoId: null, logo: null };

type VcEntry = { vcId: string; name: string; tier: 1 | 2 };
const PARADIGM_ENTRY: VcEntry = { vcId: "paradigm", name: "Paradigm", tier: 1 };

/** A VC index of these portfolio domains; every VC in it counts as checked. */
function index(byDomain: Record<string, VcEntry[]>): VcIndex {
  const entries = Object.values(byDomain).flat();
  return { byDomain: new Map(Object.entries(byDomain)), checked: new Set(entries.map((e) => e.vcId)), failed: new Set() };
}

describe("buildSignals", () => {
  it("gives TVL only to the project whose domain matches, not to a same-name lookalike", () => {
    const protocols = [{ name: "Arcus", url: "https://arcus.xyz", tvl: 45_000_000, geckoId: null, logo: null }];
    expect(kinds(buildSignals(project({ name: "Arcus", officialDomains: ["arcus.xyz"] }), { protocols, vc: null }))).toContain("tvl");
    expect(kinds(buildSignals(project({ name: "Arcus", officialDomains: ["arcus-claim.io"] }), { protocols, vc: null }))).not.toContain("tvl");
  });

  it("never marks a claimed backer as verified", () => {
    const s = buildSignals(project({ facts: [{ field: "claimed_backer", value: "Paradigm", quote: "backed by Paradigm" }] }), { protocols: [], vc: null });
    expect(s.signals.find((x) => x.kind === "claimed_backer")).toMatchObject({ verified: false, source: "llm_text" });
  });

  it("records defillama as not checked when protocols could not be fetched", () => {
    expect(buildSignals(project({}), { protocols: null, vc: null }).coverage.defillama).toBe(false);
  });

  it("records defillama as checked when the protocol list was fetched, even without a match", () => {
    expect(buildSignals(project({}), { protocols: [], vc: null }).coverage.defillama).toBe(true);
  });

  it("stores the matched TVL as a verified DefiLlama signal", () => {
    expect(buildSignals(project(), { protocols: [ARCUS], vc: null }).signals).toEqual([
      { kind: "tvl", value: { tvl_usd: 45_000_000 }, source: "defillama", verified: true },
    ]);
  });

  it("adds coingecko_listed when the matched protocol has a CoinGecko id", () => {
    const protocols = [{ ...ARCUS, url: "https://app.arcus.xyz/", tvl: null, geckoId: "arcus" }];
    expect(buildSignals(project(), { protocols, vc: null }).signals).toEqual([
      { kind: "coingecko_listed", value: { gecko_id: "arcus" }, source: "defillama", verified: true },
    ]);
  });

  it("takes the highest TVL and the CoinGecko id of the biggest listed protocol when several match", () => {
    const protocols: DefillamaProtocol[] = [
      { name: "Arcus V1", url: "https://arcus.xyz/v1", tvl: 3_000_000, geckoId: "arcus-old", logo: null },
      { name: "Arcus V2", url: "https://v2.arcus.xyz", tvl: 80_000_000, geckoId: null, logo: null },
      { name: "Arcus Perps", url: "https://perps.arcus.xyz", tvl: 12_000_000, geckoId: "arcus", logo: null },
      { name: "Unrelated", url: "https://other.xyz", tvl: 9e9, geckoId: "other", logo: null },
    ];
    expect(buildSignals(project(), { protocols, vc: null }).signals).toEqual([
      { kind: "tvl", value: { tvl_usd: 80_000_000 }, source: "defillama", verified: true },
      { kind: "coingecko_listed", value: { gecko_id: "arcus" }, source: "defillama", verified: true },
    ]);
  });

  it("gives no verified signal to a project without an official domain, whatever its name", () => {
    const protocols = [{ ...ARCUS, geckoId: "arcus" }];
    const result = buildSignals(project({ officialDomains: [] }), { protocols, vc: null });
    expect(result.signals.filter((s) => s.verified)).toEqual([]);
  });

  it("ignores protocols without a URL", () => {
    expect(buildSignals(project(), { protocols: [{ ...ARCUS, url: null }], vc: null }).signals).toEqual([]);
  });

  it("adds a curated_source per curated source kind, never for DefiLlama", () => {
    const result = buildSignals(project({ sourceKinds: ["airdrops_io", "alphadrops", "defillama", "telegram"] }), {
      protocols: [],
      vc: null,
    });
    expect(result.signals).toEqual([
      { kind: "curated_source", value: { source_kind: "airdrops_io" }, source: "airdrops_io", verified: false },
      { kind: "curated_source", value: { source_kind: "alphadrops" }, source: "alphadrops", verified: false },
      { kind: "curated_source", value: { source_kind: "telegram" }, source: "telegram", verified: false },
    ]);
  });

  it("adds one claimed_backer per investor with its quote, ignoring other facts and empty investors", () => {
    const facts = [
      { field: "claimed_backer", value: "Paradigm", quote: "backed by Paradigm" },
      { field: "key_parameter:allocation", value: "5%", quote: "5% of supply" },
      { field: "claimed_backer", value: " paradigm ", quote: "Paradigm led the round" },
      { field: "claimed_backer", value: "  ", quote: "backed by" },
      { field: "claimed_backer", value: "a16z crypto", quote: "and a16z crypto" },
    ];
    expect(buildSignals(project({ facts }), { protocols: [], vc: null }).signals).toEqual([
      { kind: "claimed_backer", value: { investor: "Paradigm", quote: "backed by Paradigm" }, source: "llm_text", verified: false },
      { kind: "claimed_backer", value: { investor: "a16z crypto", quote: "and a16z crypto" }, source: "llm_text", verified: false },
    ]);
  });

  it("adds a verified vc_backer when the project domain is in a portfolio", () => {
    const vc = index({ "arcus.xyz": [{ vcId: "paradigm", name: "Paradigm", tier: 1 }] });
    expect(buildSignals(project({ officialDomains: ["arcus.xyz"] }), { protocols: [], vc }).signals)
      .toContainEqual({ kind: "vc_backer", value: { investor: "Paradigm", tier: 1 }, source: "vc_portfolio", verified: true });
  });

  it("gives a VC backer only to the project whose domain matches, not to a same-name lookalike or a name claim", () => {
    const vc = index({ "arcus.xyz": [PARADIGM_ENTRY] });
    const claim = [{ field: "claimed_backer", value: "Paradigm", quote: "backed by Paradigm" }];
    const fake = buildSignals(project({ name: "Arcus", officialDomains: ["arcus-claim.io"], facts: claim }), { protocols: [], vc });
    expect(fake.signals.filter((s) => s.kind === "vc_backer")).toEqual([]);
    expect(buildSignals(project({ officialDomains: [] }), { protocols: [], vc }).signals).toEqual([]);
  });

  it("matches a portfolio domain on the registrable domain of an official subdomain", () => {
    const vc = index({ "arcus.xyz": [PARADIGM_ENTRY] });
    expect(kinds(buildSignals(project({ officialDomains: ["app.arcus.xyz"] }), { protocols: [], vc }))).toEqual(["vc_backer"]);
  });

  it("never matches a platform host, even when a portfolio cache holds it", () => {
    const vc = index({ "github.com": [PARADIGM_ENTRY], "notion.site": [PARADIGM_ENTRY] });
    const result = buildSignals(project({ officialDomains: ["github.com", "arcus.notion.site"] }), { protocols: [], vc });
    expect(result.signals).toEqual([]);
  });

  it("adds one vc_backer per VC, however many official domains are in its portfolio", () => {
    const vc = index({
      "arcus.xyz": [PARADIGM_ENTRY, { vcId: "variant", name: "Variant", tier: 2 }],
      "arcus.finance": [PARADIGM_ENTRY],
    });
    expect(buildSignals(project({ officialDomains: ["arcus.xyz", "arcus.finance"] }), { protocols: [], vc }).signals).toEqual([
      { kind: "vc_backer", value: { investor: "Paradigm", tier: 1 }, source: "vc_portfolio", verified: true },
      { kind: "vc_backer", value: { investor: "Variant", tier: 2 }, source: "vc_portfolio", verified: true },
    ]);
  });

  describe("reported backers (AlphaDrops)", () => {
    const ctx = { protocols: [], vc: null };
    const RAISE_PAGE = parseRaisePage(fixture("alphadrops-raise.html"));
    const raises = (pages: Record<string, RaisePage>, unchecked: string[] = []): AlphaRaises => ({
      pages,
      unchecked: new Set(unchecked),
    });
    const round = (over: Partial<RaiseRound>): RaiseRound => ({
      round: "Seed Round",
      date: null,
      amountUsd: null,
      lead: [],
      others: [],
      sourceUrl: null,
      ...over,
    });

    it("accepts AlphaDrops rounds only when the official website matches the project domain", () => {
      const page = parseRaisePage(fixture("alphadrops-raise.html")); // Catalyst, Official Website catalyst.app, Sequoia lead
      expect(kinds(buildSignals(project({ officialDomains: ["catalyst.app"] }), { ...ctx, raises: raises({ catalyst: page }) }))).toContain("reported_backer");
      // A scam using the name of a project in the AlphaDrops fundraising list gets nothing: its domain differs.
      expect(kinds(buildSignals(project({ name: "Catalyst", officialDomains: ["catalyst-claim.io"] }), { ...ctx, raises: raises({ catalyst: page }) }))).not.toContain("reported_backer");
      expect(kinds(buildSignals(project({ name: "Catalyst", officialDomains: [] }), { ...ctx, raises: raises({ catalyst: page }) }))).toEqual([]);
    });

    it("never marks a reported backer as verified", () => {
      const result = buildSignals(project({ officialDomains: ["app.catalyst.app"] }), { ...ctx, raises: raises({ catalyst: RAISE_PAGE }) });
      const reported = result.signals.filter((s) => s.kind === "reported_backer");
      expect(reported).toHaveLength(8);
      expect(reported.every((s) => s.verified === false && s.source === "alphadrops")).toBe(true);
      expect(reported[0]).toEqual({
        kind: "reported_backer",
        value: {
          investor: "Sequoia Capital",
          lead: true,
          amount_usd: 30_000_000,
          round: "Seed Round",
          round_date: "2026-10-08",
          source_url: "https://dropstab.com/coins/catalyst-labs/fundraising",
        },
        source: "alphadrops",
        verified: false,
      });
      expect(reported[1]?.value).toMatchObject({ investor: "Peak XV Partners(ex-Sequoia India)", lead: false });
    });

    it("gives one backer per investor with the total raised, its latest round, and lead when it led any round", () => {
      const page: RaisePage = {
        officialDomain: "arcus.xyz",
        rounds: [
          round({ round: "Seed", date: "2024-02-01", amountUsd: 4_000_000, lead: ["Paradigm"], others: ["Variant"], sourceUrl: "https://seed.test/" }),
          round({ round: "Series A", date: "2026-01-15", amountUsd: 20_000_000, lead: ["a16z crypto"], others: [" paradigm ", "Angel", ""] }),
          round({ round: "Strategic", date: null, amountUsd: null, others: ["Angel"] }),
        ],
      };
      const signals = buildSignals(project(), { ...ctx, raises: raises({ arcus: page }) }).signals;
      expect(signals.map((s) => s.value)).toEqual([
        { investor: "a16z crypto", lead: true, amount_usd: 24_000_000, round: "Series A", round_date: "2026-01-15", source_url: null },
        { investor: "paradigm", lead: true, amount_usd: 24_000_000, round: "Series A", round_date: "2026-01-15", source_url: null },
        { investor: "Angel", lead: false, amount_usd: 24_000_000, round: "Series A", round_date: "2026-01-15", source_url: null },
        { investor: "Variant", lead: false, amount_usd: 24_000_000, round: "Seed", round_date: "2024-02-01", source_url: "https://seed.test/" },
      ]);
    });

    it("gives a null amount when no round discloses one", () => {
      const page: RaisePage = { officialDomain: "arcus.xyz", rounds: [round({ others: ["Angel"] })] };
      const [signal] = buildSignals(project(), { ...ctx, raises: raises({ arcus: page }) }).signals;
      expect(signal?.value).toMatchObject({ investor: "Angel", amount_usd: null });
    });

    it("never matches a raise page whose official website is a platform host or missing", () => {
      const onX: RaisePage = { officialDomain: "x.com", rounds: [round({ lead: ["Paradigm"] })] };
      const none: RaisePage = { officialDomain: null, rounds: [round({ lead: ["Paradigm"] })] };
      expect(buildSignals(project({ officialDomains: ["x.com"] }), { ...ctx, raises: raises({ onx: onX, none }) }).signals).toEqual([]);
    });

    it("records AlphaDrops raises as checked only when they were loaded and the project's pages were all usable", () => {
      const coverage = (r: AlphaRaises | null | undefined) =>
        buildSignals(project({ id: "p-1" }), { ...ctx, raises: r }).coverage.alphadrops_raises;
      expect(coverage(undefined)).toBe(false);
      expect(coverage(null)).toBe(false);
      expect(coverage(raises({}, ["p-1"]))).toBe(false);
      expect(coverage(raises({}, ["p-2"]))).toBe(true);
    });

    it("gives no reported backer to a project whose raise pages were not checked", () => {
      const page = { ...RAISE_PAGE, officialDomain: "arcus.xyz" };
      expect(buildSignals(project({ id: "p-1" }), { ...ctx, raises: raises({ arcus: page }, ["p-1"]) }).signals).toEqual([]);
    });
  });

  it("records vc as not checked without a VC index, and as checked once one VC was checked", () => {
    const vc = (checked: string[]): VcIndex => ({ byDomain: new Map(), checked: new Set(checked), failed: new Set() });
    expect(buildSignals(project(), { protocols: [], vc: null }).coverage.vc).toBe(false);
    expect(buildSignals(project(), { protocols: [], vc: vc([]) }).coverage.vc).toBe(false);
    expect(buildSignals(project(), { protocols: [], vc: vc(["paradigm"]) }).coverage.vc).toBe(true);
  });
});

function newProject(name: string, officialDomains: string[]): NewProject {
  const key = name.toLowerCase();
  return { slug: key, name, nameKey: key, tokenSymbol: null, chains: [], officialDomains, status: "live", conflict: false, lookalikeOf: null };
}

describe("refreshSignals", () => {
  it("replaces each active project's signals and counts TVL and CoinGecko signals", async () => {
    const repo = new MemoryRepo();
    const arcus = await repo.createProject(newProject("Arcus", ["arcus.xyz"]), NOW);
    const fake = await repo.createProject(newProject("Arcus Claim", ["arcus-claim.io"]), NOW);
    const doc = await repo.upsertDocument(
      { sourceKind: "airdrops_io", sourceKey: "airdrops_io:latest", url: "https://airdrops.io/arcus/", text: "t", publishedAt: null, pageUpdatedAt: null, fetchedAt: NOW },
      "h",
    );
    await repo.addEvidence({ projectId: fake.id, documentId: doc.id, field: "status", value: "live", quote: "q", at: NOW });
    await repo.replaceSignals(arcus.id, [{ kind: "tvl", value: { tvl_usd: 1 }, source: "defillama", verified: true }], NOW);
    const stats = emptyStats();

    await refreshSignals({ repo }, defaultConfig, NOW, stats, { protocols: [{ ...ARCUS, geckoId: "arcus" }], vc: null });

    expect(repo.signals.filter((s) => s.projectId === arcus.id)).toEqual([
      { projectId: arcus.id, kind: "tvl", value: { tvl_usd: 45_000_000 }, source: "defillama", verified: true, observedAt: NOW },
      { projectId: arcus.id, kind: "coingecko_listed", value: { gecko_id: "arcus" }, source: "defillama", verified: true, observedAt: NOW },
    ]);
    expect(repo.signals.filter((s) => s.projectId === fake.id)).toEqual([
      { projectId: fake.id, kind: "curated_source", value: { source_kind: "airdrops_io" }, source: "airdrops_io", verified: false, observedAt: NOW },
    ]);
    expect(stats).toMatchObject({ signals_tvl: 1, signals_coingecko: 1, signals_failed: 0 });
  });

  it("counts a project whose signals cannot be stored as signals_failed and continues with the others", async () => {
    const repo = new MemoryRepo();
    const broken = await repo.createProject(newProject("Broken", ["arcus.xyz"]), NOW);
    const ok = await repo.createProject(newProject("Arcus", ["arcus.xyz"]), NOW);
    const replace = repo.replaceSignals.bind(repo);
    repo.replaceSignals = async (projectId, signals, at, keepSources) => {
      if (projectId === broken.id) throw new Error("db write failed");
      return replace(projectId, signals, at, keepSources);
    };
    const stats = emptyStats();

    await refreshSignals({ repo }, defaultConfig, NOW, stats, { protocols: [ARCUS], vc: null });

    expect(stats).toMatchObject({ signals_tvl: 1, signals_coingecko: 0, signals_failed: 1 });
    expect(repo.signals.map((s) => [s.projectId, s.kind])).toEqual([[ok.id, "tvl"]]);
  });

  it("keeps the DefiLlama signals of the last check when the protocol list could not be fetched", async () => {
    const repo = new MemoryRepo();
    const arcus = await repo.createProject(newProject("Arcus", ["arcus.xyz"]), NOW);
    const doc = await repo.upsertDocument(
      { sourceKind: "telegram", sourceKey: "telegram:chan", url: "https://t.me/chan/1", text: "t", publishedAt: null, pageUpdatedAt: null, fetchedAt: NOW },
      "h",
    );
    const earlier = new Date(NOW.getTime() - 86_400_000);
    await repo.replaceSignals(
      arcus.id,
      [
        { kind: "tvl", value: { tvl_usd: 45_000_000 }, source: "defillama", verified: true },
        { kind: "coingecko_listed", value: { gecko_id: "arcus" }, source: "defillama", verified: true },
        { kind: "claimed_backer", value: { investor: "Paradigm", quote: "q" }, source: "llm_text", verified: false },
      ],
      earlier,
    );
    await repo.addEvidence({ projectId: arcus.id, documentId: doc.id, field: "status", value: "live", quote: "q", at: NOW });
    const stats = emptyStats();

    await refreshSignals({ repo }, defaultConfig, NOW, stats, { protocols: null, vc: null });

    // Not checked is not "none": the last checked TVL and listing stay, still dated when they were checked.
    expect(repo.signals.filter((s) => s.projectId === arcus.id)).toEqual([
      { projectId: arcus.id, kind: "tvl", value: { tvl_usd: 45_000_000 }, source: "defillama", verified: true, observedAt: earlier },
      { projectId: arcus.id, kind: "coingecko_listed", value: { gecko_id: "arcus" }, source: "defillama", verified: true, observedAt: earlier },
      { projectId: arcus.id, kind: "curated_source", value: { source_kind: "telegram" }, source: "telegram", verified: false, observedAt: NOW },
    ]);
    expect(stats).toMatchObject({ signals_tvl: 0, signals_coingecko: 0, signals_failed: 0 });
  });

  describe("VC backers", () => {
    const vcConfig = (id: string, name: string, tier: 1 | 2): VcConfig => ({
      id,
      name,
      aliases: [],
      tier,
      portfolioUrl: `https://${id}.test/portfolio`,
    });
    const config: PipelineConfig = {
      ...defaultConfig,
      vcs: [vcConfig("paradigm", "Paradigm", 1), vcConfig("variant", "Variant", 2), vcConfig("polychain", "Polychain", 1)],
    };
    const backer = (investor: string, tier: 1 | 2): NewSignal => ({
      kind: "vc_backer",
      value: { investor, tier },
      source: "vc_portfolio",
      verified: true,
    });
    const earlier = new Date(NOW.getTime() - 86_400_000);

    async function arcusWithBackers(repo: MemoryRepo): Promise<string> {
      const arcus = await repo.createProject(newProject("Arcus", ["arcus.xyz"]), NOW);
      await repo.replaceSignals(arcus.id, [backer("Paradigm", 1), backer("Variant", 2), backer("Polychain", 1)], earlier);
      return arcus.id;
    }

    it("keeps the backers of a VC that was not checked when another VC was, and drops those no longer listed", async () => {
      const repo = new MemoryRepo();
      const arcusId = await arcusWithBackers(repo);
      const stats = emptyStats();
      // Paradigm still lists Arcus; Polychain was checked and no longer does; Variant's page failed without a cache.
      const vc: VcIndex = {
        byDomain: new Map([["arcus.xyz", [{ vcId: "paradigm", name: "Paradigm", tier: 1 }]]]),
        checked: new Set(["paradigm", "polychain"]),
        failed: new Set(["variant"]),
      };

      await refreshSignals({ repo }, config, NOW, stats, { protocols: [], vc });

      expect(repo.signals.filter((s) => s.projectId === arcusId)).toEqual([
        { projectId: arcusId, ...backer("Variant", 2), observedAt: earlier },
        { projectId: arcusId, ...backer("Paradigm", 1), observedAt: NOW },
      ]);
      expect(stats).toMatchObject({ signals_vc_backer: 1, signals_failed: 0 });
    });

    it("keeps every VC backer when the portfolios could not be loaded at all", async () => {
      const repo = new MemoryRepo();
      const arcusId = await arcusWithBackers(repo);
      const stats = emptyStats();

      await refreshSignals({ repo }, config, NOW, stats, { protocols: [], vc: null });

      expect(repo.signals.filter((s) => s.projectId === arcusId).map((s) => [s.value.investor, s.observedAt])).toEqual([
        ["Paradigm", earlier],
        ["Variant", earlier],
        ["Polychain", earlier],
      ]);
      expect(stats.signals_vc_backer).toBe(0);
    });

    it("drops the backers of a VC that is no longer in the list", async () => {
      const repo = new MemoryRepo();
      const arcusId = await arcusWithBackers(repo);
      const vc: VcIndex = { byDomain: new Map(), checked: new Set(["paradigm", "variant"]), failed: new Set() };

      await refreshSignals({ repo }, { ...config, vcs: config.vcs.slice(0, 2) }, NOW, emptyStats(), { protocols: [], vc });

      expect(repo.signals.filter((s) => s.projectId === arcusId)).toEqual([]);
    });
  });

  describe("reported backers (AlphaDrops)", () => {
    const earlier = new Date(NOW.getTime() - 86_400_000);
    const reported = (investor: string): NewSignal => ({
      kind: "reported_backer",
      value: { investor, lead: true, amount_usd: 5_000_000, round: "Seed", round_date: null, source_url: null },
      source: "alphadrops",
      verified: false,
    });
    const page: RaisePage = {
      officialDomain: "arcus.xyz",
      rounds: [{ round: "Seed", date: null, amountUsd: 5_000_000, lead: ["Paradigm"], others: [], sourceUrl: null }],
    };

    /** Arcus with an AlphaDrops document and the reported backers of an earlier run. */
    async function arcusFromAlphaDrops(repo: MemoryRepo): Promise<string> {
      const arcus = await repo.createProject(newProject("Arcus", ["arcus.xyz"]), NOW);
      const doc = await repo.upsertDocument(
        { sourceKind: "alphadrops", sourceKey: "alphadrops", url: "https://alphadrops.net/airdrops/arcus", text: "t", publishedAt: null, pageUpdatedAt: null, fetchedAt: NOW },
        "h",
      );
      await repo.addEvidence({ projectId: arcus.id, documentId: doc.id, field: "status", value: "live", quote: "q", at: NOW });
      await repo.replaceSignals(arcus.id, [reported("Paradigm"), reported("Variant")], earlier);
      return arcus.id;
    }

    it("rewrites the reported backers of a checked project and counts it as matched", async () => {
      const repo = new MemoryRepo();
      const arcusId = await arcusFromAlphaDrops(repo);
      const stats = emptyStats();

      await refreshSignals({ repo }, defaultConfig, NOW, stats, { protocols: [], vc: null, raises: { pages: { arcus: page }, unchecked: new Set() } });

      expect(repo.signals.filter((s) => s.projectId === arcusId)).toEqual([
        { projectId: arcusId, kind: "curated_source", value: { source_kind: "alphadrops" }, source: "alphadrops", verified: false, observedAt: NOW },
        { projectId: arcusId, ...reported("Paradigm"), observedAt: NOW },
      ]);
      expect(stats.raises_matched).toBe(1);
    });

    it("keeps the earlier reported backers when AlphaDrops was not checked, and still rewrites its curated source", async () => {
      const repo = new MemoryRepo();
      const arcusId = await arcusFromAlphaDrops(repo);
      const stats = emptyStats();

      for (const raises of [null, { pages: { arcus: page }, unchecked: new Set([arcusId]) }]) {
        await refreshSignals({ repo }, defaultConfig, NOW, stats, { protocols: [], vc: null, raises });

        expect(repo.signals.filter((s) => s.projectId === arcusId)).toEqual([
          { projectId: arcusId, ...reported("Paradigm"), observedAt: earlier },
          { projectId: arcusId, ...reported("Variant"), observedAt: earlier },
          { projectId: arcusId, kind: "curated_source", value: { source_kind: "alphadrops" }, source: "alphadrops", verified: false, observedAt: NOW },
        ]);
      }
      expect(stats.raises_matched).toBe(0);
    });
  });

  it("skips projects not seen within scoreActiveSinceDays", async () => {
    const repo = new MemoryRepo();
    await repo.createProject(newProject("Arcus", ["arcus.xyz"]), new Date(NOW.getTime() - 61 * 86_400_000));
    const stats = emptyStats();

    await refreshSignals({ repo }, defaultConfig, NOW, stats, { protocols: [ARCUS], vc: null });

    expect(repo.signals).toEqual([]);
    expect(stats.signals_tvl).toBe(0);
  });
});
