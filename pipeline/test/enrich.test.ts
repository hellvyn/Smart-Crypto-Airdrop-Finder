import { describe, expect, it, vi } from "vitest";
import type { Http } from "../src/collectors/types.js";
import { checkPhishingSite } from "../src/enrich/goplus.js";
import { firstCertificateAgeDays } from "../src/enrich/crtsh.js";
import { pacedHttp } from "../src/enrich/paced.js";
import { RDAP_MIN_INTERVAL_MS, RDAP_RETRY_MS, rdapDomainAge } from "../src/enrich/rdap.js";
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

type Reply = { status: number; body: string; headers?: Record<string, string> };

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
    expect(sleep).toHaveBeenCalledWith(5000);
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

const RATE_LIMITED_BODY = json({ code: 4029, message: "too many requests", result: {} });

describe("checkPhishingSite rate limit sent as HTTP 200 with code 4029", () => {
  it("pauses once, retries once and uses the second answer", async () => {
    const calls: string[] = [];
    const http = sequenceHttp([{ status: 200, body: RATE_LIMITED_BODY }, { status: 200, body: PHISHING_OK }], calls);
    const sleep = vi.fn(async () => {});
    const onRateLimited = vi.fn();
    expect(await checkPhishingSite(http, "https://a.io", sleep, onRateLimited)).toBe(false);
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(5000);
    expect(onRateLimited).not.toHaveBeenCalled();
  });

  it("gives up with null after a second 4029, makes no third request and reports it as rate limited", async () => {
    const calls: string[] = [];
    const sleep = vi.fn(async () => {});
    const onRateLimited = vi.fn();
    const http = sequenceHttp([{ status: 200, body: RATE_LIMITED_BODY }], calls);
    expect(await checkPhishingSite(http, "https://a.io", sleep, onRateLimited)).toBeNull();
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(onRateLimited).toHaveBeenCalledTimes(1);
  });

  it("reports a second 429 as rate limited too", async () => {
    const onRateLimited = vi.fn();
    const http = sequenceHttp([{ status: 429, body: "" }]);
    expect(await checkPhishingSite(http, "https://a.io", noSleep, onRateLimited)).toBeNull();
    expect(onRateLimited).toHaveBeenCalledTimes(1);
  });

  it("does not call a 5xx that persists rate limited", async () => {
    const onRateLimited = vi.fn();
    const http = sequenceHttp([{ status: 503, body: "" }]);
    expect(await checkPhishingSite(http, "https://a.io", noSleep, onRateLimited)).toBeNull();
    expect(onRateLimited).not.toHaveBeenCalled();
  });

  it("leaves other non-1 codes as null without a retry or a rate-limit report", async () => {
    const calls: string[] = [];
    const sleep = vi.fn(async () => {});
    const onRateLimited = vi.fn();
    const http = sequenceHttp([{ status: 200, body: json({ code: 2, message: "err", result: {} }) }], calls);
    expect(await checkPhishingSite(http, "https://a.io", sleep, onRateLimited)).toBeNull();
    expect(calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(onRateLimited).not.toHaveBeenCalled();
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

describe("rdapDomainAge", () => {
  const now = new Date("2026-10-10T00:00:00Z");
  const rdap = (eventDate: string) =>
    json({ events: [{ eventAction: "last changed", eventDate: "2026-10-05T00:00:00Z" }, { eventAction: "registration", eventDate }] });
  const days = async (http: Http, domain = "example.org"): Promise<number | null> => (await rdapDomainAge(http, domain, now, noSleep)).days;

  it("returns whole days since registration", async () => {
    expect(await rdapDomainAge(fakeHttp(200, rdap("2026-10-01T00:00:00Z")), "example.org", now, noSleep)).toEqual({ outcome: "age", days: 9 });
  });

  it("floors partial days", async () => {
    expect(await days(fakeHttp(200, rdap("2026-10-01T12:00:00Z")))).toBe(8);
  });

  it("clamps a future registration date to 0", async () => {
    expect(await days(fakeHttp(200, rdap("2026-10-20T00:00:00Z")))).toBe(0);
  });

  it("lowercases and encodes the domain in the request", async () => {
    const calls: string[] = [];
    await days(fakeHttp(200, rdap("2026-10-01T00:00:00Z"), calls), "Example.ORG");
    expect(calls).toEqual(["https://rdap.org/domain/example.org"]);
  });

  it("reports a 404 as no RDAP service, without a retry", async () => {
    const calls: string[] = [];
    const sleep = vi.fn(async () => {});
    expect(await rdapDomainAge(fakeHttp(404, "not found", calls), "a.io", now, sleep)).toEqual({ outcome: "no_rdap", days: null });
    expect(calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("reports a 200 without a registration event as no date", async () => {
    const body = json({ events: [{ eventAction: "expiration", eventDate: "2030-01-01T00:00:00Z" }] });
    expect(await rdapDomainAge(fakeHttp(200, body), "example.org", now, noSleep)).toEqual({ outcome: "no_date", days: null });
  });

  it("reports an unparseable date, invalid JSON or bad shape on a 200 as no date", async () => {
    for (const body of [rdap("not-a-date"), "nope", json({ events: "x" }), json({})]) {
      expect(await rdapDomainAge(fakeHttp(200, body), "example.org", now, noSleep)).toEqual({ outcome: "no_date", days: null });
    }
  });

  it("reports a timeout as failed, without a retry", async () => {
    const calls: string[] = [];
    expect(await rdapDomainAge(fakeHttp(0, "", calls), "example.org", now, noSleep)).toEqual({ outcome: "failed", days: null });
    expect(calls).toHaveLength(1);
  });
});

describe("rdapDomainAge retry", () => {
  const now = new Date("2026-10-10T00:00:00Z");
  const OK: Reply = { status: 200, body: json({ events: [{ eventAction: "registration", eventDate: "2026-10-01T00:00:00Z" }] }) };

  it("retries once after a 429, waiting 3 s, and uses the age of the second answer", async () => {
    const calls: string[] = [];
    const sleep = vi.fn(async () => {});
    const http = sequenceHttp([{ status: 429, body: "" }, OK], calls);
    expect(await rdapDomainAge(http, "a.com", now, sleep)).toEqual({ outcome: "age", days: 9 });
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(RDAP_RETRY_MS);
    expect(RDAP_RETRY_MS).toBe(3000);
  });

  it("gives up as rate limited after a second 429 and makes no third request", async () => {
    const calls: string[] = [];
    const sleep = vi.fn(async () => {});
    const http = sequenceHttp([{ status: 429, body: "" }], calls);
    expect(await rdapDomainAge(http, "a.com", now, sleep)).toEqual({ outcome: "rate_limited", days: null });
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("waits the Retry-After of a 503 (2 s) before the retry", async () => {
    const calls: string[] = [];
    const sleep = vi.fn(async () => {});
    const http = sequenceHttp([{ status: 503, body: "", headers: { "retry-after": "2" } }, OK], calls);
    expect(await rdapDomainAge(http, "a.com", now, sleep)).toEqual({ outcome: "age", days: 9 });
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("caps a long Retry-After at 10 s", async () => {
    const sleep = vi.fn(async () => {});
    const http = sequenceHttp([{ status: 429, body: "", headers: { "retry-after": "120" } }, OK]);
    await rdapDomainAge(http, "a.com", now, sleep);
    expect(sleep).toHaveBeenCalledWith(10_000);
  });

  it("reads a Retry-After given as an HTTP date against the clock", async () => {
    const sleep = vi.fn(async () => {});
    const clock = (): number => Date.parse("2026-10-10T00:00:00Z");
    const http = sequenceHttp([{ status: 429, body: "", headers: { "retry-after": "Sat, 10 Oct 2026 00:00:04 GMT" } }, OK]);
    await rdapDomainAge(http, "a.com", now, sleep, clock);
    expect(sleep).toHaveBeenCalledWith(4000);
  });

  it("waits 3 s when Retry-After cannot be read", async () => {
    const sleep = vi.fn(async () => {});
    const http = sequenceHttp([{ status: 502, body: "", headers: { "retry-after": "soon" } }, OK]);
    await rdapDomainAge(http, "a.com", now, sleep);
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("reports a 5xx that persists as failed, not rate limited", async () => {
    const calls: string[] = [];
    const http = sequenceHttp([{ status: 503, body: "" }], calls);
    expect(await rdapDomainAge(http, "a.com", now, noSleep)).toEqual({ outcome: "failed", days: null });
    expect(calls).toHaveLength(2);
  });
});

describe("pacedHttp", () => {
  /** A fake clock that only the fake sleep moves. */
  function fakeTime() {
    let t = 1_000_000;
    return { clock: () => t, sleep: async (ms: number) => void (t += ms) };
  }

  it("leaves at least the interval between request starts, with no pause before the first", async () => {
    const { clock, sleep } = fakeTime();
    const starts: number[] = [];
    const base: Http = {
      async get() {
        starts.push(clock());
        return { status: 200, body: "" };
      },
      async resolveRedirect() {
        return null;
      },
    };
    const http = pacedHttp(base, RDAP_MIN_INTERVAL_MS, clock, sleep);
    const t0 = clock();
    for (let i = 0; i < 5; i++) await http.get(`https://rdap.org/domain/d${i}.com`);
    expect(starts[0]).toBe(t0);
    for (let i = 1; i < starts.length; i++) expect((starts[i] as number) - (starts[i - 1] as number)).toBeGreaterThanOrEqual(1000);
  });

  it("does not wait when the interval has already passed", async () => {
    const { clock, sleep } = fakeTime();
    const sleeps: number[] = [];
    const base = fakeHttp(200, "");
    const http = pacedHttp(base, 1000, clock, async (ms) => {
      sleeps.push(ms);
      await sleep(ms);
    });
    await http.get("https://x/1");
    await sleep(5000);
    await http.get("https://x/2");
    expect(sleeps).toEqual([]);
  });

  it("paces the retry of a rate-limited RDAP answer too", async () => {
    const { clock, sleep } = fakeTime();
    const starts: number[] = [];
    const base: Http = {
      async get() {
        starts.push(clock());
        return { status: 429, body: "", headers: { "retry-after": "0" } };
      },
      async resolveRedirect() {
        return null;
      },
    };
    const http = pacedHttp(base, RDAP_MIN_INTERVAL_MS, clock, sleep);
    await rdapDomainAge(http, "a.com", NOW, sleep, clock);
    expect(starts).toHaveLength(2);
    expect((starts[1] as number) - (starts[0] as number)).toBeGreaterThanOrEqual(1000);
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
