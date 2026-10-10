import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Http } from "../src/collectors/types.js";
import type { ChatFn } from "../src/llm/extract.js";
import { defaultConfig } from "../src/config.js";
import { loadProviders } from "../src/config.js";
import type { PipelineConfig } from "../src/config.js";
import { runDailyJob } from "../src/daily-job.js";
import { runDaily } from "../src/run.js";
import { classifyLink, pickSlug } from "../src/steps/merge.js";
import type { StoredDocument } from "../src/store/repo.js";
import { MemoryRepo } from "../src/store/memory-repo.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const NOW = new Date("2026-10-10T00:00:00Z");
const DAY = 86_400_000;

const HOME = "https://airdrops.io/";
const DEEPBOOK = "https://airdrops.io/deepbook/";
const INK_PAGE = "https://airdrops.io/ink-chain/";
const TG = "https://t.me/s/airdrops_io";
const PROTOCOLS = "https://api.llama.fi/protocols";
const LLAMA_DOC = "https://defillama.com/protocol/hyperdrive-lend";

/** Minimal hand-written airdrops.io detail page with the structure the collector expects. */
function detailPage(title: string, body: string): string {
  return `<html><body><h1>${title}</h1><div class="airdrop-info"><ul><li>Chain: Ink</li></ul></div>
<div class="airdrop-description"><p>${body}</p></div><div class="airdrop-bottom"></div></body></html>`;
}

/** One extra Telegram channel message, appended to the fixture page. */
function tgMessage(id: number, iso: string, text: string): string {
  return `<div class="tgme_widget_message_wrap js-widget_message_wrap">
  <div class="tgme_widget_message js-widget_message" data-post="airdrops_io/${id}">
    <div class="tgme_widget_message_bubble">
      <div class="tgme_widget_message_text js-message_text" dir="auto">${text}</div>
      <div class="tgme_widget_message_footer"><a class="tgme_widget_message_date" href="https://t.me/airdrops_io/${id}"><time datetime="${iso}" class="time">x</time></a></div>
    </div>
  </div>
</div>`;
}

const PROTOCOL_LIST = [
  {
    name: "Hyperdrive Lend",
    slug: "hyperdrive-lend",
    url: "https://hyperdrive.fi",
    chains: ["Hyperliquid L1"],
    tvl: 25_000_000,
    change_7d: 12.5,
    category: "Lending",
    gecko_id: null,
    symbol: "-",
  },
  { name: "Big CEX", slug: "big-cex", url: "https://bigcex.com", chains: ["Ethereum"], tvl: 9e9, change_7d: 50, category: "CEX", gecko_id: null, symbol: "-" },
  { name: "Tokened", slug: "tokened", url: "https://tokened.xyz", chains: ["Ethereum"], tvl: 5e7, change_7d: 80, category: "Dexs", gecko_id: "tokened", symbol: "TOK" },
];

type Pages = Record<string, { status: number; body: string }>;

function basePages(): Pages {
  return {
    [HOME]: { status: 200, body: fixture("airdrops-home.html") },
    [DEEPBOOK]: { status: 200, body: fixture("airdrops-detail.html") },
    [INK_PAGE]: {
      status: 200,
      body: detailPage(
        "Ink Chain",
        'Bridge to Ink now. Official site <a href="https://inkonchain.com/">Ink</a>. Follow <a href="https://x.com/inkonchain">X</a>.',
      ),
    },
    [TG]: { status: 200, body: fixture("telegram.html") },
    [PROTOCOLS]: { status: 200, body: JSON.stringify(PROTOCOL_LIST) },
    "https://api.llama.fi/hacks": { status: 200, body: "[]" },
  };
}

interface FakeHttp extends Http {
  gets: string[];
  maxInFlight: number;
}

