import { describe, expect, it } from "vitest";
import { expireStatus } from "../src/index.js";

// CZR, live from a 1 Oct page, evaluated on 2026-10-10 [FACT, run 2026-10-10].
const CZR = [
  { kind: "campaign_end", date: "2026-09-30", precision: "exact" },
  { kind: "tge", date: "2026-10-01", precision: "exact" },
  { kind: "claim", date: "2026-10-05", precision: "exact" },
  { kind: "other", date: "2026-10-11", precision: "exact" },
  { kind: "other", date: "2026-10-11", precision: "approximate" },
] as const;

describe("expireStatus", () => {
  it("expires CZR on 2026-10-10 (other deadlines do not hold it)", () => {
    expect(expireStatus("live", [...CZR], "2026-10-10")).toEqual({
      status: "ended",
      expired: true,
      basis: { kind: "claim", date: "2026-10-05" },
    });
  });

  it("is held by a future claim, snapshot, campaign_end or tge", () => {
    for (const kind of ["claim", "snapshot", "campaign_end", "tge"] as const)
      expect(expireStatus("live", [...CZR, { kind, date: "2026-10-12", precision: "exact" }], "2026-10-10").expired).toBe(
        false,
      );
  });

  it("is held by a deadline that falls on today", () => {
    const held = [...CZR, { kind: "claim", date: "2026-10-10", precision: "approximate" }] as const;
    expect(expireStatus("live", [...held], "2026-10-10").expired).toBe(false);
  });

  it("is not held by a future withdraw_funds deadline", () => {
    const deadlines = [
      { kind: "claim", date: "2026-10-05", precision: "exact" },
      { kind: "withdraw_funds", date: "2026-11-01", precision: "exact" },
    ] as const;
    expect(expireStatus("live", [...deadlines], "2026-10-10").expired).toBe(true);
  });

  it("ignores month/quarter precision and null dates", () => {
    expect(
      expireStatus(
        "live",
        [
          { kind: "claim", date: "2026-09-01", precision: "month" },
          { kind: "claim", date: "2026-07-01", precision: "quarter" },
          { kind: "claim", date: null, precision: "exact" },
        ],
        "2026-10-10",
      ),
    ).toEqual({ status: "live", expired: false, basis: null });
  });

  it("is not held by a future month-precision deadline", () => {
    expect(
      expireStatus(
        "live",
        [
          { kind: "claim", date: "2026-10-05", precision: "exact" },
          { kind: "claim", date: "2026-12-01", precision: "month" },
        ],
        "2026-10-10",
      ).expired,
    ).toBe(true);
  });

  it("does not expire on a past tge or snapshot alone", () => {
    expect(
      expireStatus(
        "live",
        [
          { kind: "tge", date: "2026-10-01", precision: "exact" },
          { kind: "snapshot", date: "2026-09-01", precision: "exact" },
        ],
        "2026-10-10",
      ),
    ).toEqual({ status: "live", expired: false, basis: null });
  });

  it("applies to announced and speculative as well", () => {
    for (const status of ["announced", "speculative"] as const)
      expect(expireStatus(status, [...CZR], "2026-10-10").status).toBe("ended");
  });

  it("only applies to live, announced and speculative", () => {
    for (const status of ["unknown", "ended"] as const)
      expect(expireStatus(status, [...CZR], "2026-10-10")).toEqual({ status, expired: false, basis: null });
  });

  it("reports the latest passed claim or campaign_end as the basis", () => {
    expect(
      expireStatus(
        "live",
        [
          { kind: "claim", date: "2026-10-01", precision: "exact" },
          { kind: "campaign_end", date: "2026-10-08", precision: "approximate" },
        ],
        "2026-10-10",
      ).basis,
    ).toEqual({ kind: "campaign_end", date: "2026-10-08" });
  });
});
