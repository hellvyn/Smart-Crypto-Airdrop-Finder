// The runner of the model comparison (`eval/model-compare.ts`) with a fake chat and an in-memory repository: no model
// and no database is called.
import { describe, expect, it } from "vitest";
import type { ChatFn, ChatResult, ModelConfig } from "@saf/llm";
import { parseProjectCount, prepareProjects, runCall } from "../eval/model-compare.js";
import { readOnlyRepo } from "../eval/model-compare-lib.js";
import { analystAnalyzer } from "../src/llm/prompts/analyst.js";
import { MemoryRepo } from "../src/store/memory-repo.js";
import type { ProjectForScoring } from "../src/store/repo.js";

const NOW = new Date("2026-10-12T03:00:00Z");
const SRC = "https://airdrops.io/ink/";
const SRC_TEXT = "Ink airdrop is live. The allocation of 5% goes to early users. Bridge ETH to Ink, then swap daily.";

const PROJECT: ProjectForScoring = {
  id: "p-ink",
  slug: "ink",
  name: "Ink",
  nameKey: "ink",
  tokenSymbol: "INK",
  chains: [],
  officialDomains: [],
  status: "live",
  conflict: false,
  lookalikeOf: null,
  firstSeen: NOW,
  lastSeen: NOW,
  tasks: ["Bridge ETH to Ink"],
  steps: [{ text: "Bridge ETH to Ink", cadence: "once" }],
  facts: [],
  deadlines: [],
  links: [],
  sourceCount: 1,
  sourceKinds: ["airdrops_io"],
  lookalikeOfName: null,
  lookalikeOfDomains: [],
  sourceAsks: [],
  signals: [],
};

const SONNET: ModelConfig = { provider: "anthropic", id: "claude-sonnet-5-5", extraBody: {} };
const answer = (over: Record<string, unknown> = {}) => ({
  verdict: "garap",
  confidence: "tinggi",
  points: [
    { text: "Alokasinya 5% buat user awal.", quote: "allocation of 5% goes to early users", source_url: SRC },
    { text: "Project ini krusial banget.", quote: "this sentence is not in the source", source_url: SRC },
  ],
  effort: { minutes_per_day: 5, capital_usd_min: null, note: "Modalnya cuma gas." },
  steps_id: [{ text: "Bridge ETH ke Ink", cadence: "once" }],
  ...over,
});
const ok = (content: unknown, over: Partial<ChatResult> = {}): ChatResult => ({
  content: JSON.stringify(content),
  finishReason: "stop",
  latencyMs: 1500,
  httpStatus: 200,
  servedModel: "claude-sonnet-5-5",
  usage: { inputTokens: 900, outputTokens: 120 },
  ...over,
});
const noSleep = async (): Promise<void> => {};

describe("runCall", () => {
  it("calls exactly the one model, and records grounding, style, usage, verdict and time", async () => {
    const seen: string[] = [];
    const chat: ChatFn = async (model) => {
      seen.push(`${model.provider}:${model.id}`);
      return ok(answer());
    };
    const record = await runCall(analystAnalyzer, PROJECT, [{ url: SRC, text: SRC_TEXT }], SONNET, { chat, sleep: noSleep });

    expect(seen).toEqual(["anthropic:claude-sonnet-5-5"]);
    expect(record).toMatchObject({
      projectId: "p-ink",
      model: "anthropic:claude-sonnet-5-5",
      ok: true,
      failure: null,
      latencyMs: 1500,
      inputTokens: 900,
      outputTokens: 120,
      pointsReturned: 2,
      pointsKept: 1,
      verdict: "garap",
      confidence: "tinggi",
    });
    expect(record.points.map((p) => p.source_url)).toEqual([SRC]);
    // The dropped point's forbidden words do not count: only the prose that is kept.
    expect(record.styleViolations).toEqual([]);
  });

  it("counts a forbidden phrase in the kept prose", async () => {
    const chat: ChatFn = async () =>
      ok(answer({ points: [{ text: "Project ini krusial buat digarap.", quote: "allocation of 5% goes to early users", source_url: SRC }] }));
    const record = await runCall(analystAnalyzer, PROJECT, [{ url: SRC, text: SRC_TEXT }], SONNET, { chat, sleep: noSleep });
    expect(record.styleViolations).toEqual(["krusial"]);
  });

  it("records null usage when the transport reports none, and the failure code of a bad answer without keeping it", async () => {
    const chat: ChatFn = async () => ok({ verdict: "buy", nonsense: "SECRET-TEXT" }, { usage: undefined });
    const record = await runCall(analystAnalyzer, PROJECT, [{ url: SRC, text: SRC_TEXT }], SONNET, { chat, sleep: noSleep });
    expect(record).toMatchObject({ ok: false, failure: "schema", inputTokens: null, outputTokens: null, pointsKept: null });
    expect(JSON.stringify(record)).not.toContain("SECRET-TEXT");
  });

  it("does not fall back: an HTTP error is one failed call on that model (a 429 is retried on it, nowhere else)", async () => {
    const seen: string[] = [];
    const chat: ChatFn = async (model) => {
      seen.push(model.id);
      return { content: "", finishReason: null, latencyMs: 10, httpStatus: 429, servedModel: null, errorBody: "slow down" };
    };
    const record = await runCall(analystAnalyzer, PROJECT, [{ url: SRC, text: SRC_TEXT }], SONNET, { chat, sleep: noSleep });
    expect(seen).toEqual(Array(3).fill("claude-sonnet-5-5"));
    expect(record).toMatchObject({ ok: false, failure: "http_429", latencyMs: 30 });
  });

  it("turns a throwing chat into a failed call", async () => {
    const chat: ChatFn = async () => {
      throw new TypeError("boom with SECRET-TEXT");
    };
    const record = await runCall(analystAnalyzer, PROJECT, [{ url: SRC, text: SRC_TEXT }], SONNET, { chat, sleep: noSleep });
    expect(record).toMatchObject({ ok: false, failure: "threw_TypeError" });
    expect(JSON.stringify(record)).not.toContain("SECRET-TEXT");
  });
});

