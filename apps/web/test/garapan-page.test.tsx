// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FarmingCard } from "@/lib/farming";

const getFarmingBoard = vi.fn();
const getResults = vi.fn();
vi.mock("@/lib/auth", () => ({ requireUser: async () => ({ id: "u1" }) }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({}) }));
vi.mock("@/lib/farming", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/farming")>()),
  getFarmingBoard: (...args: unknown[]) => getFarmingBoard(...args),
  getResults: (...args: unknown[]) => getResults(...args),
}));
vi.mock("@/app/(app)/garapan/actions", () => ({
  submitCheck: vi.fn(),
  submitAddTask: vi.fn(),
  submitArchiveTask: vi.fn(),
  submitRefresh: vi.fn(),
  submitStopFarming: vi.fn(),
  submitResultForm: vi.fn(),
  submitShareAnonymous: vi.fn(),
}));

import GarapanPage from "@/app/(app)/garapan/page";

afterEach(cleanup);
beforeEach(() => {
  getFarmingBoard.mockReset().mockResolvedValue([]);
  getResults.mockReset().mockResolvedValue({ totalUsd: 0, results: {}, averages: {} });
});

const page = async (params: Record<string, string | string[]> = {}) =>
  render(await GarapanPage({ searchParams: Promise.resolve(params) }));

function card(projectId: string, name: string, daily: { id: string; done: boolean }[], ended = false): FarmingCard {
  return {
    projectId,
    name,
    slug: name.toLowerCase(),
    today: "2026-10-10",
    nextDeadline: null,
    ended,
    tokenSymbol: null,
    tasks: daily.map((t) => ({ id: t.id, text: `Task ${t.id}`, cadence: "daily", origin: "source" })),
    checkedToday: daily.filter((t) => t.done).map((t) => t.id),
    range: { start: "2026-10-10", end: "2027-10-09", endKind: null, endsOn: null },
    heatmap: [{ day: "2026-10-10", level: 0, done: 0, total: daily.length, upcoming: false }],
    daysLeft: null,
    streak: 0,
    weeklyDone: {},
    mainProgress: { done: 0, total: 0 },
  };
}

describe("Garapan saya page", () => {
  it("says how to start when nothing is farmed", async () => {
    await page();
    expect(screen.getByRole("heading", { level: 1, name: "Garapan saya" })).toBeTruthy();
    expect(screen.getByText("Kamu belum menggarap project apa pun. Buka sebuah airdrop dan klik Mulai garap.")).toBeTruthy();
  });

  it("credits no price source while the total is $0", async () => {
    getFarmingBoard.mockResolvedValue([card("p1", "Alpha", [])]);
    await page();
    expect(screen.getByTestId("garapan-summary").textContent).toContain("≈ $0");
    expect(screen.queryByTestId("garapan-price-source")).toBeNull();
  });

  it("shows one card per farmed project and today's daily tasks across them", async () => {
    getFarmingBoard.mockResolvedValue([
      card("p1", "Alpha", [
        { id: "a1", done: true },
        { id: "a2", done: false },
      ]),
      card("p2", "Beta", [{ id: "b1", done: true }]),
    ]);
    await page();
    expect(screen.getByRole("link", { name: "Alpha" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Beta" })).toBeTruthy();
    expect(screen.queryByText(/belum menggarap/)).toBeNull();
    expect(screen.getByTestId("garapan-summary").textContent).toContain("2 project digarap");
    expect(screen.getByTestId("garapan-summary").textContent).toContain("2/3 daily task hari ini");
  });

  it("shows the message of a refused request sent back with ?error=<code>", async () => {
    await page({ error: "project_limit" });
    expect(screen.getByRole("alert").textContent).toBe(
      "Kamu udah garap 50 project. Berhentiin salah satu dulu sebelum mulai yang baru.",
    );
  });

  it("ignores an unknown error code", async () => {
    await page({ error: "<script>" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("adds up the member's results into Total hasil garapan, reading results for the ended projects", async () => {
    getFarmingBoard.mockResolvedValue([card("p1", "Alpha", []), card("p2", "Beta", [], true)]);
    getResults.mockResolvedValue({
      totalUsd: 412.25,
      results: { p2: { amount: 1250, noReward: false, claimedOn: "2026-10-07", usdAtClaim: 412.25, shareAnonymous: false, usdNow: null } },
      averages: {},
    });
    await page();
    expect(getResults.mock.calls[0]![1]).toEqual(["p2"]);
    const summary = screen.getByTestId("garapan-summary");
    expect(summary.textContent).toContain("≈ $412");
    expect(summary.textContent).toContain("Total hasil garapan");
    expect(screen.getByTestId("garapan-price-source").textContent).toBe("Data harga: CoinGecko, DefiLlama");
    expect(screen.getByRole("region", { name: "Hasil kamu" })).toBeTruthy();
  });

  it("keeps the total visible when results exist but nothing is farmed any more", async () => {
    getResults.mockResolvedValue({ totalUsd: 50, results: {}, averages: {} });
    await page();
    expect(screen.getByTestId("garapan-summary").textContent).toContain("≈ $50");
    expect(screen.getByText(/belum menggarap/)).toBeTruthy();
  });

  it("explains an unknown profile time zone with its own message", async () => {
    await page({ error: "invalid_timezone" });
    expect(screen.getByRole("alert").textContent).toMatch(/zona waktu/i);
  });
});
