import { describe, expect, it } from "vitest";
import {
  buildHeatmap,
  daysLeft,
  heatmapRange,
  localDay,
  mainProgress,
  streak,
  weeklyDone,
  type TrackerTask,
} from "../src/index.js";

const daily = (id: string, createdDay: string): TrackerTask => ({ id, cadence: "daily", createdDay, archivedDay: null });
const weekly = (id: string, createdDay: string): TrackerTask => ({ id, cadence: "weekly", createdDay, archivedDay: null });
const once = (id: string, createdDay: string): TrackerTask => ({ id, cadence: "once", createdDay, archivedDay: null });
const at = <T extends { day: string }>(cells: T[], day: string): T | undefined => cells.find((c) => c.day === day);

describe("buildHeatmap", () => {
  it("grades a day by the share of active daily tasks checked", () => {
    const tasks = [daily("a", "2026-10-01"), daily("b", "2026-10-01"), daily("c", "2026-10-01")];
    const heat = buildHeatmap(
      tasks,
      [
        { taskId: "a", day: "2026-10-09" },
        { taskId: "b", day: "2026-10-09" },
        { taskId: "c", day: "2026-10-09" },
        { taskId: "a", day: "2026-10-10" },
      ],
      { start: "2026-09-28", end: "2026-10-20" },
      "2026-10-10",
    );
    expect(at(heat, "2026-10-09")).toMatchObject({ level: 3, done: 3, total: 3 });
    expect(at(heat, "2026-10-10")).toMatchObject({ level: 1, done: 1, total: 3 });
    expect(at(heat, "2026-09-30")).toMatchObject({ level: null, total: 0 }); // before any task existed
    expect(at(heat, "2026-10-15")).toMatchObject({ upcoming: true, level: null });
    expect(heat.at(-1)!.day).toBe("2026-10-20");
    expect(heat).toHaveLength(23);
  });

  it("maps the share to level 0, 1, 2 and 3 at the 0, 49, 50 and 100 percent edges", () => {
    const two = [daily("a", "2026-10-01"), daily("b", "2026-10-01")];
    const checks = [{ taskId: "a", day: "2026-10-02" }, { taskId: "a", day: "2026-10-03" }, { taskId: "b", day: "2026-10-03" }];
    const range = { start: "2026-10-01", end: "2026-10-03" };
    const heat = buildHeatmap(two, checks, range, "2026-10-03");
    expect(at(heat, "2026-10-01")).toMatchObject({ level: 0, done: 0, total: 2 });
    expect(at(heat, "2026-10-02")).toMatchObject({ level: 2, done: 1, total: 2 }); // 50%
    expect(at(heat, "2026-10-03")).toMatchObject({ level: 3, done: 2, total: 2 });
    const three = [...two, daily("c", "2026-10-01")];
    const heat3 = buildHeatmap(three, [{ taskId: "a", day: "2026-10-02" }], range, "2026-10-03");
    expect(at(heat3, "2026-10-02")).toMatchObject({ level: 1, done: 1, total: 3 }); // 33%
    const heat49 = buildHeatmap(
      Array.from({ length: 100 }, (_, i) => daily(`t${i}`, "2026-10-01")),
      Array.from({ length: 49 }, (_, i) => ({ taskId: `t${i}`, day: "2026-10-02" })),
      range,
      "2026-10-03",
    );
    expect(at(heat49, "2026-10-02")).toMatchObject({ level: 1, done: 49, total: 100 });
  });

  it("counts an archived task only before it was archived", () => {
    const heat = buildHeatmap(
      [daily("a", "2026-10-01"), { ...daily("b", "2026-10-01"), archivedDay: "2026-10-05" }],
      [{ taskId: "a", day: "2026-10-06" }],
      { start: "2026-10-01", end: "2026-10-31" },
      "2026-10-10",
    );
    expect(at(heat, "2026-10-04")!.total).toBe(2);
    expect(at(heat, "2026-10-05")!.total).toBe(1); // archivedDay itself is already gone
    expect(at(heat, "2026-10-06")).toMatchObject({ total: 1, level: 3 });
  });

  it("does not count a check on an archived task toward a later day", () => {
    const heat = buildHeatmap(
      [daily("a", "2026-10-01"), { ...daily("b", "2026-10-01"), archivedDay: "2026-10-05" }],
      [{ taskId: "b", day: "2026-10-07" }],
      { start: "2026-10-06", end: "2026-10-08" },
      "2026-10-10",
    );
    expect(at(heat, "2026-10-07")).toMatchObject({ done: 0, total: 1, level: 0 });
  });

  it("ignores once and weekly tasks", () => {
    const heat = buildHeatmap(
      [daily("a", "2026-10-01"), once("o", "2026-10-01"), weekly("w", "2026-10-01")],
      [{ taskId: "o", day: "2026-10-02" }, { taskId: "w", day: "2026-10-02" }],
      { start: "2026-10-02", end: "2026-10-02" },
      "2026-10-10",
    );
    expect(heat).toEqual([{ day: "2026-10-02", level: 0, done: 0, total: 1, upcoming: false }]);
  });

  it("keeps a past day's colour fixed by the day stored on the check", () => {
    const heat = buildHeatmap(
      [daily("a", "2026-10-01")],
      [{ taskId: "a", day: "2026-10-09" }],
      { start: "2026-10-08", end: "2026-10-10" },
      "2026-10-10",
    );
    expect(heat.map((c) => c.level)).toEqual([0, 3, 0]);
  });

  it("treats today as a normal cell and tomorrow as upcoming", () => {
    const heat = buildHeatmap([daily("a", "2026-10-01")], [], { start: "2026-10-10", end: "2026-10-11" }, "2026-10-10");
    expect(at(heat, "2026-10-10")).toMatchObject({ upcoming: false, level: 0 });
    expect(at(heat, "2026-10-11")).toMatchObject({ upcoming: true, level: null });
  });

  it("crosses month and leap-year boundaries one cell per day", () => {
    const heat = buildHeatmap([], [], { start: "2027-12-30", end: "2028-03-01" }, "2026-10-10");
    const days = heat.map((c) => c.day);
    expect(days.slice(0, 4)).toEqual(["2027-12-30", "2027-12-31", "2028-01-01", "2028-01-02"]);
    expect(days).toContain("2028-02-29");
    expect(days).toHaveLength(2 + 31 + 29 + 1);
  });
});

