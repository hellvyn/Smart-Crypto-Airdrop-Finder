// Official website text for the AI Analyst (owner request 2026-10-11): listed projects only, a clean official domain,
// the homepage and at most 2 same-domain docs/points/airdrop pages, cached 7 days in `claim_pages`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../src/config.js";
import type { FetchUntrusted } from "../src/http.js";
import { emptyStats } from "../src/stats.js";
import { combineExtraSources, officialSiteSources } from "../src/steps/analyze.js";
import { loadOfficialSites, officialSiteUrl, pickOfficialPages } from "../src/steps/official-sites.js";
import { MemoryRepo } from "../src/store/memory-repo.js";
import type { ProjectForScoring } from "../src/store/repo.js";

const NOW = new Date("2026-10-11T03:00:00Z");
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);
const CFG = defaultConfig;

function project(id: string, officialDomains: string[], over: Partial<ProjectForScoring> = {}): ProjectForScoring {
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
    links: [],
    sourceCount: 1,
    sourceKinds: ["airdrops_io"],
    lookalikeOfName: null,
    lookalikeOfDomains: [],
    sourceAsks: [],
    signals: [],
    ...over,
  };
}

async function listed(repo: MemoryRepo, ...ids: string[]): Promise<void> {
  for (const id of ids) {
    await repo.saveCuration(
      id,
      {
        passed: true,
        worthLevel: "low",
        worthPoints: 0,
        tab: "live_now",
        statusAt: "live",
        endedOn: null,
        reasons: [],
        coverage: {},
        coingeckoListed: null,
      },
      daysAgo(1),
    );
  }
}

type Page = { status: number; body: string; finalUrl?: string };

/** A fetch of untrusted pages answering from `pages` (others 404) and recording URLs and the most in flight at once. */
function fakeFetch(pages: Record<string, Page>) {
  const requested: string[] = [];
  let inFlight = 0;
  const peak = { value: 0 };
  const fetchUntrusted: FetchUntrusted = async (url) => {
    requested.push(url);
    inFlight += 1;
    peak.value = Math.max(peak.value, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 2));
    inFlight -= 1;
    const page = pages[url];
    return page === undefined ? { status: 404, body: "" } : { finalUrl: url, ...page };
  };
  return { fetchUntrusted, requested, peak };
}

const HOME = `<html><head><title>Arcus</title><script>steal()</script></head><body>
<nav><a href="/docs/intro">Docs</a> <a href="https://x.com/arcus">X</a> <a href="/airdrop">Airdrop</a>
<a href="/blog/post-1">Blog</a> <a href="https://docs.arcus.xyz/points">Points</a> <a href="/rewards">Rewards</a></nav>
<h1>Arcus lending</h1><p>Earn Arcus points by lending.</p></body></html>`;

const PAGES: Record<string, Page> = {
  "https://arcus.xyz/": { status: 200, body: HOME },
  "https://arcus.xyz/airdrop": { status: 200, body: "<h1>Airdrop</h1><p>Season 1 allocation is 10% of supply.</p>" },
  "https://docs.arcus.xyz/points": { status: 200, body: "<p>Points are earned per dollar lent per day.</p>" },
  "https://arcus.xyz/docs/intro": { status: 200, body: "<p>Intro docs.</p>" },
  "https://arcus.xyz/rewards": { status: 200, body: "<p>Rewards page.</p>" },
};

afterEach(() => vi.restoreAllMocks());