/** `registrations` maps a domain to its RDAP registration date (default 2020-01-01). */
function fakeHttp(pages: Pages, registrations: Record<string, string> = {}): FakeHttp {
  let inFlight = 0;
  const http: FakeHttp = {
    gets: [],
    maxInFlight: 0,
    async get(url) {
      http.gets.push(url);
      inFlight++;
      http.maxInFlight = Math.max(http.maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      if (url.startsWith("https://api.gopluslabs.io/")) {
        return { status: 200, body: JSON.stringify({ code: 1, result: { phishing_site: 0 } }) };
      }
      if (url.startsWith("https://rdap.org/domain/")) {
        const eventDate = registrations[url.slice("https://rdap.org/domain/".length)] ?? "2020-01-01T00:00:00Z";
        return { status: 200, body: JSON.stringify({ events: [{ eventAction: "registration", eventDate }] }) };
      }
      return pages[url] ?? { status: 404, body: "" };
    },
    async resolveRedirect(url) {
      if (url === "https://airdrops.io/visit/53a3/?k=6efe1f6681") return "https://deepbook.tech/waitlist?ref=abc";
      return null;
    },
  };
  return http;
}

function project(p: { name: string; status: string } & Record<string, unknown>): Record<string, unknown> {
  return {
    token_symbol: null,
    chains: [],
    status_evidence: "quote",
    tasks: [],
    deadlines: [],
    official_urls: [],
    confidence: 0.9,
    ...p,
  };
}

const REPLIES: Record<string, unknown> = {
  [DEEPBOOK]: {
    is_airdrop_content: true,
    projects: [
      project({
        name: "DeepBook",
        status: "live",
        status_evidence: "Airdrop confirmed",
        chains: ["Sui"],
        tasks: ["Join the waitlist"],
        deadlines: [{ kind: "claim", date: null, precision: "approximate", text: "Claims are open for 30 days" }],
        official_urls: ["https://deepbook.tech/waitlist"],
      }),
    ],
  },
  [INK_PAGE]: {
    is_airdrop_content: true,
    projects: [
      project({
        name: "Ink Chain",
        status: "speculative",
        chains: ["Ink"],
        official_urls: ["https://inkonchain.com/", "https://x.com/inkonchain"],
      }),
    ],
  },
  "https://t.me/airdrops_io/101": { is_airdrop_content: false, projects: [] },
  "https://t.me/airdrops_io/102": {
    is_airdrop_content: true,
    projects: [project({ name: "$INK", token_symbol: "INK", status: "announced" })],
  },
  "https://t.me/airdrops_io/104": {
    is_airdrop_content: true,
    projects: [project({ name: "DeepBook", status: "ended", status_evidence: "DeepBook claim has ended" })],
  },
};

interface FakeChat {
  chat: ChatFn;
  calls: string[];
  maxInFlight: number;
}

/** Answers by the document URL in the prompt; unknown URLs (or `fail`) get HTTP 500. */
function fakeChat(replies: Record<string, unknown> = REPLIES, fail: Set<string> = new Set()): FakeChat {
  let inFlight = 0;
  const fake: FakeChat = {
    calls: [],
    maxInFlight: 0,
    chat: async (_model, messages) => {
      const url = /^Source: (\S+)/.exec(messages[1]?.content ?? "")?.[1] ?? "";
      fake.calls.push(url);
      inFlight++;
      fake.maxInFlight = Math.max(fake.maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      const reply = replies[url];
      if (reply === undefined || fail.has(url)) {
        return { content: "", finishReason: null, latencyMs: 1, httpStatus: 500, errorBody: "boom", servedModel: null };
      }
      return { content: JSON.stringify(reply), finishReason: "stop", latencyMs: 1, httpStatus: 200, servedModel: null };
    },
  };
  return fake;
}

function setup(opts: { pages?: Pages; chat?: FakeChat; repo?: MemoryRepo; now?: Date; config?: PipelineConfig } = {}) {
  const repo = opts.repo ?? new MemoryRepo();
  const http = fakeHttp(opts.pages ?? basePages());
  const chat = opts.chat ?? fakeChat();
  const now = opts.now ?? NOW;
  const deps = { repo, http, chat: chat.chat, sleep: async () => {}, now: () => now };
  return { repo, http, chat, deps, config: opts.config ?? defaultConfig };
}

async function projects(repo: MemoryRepo) {
  return repo.listProjectsForScoring(10_000, NOW);
}

/** Latest stored risk assessment of the first project with this name key. */
async function latestRisk(repo: MemoryRepo, nameKey: string, index = 0) {
  const id = (await repo.findProjectsByNameKey(nameKey))[index]?.id;
  return repo.riskAssessments.filter((r) => r.projectId === id).at(-1);
}

/** The Telegram fixture page with extra messages appended. */
function telegramWith(...messages: string[]): { status: number; body: string } {
  return { status: 200, body: fixture("telegram.html").replace("</section>", `${messages.join("")}</section>`) };
}

describe("runDaily", () => {
  it("collects, extracts, merges and scores on the first run", async () => {
    const { repo, deps, config, chat } = setup();
    const stats = await runDaily(deps, config);

    expect(stats.docs_collected).toBe(5); // 2 airdrops.io pages, 2 telegram posts, 1 defillama candidate
    expect(stats.docs_changed).toBe(5);
    expect(stats.extract_ok).toBe(4);
    expect(stats.not_airdrop).toBe(1);
    expect(stats.extract_failed).toBe(0);
    expect(stats.source_failed).toBe(0);
    expect(stats.projects_created).toBe(3);
    expect(stats.projects_updated).toBe(1);
    expect(stats.assessed).toBe(3);
    expect(stats.purged).toBe(0);

    const deepbook = (await repo.findProjectsByNameKey("deepbook"))[0];
    expect(deepbook?.status).toBe("live");
    expect(deepbook?.slug).toBe("deepbook");
    expect(deepbook?.chains).toEqual(["Sui"]);
    expect(deepbook?.officialDomains).toEqual(["deepbook.tech"]);

    const all = await projects(repo);
    const db = all.find((p) => p.nameKey === "deepbook");
    expect(db?.tasks).toEqual(["Join the waitlist"]);
    expect(db?.links).toEqual([{ url: "https://deepbook.tech/waitlist", kind: "website" }]);
    expect(repo.deadlines.filter((d) => d.projectId === db?.id)).toHaveLength(1);

    // Every attempt is stored, and the run row carries the stats.
    expect(repo.extractions.length).toBe(chat.calls.length);
    expect(repo.runs).toHaveLength(1);
    expect(repo.runs[0]?.stats).toEqual(stats);
    expect(repo.runs[0]?.finishedAt).not.toBeNull();
    expect(repo.riskAssessments).toHaveLength(3);

    const statuses = Object.fromEntries(repo.allDocuments().map((d) => [d.url, d.extractionStatus]));
    expect(statuses).toEqual({
      [DEEPBOOK]: "done",
      [INK_PAGE]: "done",
      "https://t.me/airdrops_io/101": "not_airdrop",
      "https://t.me/airdrops_io/102": "done",
      [LLAMA_DOC]: "done",
    });
  });

  it("does not re-extract unchanged documents on a second run", async () => {
    const { repo, deps, config } = setup();
    await runDaily(deps, config);

    const chat2 = fakeChat();
    const stats = await runDaily({ ...deps, chat: chat2.chat, now: () => new Date(NOW.getTime() + DAY) }, config);
    expect(stats.docs_changed).toBe(0);
    expect(stats.extract_ok).toBe(0);
    expect(stats.projects_created).toBe(0);
    expect(chat2.calls).toEqual([]);
    expect(repo.runs).toHaveLength(2);
  });

  it("counts a structurally broken source as failed and still processes the others", async () => {
    const pages = basePages();
    pages[HOME] = { status: 200, body: "<html></html>" };
    const { repo, deps, config } = setup({ pages });
    const stats = await runDaily(deps, config);

    expect(stats.source_failed).toBe(1);
    expect(stats.docs_collected).toBe(3);
    expect(stats.extract_ok).toBe(2);
    expect(repo.allDocuments().some((d) => d.url.startsWith("https://airdrops.io/"))).toBe(false);
    expect((await repo.findProjectsByNameKey("ink")).map((p) => p.name)).toEqual(["$INK"]);
  });

  it("counts a failing DefiLlama endpoint as a failed source", async () => {
    const pages = basePages();
    pages[PROTOCOLS] = { status: 503, body: "" };
    const { deps, config } = setup({ pages });
    const stats = await runDaily(deps, config);
    expect(stats.source_failed).toBe(1);
    expect(stats.docs_collected).toBe(4);
  });

  it("merges $INK and Ink Chain into one project", async () => {
    const { repo, deps, config } = setup();
    await runDaily(deps, config);

    const ink = await repo.findProjectsByNameKey("ink");
    expect(ink).toHaveLength(1);
    expect(ink[0]?.slug).toBe("ink-chain");
    expect(ink[0]?.tokenSymbol).toBe("INK");
    expect(ink[0]?.officialDomains).toEqual(["inkonchain.com"]);
    // The airdrops.io page has no "Updated" date, so its evidence is dated by fetch time (NOW),
    // which is newer than the Telegram post (2026-10-06).
    expect(ink[0]?.status).toBe("speculative");
    const scored = (await projects(repo)).find((p) => p.nameKey === "ink");
    expect(scored?.sourceCount).toBe(2);
  });

  it("records a status change when a later document reports the airdrop ended", async () => {
    const { repo, deps, config } = setup();
    await runDaily(deps, config);
    expect(repo.projectChanges.filter((c) => c.field === "status")).toEqual([]);

    const pages = basePages();
    const tg = fixture("telegram.html").replace(
      "</section>",
      `${tgMessage(104, "2026-10-09T08:00:00+00:00", "DeepBook claim has ended")}</section>`,
    );
    pages[TG] = { status: 200, body: tg };
    const later = new Date(NOW.getTime() + DAY);
    const chat2 = fakeChat();
    const stats = await runDaily({ ...deps, http: fakeHttp(pages), chat: chat2.chat, now: () => later }, config);

    expect(chat2.calls).toEqual(["https://t.me/airdrops_io/104"]);
    expect(stats.docs_changed).toBe(1);
    const deepbook = (await repo.findProjectsByNameKey("deepbook"))[0];
    expect(deepbook?.status).toBe("ended");
    const changes = repo.projectChanges.filter((c) => c.field === "status");
    expect(changes).toEqual([
      { projectId: deepbook?.id, field: "status", oldValue: "live", newValue: "ended", changedAt: later },
    ]);
  });

  it("returns numeric counters only", async () => {
    const { deps, config } = setup();
    const stats = await runDaily(deps, config);
    expect(Object.keys(stats).length).toBeGreaterThan(0);
    for (const value of Object.values(stats)) expect(typeof value).toBe("number");
  });

  it("turns DefiLlama candidates into speculative projects without calling the LLM", async () => {
    const { repo, deps, config, chat } = setup();
    await runDaily(deps, config);

    expect(chat.calls).not.toContain(LLAMA_DOC);
    const llama = repo.allDocuments().find((d) => d.url === LLAMA_DOC);
    expect(llama?.sourceKind).toBe("defillama");
    expect(llama?.sourceKey).toBe("defillama");
    expect(llama?.text).toContain("Hyperdrive Lend");
    // Volatile numbers stay out of the hashed text; they are only in the evidence quote.
    expect(llama?.text).not.toContain("25000000");

    const hyper = (await repo.findProjectsByNameKey("hyperdrivelend"))[0];
    expect(hyper?.status).toBe("speculative");
    expect(hyper?.chains).toEqual(["Hyperliquid L1"]);
    expect(hyper?.officialDomains).toEqual(["hyperdrive.fi"]);
    const evidence = await repo.listStatusEvidence(hyper?.id ?? "");
    expect(evidence).toEqual([{ status: "speculative", at: new Date(0) }]);
    const quotes = repo["evidence"].filter((e) => e.projectId === hyper?.id).map((e) => e.quote);
    expect(quotes).toEqual(["No token listed; TVL $25000000, 7d change 12.50% (DefiLlama)"]);
    // Excluded category and tokened protocols are not candidates.
    expect(repo.allDocuments().filter((d) => d.sourceKind === "defillama")).toHaveLength(1);
  });

  it("leaves a document pending when every model fails", async () => {
    const chat = fakeChat(REPLIES, new Set([INK_PAGE]));
    const { repo, deps, config } = setup({ chat });
    const stats = await runDaily(deps, config);

    expect(stats.extract_failed).toBe(1);
    expect(stats.extract_ok).toBe(3);
    expect(repo.allDocuments().find((d) => d.url === INK_PAGE)?.extractionStatus).toBe("pending");
    expect(chat.calls.filter((u) => u === INK_PAGE)).toHaveLength(config.models.length);
    expect(repo.extractions.filter((e) => e.error === "http_500")).toHaveLength(config.models.length);
  });

  it("keeps LLM and enrichment concurrency within limits", async () => {
    const { deps, config, chat, http } = setup();
    await runDaily(deps, { ...config, llmConcurrency: 2 });
    expect(chat.maxInFlight).toBeLessThanOrEqual(2);
    expect(chat.maxInFlight).toBeGreaterThan(1);
    expect(http.maxInFlight).toBeLessThanOrEqual(4);
  });

  it("enriches each registrable domain once per run", async () => {
    const { deps, config, http } = setup();
    await runDaily(deps, config);
    const goplus = http.gets.filter((u) => u.startsWith("https://api.gopluslabs.io/"));
    const rdap = http.gets.filter((u) => u.startsWith("https://rdap.org/"));
    expect(goplus.length).toBe(new Set(goplus).size);
    expect(goplus).toHaveLength(3);
    // Social links (x.com) are not enriched.
    expect(goplus.some((u) => u.includes("x.com"))).toBe(false);
    expect(rdap.sort()).toEqual([
      "https://rdap.org/domain/deepbook.tech",
      "https://rdap.org/domain/hyperdrive.fi",
      "https://rdap.org/domain/inkonchain.com",
    ]);
    expect(http.gets.filter((u) => u === "https://api.llama.fi/hacks")).toHaveLength(1);
  });

  it("respects maxDocumentsPerRun", async () => {
    const { repo, deps, config, chat } = setup();
    const stats = await runDaily(deps, { ...config, maxDocumentsPerRun: 2 });
    expect(new Set(chat.calls).size).toBe(2);
    expect(stats.extract_ok).toBe(2);
    expect(repo.allDocuments().filter((d) => d.extractionStatus === "pending")).toHaveLength(2);
  });

  it("still purges, finishes the run with run_error and rethrows when scoring fails at stage level", async () => {
    const repo = new MemoryRepo();
    repo.listProjectsForScoring = async () => {
      throw new Error("db down");
    };
    let purgeCalls = 0;
    const purge = repo.purgeDocumentText.bind(repo);
    repo.purgeDocumentText = async (days, now) => {
      purgeCalls += 1;
      return purge(days, now);
    };
    const { deps, config } = setup({ repo });
    await expect(runDaily(deps, config)).rejects.toThrow("db down");
    expect(purgeCalls).toBe(1);
    expect(repo.runs).toHaveLength(1);
    expect(repo.runs[0]?.stats.run_error).toBe(1);
    expect(repo.runs[0]?.stats.failed_step).toBe(5);
    expect(repo.runs[0]?.stats.docs_collected).toBe(5);
    expect(repo.runs[0]?.stats.projects_created).toBe(3);
    expect(repo.runs[0]?.finishedAt).not.toBeNull();
  });

  it("still scores and purges when every document ingest fails", async () => {
    const repo = new MemoryRepo();
    // A project from an earlier run, so there is something to score.
    await repo.createProject(
      { slug: "old", name: "Old", nameKey: "old", tokenSymbol: null, chains: [], officialDomains: [], status: "live", conflict: false, lookalikeOf: null },
      NOW,
    );
    repo.getDocumentHash = async () => {
      throw new Error("db read failed");
    };
    let purgeCalls = 0;
    const purge = repo.purgeDocumentText.bind(repo);
    repo.purgeDocumentText = async (days, now) => {
      purgeCalls += 1;
      return purge(days, now);
    };
    const { deps, config } = setup({ repo });
    const stats = await runDaily(deps, config);
    expect(stats.ingest_failed).toBe(5);
    expect(stats.run_error).toBeUndefined();
    expect(stats.assessed).toBe(1);
    expect(purgeCalls).toBe(1);
    expect(repo.runs[0]?.stats).toEqual(stats);
  });

  it("purges document text past the retention window", async () => {
    const { repo, deps, config } = setup();
    await runDaily(deps, config);
    const pages = basePages();
    pages[HOME] = { status: 500, body: "" };
    const stats = await runDaily(
      { ...deps, http: fakeHttp(pages), now: () => new Date(NOW.getTime() + 91 * DAY) },
      config,
    );
    // The DefiLlama document is refreshed on every run; the airdrops.io and telegram ones age out.
    expect(stats.purged).toBe(4);
  });
});

describe("runDaily extraction budget and merge queue", () => {
  it("starts no LLM call after the budget, leaves the rest pending, and still scores and purges", async () => {
    let current = NOW;
    const inner = fakeChat();
    const chat: FakeChat = {
      ...inner,
      chat: async (model, messages) => {
        const r = await inner.chat(model, messages);
        current = new Date(current.getTime() + 36 * 60_000);
        return r;
      },
    };
    const repo = new MemoryRepo();
    let purgeCalls = 0;
    const purge = repo.purgeDocumentText.bind(repo);
    repo.purgeDocumentText = async (days, now) => {
      purgeCalls += 1;
      return purge(days, now);
    };
    const { deps, config } = setup({ repo, chat, config: { ...defaultConfig, llmConcurrency: 1 } });
    const stats = await runDaily({ ...deps, now: () => current }, config);

    expect(inner.calls).toEqual([DEEPBOOK]);
    expect(stats.extract_ok).toBe(1);
    expect(stats.extract_deferred).toBe(3);
    expect(stats.extract_failed).toBe(0);
    expect(stats.run_error).toBeUndefined();
    const pending = repo.allDocuments().filter((d) => d.extractionStatus === "pending").map((d) => d.url);
    expect(pending.sort()).toEqual([INK_PAGE, "https://t.me/airdrops_io/101", "https://t.me/airdrops_io/102"]);
    expect(stats.assessed).toBe(2); // DeepBook and the DefiLlama project
    expect(purgeCalls).toBe(1);
  });

  it("stops between fallback models when the budget runs out and keeps the document pending", async () => {
    let current = NOW;
    const inner = fakeChat(REPLIES, new Set([INK_PAGE]));
    const chat: FakeChat = {
      ...inner,
      chat: async (model, messages) => {
        const r = await inner.chat(model, messages);
        if (r.httpStatus !== 200) current = new Date(current.getTime() + 36 * 60_000);
        return r;
      },
    };
    const { repo, deps, config } = setup({ chat, config: { ...defaultConfig, llmConcurrency: 1 } });
    const stats = await runDaily({ ...deps, now: () => current }, config);
    expect(inner.calls.filter((u) => u === INK_PAGE)).toHaveLength(1);
    expect(stats.extract_deferred).toBe(3);
    expect(stats.extract_failed).toBe(0);
    const ink = repo.allDocuments().find((d) => d.url === INK_PAGE);
    expect(ink?.extractionStatus).toBe("pending");
    expect(repo.extractions.filter((e) => e.documentId === ink?.id)).toHaveLength(1);
  });

  it("stops calling a model for the rest of the run after 3 consecutive failures", async () => {
    const first = defaultConfig.models[0]?.id;
    const inner = fakeChat();
    const byModel: string[] = [];
    const chat: FakeChat = {
      ...inner,
      chat: async (model, messages) => {
        byModel.push(model.id);
        if (model.id === first) return { content: "", finishReason: null, latencyMs: 180_000, httpStatus: 0, servedModel: null };
        return inner.chat(model, messages);
      },
    };
    const { deps, config } = setup({ chat, config: { ...defaultConfig, llmConcurrency: 1 } });
    const stats = await runDaily(deps, config);

    // 4 LLM documents: the first 3 each time out on the first model, the 4th goes straight to the second.
    expect(byModel.filter((id) => id === first)).toHaveLength(3);
    expect(stats.extract_ok).toBe(4);
    expect(stats.llm_models_tripped).toBe(1);
  });

  it("merges a document right after its extraction, before later extractions finish", async () => {
    const repo = new MemoryRepo();
    const inner = fakeChat();
    let deepbookAtLastCall: boolean | null = null;
    const chat: FakeChat = {
      ...inner,
      chat: async (model, messages) => {
        if (messages[1]?.content.startsWith("Source: https://t.me/airdrops_io/102")) {
          deepbookAtLastCall = (await repo.findProjectsByNameKey("deepbook")).length > 0;
        }
        return inner.chat(model, messages);
      },
    };
    const { deps, config } = setup({ repo, chat, config: { ...defaultConfig, llmConcurrency: 1 } });
    await runDaily(deps, config);
    expect(deepbookAtLastCall).toBe(true);
  });

  it("never runs two merges at the same time", async () => {
    const repo = new MemoryRepo();
    let inFlight = 0;
    let maxInFlight = 0;
    const find = repo.findProjectsByNameKey.bind(repo);
    repo.findProjectsByNameKey = async (key) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 3));
      inFlight--;
      return find(key);
    };
    const { deps, config } = setup({ repo });
    const stats = await runDaily(deps, config);
    expect(stats.projects_created).toBe(3);
    expect(maxInFlight).toBe(1);
  });
});

