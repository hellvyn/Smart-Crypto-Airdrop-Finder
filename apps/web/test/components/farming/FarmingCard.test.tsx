// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { HeatmapCell } from "@saf/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FarmingCard as FarmingCardData } from "@/lib/farming";

const actions = vi.hoisted(() => ({
  submitCheck: vi.fn(),
  submitAddTask: vi.fn(),
  submitArchiveTask: vi.fn(),
  submitRefresh: vi.fn(),
  submitStopFarming: vi.fn(),
  submitResultForm: vi.fn(),
  submitShareAnonymous: vi.fn(),
}));
vi.mock("@/app/(app)/garapan/actions", () => actions);

import { FarmingCard } from "@/components/farming/FarmingCard";

afterEach(cleanup);
beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset().mockResolvedValue(undefined);
});

const PID = "22222222-2222-4222-8222-222222222222";
const ID = {
  bridge: "a0000000-0000-4000-8000-000000000001",
  connect: "a0000000-0000-4000-8000-000000000002",
  swap: "a0000000-0000-4000-8000-000000000003",
  checkin: "a0000000-0000-4000-8000-000000000004",
  quest: "a0000000-0000-4000-8000-000000000005",
  points: "a0000000-0000-4000-8000-000000000006",
  recap: "a0000000-0000-4000-8000-000000000007",
};

const heat = (day: string, level: HeatmapCell["level"], upcoming = false): HeatmapCell => ({
  day,
  level,
  done: level === null ? 0 : level,
  total: upcoming || level === null ? 0 : 3,
  upcoming,
});

function card(overrides: Partial<FarmingCardData> = {}): FarmingCardData {
  return {
    projectId: PID,
    name: "Nebula Perps",
    slug: "nebula-perps",
    today: "2026-10-10",
    nextDeadline: { kind: "snapshot", date: "2026-10-12", precision: "exact" },
    ended: false,
    tokenSymbol: "NBL",
    tasks: [
      { id: ID.bridge, text: "Bridge ETH lewat bridge official", cadence: "once", origin: "source" },
      { id: ID.connect, text: "Connect akun X", cadence: "once", origin: "source" },
      { id: ID.swap, text: "Swap kecil di DEX", cadence: "daily", origin: "source" },
      { id: ID.checkin, text: "Check-in di halaman points", cadence: "daily", origin: "custom" },
      { id: ID.quest, text: "Quest mingguan", cadence: "weekly", origin: "source" },
      { id: ID.points, text: "Cek points", cadence: "weekly", origin: "source" },
      { id: ID.recap, text: "Baca recap", cadence: "weekly", origin: "custom" },
    ],
    checkedToday: [ID.bridge, ID.swap, ID.quest],
    range: { start: "2026-10-08", end: "2026-10-12", endKind: "snapshot", endsOn: "2026-10-12" },
    heatmap: [heat("2026-10-08", 3), heat("2026-10-09", 3), heat("2026-10-10", 1), heat("2026-10-11", null, true), heat("2026-10-12", null, true)],
    daysLeft: 3,
    streak: 2,
    weeklyDone: { [ID.quest]: true, [ID.points]: false, [ID.recap]: true },
    mainProgress: { done: 1, total: 2 },
    ...overrides,
  };
}

const checkbox = (name: string) => screen.getByRole("checkbox", { name });

/** Clicks the control and returns the FormData its form sent to `action`. */
async function submitted(control: HTMLElement, action: ReturnType<typeof vi.fn>): Promise<Record<string, unknown>> {
  fireEvent.click(control);
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  return Object.fromEntries((action.mock.calls[0]![0] as FormData).entries());
}

