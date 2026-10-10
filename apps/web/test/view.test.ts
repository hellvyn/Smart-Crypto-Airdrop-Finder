import { describe, expect, it } from "vitest";
import {
  coverageLine,
  isStale,
  pickLastSuccessfulRun,
  pickLatestRisk,
  pickNextDeadline,
  riskLabel,
  safeHttpUrl,
  sortProjects,
  statusLabel,
  type ProjectListItem,
} from "../lib/view";

const NOW = new Date("2026-10-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

function item(over: Partial<ProjectListItem> & { slug: string }): ProjectListItem {
  return {
    name: over.slug,
    status: "live",
    riskLevel: null,
    chains: [],
    nextDeadline: null,
    lastSeen: "2026-10-01T00:00:00Z",
    ...over,
  };
}

describe("isStale", () => {
  it("is stale beyond 36 hours", () => expect(isStale(hoursAgo(37), NOW)).toBe(true));
  it("is fresh within 36 hours", () => expect(isStale(hoursAgo(35), NOW)).toBe(false));
  it("is stale when there has been no successful run", () => expect(isStale(null, NOW)).toBe(true));
});

describe("labels", () => {
  it("shows unknown status as Unconfirmed", () => expect(statusLabel("unknown")).toBe("Unconfirmed"));
  it("labels the other statuses", () => {
    expect(statusLabel("live")).toBe("Live");
    expect(statusLabel("announced")).toBe("Announced");
    expect(statusLabel("speculative")).toBe("Speculative");
    expect(statusLabel("ended")).toBe("Ended");
  });
  it("labels risk levels without numbers", () => {
    expect(riskLabel(null)).toBe("Not assessed");
    expect(riskLabel("insufficient_data")).toBe("Insufficient data");
    expect(riskLabel("low")).toBe("Low");
    expect(riskLabel("medium")).toBe("Medium");
    expect(riskLabel("high")).toBe("High");
    expect(riskLabel("critical")).toBe("Critical");
  });
  it("never produces a SAFE label", () => {
    for (const l of [null, "low", "medium", "high", "critical", "insufficient_data"] as const) {
      expect(riskLabel(l)).not.toMatch(/safe/i);
    }
  });
});

describe("sortProjects", () => {
  it("puts the nearer exact deadline first", () => {
    const sorted = sortProjects([
      item({ slug: "later", nextDeadline: { date: "2026-12-01", kind: "claim", precision: "exact" } }),
      item({ slug: "sooner", nextDeadline: { date: "2026-10-20", kind: "claim", precision: "approximate" } }),
    ]);
    expect(sorted.map((p) => p.slug)).toEqual(["sooner", "later"]);
  });

  it("treats a quarter deadline as no deadline", () => {
    const sorted = sortProjects([
      item({
        slug: "quarter",
        lastSeen: "2026-10-09T00:00:00Z",
        nextDeadline: { date: "2026-10-11", kind: "tge", precision: "quarter" },
      }),
      item({ slug: "exact", nextDeadline: { date: "2027-01-01", kind: "claim", precision: "exact" } }),
    ]);
    expect(sorted.map((p) => p.slug)).toEqual(["exact", "quarter"]);
  });

  it("breaks ties by newest lastSeen", () => {
    const sorted = sortProjects([
      item({ slug: "old", lastSeen: "2026-10-01T00:00:00Z" }),
      item({ slug: "new", lastSeen: "2026-10-09T00:00:00Z" }),
      item({
        slug: "same-day-old",
        lastSeen: "2026-10-02T00:00:00Z",
        nextDeadline: { date: "2026-11-01", kind: "claim", precision: "exact" },
      }),
      item({
        slug: "same-day-new",
        lastSeen: "2026-10-08T00:00:00Z",
        nextDeadline: { date: "2026-11-01", kind: "snapshot", precision: "approximate" },
      }),
    ]);
    expect(sorted.map((p) => p.slug)).toEqual(["same-day-new", "same-day-old", "new", "old"]);
  });

  it("does not mutate its input", () => {
    const input = [item({ slug: "a" }), item({ slug: "b", lastSeen: "2026-10-09T00:00:00Z" })];
    sortProjects(input);
    expect(input.map((p) => p.slug)).toEqual(["a", "b"]);
  });
});

describe("safeHttpUrl", () => {
  it("accepts http and https only", () => {
    expect(safeHttpUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHttpUrl("http://example.com")).toBe("http://example.com/");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,<b>x</b>")).toBeNull();
    expect(safeHttpUrl("ftp://example.com")).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
  });
});

describe("pickLatestRisk", () => {
  it("takes the greatest computedAt, ties by seq", () => {
    const rows = [
      { id: "a", computedAt: "2026-10-09T00:00:00Z", seq: 9 },
      { id: "b", computedAt: "2026-10-10T00:00:00Z", seq: 1 },
      { id: "c", computedAt: "2026-10-10T00:00:00Z", seq: 2 },
    ];
    expect(pickLatestRisk(rows)?.id).toBe("c");
    expect(pickLatestRisk([])).toBeNull();
  });
});

describe("pickNextDeadline", () => {
  const rows = [
    { date: "2026-10-01", kind: "claim", precision: "exact" }, // past
    { date: "2026-10-10", kind: "snapshot", precision: "exact" }, // today counts
    { date: "2026-10-12", kind: "claim", precision: "month" }, // not firm
    { date: null, kind: "tge", precision: "approximate" }, // no date
    { date: "2026-10-11", kind: "claim", precision: "approximate" },
  ];
  it("picks the earliest firm deadline on or after today", () => {
    expect(pickNextDeadline(rows, "2026-10-10")).toEqual({ date: "2026-10-10", kind: "snapshot", precision: "exact" });
    expect(pickNextDeadline(rows, "2026-10-11")?.kind).toBe("claim");
  });
  it("returns null when nothing qualifies", () => {
    expect(pickNextDeadline(rows, "2027-01-01")).toBeNull();
  });
});

describe("pickLastSuccessfulRun", () => {
  it("ignores unfinished runs and runs with run_error", () => {
    const d = pickLastSuccessfulRun([
      { finishedAt: null, stats: {} },
      { finishedAt: "2026-10-10T05:00:00Z", stats: { run_error: "boom" } },
      { finishedAt: "2026-10-09T05:00:00Z", stats: { docs: 3 } },
      { finishedAt: "2026-10-08T05:00:00Z", stats: {} },
    ]);
    expect(d?.toISOString()).toBe("2026-10-09T05:00:00.000Z");
    expect(pickLastSuccessfulRun([])).toBeNull();
  });
});

describe("coverageLine", () => {
  it("counts ran checks and names the unavailable ones", () => {
    const ids = ["dangerous_asks","phishing_list","domain_age","lookalike","token_security","contract_verified","hack_history","corroboration"] as const;
    const line = coverageLine(ids.map((id, i) => ({ id, ran: i !== 2 })));
    expect(line).toBe("7/8 checks ran; domain age unavailable");
  });
});
