import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Http } from "../src/collectors/types.js";
import type { VcConfig } from "../src/config.js";
import { parsePortfolioDomains, refreshPortfolios } from "../src/enrich/vc-portfolios.js";
import { MemoryRepo } from "../src/store/memory-repo.js";

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const NOW = new Date("2026-10-10T03:00:00Z");
const DAY = 86_400_000;
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY);

const PARADIGM: VcConfig = {
  id: "paradigm",
  name: "Paradigm",
  aliases: [],
  tier: 1,
  portfolioUrl: "https://www.paradigm.xyz/portfolio",
};
const VARIANT: VcConfig = {
  id: "variant",
  name: "Variant",
  aliases: ["Variant Fund"],
  tier: 2,
  portfolioUrl: "https://variant.fund/portfolio/",
};

const page = (...urls: string[]): string =>
  `<html><body>${urls.map((u) => `<a href="${u}">x</a>`).join("")}</body></html>`;

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

describe("parsePortfolioDomains", () => {
  it("extracts registrable domains of outbound portfolio links, excluding the VC and social hosts", () => {
    expect(parsePortfolioDomains(fixture("vc-portfolio-paradigm.html"), PARADIGM).sort()).toEqual([
      "arcus.xyz",
      "uniswap.org",
    ]);
  });

  it("keeps a16z crypto's portfolio companies and drops its sister site a16z.com (and its subdomains)", () => {
    const a16zCrypto: VcConfig = {
      id: "a16z-crypto",
      name: "a16z crypto",
      aliases: ["a16z", "Andreessen Horowitz"],
      tier: 1,
      portfolioUrl: "https://a16zcrypto.com/portfolio/",
    };
    expect(parsePortfolioDomains(fixture("vc-portfolio-a16z-crypto.html"), a16zCrypto)).toEqual([
      "eigenlayer.xyz",
      "layerzero.network",
      "lido.fi",
      "phantom.app",
      "uniswap.org",
    ]);
  });

  it("returns nothing for a page rendered by JavaScript without links in its HTML", () => {
    const html = '<html><body><div id="__next"></div><script src="https://www.paradigm.xyz/app.js"></script></body></html>';
    expect(parsePortfolioDomains(html, PARADIGM)).toEqual([]);
  });

  it("drops aggregator and data sites that list many projects", () => {
    const html = page(
      "https://www.coingecko.com/en/coins/arcus",
      "https://defillama.com/protocol/arcus",
      "https://messari.io/project/arcus",
      "https://zora.co/",
    );
    expect(parsePortfolioDomains(html, VARIANT)).toEqual(["zora.co"]);
  });
});

