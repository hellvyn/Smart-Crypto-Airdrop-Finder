import { describe, expect, it, vi } from "vitest";
import type { Http } from "../src/collectors/types.js";
import { checkPhishingSite } from "../src/enrich/goplus.js";
import { firstCertificateAgeDays } from "../src/enrich/crtsh.js";
import { domainAgeDays } from "../src/enrich/rdap.js";
import { countHacks, fetchHacks } from "../src/enrich/hacks.js";

function fakeHttp(status: number, body: string, calls: string[] = []): Http {
  return {
    async get(url: string) {
      calls.push(url);
      return { status, body };
    },
    async resolveRedirect() {
      return null;
    },
  };
}

const json = (v: unknown): string => JSON.stringify(v);

type Reply = { status: number; body: string };

/** Answers by exact URL; unknown URLs get 404. */
function routedHttp(routes: Record<string, Reply>, calls: string[] = []): Http {
  return {
    async get(url: string) {
      calls.push(url);
      return routes[url] ?? { status: 404, body: "" };
    },
    async resolveRedirect() {
      return null;
    },
  };
}

/** Answers the n-th request with the n-th reply (the last reply repeats). */
function sequenceHttp(replies: Reply[], calls: string[] = []): Http {
  return {
    async get(url: string) {
      calls.push(url);
      return replies[Math.min(calls.length - 1, replies.length - 1)] as Reply;
    },
    async resolveRedirect() {
      return null;
    },
  };
}

const CRT = "https://crt.sh/?q=a.io&output=json";
const NOW = new Date("2026-10-10T00:00:00Z");
const PHISHING_OK = json({ code: 1, result: { phishing_site: 0 } });
const noSleep = async (): Promise<void> => {};

describe("checkPhishingSite", () => {
  it("returns false when GoPlus says phishing_site is 0", async () => {
    const http = fakeHttp(200, json({ code: 1, message: "OK", result: { phishing_site: 0 } }));
    expect(await checkPhishingSite(http, "https://example.org")).toBe(false);
  });

  it("returns true when GoPlus says phishing_site is 1", async () => {
    const http = fakeHttp(200, json({ code: 1, message: "OK", result: { phishing_site: 1 } }));
    expect(await checkPhishingSite(http, "https://evil.example")).toBe(true);
  });

  it("encodes the url in the request", async () => {
    const calls: string[] = [];
    const http = fakeHttp(200, json({ code: 1, result: { phishing_site: 0 } }), calls);
    await checkPhishingSite(http, "https://a.org/x?y=1&z=2");
    expect(calls).toEqual([
      `https://api.gopluslabs.io/api/v1/phishing_site?url=${encodeURIComponent("https://a.org/x?y=1&z=2")}`,
    ]);
  });

  it("returns null on HTTP 500", async () => {
    expect(await checkPhishingSite(fakeHttp(500, "oops"), "https://a.org", noSleep)).toBeNull();
  });

  it("returns null when code is not 1", async () => {
    const http = fakeHttp(200, json({ code: 2, message: "err", result: { phishing_site: 0 } }));
    expect(await checkPhishingSite(http, "https://a.org")).toBeNull();
  });

  it("returns null on invalid JSON", async () => {
    expect(await checkPhishingSite(fakeHttp(200, "<html>"), "https://a.org")).toBeNull();
  });

  it("returns null on unexpected phishing_site value or shape", async () => {
    expect(
      await checkPhishingSite(fakeHttp(200, json({ code: 1, result: { phishing_site: 2 } })), "https://a.org"),
    ).toBeNull();
    expect(await checkPhishingSite(fakeHttp(200, json({ code: 1, result: {} })), "https://a.org")).toBeNull();
    expect(await checkPhishingSite(fakeHttp(200, json({ code: 1 })), "https://a.org")).toBeNull();
  });
});

