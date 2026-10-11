import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  detailLines,
  EMPTY_DETAILS,
  parseProtocolDetail,
  selectSpeculativeCandidates,
} from "../src/collectors/defillama.js";
import type { Http } from "../src/collectors/types.js";
import { defaultConfig } from "../src/config.js";
import type { PipelineConfig } from "../src/config.js";
import { emptyStats } from "../src/stats.js";
import { collectSources, defillamaDocument } from "../src/steps/collect.js";
import { MemoryRepo } from "../src/store/memory-repo.js";

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const LIST = fixture("defillama-protocols-list.json") as Record<string, unknown>[];
const DETAIL = fixture("defillama-detail-hyperdrive.json");

const NOW = new Date("2026-10-11T00:00:00Z");
const SELECT = { minTvl: 1_000_000, excludedCategories: ["CEX"], limit: 80, newWithinDays: 180, now: NOW };
const PROTOCOLS = "https://api.llama.fi/protocols";
const detailUrl = (slug: string): string => `https://api.llama.fi/protocol/${slug}`;

describe("DefiLlama fields from the /protocols list", () => {
  it("keeps description, audits and audit links of a list entry on the candidate", () => {
    const [hyper, bare] = selectSpeculativeCandidates(LIST, SELECT);
    expect(hyper?.slug).toBe("hyperdrive-lend");
    expect(hyper?.details).toEqual({
      description: "Hyperdrive Lend is a money market on Hyperliquid L1.",
      methodology: null,
      audits: 2,
      auditLinks: ["https://github.com/hyperdrive-fi/audits/blob/main/oak.pdf"],
      github: [],
      raises: [],
    });
    expect(bare?.details).toEqual(EMPTY_DETAILS);
  });

  it("stays tolerant: wrongly typed or missing fields become empty and never drop the candidate", () => {
    const odd = {
      ...LIST[1],
      description: 5,
      methodology: { a: 1 },
      audits: { n: 1 },
      audit_links: "https://x.example",
      github: [1, null, "org"],
      raises: "none",
    };
    const [c] = selectSpeculativeCandidates([odd], SELECT);
    expect(c?.slug).toBe("bare-swap");
    expect(c?.details).toEqual({ ...EMPTY_DETAILS, github: ["org"] });
  });
});

describe("parseProtocolDetail", () => {
  it("reads description, methodology, audits, audit links (3 at most), github and raises of a /protocol/{slug} answer", () => {
    const d = parseProtocolDetail(DETAIL);
    expect(d.description).toContain("money market on Hyperliquid L1.");
    // Whitespace, including newlines, is collapsed so a field is one line.
    expect(d.description).not.toContain("\n");
    expect(d.methodology).toBe("TVL is the sum of supplied assets in the lending pools, minus borrowed amounts.");
    expect(d.audits).toBe(2);
    expect(d.auditLinks).toHaveLength(3);
    expect(d.github).toEqual(["hyperdrive-fi", "hyperdrive-labs"]);
    expect(d.raises).toEqual([
      { date: "2023-11-14", round: "Series A", amountUsd: 12_500_000, investors: ["Delta Fund"] },
      { date: "2023-03-28", round: "Seed", amountUsd: 5_000_000, investors: ["Alpha Capital", "Beta Ventures", "Gamma DAO"] },
    ]);
  });

  it("is empty for anything that is not an object, and keeps only http(s) audit links", () => {
    expect(parseProtocolDetail(null)).toEqual(EMPTY_DETAILS);
    expect(parseProtocolDetail("x")).toEqual(EMPTY_DETAILS);
    expect(parseProtocolDetail({ audit_links: ["javascript:alert(1)", "https://ok.example/a"] }).auditLinks).toEqual([
      "https://ok.example/a",
    ]);
  });

  it("caps long text and the number of raises", () => {
    const raises = Array.from({ length: 9 }, (_, i) => ({ date: 1_600_000_000 + i * 86_400, round: `R${i}`, amount: 1 }));
    const d = parseProtocolDetail({ description: "a".repeat(5000), raises });
    expect([...(d.description ?? "")].length).toBeLessThanOrEqual(601);
    expect(d.raises).toHaveLength(5);
    expect(d.raises[0]?.round).toBe("R8");
  });
});

describe("detailLines", () => {
  it("labels each field on its own line and says nothing for empty ones", () => {
    expect(detailLines(EMPTY_DETAILS)).toEqual([]);
    const lines = detailLines(parseProtocolDetail(DETAIL));
    expect(lines).toEqual([
      "Description: Hyperdrive Lend is a money market on Hyperliquid L1. Supply assets to earn yield or borrow against collateral.",
      "Methodology: TVL is the sum of supplied assets in the lending pools, minus borrowed amounts.",
      "Audits: 2",
      "Audit links: https://github.com/hyperdrive-fi/audits/blob/main/oak.pdf, https://example-auditor.io/reports/hyperdrive, https://a.example/3",
      "GitHub: hyperdrive-fi, hyperdrive-labs",
      "Raises:",
      "- Series A, $12.5M, 2023-11-14, investors: Delta Fund",
      "- Seed, $5M, 2023-03-28, investors: Alpha Capital, Beta Ventures, Gamma DAO",
    ]);
  });
});

describe("defillamaDocument with details", () => {
  it("puts the labelled lines in the document text and still leaves TVL out", () => {
    const [hyper] = selectSpeculativeCandidates(LIST, SELECT);
    const doc = defillamaDocument({ ...hyper!, details: parseProtocolDetail(DETAIL) }, NOW);
    expect(doc.text).toContain("Methodology: TVL is the sum");
    expect(doc.text).toContain("Raises:\n- Series A, $12.5M");
    expect(doc.text).toContain("Audits: 2");
    expect(doc.text).toContain("Category: Lending");
    expect(doc.text).not.toContain("25000000");
  });
});

