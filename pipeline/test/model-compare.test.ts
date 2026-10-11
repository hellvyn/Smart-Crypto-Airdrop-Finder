import { describe, expect, it } from "vitest";
import {
  MODEL_ALIASES,
  parseModelList,
  percentile,
  readOnlyRepo,
  renderReport,
  selectProjects,
  summarize,
} from "../eval/model-compare-lib.js";
import type { CallRecord } from "../eval/model-compare-lib.js";

const SONNET = "anthropic:claude-sonnet-5-5";
const HAIKU = "anthropic:claude-haiku-5-5";

function rec(over: Partial<CallRecord> & { model: string }): CallRecord {
  return {
    projectId: "p1",
    projectName: "Alpha",
    ok: true,
    failure: null,
    latencyMs: 1000,
    inputTokens: 100,
    outputTokens: 50,
    pointsReturned: 4,
    pointsKept: 4,
    styleViolations: [],
    verdict: "garap",
    confidence: "sedang",
    points: [],
    effortNote: "",
    ...over,
  };
}

describe("percentile", () => {
  it("is the nearest-rank percentile of the values, null for none", () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([5], 0.95)).toBe(5);
    const v = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(v, 0.5)).toBe(50);
    expect(percentile(v, 0.95)).toBe(100);
    expect(percentile([30, 10, 20], 0.5)).toBe(20);
  });
});

describe("summarize", () => {
  it("counts success, schema/parse and other failures, kept and dropped points, style, latency and tokens per model", () => {
    const records: CallRecord[] = [
      rec({ model: SONNET, pointsReturned: 4, pointsKept: 4, latencyMs: 1000, inputTokens: 100, outputTokens: 50 }),
      rec({ model: SONNET, pointsReturned: 4, pointsKept: 2, latencyMs: 3000, inputTokens: 200, outputTokens: 70, styleViolations: ["aman"] }),
      rec({ model: SONNET, ok: false, failure: "schema", latencyMs: 2000, pointsReturned: null, pointsKept: null, verdict: null, confidence: null, inputTokens: 100, outputTokens: 20 }),
      rec({ model: SONNET, ok: false, failure: "http_429", latencyMs: 500, pointsReturned: null, pointsKept: null, verdict: null, confidence: null, inputTokens: null, outputTokens: null }),
      rec({ model: HAIKU, ok: false, failure: "json_parse", latencyMs: 400, pointsReturned: null, pointsKept: null, verdict: null, confidence: null }),
    ];
    const [sonnet, haiku, other] = summarize(records, [SONNET, HAIKU, "freellm:auto"]);

    expect(sonnet).toMatchObject({
      model: SONNET,
      calls: 4,
      ok: 2,
      failed: 2,
      successRate: 0.5,
      schemaFailures: 1,
      otherFailures: 1,
      meanPointsKept: 3,
      pointsReturned: 8,
      pointsDropped: 2,
      droppedPct: 25,
      styleViolationCalls: 1,
      inputTokens: 400,
      outputTokens: 140,
      callsWithUsage: 3,
    });
    expect(sonnet?.latencyP50).toBe(1000);
    expect(sonnet?.latencyP95).toBe(3000);
    expect(haiku).toMatchObject({ calls: 1, ok: 0, successRate: 0, schemaFailures: 1, meanPointsKept: null, droppedPct: null });
    // A model with no call at all still gets a row, with nothing measured.
    expect(other).toMatchObject({ model: "freellm:auto", calls: 0, successRate: null, latencyP50: null, inputTokens: 0 });
  });

  it("counts a call with unknown token usage as unknown, not as zero", () => {
    const [s] = summarize([rec({ model: SONNET, inputTokens: null, outputTokens: null })], [SONNET]);
    expect(s).toMatchObject({ inputTokens: 0, outputTokens: 0, callsWithUsage: 0 });
  });
});

