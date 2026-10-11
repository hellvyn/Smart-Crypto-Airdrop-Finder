// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BriefingBox } from "@/components/BriefingBox";
import type { Briefing, GarapanDeadline } from "@/lib/briefing";
import type { ChangeFeed } from "@/lib/changes";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // jsdom always has it; the guard keeps the test honest about the try/catch.
  }
});

const NOW = new Date("2026-10-10T23:30:00Z");
const briefing: Briefing = {
  day: "2026-10-11",
  ai: true,
  items: [
    { projectId: "p-1", slug: "alpha", name: "Alpha", text: "Risiko Alpha naik jadi Tinggi, cek dulu." },
    { projectId: "p-2", slug: "beta", name: "Beta", text: "Claim Beta ditutup 12 Oktober 2026." },
  ],
};
const feed: ChangeFeed = {
  changes: [
    { kind: "status", project: { slug: "gamma", name: "Gamma" }, from: "announced", to: "live", at: "2026-10-10T23:00:00Z" },
  ],
  deadlines: [],
};
const garapan: GarapanDeadline[] = [{ slug: "delta", name: "Delta", kind: "claim", date: "2026-10-14", approximate: false }];

const box = () => screen.getByRole("region", { name: /^Briefing pagi/ });
const renderBox = (over: Partial<Parameters<typeof BriefingBox>[0]> = {}) =>
  render(<BriefingBox briefing={briefing} feed={feed} garapan={garapan} now={NOW} {...over} />);

describe("BriefingBox", () => {
  it("is headed Briefing pagi with the date of the briefing in id-ID", () => {
    renderBox();
    expect(within(box()).getByRole("heading", { name: "Briefing pagi · 11 Okt 2026" })).toBeTruthy();
  });

  it("shows the AI items, each linking to its project", () => {
    renderBox();
    const items = within(box()).getByRole("list", { name: "Poin briefing" });
    expect(within(items).getByRole("link", { name: "Alpha" }).getAttribute("href")).toBe("/projects/alpha");
    expect(within(items).getByRole("link", { name: "Beta" }).getAttribute("href")).toBe("/projects/beta");
    expect(items.textContent).toContain("Risiko Alpha naik jadi Tinggi, cek dulu.");
  });

  it("shows the watchlist changes and the nearest garapan deadlines", () => {
    renderBox();
    const changes = within(box()).getByRole("list", { name: "Perubahan di watchlist kamu" });
    expect(within(changes).getByRole("link", { name: "Gamma" }).getAttribute("href")).toBe("/projects/gamma");
    expect(changes.textContent).toContain("Status berubah: Diumumkan → Live");
    const deadlines = within(box()).getByRole("list", { name: "Deadline garapan terdekat" });
    expect(within(deadlines).getByRole("link", { name: "Delta" }).getAttribute("href")).toBe("/projects/delta");
    expect(deadlines.textContent).toContain("Claim 14 Okt 2026");
  });

  it("says an approximate garapan date is approximate", () => {
    renderBox({ garapan: [{ ...garapan[0]!, approximate: true }] });
    expect(within(box()).getByRole("list", { name: "Deadline garapan terdekat" }).textContent).toContain(
      "Claim sekitar 14 Okt 2026",
    );
  });

  it("uses the latest briefing with its own date when it is not today's", () => {
    renderBox({ briefing: { ...briefing, day: "2026-10-08" } });
    expect(within(box()).getByRole("heading", { name: "Briefing pagi · 8 Okt 2026" })).toBeTruthy();
  });

  it("hides the AI part, not the personal part, when there is no briefing at all", () => {
    renderBox({ briefing: null });
    expect(within(box()).getByRole("heading", { name: "Briefing pagi · 11 Okt 2026" })).toBeTruthy();
    expect(within(box()).queryByRole("list", { name: "Poin briefing" })).toBeNull();
    expect(within(box()).getByRole("list", { name: "Perubahan di watchlist kamu" })).toBeTruthy();
  });

  it("shows only the AI part when the member has no changes and no garapan deadline", () => {
    renderBox({ feed: { changes: [], deadlines: [] }, garapan: [] });
    expect(within(box()).getByRole("list", { name: "Poin briefing" })).toBeTruthy();
    expect(within(box()).queryByRole("list", { name: "Perubahan di watchlist kamu" })).toBeNull();
    expect(within(box()).queryByRole("list", { name: "Deadline garapan terdekat" })).toBeNull();
  });

  it("renders nothing when there is nothing to say", () => {
    const { container } = renderBox({ briefing: null, feed: { changes: [], deadlines: [] }, garapan: [] });
    expect(container.innerHTML).toBe("");
  });

  it("shows at most 3 changes and 3 garapan deadlines", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ slug: `g${i}`, name: `G${i}`, kind: "claim", date: "2026-10-14", approximate: false }));
    const changes = many.map((g) => ({ kind: "curated_in" as const, project: { slug: g.slug, name: g.name }, at: "2026-10-10T23:00:00Z" }));
    renderBox({ feed: { changes, deadlines: [] }, garapan: many });
    expect(within(box()).getByRole("list", { name: "Perubahan di watchlist kamu" }).querySelectorAll("li")).toHaveLength(3);
    expect(within(box()).getByRole("list", { name: "Deadline garapan terdekat" }).querySelectorAll("li")).toHaveLength(3);
  });

  describe("collapsing", () => {
    const toggle = () => within(box()).getByRole("button", { name: /briefing$/ });

    it("starts open and folds the body away with the button", () => {
      renderBox();
      expect(toggle().getAttribute("aria-expanded")).toBe("true");
      fireEvent.click(toggle());
      expect(toggle().getAttribute("aria-expanded")).toBe("false");
      expect(screen.getByRole("list", { name: "Poin briefing", hidden: true }).closest("[hidden]")).not.toBeNull();
      expect(within(box()).getByRole("heading", { name: /^Briefing pagi/ })).toBeTruthy();
    });

    it("stays collapsed after a reload", () => {
      const first = renderBox();
      fireEvent.click(toggle());
      first.unmount();
      renderBox();
      expect(toggle().getAttribute("aria-expanded")).toBe("false");
      expect(screen.getByRole("list", { name: "Poin briefing", hidden: true }).closest("[hidden]")).not.toBeNull();
    });

    it("opens again and remembers that too", () => {
      const first = renderBox();
      fireEvent.click(toggle());
      fireEvent.click(toggle());
      first.unmount();
      renderBox();
      expect(toggle().getAttribute("aria-expanded")).toBe("true");
    });

    it("works when the browser refuses storage", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      renderBox();
      expect(toggle().getAttribute("aria-expanded")).toBe("true");
      fireEvent.click(toggle());
      expect(toggle().getAttribute("aria-expanded")).toBe("false");
    });
  });
});
