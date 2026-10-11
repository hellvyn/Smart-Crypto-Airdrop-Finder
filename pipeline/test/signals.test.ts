import { describe, expect, it } from "vitest";
import type { NewSignal } from "@saf/core";
import type { DefillamaProtocol } from "../src/collectors/defillama.js";
import { defaultConfig } from "../src/config.js";
import { emptyStats } from "../src/stats.js";
import { buildSignals, refreshSignals } from "../src/steps/signals.js";
import type { VcIndex } from "../src/steps/signals.js";
import { MemoryRepo } from "../src/store/memory-repo.js";
import type { NewProject, ProjectForScoring } from "../src/store/repo.js";

const NOW = new Date("2026-10-10T03:00:00Z");

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
    ...overrides,
  };
}

const kinds = (r: { signals: NewSignal[] }): string[] => r.signals.map((s) => s.kind);

const ARCUS: DefillamaProtocol = { name: "Arcus", url: "https://arcus.xyz", tvl: 45_000_000, geckoId: null };

describe("buildSignals", () => {
  it("gives TVL only to the project whose domain matches, not to a same-name lookalike", () => {
    const protocols = [{ name: "Arcus", url: "https://arcus.xyz", tvl: 45_000_000, geckoId: null }];
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
      { name: "Arcus V1", url: "https://arcus.xyz/v1", tvl: 3_000_000, geckoId: "arcus-old" },
      { name: "Arcus V2", url: "https://v2.arcus.xyz", tvl: 80_000_000, geckoId: null },
      { name: "Arcus Perps", url: "https://perps.arcus.xyz", tvl: 12_000_000, geckoId: "arcus" },
      { name: "Unrelated", url: "https://other.xyz", tvl: 9e9, geckoId: "other" },
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

  it("skips projects not seen within scoreActiveSinceDays", async () => {
    const repo = new MemoryRepo();
    await repo.createProject(newProject("Arcus", ["arcus.xyz"]), new Date(NOW.getTime() - 61 * 86_400_000));
    const stats = emptyStats();

    await refreshSignals({ repo }, defaultConfig, NOW, stats, { protocols: [ARCUS], vc: null });

    expect(repo.signals).toEqual([]);
    expect(stats.signals_tvl).toBe(0);
  });
});
