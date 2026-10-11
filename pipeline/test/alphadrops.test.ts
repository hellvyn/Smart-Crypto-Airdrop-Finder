import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  collectAlphaDrops,
  parseAlphaDetail,
  parseAlphaListing,
  resolveWebsite,
} from "../src/collectors/alphadrops.js";
import { isNonProjectHost } from "../src/collectors/html-text.js";
import type { Http } from "../src/collectors/types.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const LISTING = fixture("alphadrops-listing.html");
const DETAIL = fixture("alphadrops-detail.html");
const NOW = new Date("2026-10-10T00:00:00Z");
const LISTING_URL = "https://alphadrops.net/airdrops";
const HOSTS = ["s.kaito.ai", "linktr.ee", "galxe.com", "app.galxe.com", "zealy.io", "layer3.xyz", "bit.ly", "t.co"];
const OPTS = { maxDetails: 80, delayMs: 1500, intermediaryHosts: HOSTS };

/** Detail page URL of a listing slug. */
const detailUrl = (slug: string): string => `https://alphadrops.net/airdrops/${slug}`;

interface FakeHttp extends Http {
  /** Every request in order: `get <url>` or `resolve <url>`. */
  log: string[];
}

/**
 * `listing` is the body served (HTTP 200) for the listing URL; `pages` serves any other URL (default 404, or throws
 * for `"throw"`). `redirects` maps a URL to its redirect `Location` (default: no redirect).
 */
function fakeHttp(opts: {
  listing?: string;
  pages?: Record<string, { status: number; body: string } | "throw">;
  redirects?: Record<string, string | null>;
}): FakeHttp {
  const http: FakeHttp = {
    log: [],
    async get(url) {
      http.log.push(`get ${url}`);
      if (url === LISTING_URL && opts.listing !== undefined) return { status: 200, body: opts.listing };
      const page = opts.pages?.[url];
      if (page === "throw") throw new Error("socket hang up");
      return page ?? { status: 404, body: "" };
    },
    async resolveRedirect(url) {
      http.log.push(`resolve ${url}`);
      return opts.redirects?.[url] ?? null;
    },
  };
  return http;
}

/** A sleep that records each pause into the same log as the requests. */
function loggedSleep(log: string[]): (ms: number) => Promise<void> {
  return async (ms) => void log.push(`sleep ${ms}`);
}

const noSleep = async (): Promise<void> => {};

/** A listing page whose Next.js payload is one row holding `items` (merged over a valid item). */
function listingWith(items: Record<string, unknown>[]): string {
  const full = items.map((over) => ({
    name: "Item",
    slug: "item",
    status: "active",
    shortDescription: "Short.",
    description: "",
    categories: [],
    blockchains: [],
    fundingAmount: "$$1M",
    website: "https://item.xyz/",
    hasPoints: false,
    claimDeadline: null,
    addedDate: "2026-09-01T00:00:00+00:00",
    ...over,
  }));
  const row = `5:${JSON.stringify(["$", "$L6", null, { initialAirdrops: full }])}\n`;
  return `<html><body><script>self.__next_f.push(${JSON.stringify([1, row])})</script></body></html>`;
}

