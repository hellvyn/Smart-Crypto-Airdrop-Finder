// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FarmingCard } from "@/lib/farming";

const getFarmingBoard = vi.fn();
vi.mock("@/lib/auth", () => ({ requireUser: async () => ({ id: "u1" }) }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({}) }));
vi.mock("@/lib/farming", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/farming")>()),
  getFarmingBoard: (...args: unknown[]) => getFarmingBoard(...args),
}));
vi.mock("@/app/(app)/garapan/actions", () => ({
  submitCheck: vi.fn(),
  submitAddTask: vi.fn(),
  submitArchiveTask: vi.fn(),
  submitRefresh: vi.fn(),
  submitStopFarming: vi.fn(),
}));

import GarapanPage from "@/app/(app)/garapan/page";

afterEach(cleanup);
beforeEach(() => getFarmingBoard.mockReset().mockResolvedValue([]));

const page = async (params: Record<string, string | string[]> = {}) =>
  render(await GarapanPage({ searchParams: Promise.resolve(params) }));

function card(projectId: string, name: string, daily: { id: string; done: boolean }[]): FarmingCard {
  return {
    projectId,
    name,
    slug: name.toLowerCase(),
    today: "2026-10-10",
    nextDeadline: null,
    tasks: daily.map((t) => ({ id: t.id, text: `Task ${t.id}`, cadence: "daily", origin: "source" })),
    checkedToday: daily.filter((t) => t.done).map((t) => t.id),
    range: { start: "2026-10-10", end: "2027-10-09", endKind: null },
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
});