describe("pickOfficialPages", () => {
  it("picks the 2 same-domain links that look most like airdrop, points, rewards, quests or campaign pages, then docs", () => {
    expect(pickOfficialPages(HOME, "https://arcus.xyz/", "arcus.xyz")).toEqual([
      "https://arcus.xyz/airdrop",
      "https://docs.arcus.xyz/points",
    ]);
  });

  it("falls back to docs, and ignores other domains, non-web links, files, the page itself and queries", () => {
    const html = `<a href="https://evil.example/airdrop">Airdrop</a><a href="mailto:a@arcus.xyz">Points</a>
      <a href="javascript:void(0)">Points</a><a href="/points.pdf">Points</a><a href="/">Home points</a>
      <a href="/docs/start?utm_source=x#top">Documentation</a><a href="/docs/start">Docs again</a>
      <a href="https://arcus.xyz.evil.example/points">Points</a><a href="https://notarcus.xyz/points">Points</a>`;
    expect(pickOfficialPages(html, "https://arcus.xyz/", "arcus.xyz")).toEqual(["https://arcus.xyz/docs/start"]);
  });

  it("matches the link text as well as the path, and gives none for a page without such links", () => {
    expect(pickOfficialPages('<a href="/p/17">Quests</a>', "https://arcus.xyz/", "arcus.xyz")).toEqual(["https://arcus.xyz/p/17"]);
    expect(pickOfficialPages('<a href="/about">About</a><a href="/team">Team</a>', "https://arcus.xyz/", "arcus.xyz")).toEqual([]);
    expect(pickOfficialPages("", "https://arcus.xyz/", "arcus.xyz")).toEqual([]);
  });
});