describe("prepareProjects", () => {
  async function seed(): Promise<MemoryRepo> {
    const repo = new MemoryRepo();
    const make = async (slug: string, officialDomains: string[], docUrl: string, kind: "airdrops_io" | "defillama") => {
      const project = await repo.createProject(
        { slug, name: slug, nameKey: slug, tokenSymbol: null, chains: [], officialDomains, status: "live", conflict: false, lookalikeOf: null },
        NOW,
      );
      const doc = await repo.upsertDocument(
        { sourceKind: kind, sourceKey: kind, url: docUrl, text: `${slug} text`, publishedAt: null, pageUpdatedAt: null, fetchedAt: NOW },
        `hash-${slug}`,
      );
      await repo.addEvidence({ projectId: project.id, documentId: doc.id, field: "status", value: "live", quote: "live", at: NOW });
      return project;
    };
    const rich = await make("rich", ["rich.xyz"], "https://airdrops.io/rich/", "airdrops_io");
    const thin = await make("thin", ["thin.xyz"], "https://defillama.com/protocol/thin", "defillama");
    await make("unlisted", [], "https://airdrops.io/unlisted/", "airdrops_io");
    for (const p of [rich, thin]) {
      await repo.saveCuration(
        p.id,
        { passed: true, worthLevel: "low", worthPoints: 0, tab: "live_now", statusAt: "live", endedOn: null, reasons: [], coverage: {}, coingeckoListed: null },
        NOW,
      );
    }
    await repo.saveClaimPage("official-site://rich.xyz", "[Page /]\nRich home page", NOW);
    await repo.saveClaimPage("defillama-detail://thin", "Description: a lending protocol", NOW);
    return repo;
  }

  it("builds the Analyst's sources as the analyze stage does, for listed projects only, without writing", async () => {
    const repo = await seed();
    const before = JSON.stringify([...(await repo.listClaimPages(["official-site://rich.xyz", "defillama-detail://thin"]))]);
    const prepared = await prepareProjects(readOnlyRepo(repo), NOW);

    expect(prepared.map((p) => p.project.name).sort()).toEqual(["rich", "thin"]);
    const rich = prepared.find((p) => p.project.name === "rich");
    const thin = prepared.find((p) => p.project.name === "thin");
    expect(rich?.sources.map((s) => s.url)).toEqual(["https://airdrops.io/rich/", "official-site://rich.xyz"]);
    expect(rich?.candidate.kind).toBe("rich");
    expect(thin?.sources.map((s) => s.url)).toEqual(["https://defillama.com/protocol/thin", "defillama-detail://thin"]);
    expect(thin?.candidate.kind).toBe("thin");
    expect(JSON.stringify([...(await repo.listClaimPages(["official-site://rich.xyz", "defillama-detail://thin"]))])).toBe(before);
  });
});

describe("parseProjectCount", () => {
  it("defaults to 15 and accepts 1 to 60", () => {
    expect(parseProjectCount(undefined)).toBe(15);
    expect(parseProjectCount("")).toBe(15);
    expect(parseProjectCount("8")).toBe(8);
    for (const bad of ["0", "61", "abc", "-3", "1.5"]) expect(() => parseProjectCount(bad)).toThrow();
  });
});