describe("config", () => {
  it("uses the model order and limits from the global constraints", () => {
    expect(defaultConfig.models[0]?.extraBody).toEqual({});
    expect(defaultConfig.models[1]?.extraBody).toEqual({ reasoning_effort: "low" });
    expect(defaultConfig.models[2]?.extraBody).toEqual({ chat_template_kwargs: { thinking: false } });
    expect(defaultConfig.models[3]?.extraBody).toEqual({});
    expect(defaultConfig.llmConcurrency).toBe(3);
    expect(defaultConfig.maxDocumentsPerRun).toBe(150);
    expect(defaultConfig.scoreActiveSinceDays).toBe(60);
    expect(defaultConfig.textRetentionDays).toBe(90);
    expect(defaultConfig.extractBudgetMinutes).toBe(35);
    expect(defaultConfig.telegramChannels).toEqual(["airdrops_io"]);
    expect(defaultConfig.defillama).toEqual({ minTvl: 10_000_000, excludedCategories: ["CEX"], limit: 50 });
  });
});

describe("LLM providers", () => {
  it("orders freellm auto first and NVIDIA models as fallback", () => {
    expect(defaultConfig.models.map((m) => `${m.provider}:${m.id}`)).toEqual([
      "freellm:auto",
      "nvidia:z-ai/glm-5.3-flash",
      "nvidia:moonshotai/kimi-k3",
      "nvidia:google/gemma-4-31b-it",
    ]);
  });

  it("loads provider URLs and keys from the environment", () => {
    expect(loadProviders({ LLM_BASE_URL: "https://x.test/v1/", LLM_API_KEY: "", NVIDIA_API_KEY: "n" })).toEqual({
      freellm: { baseUrl: "https://x.test/v1", apiKey: "" },
      nvidia: { baseUrl: "https://integrate.api.nvidia.com/v1", apiKey: "n" },
    });
    expect(loadProviders({})).toEqual({
      freellm: { baseUrl: "https://freellm.hellvyn.id/v1", apiKey: "" },
      nvidia: { baseUrl: "https://integrate.api.nvidia.com/v1", apiKey: "" },
    });
  });

  it("falls back to the default freellm URL when LLM_BASE_URL is empty", () => {
    expect(loadProviders({ LLM_BASE_URL: "" }).freellm.baseUrl).toBe("https://freellm.hellvyn.id/v1");
  });
});

