// Project logos (owner request 2026-10-11): the image download rules, the X handle, and the `logos` stage.
import type { CurationRecord } from "@saf/core";
import { describe, expect, it } from "vitest";
import type { DefillamaProtocol } from "../src/collectors/defillama.js";
import { defaultConfig } from "../src/config.js";
import type { PipelineConfig } from "../src/config.js";
import { createFetchImage, sniffImage } from "../src/http.js";
import type { FetchImage, LogoImage } from "../src/http.js";
import { emptyStats } from "../src/stats.js";
import { refreshLogos, xHandle } from "../src/steps/logos.js";
import { MemoryRepo } from "../src/store/memory-repo.js";
import type { ProjectForScoring } from "../src/store/repo.js";

const NOW = new Date("2026-10-11T03:00:00Z");
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

// Leading bytes of each format (only the magic decides the type).
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);
const GIF = new TextEncoder().encode("GIF89a\x01\x00\x01\x00");
const WEBP = new TextEncoder().encode("RIFF\x1a\x00\x00\x00WEBPVP8 ");
const ICO = Uint8Array.from([0, 0, 1, 0, 1, 0, 16, 16]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = new TextEncoder().encode("<!doctype html><title>Not found</title>");

describe("sniffImage", () => {
  it.each([
    ["PNG", PNG, "image/png"],
    ["JPEG", JPEG, "image/jpeg"],
    ["GIF89a", GIF, "image/gif"],
    ["GIF87a", new TextEncoder().encode("GIF87a\x01\x00"), "image/gif"],
    ["WebP", WEBP, "image/webp"],
    ["ICO", ICO, "image/x-icon"],
  ] as const)("recognises %s by its magic bytes", (_name, bytes, mime) => {
    expect(sniffImage(bytes)).toBe(mime);
  });

  it.each([
    ["SVG", SVG],
    ["SVG with an XML prolog", new TextEncoder().encode('<?xml version="1.0"?><svg/>')],
    ["HTML", HTML],
    ["a RIFF file that is not WebP", new TextEncoder().encode("RIFF\x1a\x00\x00\x00WAVEfmt ")],
    ["a truncated PNG signature", PNG.subarray(0, 7)],
    ["a cursor (ICO type 2)", Uint8Array.from([0, 0, 2, 0, 1, 0])],
    ["nothing", new Uint8Array(0)],
  ])("refuses %s", (_name, bytes) => {
    expect(sniffImage(bytes)).toBeNull();
  });
});

describe("createFetchImage", () => {
  type Answer = (url: string) => Response;
  function recordingFetch(answer: Answer): { fetchImpl: typeof fetch; calls: { url: string; init: RequestInit | undefined }[] } {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return answer(String(url));
    }) as typeof fetch;
    return { fetchImpl, calls };
  }
  const image = (bytes: Uint8Array, type = "image/png", status = 200) =>
    new Response(bytes, { status, headers: { "content-type": type } });
  const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });
  const onlyArcus = (host: string) => host === "arcus.xyz" || host === "www.arcus.xyz";

  it("downloads an allowed https image with the project User-Agent, no cookies, a timeout and manual redirects", async () => {
    const { fetchImpl, calls } = recordingFetch(() => image(PNG));

    expect(await createFetchImage(fetchImpl)("https://arcus.xyz/favicon.ico", onlyArcus)).toEqual({ mime: "image/png", bytes: PNG });

    expect(calls).toHaveLength(1);
    const init = calls[0]?.init;
    expect(new Headers(init?.headers).get("user-agent")).toBe("SmartAirdropFinder/0.1 (+https://github.com/hellvyn/Smart-Airdrop-Finder)");
    expect(init?.redirect).toBe("manual");
    expect(init?.credentials).toBe("omit");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("decides the type from the bytes, not from the Content-Type header", async () => {
    const lying = recordingFetch(() => image(JPEG, "image/png"));
    expect(await createFetchImage(lying.fetchImpl)("https://arcus.xyz/a.png", onlyArcus)).toEqual({ mime: "image/jpeg", bytes: JPEG });

    const html = recordingFetch(() => image(HTML, "image/png"));
    expect(await createFetchImage(html.fetchImpl)("https://arcus.xyz/a.png", onlyArcus)).toBeNull();
  });

  it("never accepts SVG, whatever the header says", async () => {
    const declared = recordingFetch(() => image(SVG, "image/svg+xml"));
    expect(await createFetchImage(declared.fetchImpl)("https://arcus.xyz/logo.svg", onlyArcus)).toBeNull();
    const disguised = recordingFetch(() => image(SVG, "image/png"));
    expect(await createFetchImage(disguised.fetchImpl)("https://arcus.xyz/logo.png", onlyArcus)).toBeNull();
    // PNG bytes served as SVG: the header alone is enough to refuse it.
    const svgHeader = recordingFetch(() => image(PNG, "image/svg+xml; charset=utf-8"));
    expect(await createFetchImage(svgHeader.fetchImpl)("https://arcus.xyz/logo.png", onlyArcus)).toBeNull();
  });

  it("accepts exactly 64 KB and refuses one byte more, without reading past the cap", async () => {
    const at = (size: number) => {
      const bytes = new Uint8Array(size);
      bytes.set(PNG);
      return bytes;
    };
    const exact = recordingFetch(() => image(at(65_536)));
    expect((await createFetchImage(exact.fetchImpl)("https://arcus.xyz/a.png", onlyArcus))?.bytes.length).toBe(65_536);

    const over = recordingFetch(() => image(at(65_537)));
    expect(await createFetchImage(over.fetchImpl)("https://arcus.xyz/a.png", onlyArcus)).toBeNull();

    // A body that never ends: reading stops once it is past 64 KB.
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(pulled === 1 ? at(16_384) : new Uint8Array(16_384));
      },
    });
    const stream = recordingFetch(() => new Response(endless, { headers: { "content-type": "image/png" } }));
    expect(await createFetchImage(stream.fetchImpl)("https://arcus.xyz/a.png", onlyArcus)).toBeNull();
    expect(pulled).toBeLessThanOrEqual(6);
  });

  it("refuses an http URL, a host that is not allowed, another port or credentials, without a request", async () => {
    const { fetchImpl, calls } = recordingFetch(() => image(PNG));
    expect(await createFetchImage(fetchImpl)("http://arcus.xyz/favicon.ico", onlyArcus)).toBeNull();
    expect(await createFetchImage(fetchImpl)("https://evil.io/favicon.ico", onlyArcus)).toBeNull();
    expect(await createFetchImage(fetchImpl)("not a url", onlyArcus)).toBeNull();
    expect(await createFetchImage(fetchImpl)("https://arcus.xyz:8443/favicon.ico", onlyArcus)).toBeNull();
    expect(await createFetchImage(fetchImpl)("https://user:pw@arcus.xyz/favicon.ico", onlyArcus)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("follows at most 2 redirects, each to an allowed https host, under one timeout", async () => {
    const hops: Record<string, string> = {
      "https://arcus.xyz/favicon.ico": "https://www.arcus.xyz/favicon.ico",
      "https://www.arcus.xyz/favicon.ico": "/static/favicon.ico",
    };
    const two = recordingFetch((url) => (hops[url] ? redirect(hops[url]) : image(ICO, "image/vnd.microsoft.icon")));
    expect(await createFetchImage(two.fetchImpl)("https://arcus.xyz/favicon.ico", onlyArcus)).toEqual({ mime: "image/x-icon", bytes: ICO });
    expect(two.calls.map((c) => c.url)).toEqual([
      "https://arcus.xyz/favicon.ico",
      "https://www.arcus.xyz/favicon.ico",
      "https://www.arcus.xyz/static/favicon.ico",
    ]);
    expect(new Set(two.calls.map((c) => c.init?.signal)).size).toBe(1);

    const three = recordingFetch((url) => redirect(`${url}x`));
    expect(await createFetchImage(three.fetchImpl)("https://arcus.xyz/a", onlyArcus)).toBeNull();
    expect(three.calls).toHaveLength(3);
  });

  it("refuses a redirect to another domain or to http, without following it", async () => {
    const cross = recordingFetch((url) => (url.startsWith("https://arcus.xyz/") ? redirect("https://evil.io/favicon.ico") : image(PNG)));
    expect(await createFetchImage(cross.fetchImpl)("https://arcus.xyz/favicon.ico", onlyArcus)).toBeNull();
    expect(cross.calls.map((c) => c.url)).toEqual(["https://arcus.xyz/favicon.ico"]);

    const http = recordingFetch((url) => (url.startsWith("https://") ? redirect("http://arcus.xyz/favicon.ico") : image(PNG)));
    expect(await createFetchImage(http.fetchImpl)("https://arcus.xyz/favicon.ico", onlyArcus)).toBeNull();
    expect(http.calls).toHaveLength(1);

    const nowhere = recordingFetch(() => new Response(null, { status: 302 }));
    expect(await createFetchImage(nowhere.fetchImpl)("https://arcus.xyz/favicon.ico", onlyArcus)).toBeNull();
  });

  it("treats any status but 200 as no logo (unavatar answers 404 with fallback=false)", async () => {
    for (const status of [404, 204, 206, 429, 500]) {
      const { fetchImpl } = recordingFetch(() => image(status === 204 ? new Uint8Array(0) : PNG, "image/png", status));
      expect(await createFetchImage(fetchImpl)("https://arcus.xyz/a.png", onlyArcus), String(status)).toBeNull();
    }
  });

  it("gives null when the request fails or outlives its timeout", async () => {
    const throwing = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect(await createFetchImage(throwing)("https://arcus.xyz/a.png", onlyArcus)).toBeNull();

    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof fetch;
    const started = Date.now();
    expect(await createFetchImage(hanging, { timeoutMs: 30 })("https://arcus.xyz/a.png", onlyArcus)).toBeNull();
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("xHandle", () => {
  const social = (...urls: string[]) => urls.map((url) => ({ url, kind: "social" }));

  it.each([
    ["https://x.com/ArcusFi", "ArcusFi"],
    ["https://twitter.com/arcus_fi/", "arcus_fi"],
    ["https://www.x.com/arcus?lang=en", "arcus"],
    ["https://x.com/arcus/", "arcus"],
    ["https://mobile.twitter.com/A1234567890_bcd", "A1234567890_bcd"],
  ])("reads the handle of %s", (url, handle) => {
    expect(xHandle(social(url))).toBe(handle);
  });

  it.each([
    ["a 16-character name", "https://x.com/A1234567890_bcde"],
    ["a dash", "https://x.com/arc-us"],
    ["no path", "https://x.com/"],
    ["the i/ path", "https://x.com/i/flow/login"],
    ["home", "https://x.com/home"],
    ["search", "https://twitter.com/search?q=arcus"],
    ["intent", "https://twitter.com/intent/follow?screen_name=arcus"],
    ["share", "https://x.com/share?url=https://arcus.xyz"],
    ["explore", "https://x.com/explore"],
    ["hashtag", "https://x.com/hashtag/arcus"],
    ["a lookalike host", "https://x.com.evil.io/arcus"],
    ["a tweet of another account", "https://x.com/other/status/123"],
    ["a profile sub-page", "https://x.com/arcus/followers"],
    ["another platform", "https://t.me/arcus"],
    ["not a URL", "x.com/arcus"],
  ])("finds no handle in %s", (_name, url) => {
    expect(xHandle(social(url))).toBeNull();
  });

  it("reads only social links", () => {
    expect(xHandle([{ url: "https://x.com/arcus", kind: "website" }])).toBeNull();
    expect(xHandle([{ url: "https://x.com/arcus", kind: "website" }, ...social("https://x.com/arcusfi")])).toBe("arcusfi");
  });

  it("takes one handle written several ways (X handles ignore case)", () => {
    expect(xHandle(social("https://x.com/Arcus", "https://twitter.com/arcus/", "https://t.me/arcus"))).toBe("Arcus");
    // A tweet of another account is not a profile: it neither gives a handle nor makes the project ambiguous.
    expect(xHandle(social("https://x.com/arcus", "https://x.com/other/status/123"))).toBe("arcus");
  });

  it("skips a project with several different handles: it is ambiguous", () => {
    expect(xHandle(social("https://x.com/arcus", "https://x.com/arcus_labs"))).toBeNull();
    // A reserved path next to a handle does not make it ambiguous.
    expect(xHandle(social("https://x.com/arcus", "https://x.com/intent/follow?screen_name=other"))).toBe("arcus");
  });
});

// ---------- the logos stage ----------

function project(id: string, over: Partial<ProjectForScoring> = {}): ProjectForScoring {
  return {
    id,
    slug: id,
    name: id,
    nameKey: id,
    tokenSymbol: null,
    chains: [],
    officialDomains: [],
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

const protocol = (over: Partial<DefillamaProtocol>): DefillamaProtocol => ({
  name: "P",
  url: null,
  tvl: null,
  geckoId: null,
  logo: null,
  ...over,
});

/**
 * A fake download: answers `images[url]` (null or missing = no usable image) and records each request with whether
 * the stage's host rule allowed a few probe hosts.
 */
function fakeFetchImage(images: Record<string, LogoImage | null>, probes: string[] = []) {
  const calls: { url: string; allowed: Record<string, boolean> }[] = [];
  const fetchImage: FetchImage = async (url, allowHost) => {
    calls.push({ url, allowed: Object.fromEntries(probes.map((h) => [h, allowHost(h)])) });
    return images[url] ?? null;
  };
  return { fetchImage, calls, urls: () => calls.map((c) => c.url) };
}

const png: LogoImage = { mime: "image/png", bytes: PNG };

/** A curation record that passed (listed) or failed. */
function curation(passed: boolean): CurationRecord {
  return {
    passed,
    worthLevel: "low",
    worthPoints: 0,
    tab: passed ? "live_now" : null,
    statusAt: "live",
    endedOn: null,
    reasons: [],
    coverage: { defillama: true, vc: true, alphadrops_raises: true },
    coingeckoListed: null,
  };
}
const ico: LogoImage = { mime: "image/x-icon", bytes: ICO };
const PNG_B64 = "iVBORw0KGgoAAAAN";
const ICO_B64 = "AAABAAEAEBA=";

function run(
  projects: ProjectForScoring[],
  fetchImage: FetchImage,
  opts: {
    repo?: MemoryRepo;
    protocols?: DefillamaProtocol[] | null;
    phishing?: Map<string, boolean | null>;
    now?: () => Date;
    config?: PipelineConfig;
  } = {},
) {
  const repo = opts.repo ?? new MemoryRepo();
  const stats = emptyStats();
  const done = refreshLogos(
    { repo, fetchImage, now: opts.now ?? (() => NOW) },
    opts.config ?? defaultConfig,
    projects,
    { protocols: opts.protocols ?? [], phishing: opts.phishing ?? new Map() },
    NOW,
    stats,
  );
  return { repo, stats, done };
}

const arcus = project("arcus", {
  officialDomains: ["arcus.xyz"],
  links: [
    { url: "https://arcus.xyz/", kind: "website" },
    { url: "https://x.com/ArcusFi", kind: "social" },
  ],
});
const ARCUS_LLAMA = protocol({ name: "Arcus", url: "https://arcus.xyz", tvl: 9_000_000, logo: "https://icons.llama.fi/arcus.png" });
const UNAVATAR = "https://unavatar.io/x/ArcusFi?fallback=false";
const APPLE = "https://arcus.xyz/apple-touch-icon.png";
const FAVICON = "https://arcus.xyz/favicon.ico";
const clean = new Map<string, boolean | null>([["arcus.xyz", false]]);

describe("refreshLogos tier order", () => {
  it("takes the DefiLlama logo first and asks nothing else", async () => {
    const fake = fakeFetchImage({ [ARCUS_LLAMA.logo!]: png, [UNAVATAR]: ico, [APPLE]: ico });
    const { repo, stats, done } = run([arcus], fake.fetchImage, { protocols: [ARCUS_LLAMA], phishing: clean });
    await done;

    expect(fake.urls()).toEqual(["https://icons.llama.fi/arcus.png"]);
    expect(repo.projectLogos.get("arcus")).toEqual({ source: "defillama", mime: "image/png", dataB64: PNG_B64, fetchedAt: NOW });
    expect(stats).toMatchObject({ logos_fetched: 1, logos_defillama: 1, logos_x_avatar: 0, logos_favicon: 0, logos_failed: 0 });
  });

  it("falls back to the X avatar, then the favicon of the clean official domain, then nothing", async () => {
    const xFirst = fakeFetchImage({ [UNAVATAR]: png, [APPLE]: ico });
    const a = run([arcus], xFirst.fetchImage, { protocols: [ARCUS_LLAMA], phishing: clean });
    await a.done;
    expect(xFirst.urls()).toEqual(["https://icons.llama.fi/arcus.png", UNAVATAR]);
    expect(a.repo.projectLogos.get("arcus")?.source).toBe("x_avatar");
    expect(a.stats).toMatchObject({ logos_fetched: 1, logos_x_avatar: 1, logos_x_avatar_requests: 1, logos_x_avatar_failed: 0 });

    // unavatar answers 404 (fallback=false: no placeholder) and apple-touch-icon is missing: favicon.ico.
    const favicon = fakeFetchImage({ [FAVICON]: ico });
    const b = run([arcus], favicon.fetchImage, { protocols: [ARCUS_LLAMA], phishing: clean });
    await b.done;
    expect(favicon.urls()).toEqual(["https://icons.llama.fi/arcus.png", UNAVATAR, APPLE, FAVICON]);
    expect(b.repo.projectLogos.get("arcus")).toEqual({ source: "favicon", mime: "image/x-icon", dataB64: ICO_B64, fetchedAt: NOW });
    expect(b.stats).toMatchObject({ logos_fetched: 1, logos_favicon: 1, logos_x_avatar_requests: 1, logos_x_avatar_failed: 1 });

    const none = fakeFetchImage({});
    const c = run([arcus], none.fetchImage, { protocols: [ARCUS_LLAMA], phishing: clean });
    await c.done;
    expect(c.repo.projectLogos.size).toBe(0);
    expect(c.stats).toMatchObject({ logos_fetched: 0, logos_failed: 1 });
  });

  it("counts a project with no source to try as neither fetched nor failed", async () => {
    const fake = fakeFetchImage({});
    const { stats, done } = run([project("bare")], fake.fetchImage);
    await done;
    expect(fake.urls()).toEqual([]);
    expect(stats).toMatchObject({ logos_fetched: 0, logos_failed: 0, logos_skipped: 0 });
  });
});

describe("refreshLogos DefiLlama tier", () => {
  it("uses only the logo of a protocol matched by official domain, the highest TVL first, and only from icons.llama.fi", async () => {
    const protocols = [
      protocol({ name: "Arcus V1", url: "https://arcus.xyz/v1", tvl: 1_000, logo: "https://icons.llama.fi/arcus-v1.png" }),
      protocol({ name: "Arcus V2", url: "https://v2.arcus.xyz", tvl: 50_000, logo: "https://icons.llama.fi/arcus-v2.jpg" }),
      // Same name, other domain: never matched.
      protocol({ name: "arcus", url: "https://arcus-fi.io", tvl: 9e9, logo: "https://icons.llama.fi/fake.png" }),
    ];
    const fake = fakeFetchImage({ "https://icons.llama.fi/arcus-v2.jpg": png }, ["icons.llama.fi", "llama.fi", "evil.io"]);
    const { repo, done } = run([arcus], fake.fetchImage, { protocols });
    await done;

    expect(fake.calls).toEqual([
      { url: "https://icons.llama.fi/arcus-v2.jpg", allowed: { "icons.llama.fi": true, "llama.fi": false, "evil.io": false } },
    ]);
    expect(repo.projectLogos.get("arcus")?.source).toBe("defillama");
  });

  it.each([
    ["another host", "https://evil.io/arcus.png"],
    ["a lookalike host", "https://icons.llama.fi.evil.io/arcus.png"],
    ["http", "http://icons.llama.fi/arcus.png"],
    ["not a URL", "icons.llama.fi/arcus.png"],
  ])("never downloads a DefiLlama logo on %s", async (_name, logo) => {
    const fake = fakeFetchImage({});
    const { done } = run([arcus], fake.fetchImage, { protocols: [{ ...ARCUS_LLAMA, logo }] });
    await done;
    expect(fake.urls()).not.toContain(logo);
    expect(fake.urls()[0]).toBe(UNAVATAR);
  });

  it("skips the DefiLlama tier when the protocol list could not be fetched", async () => {
    const fake = fakeFetchImage({ [UNAVATAR]: png });
    const { repo, done } = run([arcus], fake.fetchImage, { protocols: null });
    await done;
    expect(fake.urls()).toEqual([UNAVATAR]);
    expect(repo.projectLogos.get("arcus")?.source).toBe("x_avatar");
  });
});

describe("refreshLogos X avatar tier", () => {
  it("asks unavatar.io for the handle and lets it redirect only to its own hosts and X's image CDN", async () => {
    const fake = fakeFetchImage({ [UNAVATAR]: png }, ["unavatar.io", "cdn.unavatar.io", "pbs.twimg.com", "x.com", "evil.io", "unavatar.io.evil.io"]);
    const { done } = run([arcus], fake.fetchImage);
    await done;
    expect(fake.calls).toEqual([
      {
        url: "https://unavatar.io/x/ArcusFi?fallback=false",
        allowed: {
          "unavatar.io": true,
          "cdn.unavatar.io": true,
          "pbs.twimg.com": true,
          "x.com": false,
          "evil.io": false,
          "unavatar.io.evil.io": false,
        },
      },
    ]);
  });

  it("skips a project with two different X handles and goes on to its favicon", async () => {
    const twoHandles = project("arcus", {
      officialDomains: ["arcus.xyz"],
      links: [
        { url: "https://x.com/arcus", kind: "social" },
        { url: "https://x.com/arcus_labs", kind: "social" },
      ],
    });
    const fake = fakeFetchImage({ [APPLE]: png });
    const { stats, done } = run([twoHandles], fake.fetchImage, { phishing: clean });
    await done;
    expect(fake.urls()).toEqual([APPLE]);
    expect(stats.logos_x_avatar_requests).toBe(0);
  });

  it("asks unavatar.io at most 20 times per run; past the cap a project goes on to its favicon", async () => {
    const projects = Array.from({ length: 25 }, (_, i) =>
      project(`p${String(i).padStart(2, "0")}`, {
        officialDomains: [`p${i}.xyz`],
        links: [{ url: `https://x.com/handle${i}`, kind: "social" }],
      }),
    );
    const phishing = new Map(projects.map((p) => [p.officialDomains[0]!, false]));
    // No avatar for anyone: each project goes on to its favicon, which works.
    const images = Object.fromEntries(projects.map((p) => [`https://${p.officialDomains[0]}/apple-touch-icon.png`, png]));
    const fake = fakeFetchImage(images);
    const { repo, stats, done } = run(projects, fake.fetchImage, { phishing });
    await done;

    expect(fake.urls().filter((u) => u.startsWith("https://unavatar.io/"))).toHaveLength(20);
    expect(stats).toMatchObject({ logos_x_avatar_requests: 20, logos_x_avatar_deferred: 5, logos_favicon: 25, logos_fetched: 25 });
    expect(repo.projectLogos.size).toBe(25);
  });

  it("gives a later project its favicon in the same run when 25 always-failing X projects come first", async () => {
    const failing = Array.from({ length: 25 }, (_, i) =>
      project(`a${String(i).padStart(2, "0")}`, { links: [{ url: `https://x.com/fail${i}`, kind: "social" }] }),
    );
    const later = project("z-later", { officialDomains: ["later.io"], links: [{ url: "https://x.com/later", kind: "social" }] });
    const fake = fakeFetchImage({ "https://later.io/apple-touch-icon.png": png });
    const config = { ...defaultConfig, logos: { ...defaultConfig.logos, concurrency: 1 } };
    const { repo, stats, done } = run([later, ...failing], fake.fetchImage, { phishing: new Map([["later.io", false]]), config });
    await done;

    expect(fake.urls().at(-1)).toBe("https://later.io/apple-touch-icon.png");
    expect(repo.projectLogos.get("z-later")?.source).toBe("favicon");
    expect(stats).toMatchObject({ logos_x_avatar_requests: 20, logos_x_avatar_deferred: 6, logos_failed: 20, logos_favicon: 1 });
  });

  it("does not spend the cap on the same failing projects again the next day", async () => {
    const failing = Array.from({ length: 25 }, (_, i) =>
      project(`a${String(i).padStart(2, "0")}`, { links: [{ url: `https://x.com/fail${i}`, kind: "social" }] }),
    );
    const repo = new MemoryRepo();
    const first = fakeFetchImage({});
    await run(failing, first.fetchImage, { repo }).done;
    const asked = new Set(first.urls());
    expect(asked.size).toBe(20);

    // One day later: the 20 that failed wait a week; the 5 that were never asked are asked now.
    const second = fakeFetchImage({});
    const stats = emptyStats();
    await refreshLogos(
      { repo, fetchImage: second.fetchImage, now: () => new Date(NOW.getTime() + DAY) },
      defaultConfig,
      failing,
      { protocols: [], phishing: new Map() },
      new Date(NOW.getTime() + DAY),
      stats,
    );
    expect(second.urls()).toHaveLength(5);
    expect(second.urls().some((u) => asked.has(u))).toBe(false);
  });

  it("does not spend the cap on projects that already got a DefiLlama logo", async () => {
    const projects = Array.from({ length: 22 }, (_, i) =>
      project(`p${String(i).padStart(2, "0")}`, {
        officialDomains: [`p${i}.xyz`],
        links: [{ url: `https://x.com/handle${i}`, kind: "social" }],
      }),
    );
    const protocols = projects.slice(0, 2).map((p) =>
      protocol({ url: `https://${p.officialDomains[0]}`, logo: `https://icons.llama.fi/${p.id}.png` }),
    );
    const images = Object.fromEntries([
      ...protocols.map((p) => [p.logo!, png]),
      ...projects.map((_, i) => [`https://unavatar.io/x/handle${i}?fallback=false`, png]),
    ]);
    const fake = fakeFetchImage(images);
    const { stats, done } = run(projects, fake.fetchImage, { protocols });
    await done;
    expect(stats).toMatchObject({ logos_defillama: 2, logos_x_avatar: 20, logos_x_avatar_deferred: 0, logos_fetched: 22 });
  });
});

describe("refreshLogos favicon tier", () => {
  const site = project("site", {
    officialDomains: ["site.io"],
    links: [
      { url: "https://site.io/", kind: "website" },
      { url: "https://claim.other.io/", kind: "claim" },
    ],
  });

  it("asks the official domain only when its latest phishing check is clean", async () => {
    for (const [flag, asked] of [
      [false, true],
      [true, false],
      [null, false],
      [undefined, false],
    ] as const) {
      const fake = fakeFetchImage({ "https://site.io/apple-touch-icon.png": png });
      const phishing = new Map<string, boolean | null>(flag === undefined ? [] : [["site.io", flag]]);
      const { repo, done } = run([site], fake.fetchImage, { phishing });
      await done;
      expect(fake.urls().length > 0, String(flag)).toBe(asked);
      expect(repo.projectLogos.has("site"), String(flag)).toBe(asked);
    }
  });

  it("never asks a domain that is not official, even a clean one", async () => {
    const fake = fakeFetchImage({});
    const phishing = new Map<string, boolean | null>([
      ["site.io", true],
      ["other.io", false],
    ]);
    const { done } = run([site], fake.fetchImage, { phishing });
    await done;
    expect(fake.urls()).toEqual([]);
  });

  it("tries apple-touch-icon.png, then favicon.ico, on each clean official domain, redirects only within the domain", async () => {
    const two = project("two", { officialDomains: ["one.io", "two.io"] });
    const fake = fakeFetchImage({ "https://two.io/favicon.ico": ico }, ["one.io", "www.one.io", "two.io", "cdn.two.io", "one.io.evil.io", "evil.io"]);
    const phishing = new Map<string, boolean | null>([
      ["one.io", false],
      ["two.io", false],
    ]);
    const { repo, done } = run([two], fake.fetchImage, { phishing });
    await done;

    expect(fake.urls()).toEqual([
      "https://one.io/apple-touch-icon.png",
      "https://one.io/favicon.ico",
      "https://two.io/apple-touch-icon.png",
      "https://two.io/favicon.ico",
    ]);
    expect(fake.calls[0]?.allowed).toEqual({
      "one.io": true,
      "www.one.io": true,
      "two.io": false,
      "cdn.two.io": false,
      "one.io.evil.io": false,
      "evil.io": false,
    });
    expect(fake.calls[3]?.allowed).toMatchObject({ "two.io": true, "cdn.two.io": true, "one.io": false });
    expect(repo.projectLogos.get("two")?.source).toBe("favicon");
  });
});

describe("refreshLogos refresh, budget and failures", () => {
  it("leaves a logo younger than 7 days alone and refreshes an older one", async () => {
    const repo = new MemoryRepo();
    const old = { source: "favicon" as const, mime: "image/x-icon" as const, dataB64: ICO_B64 };
    await repo.saveProjectLogo("fresh", old, daysAgo(3));
    await repo.saveProjectLogo("stale", old, daysAgo(8));
    const fresh = project("fresh", { links: [{ url: "https://x.com/fresh", kind: "social" }] });
    const stale = project("stale", { links: [{ url: "https://x.com/stale", kind: "social" }] });
    const fake = fakeFetchImage({ "https://unavatar.io/x/fresh?fallback=false": png, "https://unavatar.io/x/stale?fallback=false": png });

    const { stats, done } = run([fresh, stale], fake.fetchImage, { repo });
    await done;

    expect(fake.urls()).toEqual(["https://unavatar.io/x/stale?fallback=false"]);
    expect(repo.projectLogos.get("stale")).toEqual({ source: "x_avatar", mime: "image/png", dataB64: PNG_B64, fetchedAt: NOW });
    expect(repo.projectLogos.get("fresh")?.fetchedAt).toEqual(daysAgo(3));
    expect(stats.logos_fetched).toBe(1);
  });

  it("keeps the stored logo when its refresh fails", async () => {
    const repo = new MemoryRepo();
    await repo.saveProjectLogo("arcus", { source: "favicon", mime: "image/x-icon", dataB64: ICO_B64 }, daysAgo(9));
    const fake = fakeFetchImage({});
    const { stats, done } = run([arcus], fake.fetchImage, { repo, phishing: clean });
    await done;
    expect(repo.projectLogos.get("arcus")).toEqual({ source: "favicon", mime: "image/x-icon", dataB64: ICO_B64, fetchedAt: daysAgo(9) });
    expect(stats.logos_failed).toBe(1);
  });

  it("orders listed projects first, then never tried, then the oldest attempt or logo, whatever the input order", async () => {
    const seeded = async (): Promise<MemoryRepo> => {
      const repo = new MemoryRepo();
      const old = { source: "favicon" as const, mime: "image/x-icon" as const, dataB64: ICO_B64 };
      // Listed: latest curation passed. u-dropped passed once, then failed.
      for (const id of ["l-never", "l-logo20", "l-tried9", "u-dropped"]) await repo.saveCuration(id, curation(true), daysAgo(3));
      await repo.saveCuration("u-dropped", curation(false), daysAgo(1));
      await repo.saveProjectLogo("l-logo20", old, daysAgo(20));
      await repo.saveLogoAttempt("l-tried9", "failed", daysAgo(9));
      await repo.saveProjectLogo("u-logo8", old, daysAgo(8));
      await repo.saveLogoAttempt("u-tried30", "failed", daysAgo(30));
      return repo;
    };
    const ids = ["u-logo8", "l-tried9", "u-never", "u-dropped", "l-logo20", "u-tried30", "l-never"];
    const expected = ["l-never", "l-logo20", "l-tried9", "u-dropped", "u-never", "u-tried30", "u-logo8"].map(
      (id) => `https://unavatar.io/x/${id.replace("-", "_")}?fallback=false`,
    );
    const config = { ...defaultConfig, logos: { ...defaultConfig.logos, concurrency: 1 } };
    for (const order of [ids, [...ids].reverse(), [...ids.slice(3), ...ids.slice(0, 3)]]) {
      const ps = order.map((id) => project(id, { links: [{ url: `https://x.com/${id.replace("-", "_")}`, kind: "social" }] }));
      const fake = fakeFetchImage({});
      await run(ps, fake.fetchImage, { repo: await seeded(), config }).done;
      expect(fake.urls(), order.join(",")).toEqual(expected);
    }
  });

  it("waits 7 days after a failed attempt before trying again, and records every attempt", async () => {
    const repo = new MemoryRepo();
    await repo.saveLogoAttempt("six", "failed", daysAgo(6));
    await repo.saveLogoAttempt("eight", "failed", daysAgo(8));
    const ps = ["six", "eight", "ok"].map((id) => project(id, { links: [{ url: `https://x.com/${id}`, kind: "social" }] }));
    const fake = fakeFetchImage({ "https://unavatar.io/x/ok?fallback=false": png });
    await run(ps, fake.fetchImage, { repo }).done;

    expect(fake.urls().sort()).toEqual(["https://unavatar.io/x/eight?fallback=false", "https://unavatar.io/x/ok?fallback=false"]);
    expect(repo.logoAttempts.get("six")).toEqual({ outcome: "failed", attemptedAt: daysAgo(6) });
    expect(repo.logoAttempts.get("eight")).toEqual({ outcome: "failed", attemptedAt: NOW });
    expect(repo.logoAttempts.get("ok")).toEqual({ outcome: "stored", attemptedAt: NOW });
  });

  it("records no attempt for a project whose X avatar waited for the cap and that got nothing else", async () => {
    const ps = Array.from({ length: 21 }, (_, i) => project(`p${String(i).padStart(2, "0")}`, { links: [{ url: `https://x.com/h${i}`, kind: "social" }] }));
    const config = { ...defaultConfig, logos: { ...defaultConfig.logos, concurrency: 1 } };
    const { repo, stats, done } = run(ps, fakeFetchImage({}).fetchImage, { config });
    await done;
    expect(stats).toMatchObject({ logos_x_avatar_deferred: 1, logos_failed: 20 });
    expect(repo.logoAttempts.has("p20")).toBe(false);
    expect(repo.logoAttempts.get("p19")?.outcome).toBe("failed");
  });

  it("starts no project after the time budget (2 minutes); the rest wait for the next run", async () => {
    const ps = Array.from({ length: 5 }, (_, i) => project(`p${i}`, { links: [{ url: `https://x.com/h${i}`, kind: "social" }] }));
    let clock = NOW.getTime();
    const fake = fakeFetchImage({});
    const slowFetch: FetchImage = async (url, allow) => {
      clock += 50_000; // each download takes 50 s
      return fake.fetchImage(url, allow);
    };
    const config = { ...defaultConfig, logos: { ...defaultConfig.logos, concurrency: 1 } };
    const { repo, stats, done } = run(ps, slowFetch, { now: () => new Date(clock), config });
    await done;

    expect(defaultConfig.logos.budgetMinutes).toBe(2);
    // Started at 0 s, 50 s and 100 s; at 150 s the budget is spent.
    expect(fake.urls()).toHaveLength(3);
    expect(stats).toMatchObject({ logos_skipped: 2, logos_failed: 3 });
    expect(repo.projectLogos.size).toBe(0);
  });

  it("downloads a few projects at a time", async () => {
    const ps = Array.from({ length: 8 }, (_, i) => project(`p${i}`, { links: [{ url: `https://x.com/h${i}`, kind: "social" }] }));
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImage: FetchImage = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight -= 1;
      return png;
    };
    const { stats, done } = run(ps, fetchImage);
    await done;
    expect(stats.logos_fetched).toBe(8);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(defaultConfig.logos.concurrency);
    expect(defaultConfig.logos.concurrency).toBeLessThanOrEqual(4);
  });

  it("counts a project whose logo cannot be stored as failed and goes on with the others", async () => {
    const repo = new MemoryRepo();
    const save = repo.saveProjectLogo.bind(repo);
    repo.saveProjectLogo = async (id, logo, at) => {
      if (id === "p0") throw new Error("db down");
      return save(id, logo, at);
    };
    const ps = ["p0", "p1"].map((id) => project(id, { links: [{ url: `https://x.com/${id}`, kind: "social" }] }));
    const { stats, done } = run(ps, fakeFetchImage({ "https://unavatar.io/x/p0?fallback=false": png, "https://unavatar.io/x/p1?fallback=false": png }).fetchImage, { repo });
    await done;
    expect(stats).toMatchObject({ logos_failed: 1, logos_fetched: 1 });
    expect([...repo.projectLogos.keys()]).toEqual(["p1"]);
  });
});
