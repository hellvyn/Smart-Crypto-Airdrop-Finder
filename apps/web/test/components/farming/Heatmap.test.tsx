// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { HeatmapCell } from "@saf/core";
import { afterEach, describe, expect, it } from "vitest";
import { Heatmap } from "@/components/farming/Heatmap";

afterEach(cleanup);

const cell = (day: string, level: HeatmapCell["level"], done: number, total: number, upcoming = false): HeatmapCell => ({
  day,
  level,
  done,
  total,
  upcoming,
});

// Tuesday 2026-10-06 to Monday 2026-10-12, today = Saturday 2026-10-10.
const WEEK: HeatmapCell[] = [
  cell("2026-10-06", 3, 2, 2),
  cell("2026-10-07", 2, 1, 2),
  cell("2026-10-08", null, 0, 0),
  cell("2026-10-09", 0, 0, 2),
  cell("2026-10-10", 1, 1, 3),
  cell("2026-10-11", null, 0, 3, true),
  cell("2026-10-12", null, 0, 3, true),
];

/** `count` consecutive days from `start`, all past and level 0. */
function days(start: string, count: number): HeatmapCell[] {
  const first = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => cell(new Date(first + i * 86_400_000).toISOString().slice(0, 10), 0, 0, 1));
}

const dayCells = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>("[data-day]")];
const monthLabels = (container: HTMLElement) =>
  [...container.querySelectorAll(".heat-week")].map((w) => w.querySelector(".heat-month")?.textContent ?? "");

describe("Heatmap", () => {
  it("renders one cell per day of the range, in day order, with the class of its level", () => {
    const { container } = render(<Heatmap cells={WEEK} label="Progres Demo" today="2026-10-10" />);
    const rendered = dayCells(container);
    expect(rendered.map((c) => c.dataset.day)).toEqual([
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
    ]);
    const levelClass = (el: HTMLElement) => [...el.classList].find((c) => c.startsWith("heat-level-"));
    expect(rendered.slice(0, 5).map(levelClass)).toEqual([
      "heat-level-3",
      "heat-level-2",
      "heat-level-none",
      "heat-level-0",
      "heat-level-1",
    ]);
  });

  it("draws days after today as upcoming cells with no level", () => {
    const { container } = render(<Heatmap cells={WEEK} label="Progres Demo" today="2026-10-10" />);
    const [, , , , todayCell, tomorrow, later] = dayCells(container);
    expect(todayCell!.classList.contains("heat-upcoming")).toBe(false);
    for (const el of [tomorrow!, later!]) {
      expect(el.classList.contains("heat-upcoming")).toBe(true);
      expect([...el.classList].some((c) => c.startsWith("heat-level-"))).toBe(false);
    }
  });

  it("gives every day a tooltip and an accessible name with the date and the daily tasks done", () => {
    render(<Heatmap cells={WEEK} label="Progres Demo" today="2026-10-10" />);
    const first = screen.getByRole("img", { name: "6 Okt 2026: 2/2 daily task" });
    expect(first.getAttribute("title")).toBe("6 Okt 2026: 2/2 daily task");
    expect(screen.getByRole("img", { name: "8 Okt 2026: 0/0 daily task" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "10 Okt 2026: 1/3 daily task" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "11 Okt 2026: belum lewat" }).getAttribute("title")).toBe("11 Okt 2026: belum lewat");
    expect(screen.getByRole("group", { name: "Progres Demo" })).toBeTruthy();
  });

  it("marks today's cell", () => {
    const { container } = render(<Heatmap cells={WEEK} label="Progres Demo" today="2026-10-10" />);
    const marked = dayCells(container).filter((c) => c.classList.contains("heat-today"));
    expect(marked.map((c) => c.dataset.day)).toEqual(["2026-10-10"]);
  });

  it("lays the days out in Monday-to-Sunday week columns, with hidden empty slots outside the range", () => {
    const { container } = render(<Heatmap cells={WEEK} label="Progres Demo" today="2026-10-10" />);
    const weeks = [...container.querySelectorAll(".heat-week")];
    expect(weeks).toHaveLength(2);
    const slots = (week: Element) =>
      [...week.querySelectorAll<HTMLElement>(".heat-cell, .heat-pad")].map((el) => el.dataset.day ?? "pad");
    expect(slots(weeks[0]!)).toEqual(["pad", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
    expect(slots(weeks[1]!)).toEqual(["2026-10-12", "pad", "pad", "pad", "pad", "pad", "pad"]);
    for (const pad of container.querySelectorAll(".heat-pad")) expect(pad.getAttribute("aria-hidden")).toBe("true");
  });

  it("labels a month above the first week that starts in it", () => {
    // Monday 2026-10-05 to Friday 2026-11-13: six weeks; the fifth (from Monday 2 Nov) is the first November week.
    const { container } = render(<Heatmap cells={days("2026-10-05", 40)} label="Progres" today="2026-11-13" />);
    expect(monthLabels(container)).toEqual(["Okt", "", "", "", "Nov", ""]);
  });

  it("drops a month label that would run into the next one", () => {
    // Friday 2026-10-30: the first column holds October's last days and November starts in the next column.
    const { container } = render(<Heatmap cells={days("2026-10-30", 21)} label="Progres" today="2026-11-19" />);
    expect(monthLabels(container)).toEqual(["", "Nov", "", ""]);
  });

  it("fits a full year (365 days) in 53 week columns", () => {
    for (const start of ["2026-10-05", "2026-10-11"]) {
      const { container, unmount } = render(<Heatmap cells={days(start, 365)} label="Progres" today={start} />);
      expect(dayCells(container)).toHaveLength(365);
      expect(container.querySelectorAll(".heat-week")).toHaveLength(53);
      unmount();
    }
  });
});
