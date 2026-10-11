// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LatestUpdate } from "@/components/detail/LatestUpdate";
import type { EvidenceRow } from "@/lib/view";
import { SOURCE_A, SOURCE_B } from "../../fixtures/project-detail";

afterEach(cleanup);

const update = (value: string, quote: string, sourceUrl: string, at = "2026-10-09T00:00:00Z"): EvidenceRow => ({
  field: "latest_update",
  value,
  quote,
  sourceUrl,
  at,
});

describe("LatestUpdate", () => {
  it("shows the newest update with its date and source", () => {
    render(
      <LatestUpdate
        facts={[
          update("2026-09-20", "Season 1 ended.", SOURCE_B),
          update("2026-10-01", "Season 2 points program udah mulai.", SOURCE_A),
          update("", "Something undated.", SOURCE_B, "2026-10-10T00:00:00Z"),
        ]}
        sourceUrls={[SOURCE_A, SOURCE_B]}
      />,
    );
    expect(screen.getByText("Update terbaru")).toBeTruthy();
    expect(screen.getByText("Season 2 points program udah mulai.")).toBeTruthy();
    expect(screen.getByText(/1 Okt 2026/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "source" }).getAttribute("href")).toBe(SOURCE_A);
    expect(screen.queryByText("Season 1 ended.")).toBeNull();
  });

  it("says so when no source mentions an update", () => {
    render(<LatestUpdate facts={[]} sourceUrls={[]} />);
    expect(screen.getByText("Belum ada update dari source.")).toBeTruthy();
  });

  it("renders the update text as text", () => {
    const { container } = render(<LatestUpdate facts={[update("", "<i>New</i>", SOURCE_A)]} sourceUrls={[SOURCE_A]} />);
    expect(container.querySelector("i")).toBeNull();
    expect(screen.getByText("<i>New</i>")).toBeTruthy();
  });
});