describe("classifyLink", () => {
  it.each([
    ["https://x.com/inkonchain", "social"],
    ["https://www.twitter.com/ink", "social"],
    ["https://t.me/ink", "social"],
    ["https://discord.gg/abc", "social"],
    ["https://github.com/ink", "social"],
    ["https://linktr.ee/ink", "social"],
    ["https://claim.ink.xyz/", "claim"],
    ["https://ink.xyz/claim/now", "claim"],
    ["https://docs.ink.xyz/", "docs"],
    ["https://ink.xyz/docs/start", "docs"],
    ["https://app.ink.xyz/", "app"],
    ["https://portal.ink.xyz/bridge", "app"],
    ["https://portal.ink.xyz/", "website"],
    ["https://www.ink.xyz/about", "website"],
    ["https://ink.xyz/", "website"],
  ])("%s -> %s", (url, kind) => {
    expect(classifyLink(url)).toBe(kind);
  });

  it("returns null for unparseable URLs", () => {
    expect(classifyLink("not a url")).toBeNull();
  });
});

describe("pickSlug", () => {
  const taken = (...slugs: string[]) => async (slug: string) => slugs.includes(slug);

  it("kebab-cases the name", async () => {
    expect(await pickSlug("Ink Chain", taken())).toBe("ink-chain");
    expect(await pickSlug("  $INK!! ", taken())).toBe("ink");
    expect(await pickSlug("Café Protocol", taken())).toBe("cafe-protocol");
  });

  it("appends a counter until the slug is free across all projects", async () => {
    expect(await pickSlug("Ink", taken("ink"))).toBe("ink-2");
    expect(await pickSlug("Ink", taken("ink", "ink-2"))).toBe("ink-3");
    // "Pump 2" (another name key) already owns pump-2.
    expect(await pickSlug("Pump", taken("pump", "pump-2"))).toBe("pump-3");
  });

  it("falls back to a stable non-empty slug for names without ASCII letters", async () => {
    const slug = await pickSlug("以太", taken());
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(await pickSlug("以太", taken())).toBe(slug);
    expect(await pickSlug("以太", taken(slug))).toBe(`${slug}-2`);
  });
});