describe("loadOfficialSites", () => {
  it("fetches the homepage and 2 pages of a listed project and gives the text to the analyst as one data source", async () => {
    const repo = new MemoryRepo();
    await listed(repo, "arcus");
    const net = fakeFetch(PAGES);
    const stats = emptyStats();

    const sources = await loadOfficialSites({ repo, fetchUntrusted: net.fetchUntrusted, now: () => NOW }, CFG, [project("arcus", ["arcus.xyz"])], NOW, stats);

    expect(net.requested).toEqual(["https://arcus.xyz/", "https://arcus.xyz/airdrop", "https://docs.arcus.xyz/points"]);
    expect(stats).toMatchObject({ official_pages_fetched: 3, official_pages_failed: 0, official_pages_skipped: 0 });
    const list = sources.get("arcus") ?? [];
    expect(list).toHaveLength(1);
    // Not an http(s) URL: it never matches a source document, so no member sees it as a link.
    expect(list[0]?.url).toBe("official-site://arcus.xyz");
    expect(list[0]?.url).toBe(officialSiteUrl("arcus.xyz"));
    const text = list[0]?.text ?? "";
    expect(text).toContain("[Page /]\nArcus\n");
    expect(text).toContain("Earn Arcus points by lending.");
    expect(text).toContain("[Page /airdrop]");
    expect(text).toContain("Season 1 allocation is 10% of supply.");
    expect(text).toContain("[Page /points]");
    expect(text).not.toContain("steal()");
    // Page headings carry paths, not full URLs.
    expect(text).not.toContain("https://");
    // Stored in the claim_pages cache under a key no claim link can have.
    expect([...repo.claimPages.keys()]).toEqual(["official-site://arcus.xyz"]);
    expect(repo.claimPages.get("official-site://arcus.xyz")?.fetchedAt).toEqual(NOW);
  });

  it("leaves out projects that are not listed, look like another project, or have no usable official domain", async () => {
    const repo = new MemoryRepo();
    await listed(repo, "lookalike", "intermediary", "nodomain", "ok");
    const net = fakeFetch({ "https://ok.xyz/": { status: 200, body: "<p>ok</p>" } });
    const projects = [
      project("notlisted", ["notlisted.xyz"]),
      project("lookalike", ["lookalike.xyz"], { lookalikeOf: "other" }),
      project("intermediary", ["linktr.ee"]),
      project("nodomain", []),
      project("ok", ["ok.xyz"]),
    ];

    await loadOfficialSites({ repo, fetchUntrusted: net.fetchUntrusted, now: () => NOW }, CFG, projects, NOW, emptyStats());

    expect(net.requested).toEqual(["https://ok.xyz/"]);
  });

  it("when GoPlus answers are given, takes only a domain it found clean", async () => {
    const repo = new MemoryRepo();
    await listed(repo, "p");
    const net = fakeFetch({ "https://clean.xyz/": { status: 200, body: "<p>clean</p>" } });
    const phishing = new Map<string, boolean | null>([
      ["flagged.xyz", true],
      ["unknown.xyz", null],
      ["clean.xyz", false],
    ]);
    const p = project("p", ["flagged.xyz", "unknown.xyz", "unasked.xyz", "clean.xyz"]);

    const sources = await loadOfficialSites({ repo, fetchUntrusted: net.fetchUntrusted, now: () => NOW }, CFG, [p], NOW, emptyStats(), { phishing });

    expect(net.requested).toEqual(["https://clean.xyz/"]);
    expect(sources.get("p")?.[0]?.url).toBe("official-site://clean.xyz");

    const none = fakeFetch({});
    const other = new MemoryRepo();
    await listed(other, "p");
    await loadOfficialSites({ repo: other, fetchUntrusted: none.fetchUntrusted, now: () => NOW }, CFG, [p], NOW, emptyStats(), { phishing: new Map([["flagged.xyz", true]]) });
    expect(none.requested).toEqual([]);
  });

  it("refreshes a domain at most once in 7 days, and uses the cache meanwhile", async () => {
    const repo = new MemoryRepo();
    await listed(repo, "arcus");
    const p = project("arcus", ["arcus.xyz"]);
    const first = fakeFetch(PAGES);
    await loadOfficialSites({ repo, fetchUntrusted: first.fetchUntrusted, now: () => NOW }, CFG, [p], NOW, emptyStats());

    const sixDays = new Date(NOW.getTime() + 6 * DAY);
    const again = fakeFetch(PAGES);
    const stats = emptyStats();
    const sources = await loadOfficialSites({ repo, fetchUntrusted: again.fetchUntrusted, now: () => sixDays }, CFG, [p], sixDays, stats);
    expect(again.requested).toEqual([]);
    expect(stats.official_pages_fetched).toBe(0);
    expect(sources.get("arcus")?.[0]?.text).toContain("Season 1 allocation");

    const eightDays = new Date(NOW.getTime() + 8 * DAY);
    const due = fakeFetch(PAGES);
    await loadOfficialSites({ repo, fetchUntrusted: due.fetchUntrusted, now: () => eightDays }, CFG, [p], eightDays, emptyStats());
    expect(due.requested[0]).toBe("https://arcus.xyz/");
    expect(repo.claimPages.get("official-site://arcus.xyz")?.fetchedAt).toEqual(eightDays);
  });

  it("keeps the cached text when a refresh fails, but not past 14 days, and counts the failure", async () => {
    const repo = new MemoryRepo();
    await listed(repo, "arcus");
    const p = project("arcus", ["arcus.xyz"]);
    await repo.saveClaimPage("official-site://arcus.xyz", "[Page /]\nOld text", daysAgo(9));
    const down = fakeFetch({});
    const stats = emptyStats();

    const sources = await loadOfficialSites({ repo, fetchUntrusted: down.fetchUntrusted, now: () => NOW }, CFG, [p], NOW, stats);

    expect(stats).toMatchObject({ official_pages_fetched: 0, official_pages_failed: 1 });
    expect(sources.get("arcus")?.[0]?.text).toBe("[Page /]\nOld text");

    await repo.saveClaimPage("official-site://arcus.xyz", "[Page /]\nOld text", daysAgo(15));
    const stale = await loadOfficialSites({ repo, fetchUntrusted: down.fetchUntrusted, now: () => NOW }, CFG, [p], NOW, emptyStats());
    expect(stale.get("arcus") ?? []).toEqual([]);
  });

  it("counts a failing sub page and still stores the homepage; a page that redirects off the domain is a failure", async () => {
    const repo = new MemoryRepo();
    await listed(repo, "arcus");
    const net = fakeFetch({
      ...PAGES,
      "https://arcus.xyz/airdrop": { status: 500, body: "" },
      "https://docs.arcus.xyz/points": { status: 200, body: "<p>Gambling site</p>", finalUrl: "https://casino.example/win" },
    });
    const stats = emptyStats();

    const sources = await loadOfficialSites({ repo, fetchUntrusted: net.fetchUntrusted, now: () => NOW }, CFG, [project("arcus", ["arcus.xyz"])], NOW, stats);

    expect(stats).toMatchObject({ official_pages_fetched: 1, official_pages_failed: 2 });
    const text = sources.get("arcus")?.[0]?.text ?? "";
    expect(text).toContain("Earn Arcus points by lending.");
    expect(text).not.toContain("Gambling");
  });

  it("does not store anything when the homepage itself redirects to another domain", async () => {
    const repo = new MemoryRepo();
    await listed(repo, "arcus");
    const net = fakeFetch({ "https://arcus.xyz/": { status: 200, body: "<p>Buy now</p>", finalUrl: "https://parked.example/" } });
    const stats = emptyStats();

    const sources = await loadOfficialSites({ repo, fetchUntrusted: net.fetchUntrusted, now: () => NOW }, CFG, [project("arcus", ["arcus.xyz"])], NOW, stats);

    expect(stats).toMatchObject({ official_pages_fetched: 0, official_pages_failed: 1 });
    expect(repo.claimPages.size).toBe(0);
    expect(sources.get("arcus") ?? []).toEqual([]);
  });

  it("skips a page that is not HTML (empty body) and stores the empty text so the domain waits a week", async () => {
    const repo = new MemoryRepo();
    await listed(repo, "arcus");
    const net = fakeFetch({ "https://arcus.xyz/": { status: 200, body: "" } });
    const stats = emptyStats();

    const sources = await loadOfficialSites({ repo, fetchUntrusted: net.fetchUntrusted, now: () => NOW }, CFG, [project("arcus", ["arcus.xyz"])], NOW, stats);

    expect(net.requested).toEqual(["https://arcus.xyz/"]);
    expect(stats).toMatchObject({ official_pages_fetched: 0, official_pages_failed: 0, official_pages_skipped: 1 });
    expect(repo.claimPages.get("official-site://arcus.xyz")?.text).toBe("");
    expect(sources.get("arcus") ?? []).toEqual([]);
  });

  it("caps the text of each page", async () => {
    const repo = new MemoryRepo();
    await listed(repo, "arcus");
    const net = fakeFetch({ "https://arcus.xyz/": { status: 200, body: `<p>${"word ".repeat(10_000)}</p>` } });

    const sources = await loadOfficialSites({ repo, fetchUntrusted: net.fetchUntrusted, now: () => NOW }, CFG, [project("arcus", ["arcus.xyz"])], NOW, emptyStats());

    expect([...(sources.get("arcus")?.[0]?.text ?? "")].length).toBeLessThanOrEqual(8_100);
  });

  it("fetches a domain once for the projects that share it, 2 domains at a time", async () => {
    const repo = new MemoryRepo();
    const ids = ["a", "b", "c", "d", "e", "f"];
    await listed(repo, ...ids);
    const pages: Record<string, Page> = {};
    for (const id of ids) pages[`https://${id === "b" ? "a" : id}.xyz/`] = { status: 200, body: `<p>${id}</p>` };
    const net = fakeFetch(pages);
    const projects = ids.map((id) => project(id, [`${id === "b" ? "a" : id}.xyz`]));

    const stats = emptyStats();
    const sources = await loadOfficialSites({ repo, fetchUntrusted: net.fetchUntrusted, now: () => NOW }, CFG, projects, NOW, stats);

    expect(net.requested.sort()).toEqual(["a", "c", "d", "e", "f"].map((id) => `https://${id}.xyz/`));
    expect(net.peak.value).toBe(2);
    expect(stats.official_pages_fetched).toBe(5);
    expect(sources.get("b")?.[0]?.url).toBe("official-site://a.xyz");
    expect(sources.get("a")?.[0]?.text).toBe(sources.get("b")?.[0]?.text);
  });

  it("starts no site after the budget or past the per-run cap, never-fetched first, and counts the rest as skipped", async () => {
    const repo = new MemoryRepo();
    const ids = ["a", "b", "c", "d"];
    await listed(repo, ...ids);
    await repo.saveClaimPage("official-site://a.xyz", "[Page /]\nold", daysAgo(10));
    const pages: Record<string, Page> = {};
    for (const id of ids) pages[`https://${id}.xyz/`] = { status: 200, body: `<p>${id}</p>` };
    const projects = ids.map((id) => project(id, [`${id}.xyz`]));

    const capped = fakeFetch(pages);
    const stats = emptyStats();
    await loadOfficialSites({ repo, fetchUntrusted: capped.fetchUntrusted, now: () => NOW }, { ...CFG, officialSites: { ...CFG.officialSites, maxPerRun: 2 } }, projects, NOW, stats);
    // b and c never fetched come before the stale a; d and a wait.
    expect(capped.requested.sort()).toEqual(["https://b.xyz/", "https://c.xyz/"]);
    expect(stats).toMatchObject({ official_pages_fetched: 2, official_pages_skipped: 2 });

    // The clock is past the 3-minute budget from the first read on: nothing starts.
    const late = fakeFetch(pages);
    let reads = 0;
    const clock = () => new Date(NOW.getTime() + (reads++ === 0 ? 0 : 4 * 60_000));
    const stats2 = emptyStats();
    const fresh = new MemoryRepo();
    await listed(fresh, ...ids);
    await loadOfficialSites({ repo: fresh, fetchUntrusted: late.fetchUntrusted, now: clock }, CFG, projects, NOW, stats2);
    expect(late.requested).toEqual([]);
    expect(stats2).toMatchObject({ official_pages_fetched: 0, official_pages_skipped: 4 });
  });

  it("never logs page text", async () => {
    const spies = (["log", "warn", "error", "info", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const repo = new MemoryRepo();
    await listed(repo, "arcus");
    const net = fakeFetch({ ...PAGES, "https://arcus.xyz/airdrop": { status: 500, body: "SECRET-BODY" } });
    await loadOfficialSites({ repo, fetchUntrusted: net.fetchUntrusted, now: () => NOW }, CFG, [project("arcus", ["arcus.xyz"])], NOW, emptyStats());
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("officialSiteSources", () => {
  const map = new Map([["p", [{ url: "official-site://p.xyz", text: "[Page /]\nHello" }]]]);

  it("gives the site text to the AI Analyst only: not to the public contradiction check, nor to the scam analyst", async () => {
    const extra = officialSiteSources(map);
    const p = project("p", ["p.xyz"]);
    expect(await extra(p, "analyst")).toEqual([{ url: "official-site://p.xyz", text: "[Page /]\nHello" }]);
    expect(await extra(p, "scam")).toEqual([]);
    expect(await extra(p, "contradictions")).toEqual([]);
    expect(await extra(project("other", []), "analyst")).toEqual([]);
  });

  it("combines with the claim portal sources", async () => {
    const claim = async (_p: ProjectForScoring, kind: string) => (kind === "scam" ? [{ url: "https://c/", text: "claim" }] : []);
    const both = combineExtraSources(claim as never, officialSiteSources(map));
    const p = project("p", ["p.xyz"]);
    expect((await both(p, "scam")).map((s) => s.url)).toEqual(["https://c/"]);
    expect((await both(p, "analyst")).map((s) => s.url)).toEqual(["official-site://p.xyz"]);
  });
});
