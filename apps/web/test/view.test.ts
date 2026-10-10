import { describe, expect, it } from "vitest";
import {
  coverageLine,
  PAGE_SIZE,
  isStale,
  listQueryString,
  parseChain,
  parseFilters,
  rawChainParam,
  parsePage,
  pickLastSuccessfulRun,
  pickLatestRisk,
  pickNextDeadline,
  riskLabel,
  safeHttpUrl,
  statusLabel,
} from "../lib/view";

const NOW = new Date("2026-10-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

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

describe("paging helpers", () => {
  it("parses ?page= with 1-based fallback", () => {
    expect(PAGE_SIZE).toBe(50);
    expect(parsePage("3")).toBe(3);
    expect(parsePage(undefined)).toBe(1);
    for (const bad of ["0", "-2", "abc", "1.5", "", "2e3", "99999999999"]) expect(parsePage(bad)).toBe(1);
  });

  it("builds a query string that keeps the filters", () => {
    expect(listQueryString({}, 1)).toBe("");
    expect(listQueryString({ status: ["live", "ended"], risk: ["high"], chain: "base" }, 2)).toBe(
      "status=live&status=ended&risk=high&chain=base&page=2",
    );
    expect(listQueryString({ chain: "a b&c" }, 1)).toBe("chain=a+b%26c");
  });
});

describe("chain filter parsing", () => {
  it("accepts plain chain names, trimmed and lowercased", () => {
    expect(parseChain("base")).toBe("base");
    expect(parseChain("  BNB Chain ")).toBe("bnb chain");
    expect(parseChain("zk-sync.era_1")).toBe("zk-sync.era_1");
  });

  it("rejects anything that could break the array literal", () => {
    for (const bad of ["a,b", "a}", "{a", 'x"y', "back\\slash", "NULL", "null", "", "   ", "-x", "a".repeat(60), "a\nb", "é"]) {
      expect(parseChain(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(parseChain(undefined)).toBeNull();
  });

  it("parseFilters applies no chain filter for an invalid value, but rawChainParam still reports it", () => {
    expect(parseFilters({ chain: "a,b" }).chain).toBeUndefined();
    expect(rawChainParam({ chain: " A,B " })).toBe("a,b");
    expect(parseFilters({ chain: "Base" }).chain).toBe("base");
    expect(parseFilters({ chain: ["base", "x"] }).chain).toBe("base");
  });

  it("parseFilters drops unknown status and risk values", () => {
    expect(parseFilters({ status: ["live", "nope"], risk: ["high", "safe"] })).toEqual({
      status: ["live"],
      risk: ["high"],
      chain: undefined,
    });
  });
});