describe("parseAlphaListing", () => {
  it("parses listing items from the Next.js payload", () => {
    const items = parseAlphaListing(LISTING);
    expect(items.find((i) => i.slug === "catalyst")).toMatchObject({
      status: "upcoming",
      fundingAmount: "$30M",
      website: "https://catalyst.app/?r=gVe0u",
    });
  });

  it("reads every field of an item", () => {
    expect(parseAlphaListing(LISTING).find((i) => i.slug === "catalyst")).toEqual({
      name: "Catalyst",
      slug: "catalyst",
      status: "upcoming",
      shortDescription: "AI agents that turn your trading ideas into automated strategies, backed by Sequoia.",
      description: null,
      categories: ["AI", "Perps", "Predictions", "Tools/Infra"],
      blockchains: ["Multichain"],
      fundingAmount: "$30M",
      website: "https://catalyst.app/?r=gVe0u",
      hasPoints: false,
      claimDeadline: null,
      addedDate: "2026-10-09T11:40:48.403185+00:00",
    });
  });

  it("joins the payload strings of all pushes (an item row split across two pushes)", () => {
    // The fixture splits the item row inside the Perpl object.
    expect(parseAlphaListing(LISTING).find((i) => i.slug === "perpl")).toMatchObject({
      name: "Perpl",
      status: "active",
      fundingAmount: "$9.5M",
      hasPoints: true,
    });
  });

  it("keeps every public item in page order and skips the premium placeholder", () => {
    expect(parseAlphaListing(LISTING).map((i) => i.slug)).toEqual([
      "catalyst",
      "entropy",
      "axis",
      "perpl",
      "cascade",
      "genius",
      "hyperlend",
      "rainbow",
    ]);
  });

  it("maps $undefined, empty, NA and dash values to null and keeps other funding text as written", () => {
    const items = parseAlphaListing(
      listingWith([
        { slug: "a", fundingAmount: "NA", website: "$undefined", claimDeadline: "$undefined", hasPoints: "$undefined" },
        { slug: "b", fundingAmount: "—", website: "", description: "NA" },
        { slug: "c", fundingAmount: "-", website: null },
        { slug: "d", fundingAmount: "Undisclosed", claimDeadline: "2026-10-25T00:00:00+00:00", description: "Long." },
      ]),
    );
    expect(items.map((i) => [i.slug, i.fundingAmount, i.website, i.claimDeadline, i.hasPoints, i.description])).toEqual([
      ["a", null, null, null, false, null],
      ["b", null, null, null, false, null],
      ["c", null, null, null, false, null],
      ["d", "Undisclosed", "https://item.xyz/", "2026-10-25T00:00:00+00:00", false, "Long."],
    ]);
  });

  it("dedupes items by slug, keeping the first", () => {
    const items = parseAlphaListing(
      listingWith([
        { slug: "x", name: "First" },
        { slug: "y", name: "Other" },
        { slug: "x", name: "Second" },
      ]),
    );
    expect(items.map((i) => i.name)).toEqual(["First", "Other"]);
  });

  it("returns no items when the page has no payload", () => {
    expect(parseAlphaListing("<html><body><h1>Airdrops</h1></body></html>")).toEqual([]);
  });
});

describe("parseAlphaDetail", () => {
  const text = parseAlphaDetail(DETAIL);

  it("keeps the description, the airdrop tasks and the deep dive strategy", () => {
    expect(text).toContain("Catalyst raised a $30M seed round led by Sequoia");
    expect(text).toContain("Airdrop tasks");
    expect(text).toContain("Join the waitlist\n\nSign up for early access to Catalyst.");
    expect(text).toContain("Deep dive strategy\n\nStatus: waitlist. No token or points program announced yet.");
    expect(text).toContain("Backers: Sequoia (lead), Jump, Lux Capital, AntiFund, Selini Capital, Peak XV Partners, SF1.");
  });

  it("starts at the project title and separates the stat labels from their values", () => {
    expect(text.startsWith("Catalyst\n\nUpcoming New AI Perps\n")).toBe(true);
    expect(text).toContain("Funding $30M");
    expect(text).toContain("Chain Multichain");
  });

  it("drops the ads, the community box, other airdrops, navigation and scripts", () => {
    for (const noise of [
      "Learn more",
      "Taba",
      "Polymarket Checker",
      "Alpha community",
      "Join the guild",
      "Other airdrop opportunities",
      "Flop",
      "Looking for more opportunities",
      "crypto airdrops list",
      "© 2026",
      "script text is never content",
    ]) {
      expect(text).not.toContain(noise);
    }
  });

  it("drops the relative listing age, which would change the text every day", () => {
    expect(text).not.toContain("Listed");
    expect(text).not.toContain("1d ago");
  });

  it("returns an empty string when the page has no title", () => {
    expect(parseAlphaDetail("<html><body><p>Not found</p></body></html>")).toBe("");
  });
});

describe("isNonProjectHost", () => {
  it.each([
    "airdrops.io",
    "bridge.airdrops.io",
    "alphadrops.net",
    "www.alphadrops.net",
    "s.kaito.ai",
    "linktr.ee",
    "app.galxe.com",
    "T.CO",
  ])("refuses %s", (host) => {
    expect(isNonProjectHost(host, HOSTS)).toBe(true);
  });

  it.each(["kaito.ai", "notairdrops.io", "alphadrops.network", "quest.galxe.com", "bit.ly.example.com"])(
    "accepts %s (intermediary hosts match exactly)",
    (host) => {
      expect(isNonProjectHost(host, HOSTS)).toBe(false);
    },
  );
});