// ---- collectSources: the detail endpoint --------------------------------------------------------------------------

function config(over: Partial<PipelineConfig["defillamaDetails"]> = {}): PipelineConfig {
  return {
    ...defaultConfig,
    telegramChannels: [],
    alphadrops: { ...defaultConfig.alphadrops, enabled: false },
    defillamaDetails: { ...defaultConfig.defillamaDetails, ...over },
  };
}

function fakeHttp(pages: Record<string, { status: number; body: string }>): Http & { gets: string[] } {
  const gets: string[] = [];
  return {
    gets,
    async get(url) {
      gets.push(url);
      return pages[url] ?? { status: 404, body: "" };
    },
    async resolveRedirect() {
      return null;
    },
  };
}

const THREE = [
  ...LIST,
  { ...LIST[1], name: "Third", slug: "third", url: "https://third.xyz", tvl: 2_000_000 },
];

async function collect(
  pages: Record<string, { status: number; body: string }>,
  cfg: PipelineConfig,
  sleeps: number[] = [],
  clock: () => Date = () => NOW,
) {
  const repo = new MemoryRepo();
  const http = fakeHttp(pages);
  const stats = emptyStats();
  const result = await collectSources(
    { repo, http, sleep: async (ms) => void sleeps.push(ms), now: clock },
    cfg,
    NOW,
    stats,
  );
  return { repo, http, stats, result };
}

describe("collectSources and the /protocol/{slug} endpoint", () => {
  it("fetches the detail of each candidate when the list has no methodology, raises or github, paced", async () => {
    const sleeps: number[] = [];
    const { repo, http, stats } = await collect(
      {
        [PROTOCOLS]: { status: 200, body: JSON.stringify(LIST) },
        [detailUrl("hyperdrive-lend")]: { status: 200, body: JSON.stringify(DETAIL) },
        [detailUrl("bare-swap")]: { status: 200, body: JSON.stringify({ ...(DETAIL as object), description: null, raises: [], methodology: null }) },
      },
      config(),
      sleeps,
    );
    expect(http.gets.filter((u) => u.startsWith("https://api.llama.fi/protocol/"))).toEqual([
      detailUrl("hyperdrive-lend"),
      detailUrl("bare-swap"),
    ]);
    // One pause between two requests, none before the first.
    expect(sleeps).toEqual([defaultConfig.defillamaDetails.delayMs]);
    expect(stats.defillama_details_fetched).toBe(2);
    expect(stats.defillama_details_failed).toBe(0);
    const doc = repo.allDocuments().find((d) => d.url === "https://defillama.com/protocol/hyperdrive-lend");
    expect(doc?.text).toContain("Methodology: TVL is the sum");
    expect(doc?.text).toContain("- Seed, $5M, 2023-03-28");
    expect(doc?.text).toContain("GitHub: hyperdrive-fi");
  });

  it("makes no extra request when the list entries already carry the detail fields", async () => {
    const withKeys = LIST.map((p) => ({ ...p, methodology: null, github: null, raises: null }));
    const { http, stats } = await collect({ [PROTOCOLS]: { status: 200, body: JSON.stringify(withKeys) } }, config());
    expect(http.gets.filter((u) => u.startsWith("https://api.llama.fi/"))).toEqual([PROTOCOLS]);
    expect(stats.defillama_details_fetched).toBe(0);
  });

  it("keeps the list fields when a detail fails (HTTP, JSON or throw) and counts it, without failing the source", async () => {
    const { repo, stats } = await collect(
      {
        [PROTOCOLS]: { status: 200, body: JSON.stringify(LIST) },
        [detailUrl("hyperdrive-lend")]: { status: 500, body: "" },
        [detailUrl("bare-swap")]: { status: 200, body: "not json" },
      },
      config(),
    );
    expect(stats.defillama_details_failed).toBe(2);
    expect(stats.source_failed).toBe(1); // only airdrops.io (no page in this fake), never DefiLlama
    const doc = repo.allDocuments().find((d) => d.url === "https://defillama.com/protocol/hyperdrive-lend");
    expect(doc?.text).toContain("Description: Hyperdrive Lend is a money market on Hyperliquid L1.");
    expect(doc?.text).toContain("Audits: 2");
    expect(doc?.text).not.toContain("Methodology:");
  });

  it("asks at most maxRequests details and counts the rest as skipped", async () => {
    const { http, stats } = await collect(
      {
        [PROTOCOLS]: { status: 200, body: JSON.stringify(THREE) },
        [detailUrl("hyperdrive-lend")]: { status: 200, body: JSON.stringify(DETAIL) },
      },
      config({ maxRequests: 1 }),
    );
    expect(http.gets.filter((u) => u.includes("/protocol/"))).toHaveLength(1);
    expect(stats.defillama_details_fetched).toBe(1);
    expect(stats.defillama_details_skipped).toBe(2);
  });

  it("starts no detail request after the budget", async () => {
    let calls = 0;
    // The clock jumps 3 minutes on every read after the first two: the budget (2 min) is gone after one request.
    const clock = (): Date => new Date(NOW.getTime() + Math.max(0, calls++ - 1) * 180_000);
    const { http, stats } = await collect(
      {
        [PROTOCOLS]: { status: 200, body: JSON.stringify(THREE) },
        [detailUrl("hyperdrive-lend")]: { status: 200, body: JSON.stringify(DETAIL) },
      },
      config({ budgetMinutes: 2 }),
      [],
      clock,
    );
    expect(http.gets.filter((u) => u.includes("/protocol/"))).toHaveLength(1);
    expect(stats.defillama_details_skipped).toBe(2);
  });
});
