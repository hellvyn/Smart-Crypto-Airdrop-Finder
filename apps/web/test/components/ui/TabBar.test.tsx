// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TabBar } from "@/components/ui";

afterEach(cleanup);

const TABS = [
  { label: "Live sekarang", count: 12, href: "/airdrops?tab=live_now", active: true },
  { label: "Early", count: 3, href: "/airdrops?tab=early_bets", active: false },
  { label: "Ended", href: "/airdrops?tab=ended", active: false },
];

describe("TabBar", () => {
  it("marks only the active tab with aria-current=page", () => {
    render(<TabBar tabs={TABS} />);
    const current = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute("href")).toBe("/airdrops?tab=live_now");
  });

  it("links each tab to its href and shows the count only when given", () => {
    render(<TabBar tabs={TABS} />);
    expect(screen.getByRole("link", { name: "Early · 3" }).getAttribute("href")).toBe("/airdrops?tab=early_bets");
    expect(screen.getByRole("link", { name: "Ended" })).toBeTruthy();
  });
});
