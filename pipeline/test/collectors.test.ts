import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createFetchUntrusted, createHttp } from "../src/http.js";
import type { Http } from "../src/collectors/types.js";
import { collectAirdropsIo, parseDetail, parseListing } from "../src/collectors/airdrops-io.js";
import { collectTelegram, parseTelegramPage } from "../src/collectors/telegram.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const NOW = new Date("2026-10-10T00:00:00Z");

interface FakeHttp extends Http {
  gets: string[];
  resolves: string[];
  maxInFlight: number;
}

function fakeHttp(
  pages: Record<string, { status: number; body: string }>,
  redirects: Record<string, string | null> = {},
): FakeHttp {
  let inFlight = 0;
  const http: FakeHttp = {
    gets: [],
    resolves: [],
    maxInFlight: 0,
    async get(url) {
      http.gets.push(url);
      inFlight++;
      http.maxInFlight = Math.max(http.maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return pages[url] ?? { status: 404, body: "" };
    },
    async resolveRedirect(url) {
      http.resolves.push(url);
      inFlight++;
      http.maxInFlight = Math.max(http.maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return redirects[url] ?? null;
    },
  };
  return http;
}

describe("createHttp", () => {
  it("sends the project User-Agent and returns status and body", async () => {
    let seen: { url: string; init: RequestInit | undefined } | undefined;
    const http = createHttp((async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), init };
      return new Response("hello", { status: 200 });
    }) as typeof fetch);
    expect(await http.get("https://a.test/")).toMatchObject({ status: 200, body: "hello" });
    const headers = new Headers(seen?.init?.headers);
    expect(headers.get("user-agent")).toBe(
      "SmartAirdropFinder/0.1 (+https://github.com/hellvyn/Smart-Airdrop-Finder)",
    );
    expect(seen?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns the response headers with lowercase names (RDAP reads Retry-After)", async () => {
    const http = createHttp((async () =>
      new Response("", { status: 429, headers: { "Retry-After": "2" } })) as typeof fetch);
    const res = await http.get("https://rdap.org/domain/a.com");
    expect(res.status).toBe(429);
    expect(res.headers?.["retry-after"]).toBe("2");
  });

  it("turns network errors into status 0 with an empty body", async () => {
    const http = createHttp((async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch);
    expect(await http.get("https://a.test/")).toEqual({ status: 0, body: "" });
    expect(await http.resolveRedirect("https://a.test/")).toBeNull();
  });

  it("resolveRedirect uses manual redirects and returns the absolute location", async () => {
    let redirectMode: string | undefined;
    const http = createHttp((async (_url: string | URL | Request, init?: RequestInit) => {
      redirectMode = init?.redirect;
      return new Response(null, { status: 302, headers: { location: "/next?x=1" } });
    }) as typeof fetch);
    expect(await http.resolveRedirect("https://a.test/visit/1/")).toBe("https://a.test/next?x=1");
    expect(redirectMode).toBe("manual");
  });

  it("resolveRedirect returns null when there is no location header", async () => {
    const http = createHttp((async () => new Response("ok", { status: 200 })) as typeof fetch);
    expect(await http.resolveRedirect("https://a.test/visit/1/")).toBeNull();
  });
});

describe("createFetchUntrusted", () => {
  type Answer = (url: string) => Response;
  /** A fetch that answers by URL and records each request with its options. */
  function recordingFetch(answer: Answer): { fetchImpl: typeof fetch; calls: { url: string; init: RequestInit | undefined }[] } {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return answer(String(url));
    }) as typeof fetch;
    return { fetchImpl, calls };
  }
  const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
  const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

  it("sends the project User-Agent without cookies, with a timeout, following no redirect by itself", async () => {
    const { fetchImpl, calls } = recordingFetch(() => html("<p>Claim</p>"));

    expect(await createFetchUntrusted(fetchImpl)("https://claim.a.test/")).toEqual({
      status: 200,
      body: "<p>Claim</p>",
      finalUrl: "https://claim.a.test/",
    });

    expect(calls).toHaveLength(1);
    const init = calls[0]?.init;
    expect(new Headers(init?.headers).get("user-agent")).toBe("SmartAirdropFinder/0.1 (+https://github.com/hellvyn/Smart-Airdrop-Finder)");
    expect(init?.redirect).toBe("manual");
    expect(init?.credentials).toBe("omit");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("follows up to 3 redirects to public http(s) hosts and gives up after that", async () => {
    const hops: Record<string, string> = {
      "https://a.test/": "https://b.test/x",
      "https://b.test/x": "http://c.test/y",
      "http://c.test/y": "/z",
    };
    const three = recordingFetch((url) => (hops[url] ? redirect(hops[url]) : html("landed")));
    expect(await createFetchUntrusted(three.fetchImpl)("https://a.test/")).toEqual({
      status: 200,
      body: "landed",
      finalUrl: "http://c.test/z",
    });
    expect(three.calls.map((c) => c.url)).toEqual(["https://a.test/", "https://b.test/x", "http://c.test/y", "http://c.test/z"]);

    const four = recordingFetch((url) => redirect(`${url}r`));
    expect(await createFetchUntrusted(four.fetchImpl)("https://a.test/")).toEqual({ status: 0, body: "" });
    expect(four.calls).toHaveLength(4);
    // One timeout covers every hop.
    expect(new Set(four.calls.map((c) => c.init?.signal)).size).toBe(1);
  });

  it.each([
    ["file:///etc/passwd"],
    ["javascript:alert(1)"],
    ["http://127.0.0.1/"],
    ["http://169.254.169.254/latest/meta-data/"],
    ["http://localhost:8080/"],
    ["http://[::1]/"],
    ["http://metadata.google.internal/"],
    ["http://router.local/"],
  ])("never requests %s, directly or through a redirect", async (target) => {
    const direct = recordingFetch(() => html("secret"));
    expect(await createFetchUntrusted(direct.fetchImpl)(target)).toEqual({ status: 0, body: "" });
    expect(direct.calls).toEqual([]);

    const viaRedirect = recordingFetch((url) => (url === "https://claim.a.test/" ? redirect(target) : html("secret")));
    expect(await createFetchUntrusted(viaRedirect.fetchImpl)("https://claim.a.test/")).toEqual({ status: 0, body: "" });
    expect(viaRedirect.calls.map((c) => c.url)).toEqual(["https://claim.a.test/"]);
  });

  it("reads at most 1 MB of the body", async () => {
    let cancelled = false;
    const chunk = new TextEncoder().encode("a".repeat(64 * 1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.length;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const { fetchImpl } = recordingFetch(() => new Response(stream, { status: 200, headers: { "content-type": "text/html" } }));

    const page = await createFetchUntrusted(fetchImpl)("https://claim.a.test/");

    expect(page.status).toBe(200);
    expect(page.body.length).toBe(1_000_000);
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThan(1_200_000);
  });

  it("gives an empty body for a response that is not text", async () => {
    const { fetchImpl } = recordingFetch(() => new Response("%PDF-1.7", { status: 200, headers: { "content-type": "application/pdf" } }));
    expect(await createFetchUntrusted(fetchImpl)("https://claim.a.test/")).toEqual({
      status: 200,
      body: "",
      finalUrl: "https://claim.a.test/",
    });
  });

  it("turns a network error into status 0", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect(await createFetchUntrusted(fetchImpl)("https://claim.a.test/")).toEqual({ status: 0, body: "" });
  });
});

describe("parseListing", () => {
  const urls = parseListing(fixture("airdrops-home.html"));

  it("keeps airdrop detail pages as absolute, deduplicated URLs", () => {
    expect(urls).toEqual([
      "https://airdrops.io/deepbook/",
      "https://airdrops.io/ink-chain/",
      "https://airdrops.io/mint-io/",
    ]);
  });

  it("drops non-airdrop paths", () => {
    expect(urls).not.toContain("https://airdrops.io/blog/");
    for (const bad of ["blog", "calendar", "faq", "feed", "wp-json", "speculative", "confirmed", "airdrop-alert", "hot", "latest"]) {
      expect(urls.some((u) => u.includes(`/${bad}/`))).toBe(false);
    }
  });

  it("returns nothing for a page without listings", () => {
    expect(parseListing("<html></html>")).toEqual([]);
  });
});

describe("parseDetail", () => {
  const detail = parseDetail(fixture("airdrops-detail.html"), "https://airdrops.io/deepbook/");

  it("extracts title and updated date as UTC midnight", () => {
    expect(detail?.title).toBe("DeepBook");
    expect(detail?.pageUpdatedAt?.toISOString()).toBe("2026-07-24T00:00:00.000Z");
  });

  it("keeps only the content between .airdrop-info and .airdrop-bottom", () => {
    const text = detail?.text ?? "";
    expect(text).toContain("Join Waitlist");
    expect(text).toContain("Chain: Sui");
    expect(text).toContain("Claims are open for 30 days.");
    expect(text).not.toContain("SITE-NAV-TEXT");
    expect(text).not.toContain("SIDEBAR-RELATED");
    expect(text).not.toContain("SIDEBAR-WIDGET");
    expect(text).not.toContain("FOOTER-TEXT");
    expect(text).not.toContain("SCRIPT-TEXT");
    expect(text).not.toContain("BUTTON-TEXT");
  });

  it("embeds cleaned outbound links and visit placeholders, dropping aggregator links", () => {
    const text = detail?.text ?? "";
    expect(text).toContain("docs [https://x.io/start?chain=sui]");
    expect(text).toContain("[[visit:53a3]]");
    expect(text).not.toContain("other-project");
    expect(text).not.toContain("mailto");
    expect(text).toContain("broken");
    expect(detail?.visitLinks).toEqual([
      "https://airdrops.io/visit/53a3/?k=6efe1f6681",
      "https://airdrops.io/visit/dead/?k=1",
      "https://airdrops.io/visit/9ea3/?k=11",
      "https://airdrops.io/visit/aea3/?k=22",
      "https://airdrops.io/visit/bea3/?k=33",
    ]);
  });

  it("returns null when the expected structure is missing", () => {
    expect(parseDetail("<html><body><h1>X</h1></body></html>", "https://airdrops.io/x/")).toBeNull();
    expect(parseDetail("", "https://airdrops.io/x/")).toBeNull();
  });
});

describe("airdrops.io Overview box", () => {
  const HOME = "https://airdrops.io/";
  const DEEPBOOK = "https://airdrops.io/deepbook/";
  const detailHtml = fixture("airdrops-detail.html");
  const home = `<a href="/deepbook/">DeepBook</a>`;
  const pagesFor = (body: string): Record<string, { status: number; body: string }> => ({
    [HOME]: { status: 200, body: home },
    [DEEPBOOK]: { status: 200, body },
  });
  const redirects = {
    "https://airdrops.io/visit/9ea3/?k=11": "https://arcus.xyz/?ref=AB",
    "https://airdrops.io/visit/bea3/?k=33": "https://bridge.airdrops.io/",
  };
  const withoutOverview = detailHtml.replace(/<div class="aidrop-info-wrapper">[\s\S]*?<\/div>/, "");

  it("appends the Overview links with their resolved URLs", async () => {
    const doc = (await collectAirdropsIo(fakeHttp(pagesFor(detailHtml), redirects), NOW)).documents[0]!;
    expect(doc.text).toContain("Overview\nWebsite: [https://arcus.xyz/]");
    expect(doc.text).toContain("Documentation: [https://docs.arcus.xyz/]"); // resolve failed, host fallback
    expect(doc.text).toContain("X (Formerly Twitter): [https://x.com/arcus_xyz]");
    expect(doc.text).not.toContain("Blog");
    expect(doc.text).not.toContain("airdrops.io"); // aggregator target dropped
    expect(doc.text).not.toContain("ref=AB");
    expect(doc.text.endsWith("[https://x.com/arcus_xyz]")).toBe(true);
  });

  it("uses data-outbound-host when an in-body visit link cannot be resolved", async () => {
    const body = detailHtml.replace(
      "Claims are open for 30 days.",
      'Open the <a href="/visit/5ea3/?k=1" data-outbound-host="app.arcus.xyz">portal</a>.',
    );
    const doc = (await collectAirdropsIo(fakeHttp(pagesFor(body)), NOW)).documents[0]!;
    expect(doc.text).toContain("portal [https://app.arcus.xyz/]");
  });

  it("drops an unresolved visit link whose outbound host is an aggregator host", async () => {
    const body = detailHtml.replace(
      "Claims are open for 30 days.",
      'Read <a href="/visit/7ea3/?k=1" data-outbound-host="bridge.airdrops.io">the bridge</a>.',
    );
    const doc = (await collectAirdropsIo(fakeHttp(pagesFor(body)), NOW)).documents[0]!;
    expect(doc.text).toContain("the bridge");
    expect(doc.text).not.toContain("airdrops.io");
  });

  it("accepts the correctly spelled wrapper class and pages without an Overview box", () => {
    const spelled = detailHtml.replace("aidrop-info-wrapper", "airdrop-info-wrapper");
    expect(parseDetail(spelled, DEEPBOOK)!.overview).toHaveLength(4);
    expect(parseDetail(withoutOverview, DEEPBOOK)!.overview).toEqual([]);
  });

  it("reads label, absolute href and outbound host in page order", () => {
    expect(parseDetail(detailHtml, DEEPBOOK)!.overview).toEqual([
      { label: "Website", href: "https://airdrops.io/visit/9ea3/?k=11", outboundHost: "arcus.xyz" },
      { label: "Documentation", href: "https://airdrops.io/visit/aea3/?k=22", outboundHost: "docs.arcus.xyz" },
      { label: "X (Formerly Twitter)", href: "https://x.com/arcus_xyz?utm_source=x", outboundHost: null },
      { label: "Blog", href: "https://airdrops.io/visit/bea3/?k=33", outboundHost: "bridge.airdrops.io" },
    ]);
    expect(parseDetail(detailHtml, DEEPBOOK)!.visitHosts.get("9ea3")).toBe("arcus.xyz");
  });

  it("still builds the document from the main block when there is no Overview box", async () => {
    const doc = (await collectAirdropsIo(fakeHttp(pagesFor(withoutOverview), redirects), NOW)).documents[0]!;
    expect(doc.text).toContain("Claims are open for 30 days.");
    expect(doc.text).not.toContain("Overview");
  });
});

describe("collectAirdropsIo", () => {
  const HOME = "https://airdrops.io/";
  const detailHtml = fixture("airdrops-detail.html");

  it("fails when the home page parses to zero listings", async () => {
    const http = fakeHttp({ [HOME]: { status: 200, body: "<html></html>" } });
    const result = await collectAirdropsIo(http, NOW);
    expect(result.failed).toBe(true);
    expect(result.documents).toEqual([]);
    expect(result.sourceKey).toBe("airdrops_io");
  });

  it("fails when the home page is not 200", async () => {
    const http = fakeHttp({ [HOME]: { status: 503, body: "" } });
    const result = await collectAirdropsIo(http, NOW);
    expect(result.failed).toBe(true);
    expect(result.error).toContain("503");
  });

  it("builds documents with resolved, cleaned visit links", async () => {
    const http = fakeHttp(
      {
        [HOME]: { status: 200, body: fixture("airdrops-home.html") },
        "https://airdrops.io/deepbook/": { status: 200, body: detailHtml },
        "https://airdrops.io/ink-chain/": { status: 200, body: detailHtml },
        "https://airdrops.io/mint-io/": { status: 404, body: "" },
      },
      { "https://airdrops.io/visit/53a3/?k=6efe1f6681": "https://x.io/?ref=AB" },
    );
    const result = await collectAirdropsIo(http, NOW);
    expect(result.failed).toBe(false);
    expect(result.error).toBe("1 detail page skipped");
    expect(result.documents).toHaveLength(2);
    const doc = result.documents[0];
    expect(doc?.sourceKind).toBe("airdrops_io");
    expect(doc?.sourceKey).toBe("airdrops_io");
    expect(doc?.url).toBe("https://airdrops.io/deepbook/");
    expect(doc?.publishedAt).toBeNull();
    expect(doc?.pageUpdatedAt?.toISOString()).toBe("2026-07-24T00:00:00.000Z");
    expect(doc?.fetchedAt).toEqual(NOW);
    expect(doc?.text.startsWith("DeepBook")).toBe(true);
    expect(doc?.text).toContain("[https://x.io/]");
    expect(doc?.text).not.toContain("ref=AB");
    expect(doc?.text).not.toContain("[[visit:");
    // unresolved visit link (null) is dropped from the text
    expect(doc?.text).not.toContain("visit/dead");
    expect(doc?.text).toContain("dead link");
  });

  it("resolves each distinct visit link once per run", async () => {
    const http = fakeHttp(
      {
        [HOME]: { status: 200, body: fixture("airdrops-home.html") },
        "https://airdrops.io/deepbook/": { status: 200, body: detailHtml },
        "https://airdrops.io/ink-chain/": { status: 200, body: detailHtml },
        "https://airdrops.io/mint-io/": { status: 200, body: detailHtml },
      },
      { "https://airdrops.io/visit/53a3/?k=6efe1f6681": "https://x.io/" },
    );
    await collectAirdropsIo(http, NOW);
    expect(http.resolves.filter((u) => u.includes("/visit/53a3/"))).toHaveLength(1);
    expect(http.resolves.filter((u) => u.includes("/visit/dead/"))).toHaveLength(1);
  });

  it("skips unparseable detail pages and counts them", async () => {
    const http = fakeHttp({
      [HOME]: { status: 200, body: fixture("airdrops-home.html") },
      "https://airdrops.io/deepbook/": { status: 200, body: detailHtml },
      "https://airdrops.io/ink-chain/": { status: 200, body: "<html></html>" },
      "https://airdrops.io/mint-io/": { status: 500, body: "" },
    });
    const result = await collectAirdropsIo(http, NOW);
    expect(result.failed).toBe(false);
    expect(result.documents).toHaveLength(1);
    expect(result.error).toBe("2 detail pages skipped");
  });

  it("fails when listings exist but every detail page is skipped", async () => {
    const http = fakeHttp({
      [HOME]: { status: 200, body: fixture("airdrops-home.html") },
      "https://airdrops.io/deepbook/": { status: 200, body: "<html></html>" },
      "https://airdrops.io/ink-chain/": { status: 500, body: "" },
      "https://airdrops.io/mint-io/": { status: 200, body: "<html></html>" },
    });
    const result = await collectAirdropsIo(http, NOW);
    expect(result.failed).toBe(true);
    expect(result.documents).toEqual([]);
    expect(result.error).toBe("3 detail pages skipped");
  });

  it("never runs more than 4 requests at once", async () => {
    const slugs = Array.from({ length: 12 }, (_, i) => `p${i}`);
    const home = slugs.map((s) => `<a href="/${s}/">${s}</a>`).join("");
    const pages: Record<string, { status: number; body: string }> = {
      [HOME]: { status: 200, body: home },
    };
    for (const s of slugs) pages[`https://airdrops.io/${s}/`] = { status: 200, body: detailHtml };
    const http = fakeHttp(pages);
    const result = await collectAirdropsIo(http, NOW);
    expect(result.documents).toHaveLength(12);
    expect(http.maxInFlight).toBeLessThanOrEqual(4);
    expect(http.maxInFlight).toBeGreaterThan(1);
  });
});

describe("parseTelegramPage", () => {
  const { messages } = parseTelegramPage(fixture("telegram.html"), "airdrops_io");

  it("returns text messages with id, url and publishedAt", () => {
    expect(messages.map((m) => m.id)).toEqual([101, 102]);
    expect(messages[0]?.url).toBe("https://t.me/airdrops_io/101");
    expect(messages[0]?.publishedAt.toISOString()).toBe("2026-10-05T18:22:00.000Z");
    expect(messages[1]?.publishedAt.toISOString()).toBe("2026-10-06T11:20:20.000Z");
  });

  it("embeds cleaned links, drops aggregator links and ignores quoted replies", () => {
    expect(messages[0]?.text).toContain("the portal [https://x.io/claim] now");
    expect(messages[0]?.text).not.toContain("[https://airdrops.io");
    expect(messages[0]?.text).toContain("Radar update\nVisit");
    expect(messages[1]?.text).toBe("Second message $TOKEN");
  });
});

describe("telegram link handling", () => {
  const wrap = (inner: string): string =>
    `<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="chan/1">` +
    `<div class="tgme_widget_message_text">${inner}</div>` +
    `<time datetime="2026-10-01T00:00:00+00:00"></time></div></div>`;

  it("skips query-only and t.me root links (hashtags)", () => {
    const { messages } = parseTelegramPage(
      wrap(`Hello <a href="?q=%23airdrop">#airdrop</a> <a href="https://t.me/?q=%23tag">#tag</a>`),
      "chan",
    );
    expect(messages[0]?.text).toBe("Hello #airdrop #tag");
  });

  it("replaces raw autolink text with the cleaned URL, without duplicating it", () => {
    const { messages } = parseTelegramPage(
      wrap(`Go <a href="https://x.io/a?ref=AB">https://x.io/a?ref=AB</a> now`),
      "chan",
    );
    expect(messages[0]?.text).toBe("Go [https://x.io/a] now");
  });
});

function tgPage(ids: number[]): { status: number; body: string } {
  const body = ids
    .map(
      (id) =>
        `<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="chan/${id}">` +
        `<div class="tgme_widget_message_text">msg ${id}</div>` +
        `<time datetime="2026-10-01T00:00:${String(id % 60).padStart(2, "0")}+00:00"></time></div></div>`,
    )
    .join("");
  return { status: 200, body: `<html><body>${body}</body></html>` };
}

describe("collectTelegram", () => {
  const BASE = "https://t.me/s/chan";

  it("fetches only the first page when there is no cursor", async () => {
    const http = fakeHttp({ [BASE]: tgPage([5, 6, 7]), [`${BASE}?before=5`]: tgPage([2, 3, 4]) });
    const result = await collectTelegram(http, "chan", null, NOW);
    expect(http.gets).toEqual([BASE]);
    expect(result.failed).toBe(false);
    expect(result.sourceKey).toBe("telegram:chan");
    expect(result.documents.map((d) => d.url)).toEqual([
      "https://t.me/chan/5",
      "https://t.me/chan/6",
      "https://t.me/chan/7",
    ]);
    const doc = result.documents[0];
    expect(doc?.sourceKind).toBe("telegram");
    expect(doc?.sourceKey).toBe("telegram:chan");
    expect(doc?.pageUpdatedAt).toBeNull();
    expect(doc?.publishedAt?.toISOString()).toBe("2026-10-01T00:00:05.000Z");
    expect(doc?.fetchedAt).toEqual(NOW);
    expect(doc?.text).toBe("msg 5");
  });

  it("paginates with ?before= until it reaches the cursor and keeps only newer messages", async () => {
    const http = fakeHttp({
      [BASE]: tgPage([8, 9, 10]),
      [`${BASE}?before=8`]: tgPage([5, 6, 7]),
      [`${BASE}?before=5`]: tgPage([2, 3, 4]),
    });
    const result = await collectTelegram(http, "chan", 4, NOW);
    expect(http.gets).toEqual([BASE, `${BASE}?before=8`, `${BASE}?before=5`]);
    expect(result.documents.map((d) => d.url.split("/").pop())).toEqual(["5", "6", "7", "8", "9", "10"]);
    expect(result.failed).toBe(false);
  });

  it("stops after the page that contains the cursor", async () => {
    const http = fakeHttp({ [BASE]: tgPage([8, 9, 10]), [`${BASE}?before=8`]: tgPage([5, 6, 7]) });
    const result = await collectTelegram(http, "chan", 6, NOW);
    expect(http.gets).toHaveLength(2);
    expect(result.documents.map((d) => d.url.split("/").pop())).toEqual(["7", "8", "9", "10"]);
  });

  it("fetches at most 5 pages", async () => {
    const pages: Record<string, { status: number; body: string }> = { [BASE]: tgPage([100, 101]) };
    for (let i = 1; i <= 10; i++) pages[`${BASE}?before=${100 - (i - 1) * 2}`] = tgPage([100 - i * 2, 101 - i * 2]);
    const http = fakeHttp(pages);
    const result = await collectTelegram(http, "chan", 1, NOW);
    expect(http.gets).toHaveLength(5);
    expect(result.documents).toHaveLength(10);
  });

  it("returns nothing new when the cursor is already the newest message", async () => {
    const http = fakeHttp({ [BASE]: tgPage([5, 6, 7]) });
    const result = await collectTelegram(http, "chan", 7, NOW);
    expect(http.gets).toHaveLength(1);
    expect(result.documents).toEqual([]);
    expect(result.failed).toBe(false);
  });

  it("fails on a non-200 first page", async () => {
    const http = fakeHttp({ [BASE]: { status: 500, body: "" } });
    const result = await collectTelegram(http, "chan", null, NOW);
    expect(result.failed).toBe(true);
    expect(result.documents).toEqual([]);
  });

  it("fails when a 200 first page has no messages (structure changed)", async () => {
    const http = fakeHttp({ [BASE]: { status: 200, body: "<html><body>nothing</body></html>" } });
    const result = await collectTelegram(http, "chan", 3, NOW);
    expect(result.failed).toBe(true);
    expect(result.documents).toEqual([]);
  });

  it("fails when posts parse but no text/time selector matches (structure changed)", async () => {
    const body =
      `<html><body><div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="chan/7">` +
      `<div class="renamed_text">hello</div></div></div></body></html>`;
    const http = fakeHttp({ [BASE]: { status: 200, body } });
    const result = await collectTelegram(http, "chan", null, NOW);
    expect(result.failed).toBe(true);
    expect(result.documents).toEqual([]);
    expect(result.error).toBe("telegram: 1 posts parsed but no text/time found (structure changed?)");
  });

  it("keeps collected documents but reports failure when a later page fails", async () => {
    const http = fakeHttp({ [BASE]: tgPage([8, 9, 10]), [`${BASE}?before=8`]: { status: 502, body: "" } });
    const result = await collectTelegram(http, "chan", 3, NOW);
    expect(result.failed).toBe(true);
    expect(result.documents).toHaveLength(3);
  });
});
