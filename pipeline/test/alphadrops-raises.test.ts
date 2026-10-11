import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Http } from "../src/collectors/types.js";
import {
  countAlphaDropsRequests,
  loadRaises,
  parseRaiseIndex,
  parseRaisePage,
} from "../src/enrich/alphadrops-raises.js";
import { emptyStats } from "../src/stats.js";
import { MemoryRepo } from "../src/store/memory-repo.js";
import type { ProjectForScoring } from "../src/store/repo.js";

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const NOW = new Date("2026-10-10T03:00:00Z");
const DAY = 86_400_000;
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY);

const LLMS_FULL = "https://alphadrops.net/llms-full.txt";
const raiseUrl = (slug: string): string => `https://alphadrops.net/raises/${slug}`;

/** An llms-full.txt with an airdrop section and a fundraising section listing `entries` ([name, slug]). */
function llmsFull(entries: [string, string][]): string {
  return [
    "# Alpha Drops — Full Index for AI Assistants",
    "",
    "## All tracked crypto airdrops (1)",
    "",
    "- Arcus (active · DeFi · Ethereum): https://alphadrops.net/airdrops/arcus",
    "",
    `## All tracked fundraising projects (${entries.length})`,
    "",
    "Each entry: project, total raised across tracked rounds, lead investors, and canonical URL.",
    "",
    ...entries.map(([name, slug]) => `- ${name} — $5M raised (investors: Paradigm): ${raiseUrl(slug)}`),
    "",
    "## All guides and articles (1)",
    "",
    "- Perp DEX Farming: https://alphadrops.net/blog/perp-dex-farming-in-2026",
  ].join("\n");
}

/** A raise page with one $5M seed round led by Paradigm, linking `website` as its official website. */
function raiseHtml(website: string | null): string {
  const links = website === null ? "" : `<a href="${website}"><div><span>Official Website</span></div></a>`;
  return `<html><body><main><h1>Project</h1><section><h2>Funding Rounds History</h2><div>
<div><div><div><h3>Seed Round</h3><span>Synced</span></div><p>Sep 1, 2026</p></div><div><p>$5M</p></div>
<div><p>Lead Investors</p><div><div>Paradigm</div></div></div></div>
</div></section><aside><h3>Project Links</h3><div>${links}</div></aside></main></body></html>`;
}

function project(id: string, name: string, officialDomains: string[]): ProjectForScoring {
  return {
    id,
    slug: id,
    name,
    nameKey: name.toLowerCase(),
    tokenSymbol: null,
    chains: [],
    officialDomains,
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
    sourceCount: 1,
    documentCount: 1,
    sourceKinds: [],
    lookalikeOfName: null,
    lookalikeOfDomains: [],
    sourceAsks: [],
    signals: [],
  };
}

type Pages = Record<string, { status: number; body: string }>;