describe("selectProjects", () => {
  const cands = (kind: "rich" | "thin", n: number, start = 0) =>
    Array.from({ length: n }, (_, i) => ({ id: `${kind}${start + i}`, kind, weight: 1000 * (i + 1) }));

  it("takes about two thirds rich and the rest DefiLlama-only, spread over the size range", () => {
    const picked = selectProjects([...cands("rich", 20), ...cands("thin", 20)], 15);
    expect(picked).toHaveLength(15);
    expect(picked.filter((c) => c.kind === "rich")).toHaveLength(10);
    expect(picked.filter((c) => c.kind === "thin")).toHaveLength(5);
    const richWeights = picked.filter((c) => c.kind === "rich").map((c) => c.weight);
    // Not just the biggest ones: the pick spans the range.
    expect(Math.min(...richWeights)).toBeLessThan(5000);
    expect(Math.max(...richWeights)).toBeGreaterThan(15000);
    expect(new Set(picked.map((c) => c.id)).size).toBe(15);
  });

  it("fills from the other group when one is short, and returns all when fewer exist than asked", () => {
    const picked = selectProjects([...cands("rich", 20), ...cands("thin", 2)], 15);
    expect(picked).toHaveLength(15);
    expect(picked.filter((c) => c.kind === "thin")).toHaveLength(2);
    expect(selectProjects(cands("rich", 3), 15)).toHaveLength(3);
    expect(selectProjects([], 15)).toEqual([]);
  });

  it("is deterministic", () => {
    const all = [...cands("rich", 12), ...cands("thin", 9)];
    expect(selectProjects(all, 7).map((c) => c.id)).toEqual(selectProjects([...all].reverse(), 7).map((c) => c.id));
  });
});

describe("parseModelList", () => {
  it("accepts aliases and full keys, de-duplicates, keeps order, and rejects unknown names", () => {
    expect(parseModelList(undefined).map((m) => `${m.provider}:${m.id}`)).toEqual([
      "anthropic:claude-sonnet-5-5",
      "anthropic:claude-haiku-5-5",
      "freellm:auto",
      "nvidia:z-ai/glm-5.3-flash",
    ]);
    expect(parseModelList("haiku, freellm:auto,haiku").map((m) => m.id)).toEqual(["claude-haiku-5-5", "auto"]);
    expect(() => parseModelList("gpt-9")).toThrow(/unknown model/);
    expect(Object.keys(MODEL_ALIASES).sort()).toEqual(["freellm", "glm", "haiku", "sonnet"]);
  });

  it("uses the production request options of the free models (glm reasoning_effort low)", () => {
    const glm = parseModelList("glm")[0];
    expect(glm?.extraBody).toEqual({ reasoning_effort: "low" });
  });
});

describe("readOnlyRepo", () => {
  it("passes reads through with the right this, and refuses every write", async () => {
    const calls: string[] = [];
    class Fake {
      private readonly tag = "t";
      async listThings(): Promise<string> {
        calls.push("listThings");
        return this.tag;
      }
      async saveThing(): Promise<void> {
        calls.push("saveThing");
      }
      async upsertDocument(): Promise<void> {
        calls.push("upsertDocument");
      }
    }
    const repo = readOnlyRepo(new Fake());
    await expect(repo.listThings()).resolves.toBe("t");
    expect(() => repo.saveThing()).toThrow(/read-only/);
    expect(() => repo.upsertDocument()).toThrow(/read-only/);
    expect(calls).toEqual(["listThings"]);
  });
});

describe("renderReport", () => {
  const meta = { generatedAt: "2026-10-12T01:00:00.000Z", projectCount: 1, models: [SONNET, HAIKU] };
  const records: CallRecord[] = [
    rec({
      model: SONNET,
      verdict: "garap",
      confidence: "tinggi",
      pointsReturned: 3,
      pointsKept: 2,
      points: [{ text: "Poin satu | dengan pipa", quote: "q1", source_url: "https://x.test/a" }, { text: "Poin dua", quote: "q2", source_url: "https://x.test/a" }],
      styleViolations: ["aman"],
    }),
    rec({ model: HAIKU, ok: false, failure: "schema", verdict: null, confidence: null, pointsReturned: null, pointsKept: null }),
  ];
  const projects = [{ id: "p1", name: "Alpha", sourceKinds: "airdrops_io, official-site", sourceCount: 2, sourceChars: 4321 }];

  it("has the summary table, the per-project side-by-side section and no pipes inside cells", () => {
    const md = renderReport(meta, summarize(records, meta.models), projects, records);
    expect(md).toContain("| Model | Success");
    expect(md).toContain("anthropic:claude-sonnet-5-5");
    expect(md).toContain("## 1. Alpha");
    expect(md).toContain("garap (tinggi)");
    expect(md).toContain("FAILED: schema");
    expect(md).toContain("2 of 3 points kept");
    expect(md).toContain("Poin satu \\| dengan pipa");
    expect(md).toContain("aman");
  });
});
