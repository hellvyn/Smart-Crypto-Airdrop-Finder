// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WhyListed } from "@/components/detail/WhyListed";
import type { CuratedSignal, EvidenceRow } from "@/lib/view";
import { SOURCE_A } from "../../fixtures/project-detail";

afterEach(cleanup);

const signal = (kind: CuratedSignal["kind"], value: Record<string, unknown>, verified: boolean, source = "test"): CuratedSignal => ({
  kind,
  value,
  verified,
  source,
  observedAt: "2026-10-09T23:00:00Z",
});
const claimFact = (investor: string, quote: string): EvidenceRow => ({
  field: "claimed_backer",
  value: investor,
  quote,
  sourceUrl: SOURCE_A,
  at: "2026-10-09T00:00:00Z",
});
const rows = () =>
  screen.getAllByTestId("why-row").map((r) => [r.querySelector("[data-part='text']")?.textContent, r.querySelector("[data-part='label']")?.textContent]);

describe("WhyListed", () => {
  it("is titled 06 · Kenapa lolos", () => {
    render(<WhyListed signals={[]} facts={[]} reasons={null} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("06 · Kenapa lolos");
  });

  it("labels each signal with its source, verified ones as Verified", () => {
    render(
      <WhyListed
        signals={[
          signal("curated_source", { source_kind: "airdrops_io" }, false, "airdrops_io"),
          signal("tvl", { tvl_usd: 45_000_000 }, true, "defillama"),
          signal("vc_backer", { investor: "Paradigm", tier: 1 }, true, "vc_portfolio"),
          signal("reported_backer", { investor: "a16z", lead: true }, false, "alphadrops"),
          signal("coingecko_listed", { gecko_id: "nebula" }, true, "defillama"),
        ]}
        facts={[]}
        reasons={null}
      />,
    );
    expect(rows()).toEqual([
      ["VC: Paradigm ✓", "Verified · portfolio VC"],
      ["Menurut AlphaDrops: a16z (lead)", "Laporan AlphaDrops, belum verified"],
      ["TVL $45 jt", "Verified · DefiLlama"],
      ["Terdaftar di CoinGecko", "Verified · CoinGecko"],
      ["Sumber kurasi", "airdrops.io"],
    ]);
  });

  it("writes Klaim project, belum verified for a claimed backer, once per investor, never with a check mark", () => {
    const { container } = render(
      <WhyListed
        signals={[signal("claimed_backer", { investor: "Jump", quote: "Backed by Jump" }, false, "llm_text")]}
        facts={[claimFact("jump", "Backed by Jump Crypto"), claimFact("Wintermute", "Wintermute is an investor")]}
        reasons={null}
      />,
    );
    expect(rows()).toEqual([
      ['"Backed by Jump"', "Klaim project, belum verified"],
      ['"Wintermute is an investor"', "Klaim project, belum verified"],
    ]);
    expect(container.textContent).not.toContain("✓");
  });

  it("leaves out an unverified VC signal", () => {
    render(<WhyListed signals={[signal("vc_backer", { investor: "Paradigm" }, false)]} facts={[]} reasons={null} />);
    expect(screen.queryByText(/Paradigm/)).toBeNull();
    expect(screen.getByText("Belum ada sinyal yang tercatat.")).toBeTruthy();
  });

  it("shows a member the notes of our assessment", () => {
    render(
      <WhyListed
        signals={[]}
        facts={[]}
        reasons={[{ code: "vc_tier1", kind: "worth", message: "Didukung VC tier 1 yang verified." }]}
      />,
    );
    expect(screen.getByText("Didukung VC tier 1 yang verified.")).toBeTruthy();
  });
});