describe("heatmapRange", () => {
  it("spans from the start day to the earliest snapshot or campaign end", () => {
    expect(
      heatmapRange(
        "2026-10-01",
        [
          { kind: "campaign_end", date: "2026-11-30", precision: "exact" },
          { kind: "snapshot", date: "2026-11-15", precision: "approximate" },
          { kind: "tge", date: "2026-10-20", precision: "exact" },
        ],
        "2026-10-10",
      ),
    ).toEqual({ start: "2026-10-01", end: "2026-11-15", endKind: "snapshot", endsOn: "2026-11-15" });
  });

  it("reports campaign_end when it is the earliest", () => {
    expect(
      heatmapRange(
        "2026-10-01",
        [
          { kind: "campaign_end", date: "2026-11-10", precision: "exact" },
          { kind: "snapshot", date: "2026-11-15", precision: "exact" },
        ],
        "2026-10-10",
      ),
    ).toEqual({ start: "2026-10-01", end: "2026-11-10", endKind: "campaign_end", endsOn: "2026-11-10" });
  });

  it("reports a snapshot when it falls on the same day as a campaign end, in either order", () => {
    const snap = { kind: "snapshot" as const, date: "2026-11-15", precision: "exact" as const };
    const camp = { kind: "campaign_end" as const, date: "2026-11-15", precision: "exact" as const };
    expect(heatmapRange("2026-10-01", [camp, snap], "2026-10-10").endKind).toBe("snapshot");
    expect(heatmapRange("2026-10-01", [snap, camp], "2026-10-10").endKind).toBe("snapshot");
  });

  it("skips deadlines before the start, without a date, or with month or quarter precision", () => {
    expect(
      heatmapRange(
        "2026-10-08",
        [
          { kind: "snapshot", date: "2026-10-07", precision: "exact" },
          { kind: "snapshot", date: null, precision: "exact" },
          { kind: "campaign_end", date: "2026-10-31", precision: "month" },
          { kind: "campaign_end", date: "2026-12-31", precision: "quarter" },
          { kind: "campaign_end", date: "2026-11-20", precision: "approximate" },
        ],
        "2026-10-10",
      ),
    ).toEqual({ start: "2026-10-08", end: "2026-11-20", endKind: "campaign_end", endsOn: "2026-11-20" });
  });

  it("accepts a deadline on the start day itself, while it is still today", () => {
    expect(heatmapRange("2026-10-08", [{ kind: "snapshot", date: "2026-10-08", precision: "exact" }], "2026-10-08")).toEqual({
      start: "2026-10-08",
      end: "2026-10-08",
      endKind: "snapshot",
      endsOn: "2026-10-08",
    });
  });

  it("moves on to the next deadline once the earliest has passed, keeping today in the range", () => {
    const deadlines = [
      { kind: "snapshot" as const, date: "2026-10-05", precision: "exact" as const },
      { kind: "campaign_end" as const, date: "2026-12-31", precision: "exact" as const },
    ];
    expect(heatmapRange("2026-09-01", deadlines, "2026-10-10")).toEqual({
      start: "2026-09-01",
      end: "2026-12-31",
      endKind: "campaign_end",
      endsOn: "2026-12-31",
    });
  });

  it("falls back to the one-year range once every deadline has passed", () => {
    expect(heatmapRange("2026-09-01", [{ kind: "snapshot", date: "2026-10-05", precision: "exact" }], "2026-10-10")).toEqual({
      start: "2026-09-01",
      end: "2027-08-31",
      endKind: null,
      endsOn: null,
    });
  });

  it("keeps today in the range when the deadline is more than a year away", () => {
    const far = [{ kind: "campaign_end" as const, date: "2027-12-31", precision: "approximate" as const }];
    // Cutting the earliest days would start the range after today: it runs 364 cells from the start day instead.
    expect(heatmapRange("2026-10-01", far, "2026-10-10")).toEqual({
      start: "2026-10-01",
      end: "2027-09-29",
      endKind: "campaign_end",
      endsOn: "2027-12-31",
    });
    // Farmed for more than a year already: the 364 cells end today.
    expect(heatmapRange("2025-01-01", [{ kind: "snapshot", date: "2028-01-01", precision: "exact" }], "2026-10-10")).toEqual({
      start: "2025-10-12",
      end: "2026-10-10",
      endKind: "snapshot",
      endsOn: "2028-01-01",
    });
  });

  it("rolls the one-year range forward to end today after a year without a deadline", () => {
    expect(heatmapRange("2025-09-01", [], "2026-10-10")).toEqual({ start: "2025-10-11", end: "2026-10-10", endKind: null, endsOn: null });
  });

  it("keeps a passed end for a project that ended", () => {
    expect(
      heatmapRange("2026-09-01", [{ kind: "snapshot", date: "2026-10-05", precision: "exact" }], "2026-10-10", "2026-10-05"),
    ).toEqual({ start: "2026-09-01", end: "2026-10-05", endKind: "ended", endsOn: "2026-10-05" });
  });

  it("spans one year without an end date and caps at 364 days", () => {
    expect(heatmapRange("2026-10-08", [], "2026-10-10")).toEqual({ start: "2026-10-08", end: "2027-10-07", endKind: null, endsOn: null });
    expect(
      heatmapRange("2025-01-01", [{ kind: "campaign_end", date: "2026-12-31", precision: "exact" }], "2026-10-10").start,
    ).toBe("2026-01-02");
  });

  it("keeps a 364 day deadline range whole and caps one day longer", () => {
    const dl = (date: string) => [{ kind: "snapshot" as const, date, precision: "exact" as const }];
    expect(heatmapRange("2026-01-02", dl("2026-12-31"), "2026-10-10").start).toBe("2026-01-02"); // 364 cells
    expect(heatmapRange("2026-01-01", dl("2026-12-31"), "2026-10-10").start).toBe("2026-01-02"); // 365 cells
  });

  it("stops at the day the project ended", () => {
    expect(
      heatmapRange("2026-10-01", [{ kind: "campaign_end", date: "2026-11-30", precision: "exact" }], "2026-10-10", "2026-10-07"),
    ).toEqual({ start: "2026-10-01", end: "2026-10-07", endKind: "ended", endsOn: "2026-10-07" });
    expect(heatmapRange("2026-10-08", [], "2026-10-10", "2026-10-01").endKind).toBeNull(); // ended before start: ignored
  });

  it("ignores an ended day that is not earlier than the end", () => {
    const dl = [{ kind: "snapshot" as const, date: "2026-11-15", precision: "exact" as const }];
    expect(heatmapRange("2026-10-01", dl, "2026-10-10", "2026-11-15")).toMatchObject({ end: "2026-11-15", endKind: "snapshot" });
    expect(heatmapRange("2026-10-01", dl, "2026-10-10", "2026-12-01")).toMatchObject({ end: "2026-11-15", endKind: "snapshot" });
    expect(heatmapRange("2026-10-01", [], "2026-10-10", "2026-10-01")).toEqual({
      start: "2026-10-01",
      end: "2026-10-01",
      endKind: "ended",
      endsOn: "2026-10-01",
    });
  });
});