describe("resolveWebsite", () => {
  it("strips the referral and drops intermediary hosts", async () => {
    expect(await resolveWebsite(fakeHttp({}), "https://catalyst.app/?r=gVe0u", HOSTS)).toBe("https://catalyst.app/");
    expect(
      await resolveWebsite(fakeHttp({ redirects: { "https://s.kaito.ai/x": null } }), "https://s.kaito.ai/x", HOSTS),
    ).toBeNull();
    expect(await resolveWebsite(fakeHttp({}), "https://kaito.ai/", HOSTS)).toBe("https://kaito.ai/");
  });

  it("follows redirects and cleans the final URL", async () => {
    const http = fakeHttp({
      redirects: {
        "https://bit.ly/abc": "https://go.project.xyz/start",
        "https://go.project.xyz/start": "https://www.project.xyz/?ref=abc",
      },
    });
    expect(await resolveWebsite(http, "https://bit.ly/abc", HOSTS)).toBe("https://www.project.xyz/");
  });

  it("drops a link whose redirects end on an intermediary or aggregator host", async () => {
    const toLinktree = fakeHttp({ redirects: { "https://project.xyz/links": "https://linktr.ee/project" } });
    expect(await resolveWebsite(toLinktree, "https://project.xyz/links", HOSTS)).toBeNull();
    const toAlpha = fakeHttp({ redirects: { "https://project.xyz/": "https://www.alphadrops.net/airdrops/project" } });
    expect(await resolveWebsite(toAlpha, "https://project.xyz/", HOSTS)).toBeNull();
  });

  it("follows at most 3 redirects", async () => {
    const http = fakeHttp({
      redirects: {
        "https://a.xyz/": "https://b.xyz/",
        "https://b.xyz/": "https://c.xyz/",
        "https://c.xyz/": "https://d.xyz/",
        "https://d.xyz/": "https://e.xyz/",
      },
    });
    expect(await resolveWebsite(http, "https://a.xyz/", HOSTS)).toBe("https://d.xyz/");
    expect(http.log).toEqual(["resolve https://a.xyz/", "resolve https://b.xyz/", "resolve https://c.xyz/"]);
  });

  it("returns null for a value that is not an http(s) URL", async () => {
    expect(await resolveWebsite(fakeHttp({}), "Hidden", HOSTS)).toBeNull();
    expect(await resolveWebsite(fakeHttp({}), "javascript:alert(1)", HOSTS)).toBeNull();
  });
});

