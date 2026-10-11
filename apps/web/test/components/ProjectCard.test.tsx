// @vitest-environment jsdom
// The /airdrops card (owner request 2026-10-11). Every assertion the curated list row had (Plan 6 Task 4, G5) is kept
// here against the card markup, plus the logo, its fallback tile, the unavatar.io credit and the single link.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectCard } from "@/components/ProjectCard";
import type { CuratedItem } from "@/lib/view";

afterEach(cleanup);

// 19:00 WIB on 10 October 2026.
const now = new Date("2026-10-10T12:00:00Z");
const ID = "5b3c1a2e-0000-4000-8000-0000000000aa";

function item(over: Partial<CuratedItem> = {}): CuratedItem {
  return {
    id: ID,
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
    logoSource: null,
    ...over,
  };
}

const card = () => screen.getByTestId("project-card");

describe("ProjectCard content (everything the list row had)", () => {
  it("shows a visitor the link, status, risk, key checks, check time, capital tag, signals and deadline, but no worth", () => {
    render(<ProjectCard item={item()} member={false} now={now} />);
    expect(screen.getByRole("link", { name: "Demo Protocol" }).getAttribute("href")).toBe("/projects/demo");
    expect(screen.getByRole("heading", { name: "Demo Protocol" })).toBeTruthy();
    expect(screen.getByTestId("status-badge").textContent).toBe("Status Live");
    expect(screen.getByTestId("risk-badge").textContent).toBe("Risiko Rendah");
    expect(screen.getByText("4/4 security check jalan")).toBeTruthy();
    expect(screen.getByText("Dicek hari ini")).toBeTruthy();
    expect(screen.getByText("Gratis").getAttribute("data-tone")).toBe("verified");
    expect(screen.getByText("VC: Paradigm ✓")).toBeTruthy();
    expect(screen.getByText("Snapshot 1 Nov 2026 (tanggal tepat)", { exact: false })).toBeTruthy();
    expect(screen.getByText("base")).toBeTruthy();
    expect(card().textContent).not.toMatch(/worth it|data belum cukup/i);
    expect(within(card()).getByText("Member only")).toBeTruthy();
  });

  it.each([
    ["high", "Sangat worth it"],
    ["medium", "Worth it"],
    ["low", "Kurang worth it"],
    ["insufficient_data", "Data belum cukup"],
  ] as const)("shows a member the worth level %s as %s", (level, text) => {
    render(<ProjectCard item={item({ worthLevel: level })} member={true} now={now} />);
    expect(screen.getByText(text).getAttribute("data-level")).toBe(level);
    expect(within(card()).queryByText("Member only")).toBeNull();
  });

  it("never shows a worth level to a visitor, even if the item carried one", () => {
    render(<ProjectCard item={item({ worthLevel: "high" })} member={false} now={now} />);
    expect(card().textContent).not.toMatch(/worth it/i);
  });

  it("shows how many of the 4 key checks ran", () => {
    render(<ProjectCard item={item({ keyChecksRan: 3 })} member={false} now={now} />);
    expect(screen.getByText("3/4 security check jalan")).toBeTruthy();
  });

  it("marks an open claim with every claim link official", () => {
    render(<ProjectCard item={item({ claimOpenChecked: true })} member={false} now={now} />);
    expect(screen.getByText("Claim open · link dicek").getAttribute("data-tone")).toBe("claimOpen");
  });

  it.each([
    ["deposit", 500, "Butuh $500+", "plain"],
    ["deposit", null, "Butuh $", "plain"],
    ["unknown", null, "Modal belum jelas", "reported"],
  ] as const)("tags capital %s (min %s) with its own label and tone", (capital, min, text, tone) => {
    render(<ProjectCard item={item({ capital, capitalMinUsd: min })} member={false} now={now} />);
    const tag = screen.getByText(text);
    expect(tag.getAttribute("data-tone")).toBe(tone);
    expect(tag.getAttribute("data-capital")).toBe(capital);
  });

  it("warns when the last check is over 48 hours old", () => {
    render(<ProjectCard item={item({ checkedAt: "2026-10-07T23:00:00Z" })} member={false} now={now} />);
    expect(screen.getByText("Belum dicek lagi sejak 8 Okt").getAttribute("data-tone")).toBe("warn");
  });

  it("in the ended tab shows Ended with the end date instead of the next deadline", () => {
    render(
      <ProjectCard
        item={item({ tab: "ended", status: "ended", endedOn: "2026-10-03", checkedAt: "2026-10-09T23:00:00Z" })}
        member={false}
        now={now}
      />,
    );
    expect(screen.getByTestId("status-badge").textContent).toBe("Status Ended");
    expect(screen.getByText("Ended 3 Okt 2026")).toBeTruthy();
    expect(card().textContent).not.toContain("Snapshot");
    expect(screen.getByText("Dicek hari ini")).toBeTruthy();
  });

  it("freezes the check time of a project that ended more than 90 days ago (ruling 6)", () => {
    render(
      <ProjectCard
        item={item({ tab: "ended", status: "ended", endedOn: "2025-01-15", checkedAt: "2025-04-01T23:00:00Z" })}
        member={false}
        now={now}
      />,
    );
    expect(screen.getByText("Ended 15 Jan 2025")).toBeTruthy();
    const checked = screen.getByText("Last check 2 Apr 2025");
    expect(checked.getAttribute("data-tone")).not.toBe("warn");
  });

  it("says when no chain and no deadline are known", () => {
    render(<ProjectCard item={item({ chains: [], nextDeadline: null })} member={false} now={now} />);
    expect(screen.getByText("Chain belum diketahui")).toBeTruthy();
    expect(screen.getByText("Belum ada deadline yang jelas")).toBeTruthy();
  });
});