describe("daysLeft", () => {
  it("counts days left until the end", () => {
    expect(daysLeft({ start: "2026-10-01", end: "2026-10-20", endKind: "snapshot", endsOn: "2026-10-20" }, "2026-10-10")).toBe(11);
  });
  it("counts the end day itself and returns null once it has passed or there is no end", () => {
    expect(daysLeft({ start: "2026-10-01", end: "2026-10-10", endKind: "campaign_end", endsOn: "2026-10-10" }, "2026-10-10")).toBe(1);
    expect(daysLeft({ start: "2026-10-01", end: "2026-10-09", endKind: "ended", endsOn: "2026-10-09" }, "2026-10-10")).toBeNull();
    expect(daysLeft({ start: "2026-10-01", end: "2027-09-30", endKind: null, endsOn: null }, "2026-10-10")).toBeNull();
  });
  it("counts to a deadline that lies past the end of the range", () => {
    expect(daysLeft({ start: "2026-10-01", end: "2027-09-29", endKind: "campaign_end", endsOn: "2027-12-31" }, "2026-10-10")).toBe(448);
  });
});

describe("streak", () => {
  const pair = [daily("d1", "2026-10-01"), daily("d2", "2026-10-01")];
  const full = (...days: string[]) => days.flatMap((day) => [{ taskId: "d1", day }, { taskId: "d2", day }]);

  it("ends the streak today or yesterday", () => {
    expect(streak(pair, [...full("2026-10-08", "2026-10-09"), { taskId: "d1", day: "2026-10-10" }], "2026-10-10")).toBe(2);
    expect(streak(pair, full("2026-10-09", "2026-10-10"), "2026-10-10")).toBe(2);
    expect(streak(pair, full("2026-10-08"), "2026-10-10")).toBe(0);
  });
  it("stops at the first day below 100 percent", () => {
    expect(streak(pair, [...full("2026-10-07"), { taskId: "d1", day: "2026-10-08" }, ...full("2026-10-09", "2026-10-10")], "2026-10-10")).toBe(2);
  });
  it("stops at a day without an active daily task", () => {
    const swapped = [{ ...daily("d1", "2026-10-01"), archivedDay: "2026-10-08" }, daily("d2", "2026-10-09")];
    const checks = ["2026-10-06", "2026-10-07"].map((day) => ({ taskId: "d1", day }));
    expect(streak(swapped, [...checks, { taskId: "d2", day: "2026-10-09" }, { taskId: "d2", day: "2026-10-10" }], "2026-10-10")).toBe(2);
  });
  it("is zero when yesterday broke the chain even if earlier days were 100 percent", () => {
    expect(streak(pair, [...full("2026-10-07", "2026-10-08"), { taskId: "d1", day: "2026-10-10" }], "2026-10-10")).toBe(0);
  });
  it("leaves once and weekly tasks out", () => {
    const mixed = [daily("d1", "2026-10-01"), once("o1", "2026-10-01"), weekly("w1", "2026-10-01")];
    expect(streak(mixed, [{ taskId: "d1", day: "2026-10-09" }, { taskId: "d1", day: "2026-10-10" }], "2026-10-10")).toBe(2);
  });
  it("counts back past the start of any heatmap range", () => {
    const checks: { taskId: string; day: string }[] = [];
    for (let ms = Date.UTC(2025, 0, 1); ms <= Date.UTC(2026, 9, 10); ms += 86_400_000) {
      checks.push({ taskId: "d1", day: new Date(ms).toISOString().slice(0, 10) });
    }
    // 2025-01-01 to 2026-10-10: 365 days of 2025 and 283 days of 2026.
    expect(streak([daily("d1", "2025-01-01")], checks, "2026-10-10")).toBe(648);
  });
});

