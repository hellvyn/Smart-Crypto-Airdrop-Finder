import { beforeEach, describe, expect, it } from "vitest";
import type { CurationRecord, RiskAssessment } from "@saf/core";
import type { ChatFn, ChatMessage, ChatResult, ModelConfig } from "@saf/llm";
import { defaultConfig } from "../src/config.js";
import type { PipelineConfig } from "../src/config.js";
import { runBriefing } from "../src/steps/briefing.js";
import { purgeCoach } from "../src/steps/purge.js";
import { emptyStats } from "../src/stats.js";
import type { DailyStats } from "../src/stats.js";
import { MemoryRepo } from "../src/store/memory-repo.js";
import type { ProjectRow } from "../src/store/repo.js";

// 23:00 UTC on 10 Oct is 06:00 WIB on 11 Oct: the briefing's day is the WIB day.
const NOW = new Date("2026-10-10T23:00:00Z");
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const hoursAgo = (h: number): Date => new Date(NOW.getTime() - h * HOUR_MS);
const daysAgo = (d: number): Date => new Date(NOW.getTime() - d * DAY_MS);

const MODELS: ModelConfig[] = [
  { provider: "nvidia", id: "m/one", extraBody: {} },
  { provider: "nvidia", id: "m/two", extraBody: {} },
];
const CONFIG: PipelineConfig = { ...defaultConfig, models: MODELS, analyzeModels: MODELS };

function ok(content: unknown): ChatResult {
  return { content: JSON.stringify(content), finishReason: "stop", latencyMs: 3, httpStatus: 200, servedModel: "served" };
}
const SERVER_ERROR: ChatResult = {
  content: "",
  finishReason: null,
  latencyMs: 3,
  httpStatus: 503,
  errorBody: "unavailable",
  servedModel: null,
};

/** Chat that answers each call with `answer(callNumber, messages)` and records every call. */
function fakeChat(answer: (call: number, messages: ChatMessage[]) => ChatResult): {
  chat: ChatFn;
  calls: { model: ModelConfig; messages: ChatMessage[] }[];
} {
  const calls: { model: ModelConfig; messages: ChatMessage[] }[] = [];
  const chat: ChatFn = async (model, messages) => {
    calls.push({ model, messages });
    return answer(calls.length, messages);
  };
  return { chat, calls };
}

const curation = (passed = true): CurationRecord => ({
  passed,
  worthLevel: passed ? "medium" : null,
  worthPoints: passed ? 2 : null,
  tab: passed ? "live_now" : null,
  statusAt: "live",
  endedOn: null,
  reasons: [],
  coverage: {},
  coingeckoListed: false,
});
const assessment = (level: RiskAssessment["level"]): RiskAssessment => ({ level, points: 0, reasons: [], checks: [] });

async function project(repo: MemoryRepo, name: string, status: ProjectRow["status"] = "announced"): Promise<ProjectRow> {
  const slug = name.toLowerCase();
  return repo.createProject(
    {
      slug,
      name,
      nameKey: slug,
      tokenSymbol: null,
      chains: [],
      officialDomains: [],
      status,
      conflict: false,
      lookalikeOf: null,
    },
    daysAgo(10),
  );
}