describe("runDaily lookalikes", () => {
  it("creates a lookalike with a suffixed slug when the same name has a different domain", async () => {
    const pages = basePages();
    const tg = fixture("telegram.html").replace(
      "</section>",
      `${tgMessage(105, "2026-10-07T08:00:00+00:00", 'Claim DeepBook at <a href="https://deepbook-claim.xyz/">here</a>')}</section>`,
    );
    pages[TG] = { status: 200, body: tg };
    const replies = {
      ...REPLIES,
      "https://t.me/airdrops_io/105": {
        is_airdrop_content: true,
        projects: [project({ name: "DeepBook", status: "live", official_urls: ["https://deepbook-claim.xyz/"] })],
      },
    };
    const { repo, deps, config } = setup({ pages, chat: fakeChat(replies) });
    await runDaily(deps, config);

    const rows = await repo.findProjectsByNameKey("deepbook");
    expect(rows.map((r) => r.slug)).toEqual(["deepbook", "deepbook-2"]);
    expect(rows[1]?.lookalikeOf).toBe(rows[0]?.id);

    // The risk reason names the other project and its official domain, never its id.
    const risk = await latestRisk(repo, "deepbook", 1);
    const reasons = risk?.reasons.filter((r) => r.code === "lookalike_domain").map((r) => r.message) ?? [];
    expect(reasons).toContain('This project shares a name with "DeepBook" (deepbook.tech) but uses a different domain.');
    expect(reasons.join(" ")).not.toContain(rows[0]?.id ?? "-");
  });
});

describe("runDaily official domains", () => {
  it("never promotes a later claim domain to official, so a young lookalike claim domain is high risk", async () => {
    const { repo, deps, config } = setup();
    await runDaily(deps, config);
    expect((await repo.findProjectsByNameKey("deepbook"))[0]?.officialDomains).toEqual(["deepbook.tech"]);

    const pages = basePages();
    pages[TG] = telegramWith(
      tgMessage(
        105,
        "2026-10-10T08:00:00+00:00",
        'DeepBook claim is live: <a href="https://deepbook.tech/">site</a> <a href="https://deepbook-airdrop.xyz/claim">claim</a>',
      ),
    );
    const replies = {
      ...REPLIES,
      "https://t.me/airdrops_io/105": {
        is_airdrop_content: true,
        projects: [
          project({ name: "DeepBook", status: "live", official_urls: ["https://deepbook.tech/", "https://deepbook-airdrop.xyz/claim"] }),
        ],
      },
    };
    const later = new Date(NOW.getTime() + DAY);
    const http = fakeHttp(pages, { "deepbook-airdrop.xyz": new Date(NOW.getTime() - 5 * DAY).toISOString() });
    await runDaily({ ...deps, http, chat: fakeChat(replies).chat, now: () => later }, config);

    const rows = await repo.findProjectsByNameKey("deepbook");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.officialDomains).toEqual(["deepbook.tech"]);
    const risk = await latestRisk(repo, "deepbook");
    expect(risk?.level).toBe("high");
    expect(risk?.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(["new_claim_domain", "lookalike_domain", "young_domain"]));
  });

  it("takes official domains only from website, app and docs links of a new project", async () => {
    const pages = basePages();
    pages[TG] = telegramWith(
      tgMessage(
        106,
        "2026-10-08T08:00:00+00:00",
        'Nova drop: <a href="https://claim.nova-drop.xyz/">claim</a> <a href="https://docs.novaproto.io/start">docs</a> <a href="https://x.com/nova">X</a>',
      ),
    );
    const replies = {
      ...REPLIES,
      "https://t.me/airdrops_io/106": {
        is_airdrop_content: true,
        projects: [
          project({
            name: "Nova",
            status: "live",
            official_urls: ["https://claim.nova-drop.xyz/", "https://docs.novaproto.io/start", "https://x.com/nova"],
          }),
        ],
      },
    };
    const { repo, deps, config } = setup({ pages, chat: fakeChat(replies) });
    await runDaily(deps, config);
    expect((await repo.findProjectsByNameKey("nova"))[0]?.officialDomains).toEqual(["novaproto.io"]);
  });

  it("fills official domains of an existing project that has none yet", async () => {
    const repo = new MemoryRepo();
    await repo.createProject(
      { slug: "ink", name: "Ink", nameKey: "ink", tokenSymbol: null, chains: [], officialDomains: [], status: "unknown", conflict: false, lookalikeOf: null },
      new Date(NOW.getTime() - DAY),
    );
    const { deps, config } = setup({ repo });
    await runDaily(deps, config);
    const ink = await repo.findProjectsByNameKey("ink");
    expect(ink).toHaveLength(1);
    expect(ink[0]?.officialDomains).toEqual(["inkonchain.com"]);
  });

  it("treats the DefiLlama url as the website and the DefiLlama twitter handle as a social link", async () => {
    const pages = basePages();
    pages[PROTOCOLS] = {
      status: 200,
      body: JSON.stringify([{ ...PROTOCOL_LIST[0], url: "https://hyperdrive.fi/claim", twitter: "hyperdrive_fi" }]),
    };
    const { repo, deps, config } = setup({ pages });
    await runDaily(deps, config);
    const [hyper] = await repo.findProjectsByNameKey("hyperdrivelend");
    expect(hyper?.officialDomains).toEqual(["hyperdrive.fi"]);
    const scored = (await projects(repo)).find((p) => p.nameKey === "hyperdrivelend");
    expect(scored?.links).toEqual([
      { url: "https://hyperdrive.fi/claim", kind: "website" },
      { url: "https://x.com/hyperdrive_fi", kind: "social" },
    ]);
    expect(repo.riskAssessments.find((r) => r.projectId === hyper?.id)?.reasons.map((r) => r.code)).not.toContain("single_source");
  });
});