describe("weeklyDone", () => {
  it("marks weekly tasks done within the ISO week", () => {
    expect(weeklyDone([weekly("w", "2026-09-01")], [{ taskId: "w", day: "2026-10-05" }], "2026-10-10")).toEqual({ w: true }); // Mon 5 Oct
    expect(weeklyDone([weekly("w", "2026-09-01")], [{ taskId: "w", day: "2026-10-04" }], "2026-10-10")).toEqual({ w: false }); // Sun 4 Oct
  });
  it("covers Monday to Sunday when today is a Sunday or a Monday", () => {
    const w = [weekly("w", "2026-09-01")];
    expect(weeklyDone(w, [{ taskId: "w", day: "2026-10-05" }], "2026-10-11")).toEqual({ w: true }); // today Sun 11 Oct
    expect(weeklyDone(w, [{ taskId: "w", day: "2026-10-11" }], "2026-10-12")).toEqual({ w: false }); // today Mon 12 Oct
    expect(weeklyDone(w, [{ taskId: "w", day: "2026-10-12" }], "2026-10-12")).toEqual({ w: true });
  });
  it("only reports weekly tasks and only counts their own checks", () => {
    const tasks = [weekly("w1", "2026-09-01"), weekly("w2", "2026-09-01"), daily("d", "2026-09-01"), once("o", "2026-09-01")];
    const checks = [{ taskId: "w1", day: "2026-10-06" }, { taskId: "d", day: "2026-10-06" }];
    expect(weeklyDone(tasks, checks, "2026-10-10")).toEqual({ w1: true, w2: false });
  });
  it("leaves out weekly tasks archived on or before today", () => {
    const tasks = [weekly("w", "2026-09-01"), { ...weekly("gone", "2026-09-01"), archivedDay: "2026-10-08" }];
    expect(weeklyDone(tasks, [], "2026-10-10")).toEqual({ w: false });
  });
});