describe("FarmingCard", () => {
  it("heads the card with the project link, the countdown and the streak", () => {
    render(<FarmingCard card={card()} />);
    expect(screen.getByRole("link", { name: "Nebula Perps" }).getAttribute("href")).toBe("/projects/nebula-perps");
    expect(screen.getByText("Sisa 3 hari sampai snapshot")).toBeTruthy();
    expect(screen.getByText("Streak: 2 hari")).toBeTruthy();
  });

  it("counts down to the end of the campaign, and shows no countdown without a deadline", () => {
    render(<FarmingCard card={card({ range: { start: "2026-10-08", end: "2026-10-12", endKind: "campaign_end", endsOn: "2026-10-12" } })} />);
    expect(screen.getByText("Sisa 3 hari sampai akhir campaign")).toBeTruthy();
    cleanup();
    const { container } = render(
      <FarmingCard card={card({ range: { start: "2026-10-08", end: "2027-10-07", endKind: null, endsOn: null }, daysLeft: null, nextDeadline: null })} />,
    );
    expect(container.textContent).not.toMatch(/Sisa \d+ hari/);
  });

  it("lists the main tasks with their progress, ticked when done", () => {
    render(<FarmingCard card={card()} />);
    const main = screen.getByRole("region", { name: "Task utama" });
    expect(within(main).getByText("1/2 selesai")).toBeTruthy();
    expect(within(main).getByRole("checkbox", { name: "Bridge ETH lewat bridge official" }).getAttribute("aria-checked")).toBe("true");
    expect(within(main).getByRole("checkbox", { name: "Connect akun X" }).getAttribute("aria-checked")).toBe("false");
  });

  it("ticking a box sends the task and the wanted state, so a repeat cannot undo it", async () => {
    render(<FarmingCard card={card()} />);
    expect(await submitted(checkbox("Connect akun X"), actions.submitCheck)).toEqual({ from: "garapan", taskId: ID.connect, done: "1" });
    actions.submitCheck.mockClear();
    expect(await submitted(checkbox("Swap kecil di DEX"), actions.submitCheck)).toEqual({ from: "garapan", taskId: ID.swap, done: "0" });
  });

  it("shows today's daily tasks and how many are done", () => {
    render(<FarmingCard card={card()} />);
    const today = screen.getByRole("region", { name: "Hari ini" });
    expect(within(today).getByText("1 dari 2 task hari ini")).toBeTruthy();
    expect(within(today).getByRole("checkbox", { name: "Swap kecil di DEX" }).getAttribute("aria-checked")).toBe("true");
    expect(within(today).getByRole("checkbox", { name: "Check-in di halaman points" }).getAttribute("aria-checked")).toBe("false");
    expect(within(today).queryByRole("checkbox", { name: "Connect akun X" })).toBeNull();
  });

  it("says whether each weekly task is done this week; one done on an earlier day has no box to untick", () => {
    render(<FarmingCard card={card()} />);
    const weekly = screen.getByRole("region", { name: "Weekly" });
    const row = (text: string) => within(weekly).getByText(text).closest("li")!;
    expect(within(row("Quest mingguan")).getByText("Minggu ini udah")).toBeTruthy();
    expect(within(row("Quest mingguan")).getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
    expect(within(row("Cek points")).getByText("Belum minggu ini")).toBeTruthy();
    expect(within(row("Cek points")).getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
    expect(within(row("Baca recap")).getByText("Minggu ini udah")).toBeTruthy();
    expect(within(row("Baca recap")).queryByRole("checkbox")).toBeNull();
  });

  it("without daily tasks says so and keeps the rest of the checklist (review focus 2)", () => {
    const tasks = card().tasks.filter((t) => t.cadence !== "daily");
    render(<FarmingCard card={card({ tasks })} />);
    expect(screen.getByText("Belum ada daily task. Tambah task sendiri.")).toBeTruthy();
    expect(screen.queryByText(/dari \d+ task hari ini/)).toBeNull();
    expect(screen.getByRole("region", { name: "Task utama" })).toBeTruthy();
  });

  it("with no tasks at all still offers to fetch the source steps again", async () => {
    render(<FarmingCard card={card({ tasks: [], checkedToday: [], weeklyDone: {}, mainProgress: { done: 0, total: 0 } })} />);
    expect(screen.getByText("Belum ada daily task. Tambah task sendiri.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Task utama" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Weekly" })).toBeNull();
    const refresh = screen.getByRole("button", { name: "Ambil ulang step dari source" });
    expect(await submitted(refresh, actions.submitRefresh)).toEqual({ from: "garapan", projectId: PID });
  });

  it("adds a task of the member's own from a small form behind a text link", async () => {
    render(<FarmingCard card={card()} />);
    expect(screen.getByText("+ Tambah task sendiri").tagName).toBe("SUMMARY");
    const text = screen.getByRole("textbox", { name: "Task" }) as HTMLInputElement;
    expect(text.maxLength).toBe(200);
    const cadence = screen.getByRole("combobox", { name: "Seberapa sering" }) as HTMLSelectElement;
    expect([...cadence.options].map((o) => [o.value, o.textContent])).toEqual([
      ["daily", "Daily"],
      ["weekly", "Weekly"],
      ["once", "Sekali"],
    ]);
    fireEvent.change(text, { target: { value: "Vote di forum" } });
    fireEvent.change(cadence, { target: { value: "weekly" } });
    expect(await submitted(screen.getByRole("button", { name: "Tambah task" }), actions.submitAddTask)).toEqual({
      from: "garapan",
      projectId: PID,
      text: "Vote di forum",
      cadence: "weekly",
    });
  });

  it("archives a single task instead of deleting it", async () => {
    render(<FarmingCard card={card()} />);
    const archive = screen.getByRole("button", { name: "Arsipkan task: Check-in di halaman points" });
    expect(await submitted(archive, actions.submitArchiveTask)).toEqual({ from: "garapan", taskId: ID.checkin });
  });

  it("stops farming the project with Berhenti garap", async () => {
    render(<FarmingCard card={card()} />);
    expect(await submitted(screen.getByRole("button", { name: "Berhenti garap" }), actions.submitStopFarming)).toEqual({
      from: "garapan",
      projectId: PID,
    });
  });

  it("draws the progress heatmap with the range it covers", () => {
    const { container } = render(<FarmingCard card={card()} />);
    expect(screen.getByRole("group", { name: "Progres Nebula Perps" })).toBeTruthy();
    expect(screen.getByText("8 Okt 2026 sampai 12 Okt 2026 (snapshot)")).toBeTruthy();
    expect(container.querySelector('[data-day="2026-10-10"]')!.classList.contains("heat-today")).toBe(true);
  });

  it("counts down to a deadline beyond the heatmap without naming it as the range's end", () => {
    const range = { start: "2026-10-01", end: "2027-09-29", endKind: "campaign_end" as const, endsOn: "2027-12-31" };
    render(<FarmingCard card={card({ range, daysLeft: 448 })} />);
    expect(screen.getByText("Sisa 448 hari sampai akhir campaign")).toBeTruthy();
    expect(screen.getByText("1 Okt 2026 sampai 29 Sep 2027")).toBeTruthy();
  });

  it("locks the checklist of a project whose campaign ended, keeping its history", () => {
    render(
      <FarmingCard
        card={card({ range: { start: "2026-09-01", end: "2026-10-05", endKind: "ended", endsOn: "2026-10-05" }, daysLeft: null, nextDeadline: null })}
      />,
    );
    expect(screen.getByRole("img", { name: "ENDED" })).toBeTruthy();
    expect(screen.getByText("Ended 5 Okt 2026")).toBeTruthy();
    expect(screen.getByText("Campaign udah ended. Checklist dikunci, riwayat garapanmu tetap tersimpan di sini.")).toBeTruthy();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByText("+ Tambah task sendiri")).toBeNull();
    expect(screen.queryByRole("button", { name: "Ambil ulang step dari source" })).toBeNull();
    expect(screen.getByRole("group", { name: "Progres Nebula Perps" })).toBeTruthy();
    // Stopping stays possible, so an ended project does not hold one of the 50 active places for good.
    expect(screen.getByRole("button", { name: "Berhenti garap" })).toBeTruthy();
  });

  it("names the next deadline under the project name", () => {
    render(<FarmingCard card={card()} />);
    expect(screen.getByText("Deadline terdekat: Snapshot 12 Okt 2026 (tanggal tepat)")).toBeTruthy();
    cleanup();
    const { container } = render(<FarmingCard card={card({ nextDeadline: null })} />);
    expect(container.textContent).not.toContain("Deadline terdekat");
  });

  it("asks for the airdrop result only once the project ended", () => {
    render(<FarmingCard card={card()} />);
    expect(screen.queryByRole("region", { name: "Dapet berapa dari airdrop ini?" })).toBeNull();
    cleanup();
    render(<FarmingCard card={card({ ended: true })} />);
    expect(screen.getByRole("region", { name: "Dapet berapa dari airdrop ini?" })).toBeTruthy();
    cleanup();
    render(
      <FarmingCard
        card={card({ ended: true })}
        result={{ amount: 1250, noReward: false, claimedOn: "2026-10-07", usdAtClaim: 412, shareAnonymous: true, usdNow: null }}
        average={{ contributors: 6, avgUsd: 300 }}
      />,
    );
    const region = screen.getByRole("region", { name: "Hasil kamu" });
    expect(within(region).getByText("1.250 NBL")).toBeTruthy();
    expect(within(region).getByText("Rata-rata member yang garap Nebula Perps: ≈ $300 (dari 6 member yang mau berbagi)")).toBeTruthy();
  });
});
