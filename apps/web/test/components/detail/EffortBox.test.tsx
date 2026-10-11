// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EffortBox } from "@/components/detail/EffortBox";
import type { EvidenceRow } from "@/lib/view";
import { SOURCE_A, SOURCE_B, analyst } from "../../fixtures/project-detail";

afterEach(cleanup);

const fact = (field: string, value: string, sourceUrl = SOURCE_A): EvidenceRow => ({
  field,
  value,
  quote: "",
  sourceUrl,
  at: "2026-10-09T00:00:00Z",
});
const FACTS = [
  fact("source_rating:difficulty", "Easy"),
  fact("source_rating:cost", "Medium", SOURCE_B),
  fact("capital_required", "low"),
  fact("latest_update", "2026-10-01"),
];

describe("EffortBox", () => {
  it("is titled 05 · Estimasi effort and labelled Analisis AI", () => {
    render(<EffortBox member analyst={analyst()} facts={FACTS} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("05 · Estimasi effort");
    expect(screen.getByText("Analisis AI")).toBeTruthy();
  });

  it("shows a visitor Member only and nothing else", () => {
    const { container } = render(<EffortBox member={false} analyst={analyst()} facts={FACTS} />);
    expect(screen.getByText("Member only")).toBeTruthy();
    expect(container.textContent).not.toMatch(/menit|Easy|airdrops\.io|volume/);
  });

  it("shows a member the AI estimate next to what each source says", () => {
    render(<EffortBox member analyst={analyst()} facts={FACTS} />);
    expect(screen.getByText("±10")).toBeTruthy();
    expect(screen.getByText("menit / hari")).toBeTruthy();
    expect(screen.getByText("$100+")).toBeTruthy();
    expect(screen.getByText("modal awal")).toBeTruthy();
    expect(screen.getByText("Butuh volume trading tiap hari.")).toBeTruthy();
    expect(screen.getByText("airdrops.io: Easy")).toBeTruthy();
    expect(screen.getByText("t.me: Medium")).toBeTruthy();
    expect(screen.getByText("airdrops.io: modal kecil")).toBeTruthy();
  });

  it("says Belum jelas for an estimate the AI left empty", () => {
    render(
      <EffortBox member analyst={analyst({ effort: { minutes_per_day: null, capital_usd_min: 0, note: "" } })} facts={[]} />,
    );
    expect(screen.getByText("Belum jelas")).toBeTruthy();
    expect(screen.getByText("Gratis")).toBeTruthy();
  });

  it("still shows the sources' ratings to a member when there is no AI analysis", () => {
    render(<EffortBox member analyst={null} facts={FACTS} />);
    expect(screen.getByText("Analisis AI belum tersedia")).toBeTruthy();
    expect(screen.getByText("airdrops.io: Easy")).toBeTruthy();
  });
});