describe("runBriefing", () => {
  let repo: MemoryRepo;
  let stats: DailyStats;
  const run = (chat: ChatFn, config: PipelineConfig = CONFIG) =>
    runBriefing({ repo, chat, sleep: async () => {}, now: () => NOW }, config, stats);

  beforeEach(() => {
    repo = new MemoryRepo();
    stats = emptyStats();
  });

  /** Alpha: newly curated and live today; Beta: risk raised; Gamma: claim deadline tomorrow. All listed. */
  async function seed(): Promise<{ alpha: ProjectRow; beta: ProjectRow; gamma: ProjectRow }> {
    const alpha = await project(repo, "Alpha");
    const beta = await project(repo, "Beta", "live");
    const gamma = await project(repo, "Gamma", "live");
    for (const p of [alpha, beta, gamma]) await repo.saveCuration(p.id, curation(), daysAgo(10));
    await repo.saveRiskAssessment(beta.id, assessment("low"), daysAgo(3));
    await repo.saveRiskAssessment(beta.id, assessment("high"), hoursAgo(2));
    await repo.updateProject(alpha.id, { status: "live" }, hoursAgo(2));
    await repo.saveCuration(alpha.id, curation(false), daysAgo(5));
    await repo.saveCuration(alpha.id, curation(), hoursAgo(1));
    const doc = await repo.upsertDocument(
      { sourceKind: "airdrops_io", sourceKey: "k", url: "https://src.test/g", text: "x", publishedAt: null, pageUpdatedAt: null, fetchedAt: NOW },
      "h",
    );
    await repo.replaceDeadlines(gamma.id, doc.id, [{ kind: "claim", date: "2026-10-11", precision: "exact", text: "Claim 11 Oct" }]);
    return { alpha, beta, gamma };
  }

  it("builds the facts from the day's changes and deadlines and asks the model once", async () => {
    const { alpha, beta, gamma } = await seed();
    const { chat, calls } = fakeChat(() =>
      ok({
        items: [
          { project_id: beta.id, text: "Risiko Beta naik jadi Tinggi, cek dulu sebelum lanjut." },
          { project_id: gamma.id, text: "Claim Gamma ditutup 11 Oktober 2026, jangan sampai kelewat." },
          { project_id: alpha.id, text: "Alpha baru masuk list dan udah Live." },
        ],
      }),
    );

    await run(chat);

    expect(calls).toHaveLength(1);
    const prompt = calls[0]!.messages.map((m) => m.content).join("\n");
    expect(prompt).toContain("Risiko Beta naik jadi Tinggi.");
    expect(prompt).toContain("Claim Gamma ditutup 11 Oktober 2026.");
    expect(prompt).toContain("Alpha baru masuk list.");
    expect(prompt).toContain("Alpha berubah status jadi Live.");
    const saved = repo.briefings.get("2026-10-11");
    expect(saved?.ai).toBe(true);
    expect(saved?.model).toBe("nvidia:m/one");
    expect(saved?.items.map((i) => [i.slug, i.name])).toEqual([
      ["beta", "Beta"],
      ["gamma", "Gamma"],
      ["alpha", "Alpha"],
    ]);
    expect(stats.briefing_items).toBe(3);
    expect(stats.briefing_ai).toBe(1);
  });

  it("drops an item that names an unknown project and keeps the others", async () => {
    const { beta } = await seed();
    const { chat } = fakeChat(() =>
      ok({
        items: [
          { project_id: "00000000-0000-0000-0000-00000000dead", text: "Ada project baru yang rame." },
          { project_id: beta.id, text: "Risiko Beta naik jadi Tinggi." },
        ],
      }),
    );

    await run(chat);

    const saved = repo.briefings.get("2026-10-11");
    expect(saved?.ai).toBe(true);
    expect(saved?.items.map((i) => i.slug)).toEqual(["beta"]);
    expect(stats.briefing_items).toBe(1);
  });

  it("rewrites once when a banned word shows up, and uses the rewrite when it is clean", async () => {
    const { beta } = await seed();
    const { chat, calls } = fakeChat((call) =>
      ok({
        items: [{ project_id: beta.id, text: call === 1 ? "Risiko Beta naik jadi Tinggi, ini krusial." : "Risiko Beta naik jadi Tinggi, cek dulu." }],
      }),
    );

    await run(chat);

    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[1]!.messages)).toContain("krusial");
    expect(repo.briefings.get("2026-10-11")?.items.map((i) => i.text)).toEqual(["Risiko Beta naik jadi Tinggi, cek dulu."]);
    expect(repo.briefings.get("2026-10-11")?.ai).toBe(true);
  });

  it("falls back to the fact texts when the rewrite still has a banned word", async () => {
    const { beta } = await seed();
    const { chat, calls } = fakeChat(() =>
      ok({ items: [{ project_id: beta.id, text: "Risiko Beta naik jadi Tinggi, ini krusial." }] }),
    );

    await run(chat);

    expect(calls).toHaveLength(2);
    const saved = repo.briefings.get("2026-10-11");
    expect(saved?.ai).toBe(false);
    expect(saved?.model).toBeNull();
    expect(saved?.items.map((i) => i.text)).toContain("Risiko Beta naik jadi Tinggi.");
    expect(stats.briefing_ai).toBe(0);
    expect(stats.briefing_items).toBe(saved?.items.length);
  });

  it("falls back when no item survives the checks", async () => {
    await seed();
    const { chat } = fakeChat(() => ok({ items: [{ project_id: "nope", text: "Apa saja." }] }));

    await run(chat);

    const saved = repo.briefings.get("2026-10-11");
    expect(saved?.ai).toBe(false);
    expect(saved?.items.length).toBeGreaterThan(0);
  });

  it("falls back, with the next model tried first, when the models fail", async () => {
    await seed();
    const { chat, calls } = fakeChat(() => SERVER_ERROR);

    await run(chat);

    expect(calls.map((c) => c.model.id)).toEqual(["m/one", "m/two"]);
    expect(repo.briefings.get("2026-10-11")?.ai).toBe(false);
  });

  it("makes no call and saves nothing when there are no facts, keeping the earlier briefing", async () => {
    await repo.saveBriefing("2026-10-10", [{ projectId: "p", slug: "s", name: "S", text: "Kemarin." }], null, false);
    const { chat, calls } = fakeChat(() => ok({ items: [] }));

    await run(chat);

    expect(calls).toHaveLength(0);
    expect([...repo.briefings.keys()]).toEqual(["2026-10-10"]);
    expect(stats.briefing_items).toBe(0);
    expect(stats.briefing_ai).toBe(0);
  });

  it("only reports projects on the list, changes from the last day and deadlines in the next 48 hours", async () => {
    const hidden = await project(repo, "Hidden", "live");
    await repo.saveCuration(hidden.id, curation(false), daysAgo(10));
    await repo.updateProject(hidden.id, { status: "ended" }, hoursAgo(2));
    const stale = await project(repo, "Stale", "announced");
    await repo.saveCuration(stale.id, curation(), daysAgo(10));
    await repo.updateProject(stale.id, { status: "live" }, daysAgo(3));
    const far = await project(repo, "Far", "live");
    await repo.saveCuration(far.id, curation(), daysAgo(10));
    const doc = await repo.upsertDocument(
      { sourceKind: "airdrops_io", sourceKey: "k", url: "https://src.test/f", text: "x", publishedAt: null, pageUpdatedAt: null, fetchedAt: NOW },
      "h",
    );
    await repo.replaceDeadlines(far.id, doc.id, [
      { kind: "claim", date: "2026-10-14", precision: "exact", text: "far" },
      { kind: "claim", date: "2026-10-09", precision: "exact", text: "past" },
    ]);
    const { chat, calls } = fakeChat(() => ok({ items: [] }));

    await run(chat);

    expect(calls).toHaveLength(0);
    expect(repo.briefings.size).toBe(0);
  });

  it("does not put the member data, the model output or the prompt in the run stats", async () => {
    const { beta } = await seed();
    const { chat } = fakeChat(() => ok({ items: [{ project_id: beta.id, text: "Risiko Beta naik jadi Tinggi." }] }));
    await run(chat);
    expect(Object.values(stats).every((v) => typeof v === "number")).toBe(true);
  });
});

