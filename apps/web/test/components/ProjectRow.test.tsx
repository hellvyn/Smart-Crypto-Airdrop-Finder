// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectRow } from "@/components/ProjectRow";
import type { ProjectListItem } from "@/lib/view";

afterEach(cleanup);

function plain(): ProjectListItem {
  return {
    slug: "demo",
    name: "Demo Protocol",
    status: "live",
    riskLevel: "low",
    chains: ["base"],
    nextDeadline: { date: "2026-11-01", kind: "snapshot", precision: "exact" },
    lastSeen: "2026-10-10T00:00:00Z",
  };
}

// The curated list moved to cards (ProjectCard, test/components/ProjectCard.test.tsx); the watchlist keeps the row.
describe("ProjectRow (watchlist label)", () => {
  it("labels a watched project that did not pass with the banner wording and its reason", () => {
    render(<ProjectRow item={plain()} notCuratedReason="Risiko tinggi" />);
    expect(screen.getByTestId("not-curated").textContent).toBe("Gak masuk list: Risiko tinggi");
  });

  it("has no label without a reason (the project passed)", () => {
    render(<ProjectRow item={plain()} notCuratedReason={null} />);
    expect(screen.queryByTestId("not-curated")).toBeNull();
    cleanup();
    render(<ProjectRow item={plain()} />);
    expect(screen.queryByTestId("not-curated")).toBeNull();
  });
});