function fakeHttp(pages: Pages): Http & { gets: string[] } {
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

const OPTS = { maxPages: 40, maxRequests: 120, delayMs: 1500 };
const noSleep = async (): Promise<void> => {};

describe("parseRaiseIndex", () => {
  it("lists the name and slug of every entry of the fundraising section, whatever else the line holds", () => {
    const text = [
      "## All tracked crypto airdrops (1)",
      "- Catalyst (active · AI · Base): https://alphadrops.net/airdrops/catalyst",
      "## All tracked fundraising projects (5)",
      "Each entry: project, total raised across tracked rounds, lead investors, and canonical URL.",
      "- Meanwhile — $119.5M raised (investors: Bain Capital Crypto, Haun Ventures): https://alphadrops.net/raises/meanwhile",
      "- Noah — $16M raised: https://alphadrops.net/raises/noah",
      "- Xverse App (investors: Draper Associates): https://alphadrops.net/raises/xverse-app",
      "- Loopscale (ex Bridgesplit): https://alphadrops.net/raises/loopscale-ex-bridgesplit",
      "- FastNEAR: https://alphadrops.net/raises/fastnear",
      "- Not a raise: https://alphadrops.net/blog/not-a-raise",
      "## All guides and articles (1)",
      "- 2025 Crypto VC Report: $25B+ Raised: https://alphadrops.net/raises/report",
    ].join("\n");

    expect(parseRaiseIndex(text)).toEqual([
      { name: "Meanwhile", slug: "meanwhile" },
      { name: "Noah", slug: "noah" },
      { name: "Xverse App", slug: "xverse-app" },
      { name: "Loopscale (ex Bridgesplit)", slug: "loopscale-ex-bridgesplit" },
      { name: "FastNEAR", slug: "fastnear" },
    ]);
  });

  it("returns nothing when the fundraising section is missing", () => {
    expect(parseRaiseIndex("# Alpha Drops\n\n- Noah — $16M raised: https://alphadrops.net/raises/noah")).toEqual([]);
  });
});

describe("parseRaisePage", () => {
  it("reads the official website's registrable domain and each round of an AlphaDrops raise page", () => {
    expect(parseRaisePage(fixture("alphadrops-raise.html"))).toEqual({
      officialDomain: "catalyst.app",
      rounds: [
        {
          round: "Seed Round",
          date: "2026-10-08",
          amountUsd: 30_000_000,
          lead: ["Sequoia Capital"],
          others: [
            "Peak XV Partners(ex-Sequoia India)",
            "Lux Capital",
            "Anti Fund",
            "Jump Crypto",
            "Selini Capital",
            "Coinbase Ventures",
            "Premji Invest",
          ],
          sourceUrl: "https://dropstab.com/coins/catalyst-labs/fundraising",
        },
      ],
    });
  });

  it("reads several rounds with their own amounts, and null for what a round does not give", () => {
    const html = `<main><h1>Meanwhile</h1><section><h2>Funding Rounds History</h2><div>
<div><div></div><div><div><div><h3>Founding Round</h3><span>Synced</span></div><p>Oct 8, 2026</p></div>
<div><p>$37.5M</p><p>Valuation: <span>$350M</span></p></div></div>
<div><div><p>Lead Investors</p><div><div>Bain Capital Crypto</div></div></div>
<div><p>Other Investors</p><div><div>Pantera Capital</div><div>Haun Ventures</div></div></div></div>
<div><a href="https://dropstab.com/coins/meanwhile/fundraising?utm_source=alphadrops"><div></div>Announcement Source</a></div></div>
<div><div></div><div><div><div><h3>Series A</h3></div><p>March 3, 2025</p></div><div><p>$1.25B</p></div></div>
<div><div><p>Other Investors</p><div><div>StillMark</div></div></div></div></div>
<div><div></div><div><div><div><h3>M&amp;A</h3></div><p>Soon</p></div><div><p>TBA</p></div></div></div>
<div><div></div><div><div><div><h3>Pre-Seed</h3></div><p>Jan 2, 2024</p></div><div><p>$750K</p></div></div>
<div><div><p>Lead Investors</p><div><div>Angel</div></div></div></div>
<div><a href="javascript:alert(1)">Announcement Source</a></div></div>
</div></section></main>`;

    expect(parseRaisePage(html)).toEqual({
      officialDomain: null,
      rounds: [
        {
          round: "Founding Round",
          date: "2026-10-08",
          amountUsd: 37_500_000,
          lead: ["Bain Capital Crypto"],
          others: ["Pantera Capital", "Haun Ventures"],
          sourceUrl: "https://dropstab.com/coins/meanwhile/fundraising",
        },
        { round: "Series A", date: "2025-03-03", amountUsd: 1_250_000_000, lead: [], others: ["StillMark"], sourceUrl: null },
        { round: "M&A", date: null, amountUsd: null, lead: [], others: [], sourceUrl: null },
        { round: "Pre-Seed", date: "2024-01-02", amountUsd: 750_000, lead: ["Angel"], others: [], sourceUrl: null },
      ],
    });
  });

  it("takes the domain of an official website on a subdomain, and none for a non-http link", () => {
    expect(parseRaisePage(raiseHtml("https://app.catalyst.app/start?ref=alpha")).officialDomain).toBe("catalyst.app");
    expect(parseRaisePage(raiseHtml("mailto:team@catalyst.app")).officialDomain).toBeNull();
  });

  it("never takes an ad's link as the official website", () => {
    const ad = '<aside><a href="https://advertiser.xyz/" rel="sponsored noopener"><span>Official Website</span></a></aside>';
    expect(parseRaisePage(raiseHtml(null).replace("</main>", `</main>${ad}`)).officialDomain).toBeNull();
  });

  it("gives no rounds for a page that is not a raise page", () => {
    expect(parseRaisePage("<html><body><h1>Maintenance</h1><p>Back soon.</p></body></html>")).toEqual({
      officialDomain: null,
      rounds: [],
    });
  });
});

describe("loadRaises", () => {
  it("fetches at most 40 raise pages per run and skips fresh cache", async () => {
    const repo = new MemoryRepo();
    const projects = Array.from({ length: 55 }, (_, i) => project(`p${i}`, `Proj ${i}`, [`proj${i}.xyz`]));
    const pages: Pages = { [LLMS_FULL]: { status: 200, body: llmsFull(projects.map((p, i) => [p.name, `proj-${i}`])) } };
    for (let i = 0; i < 55; i++) pages[raiseUrl(`proj-${i}`)] = { status: 200, body: raiseHtml(`https://proj${i}.xyz/`) };
    // Ten projects have a cache fetched less than 7 days ago.
    for (let i = 0; i < 10; i++) {
      await repo.saveAlphaRaise(`proj-${i}`, { officialDomain: `proj${i}.xyz`, rounds: [] }, daysAgo(6));
    }
    const http = fakeHttp(pages);
    const stats = emptyStats();

    const raises = await loadRaises({ http, repo, sleep: noSleep }, projects, OPTS, NOW, stats);

    const fetched = http.gets.filter((u) => u.includes("/raises/"));
    expect(http.gets[0]).toBe(LLMS_FULL);
    expect(http.gets.filter((u) => u === LLMS_FULL)).toHaveLength(1);
    expect(fetched).toHaveLength(40);
    expect(fetched.filter((u) => /\/proj-\d$/.test(u))).toEqual([]);
    expect(fetched[0]).toBe(raiseUrl("proj-10"));
    expect(stats).toMatchObject({ raises_fetched: 40, raises_failed: 0 });
    expect(await repo.listAlphaRaise("proj-10")).toEqual({
      officialDomain: "proj10.xyz",
      rounds: [{ round: "Seed Round", date: "2026-09-01", amountUsd: 5_000_000, lead: ["Paradigm"], others: [], sourceUrl: null }],
      fetchedAt: NOW,
    });
    // The 5 pages left for the next run leave their projects not checked; the cached and fetched ones are usable.
    expect([...(raises?.unchecked ?? [])].sort()).toEqual(["p50", "p51", "p52", "p53", "p54"]);
    expect(Object.keys(raises?.pages ?? {})).toHaveLength(50);
    expect(raises?.pages["proj-3"]).toEqual({ officialDomain: "proj3.xyz", rounds: [] });
  });

  it("refetches a cache older than 7 days, after the pages that have no cache", async () => {
    const repo = new MemoryRepo();
    const projects = [project("p1", "Stale", ["stale.xyz"]), project("p2", "Missing", ["missing.xyz"])];
    await repo.saveAlphaRaise("stale", { officialDomain: "stale.xyz", rounds: [] }, daysAgo(8));
    const http = fakeHttp({
      [LLMS_FULL]: { status: 200, body: llmsFull([["Stale", "stale"], ["Missing", "missing"]]) },
      [raiseUrl("stale")]: { status: 200, body: raiseHtml("https://stale.xyz") },
      [raiseUrl("missing")]: { status: 200, body: raiseHtml("https://missing.xyz") },
    });

    await loadRaises({ http, repo, sleep: noSleep }, projects, OPTS, NOW, emptyStats());

    expect(http.gets).toEqual([LLMS_FULL, raiseUrl("missing"), raiseUrl("stale")]);
    expect((await repo.listAlphaRaise("stale"))?.fetchedAt).toEqual(NOW);
  });

  it("leaves a project with a stale cache not checked when its page cannot be refetched this run", async () => {
    const repo = new MemoryRepo();
    await repo.saveAlphaRaise("stale", { officialDomain: "stale.xyz", rounds: [] }, daysAgo(8));
    const http = fakeHttp({ [LLMS_FULL]: { status: 200, body: llmsFull([["Stale", "stale"]]) } });

    const raises = await loadRaises({ http, repo, sleep: noSleep }, [project("p1", "Stale", ["stale.xyz"])], { ...OPTS, maxPages: 0 }, NOW, emptyStats());

    expect(http.gets).toEqual([LLMS_FULL]);
    expect(raises).toEqual({ pages: {}, unchecked: new Set(["p1"]) });
  });

  it("picks pages by normalized name only for projects with an official domain", async () => {
    const repo = new MemoryRepo();
    const projects = [
      project("p1", "Catalyst Labs", ["catalyst.app"]),
      project("p2", "Nodomain", []),
      project("p3", "Unlisted", ["unlisted.xyz"]),
    ];
    const http = fakeHttp({
      [LLMS_FULL]: { status: 200, body: llmsFull([["Catalyst", "catalyst"], ["NoDomain", "nodomain"]]) },
      [raiseUrl("catalyst")]: { status: 200, body: fixture("alphadrops-raise.html") },
    });

    const raises = await loadRaises({ http, repo, sleep: noSleep }, projects, OPTS, NOW, emptyStats());

    expect(http.gets).toEqual([LLMS_FULL, raiseUrl("catalyst")]);
    expect(Object.keys(raises?.pages ?? {})).toEqual(["catalyst"]);
    expect(raises?.unchecked).toEqual(new Set());
  });

  it("pauses before every AlphaDrops request", async () => {
    const repo = new MemoryRepo();
    const log: string[] = [];
    const base = fakeHttp({
      [LLMS_FULL]: { status: 200, body: llmsFull([["Alpha", "alpha"], ["Beta", "beta"]]) },
      [raiseUrl("alpha")]: { status: 200, body: raiseHtml("https://alpha.xyz") },
      [raiseUrl("beta")]: { status: 200, body: raiseHtml("https://beta.xyz") },
    });
    const http: Http = { ...base, get: async (url) => (log.push(url), base.get(url)) };
    const projects = [project("p1", "Alpha", ["alpha.xyz"]), project("p2", "Beta", ["beta.xyz"])];

    await loadRaises({ http, repo, sleep: async (ms) => void log.push(`sleep:${ms}`) }, projects, OPTS, NOW, emptyStats());

    expect(log).toEqual(["sleep:1500", LLMS_FULL, "sleep:1500", raiseUrl("alpha"), "sleep:1500", raiseUrl("beta")]);
  });

  it("spends at most the remaining request budget, llms-full.txt included", async () => {
    const repo = new MemoryRepo();
    const names = ["A1", "A2", "A3", "A4"];
    const pages: Pages = { [LLMS_FULL]: { status: 200, body: llmsFull(names.map((n) => [n, n.toLowerCase()])) } };
    for (const n of names) pages[raiseUrl(n.toLowerCase())] = { status: 200, body: raiseHtml(`https://${n}.xyz`) };
    const http = fakeHttp(pages);
    const projects = names.map((n) => project(n, n, [`${n.toLowerCase()}.xyz`]));

    await loadRaises({ http, repo, sleep: noSleep }, projects, { ...OPTS, maxRequests: 3 }, NOW, emptyStats());
    expect(http.gets).toEqual([LLMS_FULL, raiseUrl("a1"), raiseUrl("a2")]);

    const none = fakeHttp(pages);
    expect(await loadRaises({ http: none, repo, sleep: noSleep }, projects, { ...OPTS, maxRequests: 0 }, NOW, emptyStats())).toBeNull();
    expect(none.gets).toEqual([]);
  });

  it("is not checked at all when llms-full.txt cannot be read or lists no raises", async () => {
    const projects = [project("p1", "Catalyst", ["catalyst.app"])];
    for (const answer of [{ status: 503, body: "" }, { status: 200, body: "# Alpha Drops\n\nNo index today." }]) {
      const http = fakeHttp({ [LLMS_FULL]: answer });
      const stats = emptyStats();

      expect(await loadRaises({ http, repo: new MemoryRepo(), sleep: noSleep }, projects, OPTS, NOW, stats)).toBeNull();
      expect(http.gets).toEqual([LLMS_FULL]);
      expect(stats).toMatchObject({ raises_fetched: 0, raises_failed: 1 });
    }
  });

  it("counts failed pages, keeps their old cache, and stops at a broken connection", async () => {
    const repo = new MemoryRepo();
    await repo.saveAlphaRaise("stale", { officialDomain: "stale.xyz", rounds: [] }, daysAgo(30));
    const names = ["Gone", "Stale", "Ok", "Down", "Later"];
    const http = fakeHttp({
      [LLMS_FULL]: { status: 200, body: llmsFull(names.map((n) => [n, n.toLowerCase()])) },
      [raiseUrl("gone")]: { status: 404, body: "" },
      [raiseUrl("stale")]: { status: 200, body: raiseHtml("https://stale.xyz") },
      [raiseUrl("ok")]: { status: 200, body: raiseHtml("https://ok.xyz") },
      [raiseUrl("down")]: { status: 0, body: "" },
      [raiseUrl("later")]: { status: 200, body: raiseHtml("https://later.xyz") },
    });
    const projects = names.map((n) => project(n, n, [`${n.toLowerCase()}.xyz`]));
    const stats = emptyStats();

    const raises = await loadRaises({ http, repo, sleep: noSleep }, projects, OPTS, NOW, stats);

    // Pages without a cache come first and the stale one last, so the broken connection leaves it unasked.
    expect(http.gets).toEqual([LLMS_FULL, raiseUrl("gone"), raiseUrl("ok"), raiseUrl("down")]);
    expect(stats).toMatchObject({ raises_fetched: 1, raises_failed: 2 });
    expect(Object.keys(raises?.pages ?? {})).toEqual(["ok"]);
    expect([...(raises?.unchecked ?? [])].sort()).toEqual(["Down", "Gone", "Later", "Stale"]);
    expect((await repo.listAlphaRaise("stale"))?.fetchedAt).toEqual(daysAgo(30));
  });

  it("stops asking for raise pages once AlphaDrops rate limits", async () => {
    const http = fakeHttp({
      [LLMS_FULL]: { status: 200, body: llmsFull([["Alpha", "alpha"], ["Beta", "beta"]]) },
      [raiseUrl("alpha")]: { status: 429, body: "" },
      [raiseUrl("beta")]: { status: 200, body: raiseHtml("https://beta.xyz") },
    });
    const projects = [project("p1", "Alpha", ["alpha.xyz"]), project("p2", "Beta", ["beta.xyz"])];
    const stats = emptyStats();

    const raises = await loadRaises({ http, repo: new MemoryRepo(), sleep: noSleep }, projects, OPTS, NOW, stats);

    expect(http.gets).toEqual([LLMS_FULL, raiseUrl("alpha")]);
    expect(raises?.unchecked).toEqual(new Set(["p1", "p2"]));
    expect(stats.raises_failed).toBe(1);
  });

  it("fetches the page again when its cache entry cannot be read", async () => {
    const repo = new MemoryRepo();
    repo.listAlphaRaise = async () => {
      throw new Error("db read failed");
    };
    const http = fakeHttp({
      [LLMS_FULL]: { status: 200, body: llmsFull([["Catalyst", "catalyst"]]) },
      [raiseUrl("catalyst")]: { status: 200, body: fixture("alphadrops-raise.html") },
    });

    const raises = await loadRaises({ http, repo, sleep: noSleep }, [project("p1", "Catalyst", ["catalyst.app"])], OPTS, NOW, emptyStats());

    expect(http.gets).toEqual([LLMS_FULL, raiseUrl("catalyst")]);
    expect(raises?.unchecked).toEqual(new Set());
  });

  it("keeps a page whose slug is an object property name as an ordinary entry", async () => {
    const http = fakeHttp({
      [LLMS_FULL]: { status: 200, body: llmsFull([["Proto", "__proto__"]]) },
      [raiseUrl("__proto__")]: { status: 200, body: raiseHtml("https://proto.xyz") },
    });

    const raises = await loadRaises({ http, repo: new MemoryRepo(), sleep: noSleep }, [project("p1", "Proto", ["proto.xyz"])], OPTS, NOW, emptyStats());

    expect(Object.keys(raises?.pages ?? {})).toEqual(["__proto__"]);
  });

  it("does not store a page that has no funding rounds", async () => {
    const repo = new MemoryRepo();
    const http = fakeHttp({
      [LLMS_FULL]: { status: 200, body: llmsFull([["Broken", "broken"]]) },
      [raiseUrl("broken")]: { status: 200, body: "<html><body><h1>Oops</h1></body></html>" },
    });
    const stats = emptyStats();

    const raises = await loadRaises({ http, repo, sleep: noSleep }, [project("p1", "Broken", ["broken.xyz"])], OPTS, NOW, stats);

    expect(await repo.listAlphaRaise("broken")).toBeNull();
    expect(raises?.unchecked).toEqual(new Set(["p1"]));
    expect(stats).toMatchObject({ raises_fetched: 0, raises_failed: 1 });
  });

  it("still uses a fetched page when it cannot be stored in the cache", async () => {
    const repo = new MemoryRepo();
    repo.saveAlphaRaise = async () => {
      throw new Error("db write failed");
    };
    const http = fakeHttp({
      [LLMS_FULL]: { status: 200, body: llmsFull([["Catalyst", "catalyst"]]) },
      [raiseUrl("catalyst")]: { status: 200, body: fixture("alphadrops-raise.html") },
    });

    const raises = await loadRaises({ http, repo, sleep: noSleep }, [project("p1", "Catalyst", ["catalyst.app"])], OPTS, NOW, emptyStats());

    expect(raises?.pages.catalyst?.officialDomain).toBe("catalyst.app");
    expect(raises?.unchecked).toEqual(new Set());
  });
});

describe("countAlphaDropsRequests", () => {
  it("counts the requests sent to alphadrops.net and its subdomains only", async () => {
    const base = fakeHttp({});
    const counter = countAlphaDropsRequests(base);

    await counter.http.get("https://alphadrops.net/airdrops");
    await counter.http.get("https://www.alphadrops.net/raises/x");
    await counter.http.resolveRedirect("https://alphadrops.net/go/x");
    await counter.http.get("https://notalphadrops.net/");
    await counter.http.get("https://api.llama.fi/protocols");
    await counter.http.get("not a url");

    expect(counter.count()).toBe(3);
    expect(base.gets).toHaveLength(5);
  });
});