describe("runDaily evidence", () => {
  it("replaces a document's status evidence when the page changes, so an update on the same day is no conflict", async () => {
    const { repo, deps, config } = setup();
    await runDaily(deps, config);
    expect((await repo.findProjectsByNameKey("deepbook"))[0]?.status).toBe("live");

    // Same "Updated 24 Jul 2026" date, new content that says the claim ended.
    const pages = basePages();
    pages[DEEPBOOK] = {
      status: 200,
      body: fixture("airdrops-detail.html").replace("Claims are open for 30 days.", "The claim has ended."),
    };
    const replies = {
      ...REPLIES,
      [DEEPBOOK]: { is_airdrop_content: true, projects: [project({ name: "DeepBook", status: "ended", official_urls: ["https://deepbook.tech/waitlist"] })] },
    };
    await runDaily({ ...deps, http: fakeHttp(pages), chat: fakeChat(replies).chat, now: () => new Date(NOW.getTime() + DAY) }, config);
    const [deepbook] = await repo.findProjectsByNameKey("deepbook");
    expect(deepbook?.status).toBe("ended");
    expect(deepbook?.conflict).toBe(false);
    expect((await repo.listStatusEvidence(deepbook?.id ?? "")).map((e) => e.status)).toEqual(["ended"]);
  });

  it("copies the document url into evidence", async () => {
    const { repo, deps, config } = setup();
    await runDaily(deps, config);
    const [deepbook] = await repo.findProjectsByNameKey("deepbook");
    expect(repo["evidence"].filter((e) => e.projectId === deepbook?.id).map((e) => e.sourceUrl)).toEqual([DEEPBOOK]);
  });

  it("scans the text of a single-project document for dangerous asks the LLM left out", async () => {
    const pages = basePages();
    pages[TG] = telegramWith(
      tgMessage(106, "2026-10-08T08:00:00+00:00", "Scamdrop airdrop is live. Never share your keys with anyone. Enter your seed phrase to claim your tokens."),
    );
    const replies = {
      ...REPLIES,
      "https://t.me/airdrops_io/106": {
        is_airdrop_content: true,
        projects: [project({ name: "Scamdrop", status: "live", tasks: ["Claim your tokens"] })],
      },
    };
    const { repo, deps, config } = setup({ pages, chat: fakeChat(replies) });
    await runDaily(deps, config);
    const [scam] = await repo.findProjectsByNameKey("scamdrop");
    const asks = repo["evidence"].filter((e) => e.projectId === scam?.id && e.field === "dangerous_ask");
    expect(asks.map((e) => [e.value, e.quote])).toEqual([["asks_secret", "Enter your seed phrase to claim your tokens."]]);
    const risk = await latestRisk(repo, "scamdrop");
    expect(risk?.level).toBe("critical");
    expect(risk?.reasons.find((r) => r.code === "asks_secret")?.source).toBe("text");
  });

  it("does not attribute text asks in a multi-project document to any project", async () => {
    const pages = basePages();
    pages[TG] = telegramWith(
      tgMessage(107, "2026-10-08T08:00:00+00:00", "Alphadrop and Betadrop airdrops. Enter your seed phrase to claim your tokens."),
    );
    const replies = {
      ...REPLIES,
      "https://t.me/airdrops_io/107": {
        is_airdrop_content: true,
        projects: [project({ name: "Alphadrop", status: "live" }), project({ name: "Betadrop", status: "live" })],
      },
    };
    const { repo, deps, config } = setup({ pages, chat: fakeChat(replies) });
    await runDaily(deps, config);
    expect(repo["evidence"].filter((e) => e.field === "dangerous_ask")).toEqual([]);
    for (const key of ["alphadrop", "betadrop"]) {
      expect((await latestRisk(repo, key))?.reasons.map((r) => r.code)).not.toContain("asks_secret");
    }
  });
});

