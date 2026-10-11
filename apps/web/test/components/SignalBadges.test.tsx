// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SignalBadges } from "@/components/SignalBadges";
import type { CuratedSignal } from "@/lib/view";

afterEach(cleanup);

const signal = (kind: CuratedSignal["kind"], value: Record<string, unknown>, verified: boolean): CuratedSignal => ({
  kind,
  value,
  verified,
  source: "test",
  observedAt: "2026-10-10T23:00:00Z",
});

const badges = () => screen.queryAllByTestId("signal").map((el) => [el.textContent, el.getAttribute("data-tone")]);

describe("SignalBadges", () => {
  it("shows each kind of signal curation used, strongest first, with its tone", () => {
    render(
      <SignalBadges
        signals={[
          signal("curated_source", { source_kind: "telegram" }, false),
          signal("coingecko_listed", { gecko_id: "x" }, true),
          signal("tvl", { tvl_usd: 45_000_000 }, true),
          signal("reported_backer", { investor: "Sequoia", lead: false }, false),
          signal("reported_backer", { investor: "a16z", lead: true }, false),
          signal("vc_backer", { investor: "Paradigm", tier: 1 }, true),
          signal("curated_source", { source_kind: "airdrops_io" }, false),
        ]}
      />,
    );
    expect(badges()).toEqual([
      ["VC: Paradigm ✓", "verified"],
      ["Menurut AlphaDrops: a16z (lead), Sequoia", "reported"],
      ["TVL $45 jt", "plain"],
      ["Terdaftar di CoinGecko", "plain"],
      ["Sumber kurasi", "plain"],
    ]);
  });

  it("never marks a claimed or reported backer as verified, even when a row says verified", () => {
    const { container } = render(
      <SignalBadges
        signals={[
          signal("claimed_backer", { investor: "Binance Labs", quote: "backed by Binance Labs" }, true),
          signal("reported_backer", { investor: "Polychain", lead: true }, true),
        ]}
      />,
    );
    expect(container.textContent).not.toContain("✓");
    expect(container.textContent).not.toContain("VC:");
    expect(container.textContent).not.toContain("Binance Labs");
    expect(badges()).toEqual([["Menurut AlphaDrops: Polychain (lead)", "reported"]]);
  });

  it("names at most three reported backers, leads first", () => {
    render(
      <SignalBadges
        signals={["A", "B", "C", "D"].map((investor, i) => signal("reported_backer", { investor, lead: i === 3 }, false))}
      />,
    );
    expect(badges()).toEqual([["Menurut AlphaDrops: D (lead), A, B, …", "reported"]]);
  });

  it("names a reported backer once, as lead if any round says so, before the three-name budget", () => {
    render(
      <SignalBadges
        signals={[
          signal("reported_backer", { investor: "A", lead: false }, false),
          signal("reported_backer", { investor: "a", lead: true }, false),
          signal("reported_backer", { investor: "B", lead: false }, false),
          signal("reported_backer", { investor: "C", lead: false }, false),
        ]}
      />,
    );
    expect(badges()).toEqual([["Menurut AlphaDrops: A (lead), B, C", "reported"]]);
  });

  it("leaves out unverified VC, TVL and CoinGecko signals and values it cannot read", () => {
    const { container } = render(
      <SignalBadges
        signals={[
          signal("vc_backer", { investor: "Paradigm" }, false),
          signal("tvl", { tvl_usd: 45_000_000 }, false),
          signal("coingecko_listed", { gecko_id: "x" }, false),
          signal("tvl", { tvl_usd: "45M" }, true),
          signal("vc_backer", { tier: 1 }, true),
          signal("reported_backer", { investor: "  " }, false),
        ]}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders an investor name with markup as plain text", () => {
    const { container } = render(<SignalBadges signals={[signal("vc_backer", { investor: "<b>X</b>" }, true)]} />);
    expect(container.querySelector("b")).toBeNull();
    expect(badges()).toEqual([["VC: <b>X</b> ✓", "verified"]]);
  });
});