describe("purgeCoach", () => {
  it("removes threads (with their messages) older than 30 days and keeps newer ones", async () => {
    const repo = new MemoryRepo();
    repo.coachThreads.push(
      { id: "t-old", createdAt: daysAgo(31) },
      { id: "t-edge", createdAt: daysAgo(29) },
      { id: "t-new", createdAt: daysAgo(1) },
    );
    repo.coachMessages.push({ id: "m-1", threadId: "t-old" }, { id: "m-2", threadId: "t-new" });
    const stats = emptyStats();

    await purgeCoach(repo, NOW, stats);

    expect(repo.coachThreads.map((t) => t.id)).toEqual(["t-edge", "t-new"]);
    expect(repo.coachMessages.map((m) => m.id)).toEqual(["m-2"]);
    expect(stats.coach_threads_purged).toBe(1);
  });

  it("removes briefings older than 30 days and the usage ledger older than 2 days", async () => {
    const repo = new MemoryRepo();
    await repo.saveBriefing("2026-09-01", [], null, false);
    await repo.saveBriefing("2026-10-05", [], null, false);
    repo.coachUsage.push(
      { id: "u-old", createdAt: daysAgo(3) },
      { id: "u-today", createdAt: hoursAgo(5) },
    );
    const stats = emptyStats();

    await purgeCoach(repo, NOW, stats);

    expect([...repo.briefings.keys()]).toEqual(["2026-10-05"]);
    expect(repo.coachUsage.map((u) => u.id)).toEqual(["u-today"]);
    expect(stats.coach_usage_purged).toBe(1);
  });

  it("starts with the stats at 0", () => {
    const stats = emptyStats();
    expect([stats.briefing_items, stats.briefing_ai, stats.coach_threads_purged, stats.coach_usage_purged]).toEqual([0, 0, 0, 0]);
  });
});
