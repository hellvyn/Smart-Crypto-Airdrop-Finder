import { describe, expect, it } from "vitest";
import { COACH_PROFILES, SAMPLE_CASES } from "../scripts/coach-samples-cases";
import { percentile, renderMarkdown, renderPlan, scrub, summarize } from "../scripts/coach-samples-lib";
import type { SampleResult } from "../scripts/coach-samples-lib";

function result(over: Partial<SampleResult> = {}): SampleResult {
  return {
    id: "c1",
    kind: "chat",
    label: "tes",
    profile: "pemula-gratis",
    request: "Apa itu TGE?",
    called: true,
    model: "anthropic:claude-sonnet-5-5",
    ok: true,
    latencyMs: 1000,
    firstTokenMs: 400,
    shown: "TGE itu saat token pertama kali dirilis.",
    dropped: null,
    redactions: 0,
    candidateCount: 5,
    note: null,
    ...over,
  };
}

describe("percentile", () => {
  it("uses the nearest rank on sorted values", () => {
    const values = [5, 1, 4, 2, 3];
    expect(percentile(values, 50)).toBe(3);
    expect(percentile(values, 95)).toBe(5);
    expect(percentile(values, 0)).toBe(1);
  });
  it("is null for no values", () => {
    expect(percentile([], 50)).toBeNull();
  });
});

describe("summarize", () => {
  it("groups by model with count, failures, p50 and p95", () => {
    const rows = [
      ...[100, 200, 300, 400, 500, 600, 700, 800, 900, 1000].map((ms, i) => result({ id: `a${i}`, latencyMs: ms })),
      result({ id: "b1", model: "nvidia:z-ai/glm-5.3-flash", latencyMs: 2000 }),
      result({ id: "b2", model: "nvidia:z-ai/glm-5.3-flash", latencyMs: 4000, ok: false, shown: "" }),
    ];
    const s = summarize(rows);
    const claude = s.byModel.find((m) => m.model === "anthropic:claude-sonnet-5-5");
    expect(claude).toEqual({ model: "anthropic:claude-sonnet-5-5", count: 10, failures: 0, p50Ms: 500, p95Ms: 1000 });
    const glm = s.byModel.find((m) => m.model === "nvidia:z-ai/glm-5.3-flash");
    expect(glm).toEqual({ model: "nvidia:z-ai/glm-5.3-flash", count: 2, failures: 1, p50Ms: 2000, p95Ms: 4000 });
    expect(s.total).toEqual({ cases: 12, called: 12, failures: 1 });
  });

  it("files a failed chain under its own row and leaves out cases that never called a model", () => {
    const rows = [
      result({ id: "x", model: null, ok: false, latencyMs: 50_000, shown: "" }),
      result({ id: "y", called: false, model: null, latencyMs: 0 }),
    ];
    const s = summarize(rows);
    expect(s.byModel).toEqual([{ model: "(no model answered)", count: 1, failures: 1, p50Ms: 50_000, p95Ms: 50_000 }]);
    expect(s.total).toEqual({ cases: 2, called: 1, failures: 1 });
  });

  it("is empty for no results", () => {
    expect(summarize([])).toEqual({ byModel: [], total: { cases: 0, called: 0, failures: 0 } });
  });
});

describe("scrub", () => {
  it("removes emails, wallet addresses and uuids", () => {
    const text = "a@b.co 0x" + "a1".repeat(20) + " aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1 aman";
    const out = scrub(text);
    expect(out).not.toMatch(/@|0x|aaaaaaaa-/);
    expect(out).toContain("aman");
  });
});

describe("renderPlan", () => {
  it("lists each recommendation with its reasons and capital note", () => {
    const text = renderPlan(
      [{ project_id: "p1", reasons: [{ text: "Poin aktif", quote: "points program is live" }], minutes_per_day: 15, capital_note: "Gratis." }],
      new Map([["p1", "Proyek Satu"]]),
    );
    expect(text).toContain("1. Proyek Satu (15 menit per hari)");
    expect(text).toContain("Poin aktif");
    expect(text).toContain("Modal: Gratis.");
    expect(text).not.toContain("p1");
  });
});

describe("renderMarkdown", () => {
  it("has a section per case with request, model, latency and the shown text, and a summary table", () => {
    const rows = [result(), result({ id: "c2", model: null, ok: false, shown: "", note: "chain failed" })];
    const md = renderMarkdown(rows, summarize(rows), { generatedAt: "2026-10-11T00:00:00.000Z" });
    expect(md).toContain("anthropic:claude-sonnet-5-5");
    expect(md).toContain("Apa itu TGE?");
    expect(md).toContain("1000 ms");
    expect(md).toContain("TGE itu saat token pertama kali dirilis.");
    expect(md).toContain("| Model | Count | Failures | p50 ms | p95 ms |");
    expect(md).toContain("chain failed");
  });
});

describe("sample cases", () => {
  it("are 20: at least 6 plan requests and 14 chat or explain requests, with unique ids", () => {
    expect(SAMPLE_CASES).toHaveLength(20);
    expect(SAMPLE_CASES.filter((c) => c.kind === "plan").length).toBeGreaterThanOrEqual(6);
    expect(SAMPLE_CASES.filter((c) => c.kind !== "plan")).toHaveLength(14);
    expect(new Set(SAMPLE_CASES.map((c) => c.id)).size).toBe(20);
  });

  it("use known profiles, and every chat case has a message", () => {
    for (const c of SAMPLE_CASES) {
      expect(COACH_PROFILES[c.profile]).toBeDefined();
      if (c.kind !== "plan") expect(c.message?.length).toBeGreaterThan(0);
    }
  });

  it("cover the required situations", () => {
    const ids = SAMPLE_CASES.map((c) => c.id).join(" ");
    for (const part of ["pemula-gratis", "pemula-tanpa-wallet", "menengah", "pro", "quick", "tanpa-kandidat", "istilah", "aman", "injeksi", "luar-topik", "langkah", "seed"]) {
      expect(ids).toContain(part);
    }
  });

  it("contain no email, user id or wallet address", () => {
    const all = JSON.stringify({ SAMPLE_CASES, COACH_PROFILES });
    expect(all).not.toMatch(/@|0x[0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });
});
