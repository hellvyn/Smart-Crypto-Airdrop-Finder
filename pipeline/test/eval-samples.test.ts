import { describe, expect, it } from "vitest";
import { renderSamples, selectSamples } from "../eval/ai-samples.js";
import type { AnalystSample } from "../eval/ai-samples.js";
import { formatWorthReview, topPerTab } from "../eval/worth-review.js";
import type { ReviewRow } from "../eval/worth-review.js";
import { firstPerProject } from "../eval/supabase-read.js";

const reason = (message: string, kind: "pass" | "fail" | "worth" = "worth") => ({ code: "x", message, kind });
const row = (over: Partial<ReviewRow> & { name: string }): ReviewRow => ({
  tab: "live_now",
  worthLevel: "medium",
  reasons: [],
  lastSeen: "2026-10-10T00:00:00Z",
  ...over,
});

describe("topPerTab", () => {
  it("orders each tab by worth level, then newest last_seen, and keeps the top n", () => {
    const rows = [
      row({ name: "low-new", worthLevel: "low", lastSeen: "2026-10-10T00:00:00Z" }),
      row({ name: "high-old", worthLevel: "high", lastSeen: "2026-10-01T00:00:00Z" }),
      row({ name: "high-new", worthLevel: "high", lastSeen: "2026-10-09T00:00:00Z" }),
      row({ name: "none", worthLevel: "insufficient_data" }),
      row({ name: "medium", worthLevel: "medium" }),
    ];
    const top = topPerTab(rows, 4);
    expect(top.live_now.map((r) => r.name)).toEqual(["high-new", "high-old", "medium", "low-new"]);
  });

  it("keeps the tabs apart, so a strong early bet does not count against live_now", () => {
    const top = topPerTab(
      [row({ name: "a", tab: "live_now", worthLevel: "low" }), row({ name: "b", tab: "early_bets", worthLevel: "high" }), row({ name: "c", tab: "ended" })],
      20,
    );
    expect(top.live_now.map((r) => r.name)).toEqual(["a"]);
    expect(top.early_bets.map((r) => r.name)).toEqual(["b"]);
    expect(top.ended.map((r) => r.name)).toEqual(["c"]);
  });

  it("puts a curation without a worth level last", () => {
    const top = topPerTab([row({ name: "unset", worthLevel: null }), row({ name: "low", worthLevel: "low" })], 5);
    expect(top.live_now.map((r) => r.name)).toEqual(["low", "unset"]);
  });
});

describe("formatWorthReview", () => {
  it("prints name, worth level and only the worth reasons of each project, per tab", () => {
    const text = formatWorthReview(
      topPerTab(
        [
          row({
            name: "Alpha",
            worthLevel: "high",
            reasons: [reason("Lolos semua syarat kurasi.", "pass"), reason("Didukung VC tier 1 yang terverifikasi."), reason("Belum ada token yang diperdagangkan.")],
          }),
        ],
        20,
      ),
    );
    expect(text).toContain("live_now");
    expect(text).toMatch(/1\. Alpha\s+high/);
    expect(text).toContain("Didukung VC tier 1 yang terverifikasi.");
    expect(text).toContain("Belum ada token yang diperdagangkan.");
    expect(text).not.toContain("Lolos semua syarat kurasi.");
  });

  it("says so for a tab with no passing project", () => {
    expect(formatWorthReview(topPerTab([], 20))).toMatch(/early_bets[\s\S]*\(none\)/);
  });
});

const analystResult = (over: Record<string, unknown> = {}): unknown => ({
  verdict: "garap",
  confidence: "sedang",
  points: [{ text: "Ada poin farming harian.", quote: "earn points every day", source_url: "https://airdrops.io/alpha/" }],
  effort: { minutes_per_day: 10, capital_usd_min: null, note: "Ringan." },
  steps_id: [],
  ...over,
});
const sample = (over: Partial<AnalystSample> & { projectId: string }): AnalystSample => ({
  projectName: "Alpha",
  createdAt: "2026-10-10T08:00:00Z",
  model: "auto",
  servedModel: "gpt-oss:120b",
  promptVersion: "2026-10-10.1",
  result: analystResult(),
  ...over,
});

describe("selectSamples", () => {
  it("takes the latest analysis of each project, newest first, up to n", () => {
    const rows = [
      sample({ projectId: "p1", projectName: "One", createdAt: "2026-10-10T09:00:00Z" }),
      sample({ projectId: "p1", projectName: "One", createdAt: "2026-10-09T09:00:00Z" }),
      sample({ projectId: "p2", projectName: "Two", createdAt: "2026-10-08T09:00:00Z" }),
      sample({ projectId: "p3", projectName: "Three", createdAt: "2026-10-07T09:00:00Z" }),
    ];
    expect(selectSamples(rows, 2).map((s) => s.projectName)).toEqual(["One", "Two"]);
  });
});

describe("renderSamples", () => {
  it("writes verdict, points with their quotes and source, and the model that answered", () => {
    const md = renderSamples([sample({ projectId: "p1" })]);
    expect(md).toContain("## 1. Alpha");
    expect(md).toContain("garap");
    expect(md).toContain("Ada poin farming harian.");
    expect(md).toContain("earn points every day");
    expect(md).toContain("https://airdrops.io/alpha/");
    expect(md).toContain("gpt-oss:120b");
    expect(md).toContain("2026-10-10.1");
  });

  it("lists the forbidden phrases an analysis uses, for the language review (G13)", () => {
    const bad = analystResult({
      points: [{ text: "Ini krusial, selain itu hadiahnya besar.", quote: "q", source_url: "https://airdrops.io/alpha/" }],
    });
    const md = renderSamples([sample({ projectId: "p1", result: bad }), sample({ projectId: "p2", projectName: "Beta" })]);
    expect(md).toMatch(/Alpha[\s\S]*Kata terlarang: krusial, selain itu[\s\S]*Beta/);
    // The clean sample reports none.
    expect(md.split("## 2. Beta")[1]).toContain("Kata terlarang: tidak ada");
  });

  it("does not crash on an analysis whose points were all dropped or whose shape is unexpected", () => {
    const md = renderSamples([
      sample({ projectId: "p1", result: analystResult({ points: [] }) }),
      sample({ projectId: "p2", projectName: "Odd", result: { unexpected: true } }),
    ]);
    expect(md).toContain("## 2. Odd");
    expect(md).toContain("bentuk hasil tidak dikenal");
  });
});

describe("firstPerProject", () => {
  it("keeps the first row of each project in a newest-first list", () => {
    const rows = [
      { project_id: "a", n: 3 },
      { project_id: "b", n: 2 },
      { project_id: "a", n: 1 },
    ];
    expect(firstPerProject(rows)).toEqual([
      { project_id: "a", n: 3 },
      { project_id: "b", n: 2 },
    ]);
  });
});
