import { describe, expect, it } from "vitest";
import { deriveStatus, pickEvidenceDate } from "../src/index.js";

const d = (s: string) => new Date(s);

describe("deriveStatus", () => {
  it("latest evidence wins", () => {
    expect(
      deriveStatus(
        [
          { status: "live", at: d("2026-10-01T00:00:00Z") },
          { status: "ended", at: d("2026-10-05T00:00:00Z") },
        ],
        "live",
      ),
    ).toEqual({ status: "ended", conflict: false });
  });

  it("does not depend on array order", () => {
    expect(
      deriveStatus(
        [
          { status: "ended", at: d("2026-10-05T00:00:00Z") },
          { status: "live", at: d("2026-10-01T00:00:00Z") },
        ],
        null,
      ),
    ).toEqual({ status: "ended", conflict: false });
  });

  it("flags conflict for different statuses on the latest UTC date", () => {
    expect(
      deriveStatus(
        [
          { status: "live", at: d("2026-10-05T01:00:00Z") },
          { status: "ended", at: d("2026-10-05T09:00:00Z") },
        ],
        null,
      ),
    ).toEqual({ status: "ended", conflict: true });
  });

  it("does not flag conflict when the differing status is on another UTC day", () => {
    expect(
      deriveStatus(
        [
          { status: "live", at: d("2026-10-05T23:59:59Z") },
          { status: "ended", at: d("2026-10-06T00:00:00Z") },
        ],
        null,
      ),
    ).toEqual({ status: "ended", conflict: false });
  });

  it("no conflict when same-day evidence agrees", () => {
    expect(
      deriveStatus(
        [
          { status: "live", at: d("2026-10-05T01:00:00Z") },
          { status: "live", at: d("2026-10-05T09:00:00Z") },
        ],
        null,
      ),
    ).toEqual({ status: "live", conflict: false });
  });

  it("ignores unknown evidence", () => {
    expect(
      deriveStatus(
        [
          { status: "live", at: d("2026-10-05T01:00:00Z") },
          { status: "unknown", at: d("2026-10-09T09:00:00Z") },
        ],
        null,
      ),
    ).toEqual({ status: "live", conflict: false });
  });

  it("keeps current when all evidence is unknown or empty", () => {
    expect(deriveStatus([{ status: "unknown", at: d("2026-10-05T00:00:00Z") }], "live")).toEqual({
      status: "live",
      conflict: false,
    });
    expect(deriveStatus([], "announced")).toEqual({ status: "announced", conflict: false });
  });

  it("falls back to unknown without current", () => {
    expect(deriveStatus([], null)).toEqual({ status: "unknown", conflict: false });
    expect(deriveStatus([{ status: "unknown", at: d("2026-10-05T00:00:00Z") }], null)).toEqual({
      status: "unknown",
      conflict: false,
    });
  });

  it("on identical timestamps the later array entry wins and conflicts", () => {
    const at = d("2026-10-05T00:00:00Z");
    expect(
      deriveStatus(
        [
          { status: "live", at },
          { status: "ended", at },
        ],
        null,
      ),
    ).toEqual({ status: "ended", conflict: true });
  });
});

describe("pickEvidenceDate", () => {
  const published = d("2026-10-01T00:00:00Z");
  const updated = d("2026-10-02T00:00:00Z");
  const fetched = d("2026-10-03T00:00:00Z");

  it("prefers publishedAt", () => {
    expect(pickEvidenceDate({ publishedAt: published, pageUpdatedAt: updated, fetchedAt: fetched })).toBe(published);
  });
  it("then pageUpdatedAt", () => {
    expect(pickEvidenceDate({ publishedAt: null, pageUpdatedAt: updated, fetchedAt: fetched })).toBe(updated);
  });
  it("then fetchedAt", () => {
    expect(pickEvidenceDate({ publishedAt: null, pageUpdatedAt: null, fetchedAt: fetched })).toBe(fetched);
  });
  it("treats Invalid Date as null", () => {
    expect(
      pickEvidenceDate({ publishedAt: new Date("nope"), pageUpdatedAt: updated, fetchedAt: fetched }),
    ).toBe(updated);
  });
});