describe("checkPhishingSite retry", () => {
  it("retries once after a 429 and uses the second answer", async () => {
    const calls: string[] = [];
    const http = sequenceHttp([{ status: 429, body: "" }, { status: 200, body: PHISHING_OK }], calls);
    const sleep = vi.fn(async () => {});
    expect(await checkPhishingSite(http, "https://a.io", sleep)).toBe(false);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(calls).toHaveLength(2);
  });

  it("retries once after a 5xx", async () => {
    const http = sequenceHttp([
      { status: 503, body: "" },
      { status: 200, body: json({ code: 1, result: { phishing_site: 1 } }) },
    ]);
    expect(await checkPhishingSite(http, "https://a.io", noSleep)).toBe(true);
  });

  it("gives up with null after a second 429 and makes no third request", async () => {
    const calls: string[] = [];
    const sleep = vi.fn(async () => {});
    const http = sequenceHttp([{ status: 429, body: "" }], calls);
    expect(await checkPhishingSite(http, "https://a.io", sleep)).toBeNull();
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("does not retry other failures such as 404 or a bad body", async () => {
    const sleep = vi.fn(async () => {});
    const calls: string[] = [];
    expect(await checkPhishingSite(sequenceHttp([{ status: 404, body: "" }], calls), "https://a.io", sleep)).toBeNull();
    expect(await checkPhishingSite(sequenceHttp([{ status: 200, body: "<html>" }], calls), "https://a.io", sleep)).toBeNull();
    expect(calls).toHaveLength(2);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("firstCertificateAgeDays", () => {
  const certs = (...dates: string[]): Reply => ({ status: 200, body: json(dates.map((d) => ({ not_before: d }))) });

  it("uses the earliest not_before as UTC and floors to whole days", async () => {
    const http = routedHttp({
      "https://crt.sh/?q=orbinum.io&output=json": certs("2025-01-10T00:00:00", "2024-03-01T12:00:00"),
    });
    expect(await firstCertificateAgeDays(http, "orbinum.io", NOW)).toBe(952);
  });

  it("lowercases and encodes the domain in the request", async () => {
    const calls: string[] = [];
    await firstCertificateAgeDays(routedHttp({}, calls), "Orbinum.IO", NOW);
    expect(calls).toEqual(["https://crt.sh/?q=orbinum.io&output=json"]);
  });

  it("clamps a future certificate date to 0", async () => {
    expect(await firstCertificateAgeDays(routedHttp({ [CRT]: certs("2026-12-01T00:00:00") }), "a.io", NOW)).toBe(0);
  });

  it("ignores entries without a parseable not_before and still uses the valid ones", async () => {
    const body = json([{ not_before: "garbage" }, {}, { not_before: 5 }, { not_before: "2026-10-01T00:00:00" }]);
    expect(await firstCertificateAgeDays(routedHttp({ [CRT]: { status: 200, body } }), "a.io", NOW)).toBe(9);
  });

  it("returns null for errors, empty lists, bad JSON and wrong shape", async () => {
    const bad: Reply[] = [
      { status: 502, body: "" },
      { status: 0, body: "" },
      { status: 200, body: "[]" },
      { status: 200, body: "<html>" },
      { status: 200, body: json({ not_before: "2024-01-01T00:00:00" }) },
      { status: 200, body: json([{ not_before: "garbage" }]) },
    ];
    for (const res of bad) {
      expect(await firstCertificateAgeDays(routedHttp({ [CRT]: res }), "a.io", NOW)).toBeNull();
    }
  });

  it("returns null for a well-formed certificate list over the size cap", async () => {
    // Every entry is valid, so only the size cap can make this null.
    const body = json(Array.from({ length: 140_000 }, () => ({ not_before: "2024-01-01T00:00:00" })));
    expect(body.length).toBeGreaterThan(5_000_000);
    expect(await firstCertificateAgeDays(routedHttp({ [CRT]: { status: 200, body } }), "a.io", NOW)).toBeNull();
  });

  it("answers from a large but allowed certificate list", async () => {
    const many = Array.from({ length: 20_000 }, (_, i) => ({ not_before: `2025-01-01T00:00:${String(i % 60).padStart(2, "0")}` }));
    many.push({ not_before: "2026-10-09T00:00:00" }); // the earliest of the list is 2025-01-01T00:00:00
    const body = json(many);
    expect(body.length).toBeLessThan(5_000_000);
    expect(await firstCertificateAgeDays(routedHttp({ [CRT]: { status: 200, body } }), "a.io", NOW)).toBe(647);
  });
});

describe("domainAgeDays", () => {
  const now = new Date("2026-10-10T00:00:00Z");
  const rdap = (eventDate: string) =>
    json({ events: [{ eventAction: "last changed", eventDate: "2026-10-05T00:00:00Z" }, { eventAction: "registration", eventDate }] });

  it("returns whole days since registration", async () => {
    expect(await domainAgeDays(fakeHttp(200, rdap("2026-10-01T00:00:00Z")), "example.org", now)).toBe(9);
  });

  it("floors partial days", async () => {
    expect(await domainAgeDays(fakeHttp(200, rdap("2026-10-01T12:00:00Z")), "example.org", now)).toBe(8);
  });

  it("clamps a future registration date to 0", async () => {
    expect(await domainAgeDays(fakeHttp(200, rdap("2026-10-20T00:00:00Z")), "example.org", now)).toBe(0);
  });

  it("lowercases and encodes the domain in the request", async () => {
    const calls: string[] = [];
    await domainAgeDays(fakeHttp(200, rdap("2026-10-01T00:00:00Z"), calls), "Example.ORG", now);
    expect(calls).toEqual(["https://rdap.org/domain/example.org"]);
  });

  it("returns null on 404", async () => {
    expect(await domainAgeDays(fakeHttp(404, "not found"), "example.org", now)).toBeNull();
  });

  it("returns null without a registration event", async () => {
    const body = json({ events: [{ eventAction: "expiration", eventDate: "2030-01-01T00:00:00Z" }] });
    expect(await domainAgeDays(fakeHttp(200, body), "example.org", now)).toBeNull();
  });

  it("returns null on unparseable date, invalid JSON or bad shape", async () => {
    expect(await domainAgeDays(fakeHttp(200, rdap("not-a-date")), "example.org", now)).toBeNull();
    expect(await domainAgeDays(fakeHttp(200, "nope"), "example.org", now)).toBeNull();
    expect(await domainAgeDays(fakeHttp(200, json({ events: "x" })), "example.org", now)).toBeNull();
    expect(await domainAgeDays(fakeHttp(200, json({})), "example.org", now)).toBeNull();
  });
});

describe("countHacks", () => {
  it("matches normalized project names", () => {
    expect(countHacks([{ name: "Ink Chain" }], "INK")).toBe(1);
  });

  it("counts multiple matches and ignores others", () => {
    const hacks = [{ name: "Ink Chain" }, { name: "$INK" }, { name: "Other" }];
    expect(countHacks(hacks, "Ink")).toBe(2);
  });

  it("ignores items without a string name", () => {
    expect(countHacks([{ name: 5 }, {}, null, "Ink", { name: "Ink" }], "ink")).toBe(1);
  });

  it("returns 0 for an empty normalized project name", () => {
    expect(countHacks([{ name: "" }, { name: "Ink" }], "$$")).toBe(0);
  });
});

describe("fetchHacks", () => {
  it("returns the array on success", async () => {
    const calls: string[] = [];
    const hacks = [{ name: "Ink", date: 1700000000 }];
    expect(await fetchHacks(fakeHttp(200, json(hacks), calls))).toEqual(hacks);
    expect(calls).toEqual(["https://api.llama.fi/hacks"]);
  });

  it("returns null on non-200, invalid JSON or non-array", async () => {
    expect(await fetchHacks(fakeHttp(500, "x"))).toBeNull();
    expect(await fetchHacks(fakeHttp(200, "nope"))).toBeNull();
    expect(await fetchHacks(fakeHttp(200, json({ a: 1 })))).toBeNull();
  });
});
