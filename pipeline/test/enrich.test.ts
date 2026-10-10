import { describe, expect, it } from "vitest";
import type { Http } from "../src/collectors/types.js";
import { checkPhishingSite } from "../src/enrich/goplus.js";
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
    expect(await checkPhishingSite(fakeHttp(500, "oops"), "https://a.org")).toBeNull();
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
