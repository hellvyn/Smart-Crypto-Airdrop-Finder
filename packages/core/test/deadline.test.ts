import { describe, expect, it } from "vitest";
import { normalizeDeadline } from "../src/index.js";
import type { ExtractedDeadline } from "../src/index.js";

const base: ExtractedDeadline = { kind: "claim", date: "2026-10-10", precision: "exact", text: "Oct 10" };

describe("normalizeDeadline year rule", () => {
  it("rolls Jan 3 forward to next year when published late December", () => {
    const d = { ...base, date: "2026-01-03", text: "Jan 3" };
    expect(normalizeDeadline(d, new Date("2026-12-28")).date).toBe("2027-01-03");
  });

  it("leaves a date within 7 days before publication unchanged", () => {
    const d = { ...base, date: "2026-10-10", text: "Oct 10" };
    expect(normalizeDeadline(d, new Date("2026-10-09")).date).toBe("2026-10-10");
    const d2 = { ...base, date: "2026-10-02", text: "Oct 2" };
    expect(normalizeDeadline(d2, new Date("2026-10-09")).date).toBe("2026-10-02");
  });

  it("rolls forward a date more than 7 days before publication", () => {
    const d = { ...base, date: "2026-10-01", text: "Oct 1" };
    expect(normalizeDeadline(d, new Date("2026-10-09")).date).toBe("2027-10-01");
  });

  it("pulls a too-late year back to the earliest valid year", () => {
    const d = { ...base, date: "2030-03-05", text: "Mar 5" };
    expect(normalizeDeadline(d, new Date("2026-10-09")).date).toBe("2027-03-05");
  });

  it("treats a 4-digit time like 2300 UTC as no year", () => {
    const d = { ...base, date: "2026-01-03", text: "Jan 3, 2300 UTC" };
    expect(normalizeDeadline(d, new Date("2026-12-28")).date).toBe("2027-01-03");
  });

  it("never shifts the year when the text has a 4-digit year", () => {
    const d = { ...base, date: "2026-12-15", text: "Dec 15, 2026" };
    expect(normalizeDeadline(d, new Date("2027-06-01")).date).toBe("2026-12-15");
  });

  it("does nothing without publishedAt", () => {
    const d = { ...base, date: "2026-01-03", text: "Jan 3" };
    expect(normalizeDeadline(d, null).date).toBe("2026-01-03");
  });

  it("handles Feb 29 by moving to the next leap year", () => {
    const d = { ...base, date: "2024-02-29", text: "Feb 29" };
    expect(normalizeDeadline(d, new Date("2026-10-09")).date).toBe("2028-02-29");
  });

  it("compares by UTC calendar date", () => {
    const d = { ...base, date: "2026-10-02", text: "Oct 2" };
    // 2026-10-09T23:30Z minus 7 days is Oct 2 in UTC, so Oct 2 stays.
    expect(normalizeDeadline(d, new Date("2026-10-09T23:30:00Z")).date).toBe("2026-10-02");
    // 2026-10-10T00:30Z minus 7 days is Oct 3 in UTC, so Oct 2 rolls over.
    expect(normalizeDeadline(d, new Date("2026-10-10T00:30:00Z")).date).toBe("2027-10-02");
  });
});

describe("normalizeDeadline approximate rule", () => {
  it("forces approximate precision for hedging words", () => {
    for (const text of ["approximately Oct 11", "approx. Oct 11", "around Oct 11", "about Oct 11", "~Oct 11"]) {
      const d = { ...base, date: "2026-10-11", precision: "exact" as const, text };
      expect(normalizeDeadline(d, new Date("2026-10-09")).precision, text).toBe("approximate");
    }
  });

  it("does not touch precision for plain text", () => {
    const d = { ...base, date: "2026-10-11", text: "Oct 11" };
    expect(normalizeDeadline(d, new Date("2026-10-09")).precision).toBe("exact");
  });

  it("applies the approximate rule when date is null", () => {
    const d: ExtractedDeadline = { kind: "tge", date: null, precision: "exact", text: "around Q4" };
    expect(normalizeDeadline(d, new Date("2026-10-09"))).toEqual({ ...d, precision: "approximate" });
  });

  it("never downgrades month or quarter precision to approximate", () => {
    const month: ExtractedDeadline = { kind: "tge", date: "2026-11-01", precision: "month", text: "around November 2026" };
    expect(normalizeDeadline(month, new Date("2026-10-09")).precision).toBe("month");
    const quarter: ExtractedDeadline = { kind: "tge", date: "2026-10-01", precision: "quarter", text: "around Q4 2026" };
    expect(normalizeDeadline(quarter, new Date("2026-10-09")).precision).toBe("quarter");
  });

  it("keeps approximate precision as it is", () => {
    const d: ExtractedDeadline = { kind: "claim", date: "2026-10-20", precision: "approximate", text: "around Oct 20" };
    expect(normalizeDeadline(d, new Date("2026-10-09")).precision).toBe("approximate");
  });
});

describe("normalizeDeadline purity", () => {
  it("returns a new object and never mutates the input", () => {
    const d = { ...base, date: "2026-01-03", text: "approximately Jan 3" };
    const copy = { ...d };
    const out = normalizeDeadline(d, new Date("2026-12-28"));
    expect(d).toEqual(copy);
    expect(out).not.toBe(d);
    expect(out.date).toBe("2027-01-03");
    expect(out.precision).toBe("approximate");
  });

  it("returns a new object even when nothing changes", () => {
    const out = normalizeDeadline(base, null);
    expect(out).toEqual(base);
    expect(out).not.toBe(base);
  });
});