describe("runDaily fault tolerance", () => {
  it("marks a document merge_failed when its merge throws and keeps going", async () => {
    const repo = new MemoryRepo();
    const create = repo.createProject.bind(repo);
    repo.createProject = async (p, at) => {
      if (p.nameKey === "ink") throw new Error("insert failed");
      return create(p, at);
    };
    let purgeCalls = 0;
    const purge = repo.purgeDocumentText.bind(repo);
    repo.purgeDocumentText = async (days, now) => {
      purgeCalls += 1;
      return purge(days, now);
    };
    const { deps, config } = setup({ repo });
    const stats = await runDaily(deps, config);

    // Both Ink documents try to create the "ink" project and fail; DeepBook and DefiLlama still merge.
    expect(stats.merge_failed).toBe(2);
    expect(stats.run_error).toBeUndefined();
    expect(stats.projects_created).toBe(2);
    expect(stats.assessed).toBe(2);
    expect(purgeCalls).toBe(1);
    const status = (url: string) => repo.allDocuments().find((d) => d.url === url)?.extractionStatus;
    expect(status(INK_PAGE)).toBe("merge_failed");
    expect(status("https://t.me/airdrops_io/102")).toBe("merge_failed");
    expect(status(DEEPBOOK)).toBe("done");
    expect((await repo.findProjectsByNameKey("deepbook"))[0]?.status).toBe("live");
    expect((await repo.listPendingDocuments(100)).map((d) => d.url)).toEqual([]);

    // Not retried while the content is unchanged.
    const chat2 = fakeChat();
    await runDaily({ ...deps, chat: chat2.chat }, config);
    expect(chat2.calls).toEqual([]);
  });

  it("keeps ingesting the other documents and sources when storing one document throws", async () => {
    const repo = new MemoryRepo();
    const upsert = repo.upsertDocument.bind(repo);
    repo.upsertDocument = async (doc, hash) => {
      if (doc.url === INK_PAGE || doc.url === LLAMA_DOC) throw new Error("insert failed");
      return upsert(doc, hash);
    };
    const { deps, config } = setup({ repo });
    const stats = await runDaily(deps, config);
    expect(stats.ingest_failed).toBe(2);
    expect(stats.run_error).toBeUndefined();
    expect(stats.source_failed).toBe(0);
    expect(stats.docs_collected).toBe(5);
    expect(stats.docs_changed).toBe(3);
    expect(repo.allDocuments().map((d) => d.url).sort()).toEqual([
      DEEPBOOK,
      "https://t.me/airdrops_io/101",
      "https://t.me/airdrops_io/102",
    ]);
    expect((await repo.findProjectsByNameKey("deepbook"))[0]?.status).toBe("live");
  });

  it("assesses the other projects when one assessment fails", async () => {
    const repo = new MemoryRepo();
    const save = repo.saveRiskAssessment.bind(repo);
    repo.saveRiskAssessment = async (id, a, at) => {
      const [deepbook] = await repo.findProjectsByNameKey("deepbook");
      if (id === deepbook?.id) throw new Error("write failed");
      return save(id, a, at);
    };
    const { deps, config } = setup({ repo });
    const stats = await runDaily(deps, config);
    expect(stats.score_failed).toBe(1);
    expect(stats.assessed).toBe(2);
    expect(repo.riskAssessments).toHaveLength(2);
  });

  it("keeps extracting the other documents when storing one extraction throws", async () => {
    const repo = new MemoryRepo();
    const saveExtraction = repo.saveExtraction.bind(repo);
    const byId = new Map<string, StoredDocument>();
    repo.saveExtraction = async (documentId, attempt, version) => {
      if (byId.size === 0) for (const d of repo.allDocuments()) byId.set(d.id, d);
      if (byId.get(documentId)?.url === INK_PAGE) throw new Error("insert failed");
      return saveExtraction(documentId, attempt, version);
    };
    const { deps, config } = setup({ repo });
    const stats = await runDaily(deps, config);
    expect(stats.extract_failed).toBe(1);
    expect(stats.extract_ok).toBe(3);
    expect(stats.run_error).toBeUndefined();
    expect(repo.allDocuments().find((d) => d.url === INK_PAGE)?.extractionStatus).toBe("pending");
    expect(repo.allDocuments().find((d) => d.url === DEEPBOOK)?.extractionStatus).toBe("done");
  });

  it("does not send pending documents with purged (empty) text to the LLM", async () => {
    const repo = new MemoryRepo();
    await repo.upsertDocument(
      { sourceKind: "telegram", sourceKey: "telegram:old", url: "https://t.me/old/1", text: "", publishedAt: null, pageUpdatedAt: null, fetchedAt: new Date(0) },
      "h",
    );
    const { deps, config, chat } = setup({ repo });
    const stats = await runDaily(deps, config);
    expect(chat.calls).not.toContain("https://t.me/old/1");
    expect(stats.extract_failed).toBe(0);
    expect(repo.allDocuments().find((d) => d.url === "https://t.me/old/1")?.extractionStatus).toBe("pending");
  });
});

describe("runDaily slugs, platforms and DefiLlama", () => {
  it("picks a slug that is free across name keys", async () => {
    const repo = new MemoryRepo();
    // "Déepbook" keeps its accent in the name key but folds to the slug "deepbook".
    await repo.createProject(
      { slug: "deepbook", name: "Déepbook", nameKey: "déepbook", tokenSymbol: null, chains: [], officialDomains: [], status: "unknown", conflict: false, lookalikeOf: null },
      NOW,
    );
    const { deps, config } = setup({ repo });
    const stats = await runDaily(deps, config);
    expect(stats.merge_failed).toBe(0);
    const [deepbook] = await repo.findProjectsByNameKey("deepbook");
    expect(deepbook?.slug).toBe("deepbook-2");
  });

  it("never makes a multi-tenant platform an official domain", async () => {
    const pages = basePages();
    pages[INK_PAGE] = {
      status: 200,
      body: detailPage(
        "Ink Chain",
        'Site <a href="https://inkonchain.com/">Ink</a>. Form <a href="https://docs.google.com/forms/d/abc/viewform">apply</a>.',
      ),
    };
    const replies = {
      ...REPLIES,
      [INK_PAGE]: {
        is_airdrop_content: true,
        projects: [
          project({
            name: "Ink Chain",
            status: "speculative",
            official_urls: ["https://inkonchain.com/", "https://docs.google.com/forms/d/abc/viewform"],
          }),
        ],
      },
    };
    const { repo, deps, config } = setup({ pages, chat: fakeChat(replies) });
    await runDaily(deps, config);
    const [ink] = await repo.findProjectsByNameKey("ink");
    expect(ink?.officialDomains).toEqual(["inkonchain.com"]);
    const scored = (await projects(repo)).find((p) => p.nameKey === "ink");
    expect(scored?.links.map((l) => l.url)).toContain("https://docs.google.com/forms/d/abc/viewform");
  });

  it("does not let a DefiLlama listing override the status of an existing project", async () => {
    const pages = basePages();
    pages[PROTOCOLS] = {
      status: 200,
      body: JSON.stringify([
        ...PROTOCOL_LIST,
        { name: "DeepBook", slug: "deepbook", url: "https://deepbook.tech", chains: ["Sui"], tvl: 3e7, change_7d: 1, category: "Dexs", gecko_id: null, symbol: "-" },
      ]),
    };
    const { repo, deps, config } = setup({ pages });
    const stats = await runDaily(deps, config);
    expect(stats.merge_failed).toBe(0);
    const rows = await repo.findProjectsByNameKey("deepbook");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("live");
    expect((await repo.listStatusEvidence(rows[0]?.id ?? "")).map((e) => e.status)).toEqual(["live"]);
    const fields = repo["evidence"].filter((e) => e.projectId === rows[0]?.id).map((e) => e.field);
    expect(fields.sort()).toEqual(["defillama_listing", "status"]);
  });

  it("does not count a DefiLlama TVL change as a document change", async () => {
    const { deps, config } = setup();
    await runDaily(deps, config);
    const pages = basePages();
    pages[PROTOCOLS] = {
      status: 200,
      body: JSON.stringify(PROTOCOL_LIST.map((p) => ({ ...p, tvl: p.tvl * 2, change_7d: -3 }))),
    };
    const stats = await runDaily({ ...deps, http: fakeHttp(pages), now: () => new Date(NOW.getTime() + DAY) }, config);
    expect(stats.docs_changed).toBe(0);
  });

  it("lets an older-dated airdrops.io page outrank DefiLlama speculative evidence", async () => {
    const llamaDeepbook = {
      name: "DeepBook", slug: "deepbook", url: "https://deepbook.tech", chains: ["Sui"], tvl: 3e7, change_7d: 1, category: "Dexs", gecko_id: null, symbol: "-",
    };
    const pages = basePages();
    pages[HOME] = { status: 500, body: "" };
    pages[PROTOCOLS] = { status: 200, body: JSON.stringify([llamaDeepbook]) };
    const { repo, deps, config } = setup({ pages });
    await runDaily(deps, config);
    const [created] = await repo.findProjectsByNameKey("deepbook");
    expect(created?.status).toBe("speculative");

    // The detail page says "Updated 24 Jul 2026", well before the run's now.
    const pages2 = basePages();
    pages2[PROTOCOLS] = { status: 200, body: JSON.stringify([llamaDeepbook]) };
    await runDaily({ ...deps, http: fakeHttp(pages2), now: () => new Date(NOW.getTime() + DAY) }, config);
    const rows = await repo.findProjectsByNameKey("deepbook");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("live");
    const changes = repo.projectChanges.filter((c) => c.field === "status" && c.projectId === rows[0]?.id);
    expect(changes.map((c) => [c.oldValue, c.newValue])).toEqual([["speculative", "live"]]);
  });
});