describe("ProjectCard link", () => {
  it("is one link holding the whole card, with nothing interactive inside it", () => {
    render(<ProjectCard item={item({ claimOpenChecked: true, logoSource: "x_avatar" })} member={true} now={now} />);
    const links = within(card()).getAllByRole("link");
    expect(links).toHaveLength(1);
    const link = links[0]!;
    // Every piece of content is inside the link.
    for (const text of ["Demo Protocol", "4/4 security check jalan", "Dicek hari ini", "VC: Paradigm ✓", "Claim open · link dicek", "Logo: unavatar.io"]) {
      expect(link.contains(within(card()).getByText(text)), text).toBe(true);
    }
    expect(link.querySelector("a, button, input, select, textarea, [tabindex]")).toBeNull();
  });

  it("encodes the slug in the project URL", () => {
    render(<ProjectCard item={item({ slug: "a b/c" })} member={false} now={now} />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/projects/a%20b%2Fc");
  });
});

describe("ProjectCard logo", () => {
  it("shows a stored logo through our own route, with alt text, fixed size and lazy loading", () => {
    render(<ProjectCard item={item({ logoSource: "defillama" })} member={false} now={now} />);
    const img = screen.getByRole("img", { name: "Logo Demo Protocol" });
    expect(img.getAttribute("src")).toBe(`/logo/${ID}`);
    expect(img.getAttribute("width")).toBe("48");
    expect(img.getAttribute("height")).toBe("48");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(screen.queryByTestId("logo-fallback")).toBeNull();
  });

  it("shows the first letter on a tile, hidden from screen readers, when there is no logo", () => {
    render(<ProjectCard item={item({ name: "zkSync Era", slug: "zksync-era" })} member={false} now={now} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(card().querySelector("img")).toBeNull();
    const tile = screen.getByTestId("logo-fallback");
    expect(tile.textContent).toBe("Z");
    expect(tile.getAttribute("aria-hidden")).toBe("true");
    expect(tile.getAttribute("data-tone")).toMatch(/^(ink|ink-2|pass|ended|caution|accent)$/);
  });

  it("credits unavatar.io under an X avatar only", () => {
    render(<ProjectCard item={item({ logoSource: "x_avatar" })} member={false} now={now} />);
    expect(screen.getByTestId("logo-credit").textContent).toBe("Logo: unavatar.io");
    cleanup();
    for (const source of ["defillama", "favicon", null] as const) {
      render(<ProjectCard item={item({ logoSource: source })} member={false} now={now} />);
      expect(screen.queryByTestId("logo-credit"), String(source)).toBeNull();
      expect(card().textContent).not.toContain("unavatar");
      cleanup();
    }
  });
});
