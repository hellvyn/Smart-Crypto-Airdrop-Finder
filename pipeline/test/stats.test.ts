import { describe, expect, it } from "vitest";
import { emptyStats, runExitCode } from "../src/stats.js";

describe("runExitCode", () => {
  it("is 0 for a clean run, even with extraction failures or deferred documents", () => {
    expect(runExitCode({ ...emptyStats(), extract_failed: 3, extract_deferred: 7, docs_collected: 20 })).toBe(0);
  });

  it.each(["source_failed", "merge_failed", "signals_failed", "score_failed", "ingest_failed"] as const)("is 1 when %s > 0", (counter) => {
    expect(runExitCode({ ...emptyStats(), [counter]: 1 })).toBe(1);
  });

  it("is 1 when a stage failed", () => {
    expect(runExitCode({ ...emptyStats(), run_error: 1, failed_step: 5 })).toBe(1);
  });
});
