// The one aggregation of the backers AlphaDrops reports (#41), shared by the list row badge and section 06 (G5 M2).
import { describe, expect, it } from "vitest";
import { reportedBackersText } from "@/lib/backers";
import type { CuratedSignal } from "@/lib/view";

const signal = (kind: CuratedSignal["kind"], value: Record<string, unknown>, verified = false): CuratedSignal => ({
  kind,
  value,
  verified,
  source: "alphadrops",
  observedAt: "2026-10-10T00:00:00Z",
});
const reported = (investor: unknown, lead?: boolean) =>
  signal("reported_backer", lead === undefined ? { investor } : { investor, lead });

describe("reportedBackersText", () => {
  it("is null when AlphaDrops reports no backer", () => {
    expect(reportedBackersText([])).toBeNull();
    expect(reportedBackersText([signal("vc_backer", { investor: "Paradigm" }, true), reported("  "), reported(42)])).toBeNull();
  });

  it("names each investor once, ignoring case and spaces, keeping the first spelling", () => {
    expect(reportedBackersText([reported("Delphi"), reported(" delphi "), reported("DELPHI")])).toBe("Menurut AlphaDrops: Delphi");
  });

  it("marks an investor lead when any of its signals says so, and puts leads first", () => {
    expect(reportedBackersText([reported("Delphi"), reported("a16z"), reported("A16Z", true)])).toBe(
      "Menurut AlphaDrops: a16z (lead), Delphi",
    );
  });

  it("names at most 3 investors and adds … for the rest", () => {
    const four = [reported("One"), reported("Two"), reported("Three"), reported("Four", true)];
    expect(reportedBackersText(four)).toBe("Menurut AlphaDrops: Four (lead), One, Two, …");
    expect(reportedBackersText(four.slice(0, 3))).toBe("Menurut AlphaDrops: One, Two, Three");
  });

  it("counts only reported_backer signals", () => {
    const signals = [signal("claimed_backer", { investor: "Claimed" }), signal("vc_backer", { investor: "Paradigm" }, true), reported("Delphi")];
    expect(reportedBackersText(signals)).toBe("Menurut AlphaDrops: Delphi");
  });
});