describe("mainProgress", () => {
  it("counts a once task as done with any check row", () => {
    const tasks = [once("o1", "2026-10-01"), once("o2", "2026-10-01"), once("o3", "2026-10-01"), daily("d", "2026-10-01")];
    const checks = [{ taskId: "o1", day: "2026-10-03" }, { taskId: "d", day: "2026-10-03" }];
    expect(mainProgress(tasks, checks)).toEqual({ done: 1, total: 3 });
  });
  it("skips archived once tasks and counts a twice-checked task once", () => {
    const tasks = [once("o1", "2026-10-01"), { ...once("o2", "2026-10-01"), archivedDay: "2026-10-05" }];
    const checks = [{ taskId: "o1", day: "2026-10-03" }, { taskId: "o1", day: "2026-10-04" }, { taskId: "o2", day: "2026-10-03" }];
    expect(mainProgress(tasks, checks)).toEqual({ done: 1, total: 1 });
  });
  it("is 0 of 0 without once tasks", () => {
    expect(mainProgress([daily("d", "2026-10-01")], [])).toEqual({ done: 0, total: 0 });
  });
});

describe("localDay", () => {
  it("computes the local day in a time zone", () => {
    expect(localDay(new Date("2026-10-10T18:30:00Z"), "Asia/Jakarta")).toBe("2026-10-11");
  });
  it("stays on the previous day west of UTC and in plain UTC", () => {
    expect(localDay(new Date("2026-10-10T03:00:00Z"), "America/Los_Angeles")).toBe("2026-10-09");
    expect(localDay(new Date("2026-10-10T23:59:59Z"), "UTC")).toBe("2026-10-10");
  });
});
