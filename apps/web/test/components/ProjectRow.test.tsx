// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectRow } from "@/components/ProjectRow";
import type { CuratedItem } from "@/lib/view";

afterEach(cleanup);

// 19:00 WIB on 10 October 2026.
const now = new Date("2026-10-10T12:00:00Z");

function item(over: Partial<CuratedItem> = {}): CuratedItem {
  return {
    slug: "demo",
    name: "Demo Protocol",
    status: "live",
    riskLevel: "low",
    chains: ["base"],
    nextDeadline: { date: "2026-11-01", kind: "snapshot", precision: "exact" },
    lastSeen: "2026-10-10T00:00:00Z",
    tab: "live_now",
    endedOn: null,
    checkedAt: "2026-10-09T23:00:00Z",
    signals: [{ kind: "vc_backer", value: { investor: "Paradigm" }, verified: true, source: "vc_portfolio", observedAt: "2026-10-09T23:00:00Z" }],
    claimOpenChecked: false,
    capital: "free",
    capitalMinUsd: null,
    keyChecksRan: 4,
    worthLevel: null,
    ...over,
  };
}

const row = () => screen.getByTestId("project-row");

describe("ProjectRow (curated list)", () => {
  it("shows a visitor the link, status, risk, key checks, check time, capital tag, signals and deadline, but no worth", () => {
    render(<ProjectRow item={item()} member={false} now={now} />);
    expect(screen.getByRole("link", { name: "Demo Protocol" }).getAttribute("href")).toBe("/projects/demo");
    expect(screen.getByTestId("status-badge").textContent).toBe("Status Live");
    expect(screen.getByTestId("risk-badge").textContent).toBe("Risiko Rendah");
    expect(screen.getByText("4/4 security check jalan")).toBeTruthy();
    expect(screen.getByText("Dicek hari ini")).toBeTruthy();
    expect(screen.getByText("Gratis").getAttribute("data-tone")).toBe("verified");
    expect(screen.getByText("VC: Paradigm ✓")).toBeTruthy();
    expect(screen.getByText("Snapshot 1 Nov 2026 (tanggal tepat)", { exact: false })).toBeTruthy();
    expect(row().textContent).not.toMatch(/worth it|data belum cukup/i);
    expect(within(row()).getByText("Member only")).toBeTruthy();
  });

  it.each([
    ["high", "Sangat worth it"],
    ["medium", "Worth it"],
    ["low", "Kurang worth it"],
    ["insufficient_data", "Data belum cukup"],
  ] as const)("shows a member the worth level %s as %s", (level, text) => {
    render(<ProjectRow item={item({ worthLevel: level })} member={true} now={now} />);
    expect(screen.getByText(text).getAttribute("data-level")).toBe(level);
    expect(within(row()).queryByText("Member only")).toBeNull();
  });

  it("never shows a worth level to a visitor, even if the item carried one", () => {
    render(<ProjectRow item={item({ worthLevel: "high" })} member={false} now={now} />);
    expect(row().textContent).not.toMatch(/worth it/i);
  });

  it("shows how many of the 4 key checks ran", () => {
    render(<ProjectRow item={item({ keyChecksRan: 3 })} member={false} now={now} />);
    expect(screen.getByText("3/4 security check jalan")).toBeTruthy();
  });

  it("marks an open claim with every claim link official", () => {
    render(<ProjectRow item={item({ claimOpenChecked: true })} member={false} now={now} />);
    expect(screen.getByText("Claim open · link dicek").getAttribute("data-tone")).toBe("claimOpen");
  });

  it.each([
    ["deposit", 500, "Butuh $500+", "plain"],
    ["deposit", null, "Butuh $", "plain"],
    ["unknown", null, "Modal belum jelas", "reported"],
  ] as const)("tags capital %s (min %s) with its own label and tone", (capital, min, text, tone) => {
    render(<ProjectRow item={item({ capital, capitalMinUsd: min })} member={false} now={now} />);
    const tag = screen.getByText(text);
    expect(tag.getAttribute("data-tone")).toBe(tone);
    expect(tag.getAttribute("data-capital")).toBe(capital);
  });

  it("warns when the last check is over 48 hours old", () => {
    render(<ProjectRow item={item({ checkedAt: "2026-10-07T23:00:00Z" })} member={false} now={now} />);
    expect(screen.getByText("Belum dicek lagi sejak 8 Okt").getAttribute("data-tone")).toBe("warn");
  });

  it("in the ended tab shows Ended with the end date instead of the next deadline", () => {
    render(
      <ProjectRow
        item={item({ tab: "ended", status: "ended", endedOn: "2026-10-03", checkedAt: "2026-10-09T23:00:00Z" })}
        member={false}
        now={now}
      />,
    );
    expect(screen.getByTestId("status-badge").textContent).toBe("Status Ended");
    expect(screen.getByText("Ended 3 Okt 2026")).toBeTruthy();
    expect(row().textContent).not.toContain("Snapshot");
    expect(screen.getByText("Dicek hari ini")).toBeTruthy();
  });

  it("freezes the check time of a project that ended more than 90 days ago (ruling 6)", () => {
    render(
      <ProjectRow
        item={item({ tab: "ended", status: "ended", endedOn: "2025-01-15", checkedAt: "2025-04-01T23:00:00Z" })}
        member={false}
        now={now}
      />,
    );
    expect(screen.getByText("Ended 15 Jan 2025")).toBeTruthy();
    const checked = screen.getByText("Last check 2 Apr 2025");
    expect(checked.getAttribute("data-tone")).not.toBe("warn");
  });
});

describe("ProjectRow (watchlist label)", () => {
  const plain = () => {
    const { tab: _tab, endedOn: _e, checkedAt: _c, signals: _s, claimOpenChecked: _o, capital: _p, capitalMinUsd: _m, keyChecksRan: _k, worthLevel: _w, ...rest } = item();
    return rest;
  };

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
