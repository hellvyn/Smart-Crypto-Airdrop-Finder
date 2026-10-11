import { describe, expect, it } from "vitest";
import { trackRecord } from "../src/index.js";
import type { TrackRecordProject } from "../src/index.js";

const ended = (overrides: Partial<TrackRecordProject> = {}): TrackRecordProject => ({
  firstPassAt: "2026-06-01T03:00:00.000Z",
  listedAtFirstPass: false,
  tab: "ended",
  coingeckoListed: false,
  riskRaisedAfterPass: false,
  ...overrides,
});
const live = (overrides: Partial<TrackRecordProject> = {}): TrackRecordProject => ended({ tab: "live_now", ...overrides });

describe("trackRecord (curation spec §15.3, #43)", () => {
  it("counts only projects that passed before their token traded and have ended", () => {
    expect(
      trackRecord([
        ended({ listedAtFirstPass: false, coingeckoListed: true }),
        ended({ listedAtFirstPass: true, coingeckoListed: true }),
        live({ listedAtFirstPass: false }),
      ]),
    ).toEqual({ total: 1, listed: 1, noToken: 0, riskRaised: 0 });
  });

  it("splits the population into listed now and ended without a traded token", () => {
    expect(
      trackRecord([ended({ coingeckoListed: true }), ended(), ended(), ended({ coingeckoListed: true }), ended()]),
    ).toEqual({ total: 5, listed: 2, noToken: 3, riskRaised: 0 });
  });

  it("counts the projects of the population that turned high or critical risk after their first pass", () => {
    expect(
      trackRecord([
        ended({ riskRaisedAfterPass: true }),
        ended({ riskRaisedAfterPass: true, coingeckoListed: true }),
        ended(),
        // Back in the list after the raise: in the population, but not ended, so not "no token".
        live({ riskRaisedAfterPass: true }),
        // Outside the population (its token already traded at the first pass): the raise does not count.
        ended({ listedAtFirstPass: true, riskRaisedAfterPass: true }),
      ]),
    ).toEqual({ total: 4, listed: 1, noToken: 2, riskRaised: 3 });
  });

  it("counts a project that passed, then turned high or critical risk and is still out of the list", () => {
    expect(
      trackRecord([
        // Passed, turned high risk, latest curation failed (open or ended): in the population, never "no token".
        ended({ tab: null, riskRaisedAfterPass: true }),
        ended({ tab: null, riskRaisedAfterPass: true, coingeckoListed: true }),
        ended(),
      ]),
    ).toEqual({ total: 3, listed: 1, noToken: 1, riskRaised: 2 });
  });

  it("leaves out a project that turned risky but whose listing at first pass is unknown or already traded", () => {
    expect(
      trackRecord([
        ended({ tab: null, riskRaisedAfterPass: true, listedAtFirstPass: null }),
        ended({ tab: null, riskRaisedAfterPass: true, listedAtFirstPass: true }),
        ended({ tab: null, riskRaisedAfterPass: true, firstPassAt: null }),
      ]),
    ).toEqual({ total: 0, listed: 0, noToken: 0, riskRaised: 0 });
  });

  it("leaves out projects that never passed, are not in the ended tab now, or whose listing at first pass is unknown", () => {
    expect(
      trackRecord([
        ended({ firstPassAt: null }),
        ended({ tab: null }),
        ended({ tab: "early_bets" }),
        ended({ listedAtFirstPass: null }),
      ]),
    ).toEqual({ total: 0, listed: 0, noToken: 0, riskRaised: 0 });
  });

  it("is all zeros for no projects", () => {
    expect(trackRecord([])).toEqual({ total: 0, listed: 0, noToken: 0, riskRaised: 0 });
  });
});