describe("refreshPortfolios", () => {
  it("uses a cache up to 7 days old without fetching the page", async () => {
    const repo = new MemoryRepo();
    await repo.saveVcPortfolio("paradigm", ["uniswap.org"], daysAgo(7));
    const http = fakeHttp({});

    const index = await refreshPortfolios({ http, repo }, [PARADIGM], NOW);

    expect(http.gets).toEqual([]);
    expect(index.byDomain).toEqual(new Map([["uniswap.org", [{ vcId: "paradigm", name: "Paradigm", tier: 1 }]]]));
    expect(index.checked).toEqual(new Set(["paradigm"]));
    expect(index.failed).toEqual(new Set());
  });

  it("refetches a cache older than 7 days and stores the new domains", async () => {
    const repo = new MemoryRepo();
    await repo.saveVcPortfolio("paradigm", ["old.xyz"], new Date(daysAgo(7).getTime() - 1));
    const http = fakeHttp({ [PARADIGM.portfolioUrl]: { status: 200, body: page("https://uniswap.org/", "https://arcus.xyz") } });

    const index = await refreshPortfolios({ http, repo }, [PARADIGM], NOW);

    expect(http.gets).toEqual([PARADIGM.portfolioUrl]);
    expect([...index.byDomain.keys()].sort()).toEqual(["arcus.xyz", "uniswap.org"]);
    expect(index.checked).toEqual(new Set(["paradigm"]));
    expect(await repo.listVcPortfolio("paradigm")).toEqual({ domains: ["arcus.xyz", "uniswap.org"], fetchedAt: NOW });
  });

  it("uses a cache up to 14 days old when a refresh fails and marks older ones as not checked", async () => {
    const repo = new MemoryRepo();
    await repo.saveVcPortfolio("paradigm", ["uniswap.org"], daysAgo(14));
    await repo.saveVcPortfolio("variant", ["zora.co"], new Date(daysAgo(14).getTime() - 1));
    const http = fakeHttp({});

    const index = await refreshPortfolios({ http, repo }, [PARADIGM, VARIANT], NOW);

    expect(http.gets).toEqual([PARADIGM.portfolioUrl, VARIANT.portfolioUrl]);
    expect(index.byDomain).toEqual(new Map([["uniswap.org", [{ vcId: "paradigm", name: "Paradigm", tier: 1 }]]]));
    expect(index.checked).toEqual(new Set(["paradigm"]));
    expect(index.failed).toEqual(new Set(["paradigm", "variant"]));
    // A failed refresh never touches the cache.
    expect(await repo.listVcPortfolio("paradigm")).toEqual({ domains: ["uniswap.org"], fetchedAt: daysAgo(14) });
  });

  it("treats a page without portfolio links as a failed fetch and keeps the old cache", async () => {
    const repo = new MemoryRepo();
    await repo.saveVcPortfolio("paradigm", ["uniswap.org"], daysAgo(10));
    const http = fakeHttp({ [PARADIGM.portfolioUrl]: { status: 200, body: page("https://x.com/paradigm", "/team") } });

    const index = await refreshPortfolios({ http, repo }, [PARADIGM], NOW);

    expect(index.failed).toEqual(new Set(["paradigm"]));
    expect(index.checked).toEqual(new Set(["paradigm"]));
    expect([...index.byDomain.keys()]).toEqual(["uniswap.org"]);
    expect(await repo.listVcPortfolio("paradigm")).toEqual({ domains: ["uniswap.org"], fetchedAt: daysAgo(10) });
  });

  it("marks a VC without a cache whose page fails as failed and not checked", async () => {
    const repo = new MemoryRepo();
    const http = fakeHttp({ [PARADIGM.portfolioUrl]: { status: 0, body: "" } });

    const index = await refreshPortfolios({ http, repo }, [PARADIGM], NOW);

    expect(index).toEqual({ byDomain: new Map(), checked: new Set(), failed: new Set(["paradigm"]) });
  });

  it("lists every VC whose portfolio holds a domain", async () => {
    const repo = new MemoryRepo();
    const http = fakeHttp({
      [PARADIGM.portfolioUrl]: { status: 200, body: page("https://zora.co/", "https://uniswap.org") },
      [VARIANT.portfolioUrl]: { status: 200, body: page("https://zora.co/") },
    });

    const index = await refreshPortfolios({ http, repo }, [PARADIGM, VARIANT], NOW);

    expect(index.byDomain.get("zora.co")).toEqual([
      { vcId: "paradigm", name: "Paradigm", tier: 1 },
      { vcId: "variant", name: "Variant", tier: 2 },
    ]);
    expect(index.checked).toEqual(new Set(["paradigm", "variant"]));
  });

  it("counts a VC whose cache cannot be read as failed and not checked, and continues with the others", async () => {
    const repo = new MemoryRepo();
    const list = repo.listVcPortfolio.bind(repo);
    repo.listVcPortfolio = async (vcId) => {
      if (vcId === "paradigm") throw new Error("db down");
      return list(vcId);
    };
    const http = fakeHttp({ [VARIANT.portfolioUrl]: { status: 200, body: page("https://zora.co/") } });

    const index = await refreshPortfolios({ http, repo }, [PARADIGM, VARIANT], NOW);

    expect(index.failed).toEqual(new Set(["paradigm"]));
    expect(index.checked).toEqual(new Set(["variant"]));
    expect([...index.byDomain.keys()]).toEqual(["zora.co"]);
  });

  it("still uses freshly fetched domains when they cannot be cached", async () => {
    const repo = new MemoryRepo();
    repo.saveVcPortfolio = async () => {
      throw new Error("db write failed");
    };
    const http = fakeHttp({ [PARADIGM.portfolioUrl]: { status: 200, body: page("https://uniswap.org/") } });

    const index = await refreshPortfolios({ http, repo }, [PARADIGM], NOW);

    expect(index.checked).toEqual(new Set(["paradigm"]));
    expect(index.failed).toEqual(new Set());
    expect([...index.byDomain.keys()]).toEqual(["uniswap.org"]);
  });
});