describe("runDaily without email", () => {
  it("runs without any email settings and reports no digest counters", async () => {
    const { deps, config } = setup();
    const stats = await runDaily(deps, config);

    expect(stats.assessed).toBe(3);
    expect(Object.keys(stats).some((k) => k.startsWith("digests_"))).toBe(false);
  });
});

describe("runDailyJob with leftover Brevo settings", () => {
  const BASE_ENV = { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "service-key" };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["a complete set", { BREVO_API_KEY: "xkeysib-1", EMAIL_FROM: "Bot <bot@saf.test>", SITE_URL: "https://saf.test" }],
    ["only the API key", { BREVO_API_KEY: "xkeysib-1" }],
  ])("ignores %s in the environment: exit 0, no digest counters, no call to api.brevo.com", async (_name, brevoEnv) => {
    const fetched: string[] = [];
    vi.stubGlobal("fetch", async (input: unknown) => {
      fetched.push(String(input));
      throw new Error("no network in this test");
    });
    const { deps } = setup();
    const lines: string[] = [];

    const code = await runDailyJob({ ...BASE_ENV, ...brevoEnv }, deps, (line) => lines.push(line));

    expect(code).toBe(0);
    expect(fetched.filter((u) => u.includes("brevo"))).toEqual([]);
    expect(lines).toHaveLength(1);
    const stats = JSON.parse(lines[0] ?? "{}") as Record<string, number>;
    expect(stats.assessed).toBe(3);
    expect(stats.run_error).toBeUndefined();
    expect(Object.keys(stats).some((k) => k.startsWith("digests_"))).toBe(false);
  });
});

describe("runDailyJob LLM providers", () => {
  const ENV = {
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    LLM_BASE_URL: "https://llm.test/v1/",
    NVIDIA_API_KEY: "nvidia-test-key",
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const sse = (model: string, content: string): Response =>
    new Response(
      `data: ${JSON.stringify({ model, choices: [{ delta: { content }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
      { status: 200 },
    );

  it.each([
    ["an empty LLM_API_KEY sends no Authorization", "", undefined],
    ["a set LLM_API_KEY is sent as a bearer token", "llm-test-key", "Bearer llm-test-key"],
  ])("calls freellm auto first, then NVIDIA when auto answers unparsable JSON: %s", async (_name, llmKey, llmAuth) => {
    const requests: { url: string; auth: string | undefined }[] = [];
    vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, auth: (init?.headers as Record<string, string>)["Authorization"] });
      if (url.startsWith("https://llm.test/")) return sse("gpt-oss:120b", "not json");
      const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
      const source = /^Source: (\S+)/.exec(body.messages[1]?.content ?? "")?.[1] ?? "";
      const reply = REPLIES[source];
      if (reply === undefined) return new Response("unknown", { status: 500 });
      return sse("glm-served", JSON.stringify(reply));
    });
    const { repo, http } = setup();
    const lines: string[] = [];

    const code = await runDailyJob(
      { ...ENV, LLM_API_KEY: llmKey },
      { repo, http, sleep: async () => {}, now: () => NOW },
      (line) => lines.push(line),
    );

    expect(code).toBe(0);
    const freellm = requests.filter((r) => r.url.startsWith("https://llm.test/"));
    const nvidia = requests.filter((r) => !r.url.startsWith("https://llm.test/"));
    expect(new Set(freellm.map((r) => r.url))).toEqual(new Set(["https://llm.test/v1/chat/completions"]));
    expect(new Set(freellm.map((r) => r.auth))).toEqual(new Set([llmAuth]));
    expect(new Set(nvidia.map((r) => r.url))).toEqual(new Set(["https://integrate.api.nvidia.com/v1/chat/completions"]));
    expect(new Set(nvidia.map((r) => r.auth))).toEqual(new Set(["Bearer nvidia-test-key"]));
    expect(freellm).toHaveLength(4);
    expect(nvidia).toHaveLength(4);

    const attempts = repo.extractions.map((e) => [e.model, e.servedModel, e.error]);
    expect(attempts.filter((a) => a[0] === "freellm:auto")).toEqual(
      Array.from({ length: 4 }, () => ["freellm:auto", "gpt-oss:120b", "json_parse"]),
    );
    expect(attempts.filter((a) => a[0] !== "freellm:auto")).toEqual(
      Array.from({ length: 4 }, () => ["nvidia:z-ai/glm-5.3-flash", "glm-served", null]),
    );

    const stats = JSON.parse(lines[0] ?? "{}") as Record<string, number>;
    expect(stats.extract_ok).toBe(4);
    expect(stats.llm_models_tripped).toBe(0);
    expect(lines.join("\n")).not.toContain("test-key");
  });
});
