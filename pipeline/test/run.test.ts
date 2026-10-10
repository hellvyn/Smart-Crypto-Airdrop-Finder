import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Http } from "../src/collectors/types.js";
import type { ChatFn } from "../src/llm/extract.js";
import { defaultConfig, sourceCount } from "../src/config.js";
import type { PipelineConfig } from "../src/config.js";
import { runDaily } from "../src/run.js";
import { classifyLink, pickSlug } from "../src/steps/merge.js";
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
      body: detailPage("Ink Chain", 'Bridge to Ink now. Official site <a href="https://inkonchain.com/">Ink</a>.'),
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

function fakeHttp(pages: Pages): FakeHttp {
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
        return {
          status: 200,
          body: JSON.stringify({ events: [{ eventAction: "registration", eventDate: "2020-01-01T00:00:00Z" }] }),
        };
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
    projects: [project({ name: "Ink Chain", status: "speculative", chains: ["Ink"], official_urls: ["https://inkonchain.com/"] })],
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
        return { content: "", finishReason: null, latencyMs: 1, httpStatus: 500, errorBody: "boom" };
      }
      return { content: JSON.stringify(reply), finishReason: "stop", latencyMs: 1, httpStatus: 200 };
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
    expect(llama?.text).toContain("25000000");

    const hyper = (await repo.findProjectsByNameKey("hyperdrivelend"))[0];
    expect(hyper?.status).toBe("speculative");
    expect(hyper?.chains).toEqual(["Hyperliquid L1"]);
    expect(hyper?.officialDomains).toEqual(["hyperdrive.fi"]);
    const evidence = await repo.listStatusEvidence(hyper?.id ?? "");
    expect(evidence).toEqual([{ status: "speculative", at: NOW }]);
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

  it("finishes the run with run_error and rethrows when a step throws", async () => {
    const repo = new MemoryRepo();
    repo.listProjectsForScoring = async () => {
      throw new Error("db down");
    };
    const { deps, config } = setup({ repo });
    await expect(runDaily(deps, config)).rejects.toThrow("db down");
    expect(repo.runs).toHaveLength(1);
    expect(repo.runs[0]?.stats.run_error).toBe(1);
    expect(repo.runs[0]?.stats.docs_collected).toBe(5);
    expect(repo.runs[0]?.finishedAt).not.toBeNull();
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

describe("config", () => {
  it("uses the model order and limits from the global constraints", () => {
    expect(defaultConfig.models.map((m) => m.id)).toEqual([
      "moonshotai/kimi-k3",
      "z-ai/glm-5.3-flash",
      "google/gemma-4-31b-it",
    ]);
    expect(defaultConfig.models[0]?.extraBody).toEqual({ chat_template_kwargs: { thinking: false } });
    expect(defaultConfig.models[1]?.extraBody).toEqual({ reasoning_effort: "low" });
    expect(defaultConfig.models[2]?.extraBody).toEqual({});
    expect(defaultConfig.llmConcurrency).toBe(3);
    expect(defaultConfig.maxDocumentsPerRun).toBe(150);
    expect(defaultConfig.scoreActiveSinceDays).toBe(60);
    expect(defaultConfig.textRetentionDays).toBe(90);
    expect(defaultConfig.telegramChannels).toEqual(["airdrops_io"]);
    expect(defaultConfig.defillama).toEqual({ minTvl: 10_000_000, excludedCategories: ["CEX"], limit: 50 });
    expect(sourceCount(defaultConfig)).toBe(3);
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
  it("kebab-cases the name", () => {
    expect(pickSlug("Ink Chain", [])).toBe("ink-chain");
    expect(pickSlug("  $INK!! ", [])).toBe("ink");
    expect(pickSlug("Café Protocol", [])).toBe("cafe-protocol");
  });

  it("appends a counter when a same-name project already uses the slug", () => {
    expect(pickSlug("Ink", ["ink"])).toBe("ink-2");
    expect(pickSlug("Ink", ["ink", "ink-2"])).toBe("ink-3");
  });

  it("falls back to a stable non-empty slug for names without ASCII letters", () => {
    const slug = pickSlug("以太", []);
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(pickSlug("以太", [])).toBe(slug);
    expect(pickSlug("以太", [slug])).toBe(`${slug}-2`);
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
  });
});
