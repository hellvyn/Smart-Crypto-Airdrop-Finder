import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FarmingCard } from "@/lib/farming";

const getLatestBriefing = vi.fn();
const getFarmingBoard = vi.fn();
vi.mock("@/lib/queries", () => ({ getLatestBriefing: (...args: unknown[]) => getLatestBriefing(...args) }));
vi.mock("@/lib/farming", () => ({ getFarmingBoard: (...args: unknown[]) => getFarmingBoard(...args) }));

import { getBriefingData, wibDay } from "@/lib/briefing";

const db = {} as SupabaseClient;
const NOW = new Date("2026-10-10T23:30:00Z");

function card(over: Partial<FarmingCard> & { slug: string }): FarmingCard {
  return {
    projectId: `id-${over.slug}`,
    name: over.slug.toUpperCase(),
    today: "2026-10-11",
    ended: false,
    tokenSymbol: null,
    nextDeadline: null,
    tasks: [],
    checkedToday: [],
    range: { start: "2026-10-01", end: "2026-10-31" },
    heatmap: [],
    daysLeft: null,
    streak: 0,
    weeklyDone: {},
    mainProgress: { done: 0, total: 0 },
    ...over,
  } as FarmingCard;
}

beforeEach(() => {
  getLatestBriefing.mockReset().mockResolvedValue(null);
  getFarmingBoard.mockReset().mockResolvedValue([]);
});

describe("wibDay", () => {
  it("is the WIB calendar day, which is already tomorrow late in the UTC evening", () => {
    expect(wibDay(NOW)).toBe("2026-10-11");
    expect(wibDay(new Date("2026-10-10T16:59:00Z"))).toBe("2026-10-10");
  });
});

describe("getBriefingData", () => {
  it("returns the latest briefing and the three nearest garapan deadlines of projects not ended", async () => {
    const briefing = { day: "2026-10-11", ai: true, items: [] };
    getLatestBriefing.mockResolvedValue(briefing);
    getFarmingBoard.mockResolvedValue([
      card({ slug: "far", nextDeadline: { kind: "claim", date: "2026-11-01", precision: "exact" } }),
      card({ slug: "none" }),
      card({ slug: "ended", ended: true, nextDeadline: { kind: "claim", date: "2026-10-12", precision: "exact" } }),
      card({ slug: "b", nextDeadline: { kind: "snapshot", date: "2026-10-14", precision: "approximate" } }),
      card({ slug: "a", nextDeadline: { kind: "claim", date: "2026-10-13", precision: "exact" } }),
      card({ slug: "c", nextDeadline: { kind: "campaign_end", date: "2026-10-20", precision: "exact" } }),
    ]);

    const data = await getBriefingData(db, NOW);

    expect(data?.briefing).toEqual(briefing);
    expect(data?.garapan).toEqual([
      { slug: "a", name: "A", kind: "claim", date: "2026-10-13", approximate: false },
      { slug: "b", name: "B", kind: "snapshot", date: "2026-10-14", approximate: true },
      { slug: "c", name: "C", kind: "campaign_end", date: "2026-10-20", approximate: false },
    ]);
    expect(getFarmingBoard).toHaveBeenCalledWith(db, NOW);
  });

  it("returns null, so no box, when the briefing query fails", async () => {
    getLatestBriefing.mockRejectedValue(new Error("boom"));
    expect(await getBriefingData(db, NOW)).toBeNull();
  });

  it("keeps the briefing and drops the garapan part when the garapan query fails", async () => {
    const briefing = { day: "2026-10-11", ai: false, items: [] };
    getLatestBriefing.mockResolvedValue(briefing);
    getFarmingBoard.mockRejectedValue(new Error("boom"));
    expect(await getBriefingData(db, NOW)).toEqual({ briefing, garapan: [] });
  });
});