describe("collectAlphaDrops", () => {
  const CATALYST_HEADER = [
    "Name: Catalyst",
    "Status (AlphaDrops): upcoming",
    "Categories: AI, Perps, Predictions, Tools/Infra",
    "Chains: Multichain",
    "Funding (reported by AlphaDrops): $30M",
    "Website: https://catalyst.app/",
  ].join("\n");

  it("skips ended items and keeps listing-only documents when a detail page fails", async () => {
    const http = fakeHttp({
      listing: LISTING,
      pages: {
        [detailUrl("catalyst")]: { status: 200, body: DETAIL },
        [detailUrl("perpl")]: { status: 500, body: "" },
      },
    });
    const result = await collectAlphaDrops(http, NOW, OPTS, noSleep);

    expect(result.failed).toBe(false);
    expect(result.sourceKey).toBe("alphadrops");
    // cascade (inactive) and genius (ended) are skipped; the premium placeholder is not an item.
    expect(result.documents.map((d) => d.url)).toEqual(
      ["catalyst", "entropy", "axis", "perpl", "hyperlend", "rainbow"].map(detailUrl),
    );
    expect(http.log.filter((e) => e.startsWith("get "))).not.toContain(`get ${detailUrl("genius")}`);

    const catalyst = result.documents[0];
    expect(catalyst).toMatchObject({
      sourceKind: "alphadrops",
      sourceKey: "alphadrops",
      publishedAt: new Date("2026-10-09T11:40:48.403185Z"),
      pageUpdatedAt: null,
      fetchedAt: NOW,
    });
    expect(catalyst?.text.startsWith(`${CATALYST_HEADER}\n\nCatalyst\n`)).toBe(true);
    expect(catalyst?.text).toContain("Join the waitlist");

    // Detail page 500: the document is built from the listing (its description) alone.
    expect(result.documents[3]?.text).toBe(
      [
        "Name: Perpl",
        "Status (AlphaDrops): active",
        "Categories: Perps",
        "Chains: Monad",
        "Funding (reported by AlphaDrops): $9.5M",
        "Website: https://app.perpl.xyz/trade",
        "",
        "Fully onchain perps orderbook on Monad",
      ].join("\n"),
    );
  });

  it("omits the Website line when the link is on an intermediary host, and writes n/a for missing values", async () => {
    const result = await collectAlphaDrops(fakeHttp({ listing: LISTING }), NOW, OPTS, noSleep);
    const byUrl = new Map(result.documents.map((d) => [d.url, d.text]));
    const axis = byUrl.get(detailUrl("axis")) ?? "";
    expect(axis).toContain("Name: Axis Robotics\n");
    expect(axis).not.toContain("Website:");
    expect(axis).not.toContain("kaito");
    const hyperlend = byUrl.get(detailUrl("hyperlend")) ?? "";
    expect(hyperlend).toContain("Funding (reported by AlphaDrops): n/a\nWebsite: https://app.hyperlend.finance/\n");
    const rainbow = byUrl.get(detailUrl("rainbow")) ?? "";
    expect(rainbow).toContain("Chains: n/a\nFunding (reported by AlphaDrops): $19.5M\n\n");
    expect(rainbow).not.toContain("Website:");
  });

  it("builds the same text on every run, so an unchanged page keeps its hash", async () => {
    const pages = { [detailUrl("catalyst")]: { status: 200, body: DETAIL } };
    const first = await collectAlphaDrops(fakeHttp({ listing: LISTING, pages }), NOW, OPTS, noSleep);
    const later = await collectAlphaDrops(
      fakeHttp({ listing: LISTING, pages }),
      new Date("2026-10-11T00:00:00Z"),
      OPTS,
      noSleep,
    );
    expect(later.documents.map((d) => d.text)).toEqual(first.documents.map((d) => d.text));
  });

  it("pauses delayMs before every detail page request", async () => {
    const http = fakeHttp({ listing: LISTING });
    await collectAlphaDrops(http, NOW, OPTS, loggedSleep(http.log));
    const alpha = http.log.filter((e) => e.startsWith("sleep") || e.startsWith("get https://alphadrops.net/"));
    expect(alpha).toEqual([
      `get ${LISTING_URL}`,
      ...["catalyst", "entropy", "axis", "perpl", "hyperlend", "rainbow"].flatMap((slug) => [
        "sleep 1500",
        `get ${detailUrl(slug)}`,
      ]),
    ]);
  });

  it("fetches at most maxDetails detail pages and still makes a document for every item", async () => {
    const http = fakeHttp({ listing: LISTING });
    const result = await collectAlphaDrops(http, NOW, { ...OPTS, maxDetails: 2 }, noSleep);
    expect(http.log.filter((e) => e.startsWith("get https://alphadrops.net/airdrops/"))).toEqual([
      `get ${detailUrl("catalyst")}`,
      `get ${detailUrl("entropy")}`,
    ]);
    expect(result.documents).toHaveLength(6);
  });

  it("reports failed when the payload is missing", async () => {
    const result = await collectAlphaDrops(fakeHttp({ listing: "<html></html>" }), NOW, OPTS, noSleep);
    expect(result.failed).toBe(true);
    expect(result.documents).toEqual([]);
  });

  it("reports failed when the listing request fails", async () => {
    const http = fakeHttp({ pages: { [LISTING_URL]: { status: 503, body: "" } } });
    const result = await collectAlphaDrops(http, NOW, OPTS, noSleep);
    expect(result.failed).toBe(true);
    expect(result.documents).toEqual([]);
  });

  it("stops at a connection failure mid-way, reports failed and returns the documents collected so far", async () => {
    const http = fakeHttp({
      listing: LISTING,
      pages: {
        [detailUrl("catalyst")]: { status: 200, body: DETAIL },
        [detailUrl("entropy")]: { status: 0, body: "" },
      },
    });
    const result = await collectAlphaDrops(http, NOW, OPTS, noSleep);
    expect(result.failed).toBe(true);
    expect(result.documents.map((d) => d.url)).toEqual([detailUrl("catalyst")]);
    // No further detail page is requested after the connection broke.
    expect(http.log).not.toContain(`get ${detailUrl("axis")}`);
  });

  it("never throws when a request throws; the documents collected so far are returned", async () => {
    const http = fakeHttp({
      listing: LISTING,
      pages: { [detailUrl("catalyst")]: { status: 200, body: DETAIL }, [detailUrl("entropy")]: "throw" },
    });
    const result = await collectAlphaDrops(http, NOW, OPTS, noSleep);
    expect(result.failed).toBe(true);
    expect(result.documents.map((d) => d.url)).toEqual([detailUrl("catalyst")]);
  });
});
