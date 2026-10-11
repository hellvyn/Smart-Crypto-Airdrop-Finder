// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CuratedItem } from "@/lib/view";

const getUser = vi.fn();
const listCurated = vi.fn();
const getRunSummary = vi.fn();
const getTrackRecord = vi.fn();
const getChangesSeenAt = vi.fn();
const listChangesSince = vi.fn();
vi.mock("@/lib/auth", () => ({ getUser: () => getUser() }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({}) }));
vi.mock("@/lib/queries", () => ({
  listCurated: (...args: unknown[]) => listCurated(...args),
  listChains: async () => ["base", "ethereum"],
  getLastSuccessfulRunAt: async () => new Date(),
  getRunSummary: (...args: unknown[]) => getRunSummary(...args),
  getTrackRecord: (...args: unknown[]) => getTrackRecord(...args),
  getChangesSeenAt: (...args: unknown[]) => getChangesSeenAt(...args),
  listChangesSince: (...args: unknown[]) => listChangesSince(...args),
}));
vi.mock("@/app/(public)/airdrops/actions", () => ({ markChangesSeen: vi.fn() }));

import AirdropsPage from "@/app/(public)/airdrops/page";

afterEach(cleanup);

function item(over: Partial<CuratedItem> = {}): CuratedItem {
  return {
    slug: "demo",
    name: "Demo Protocol",
    status: "live",
    riskLevel: "low",
    chains: ["base"],
    nextDeadline: null,
    lastSeen: "2026-10-10T00:00:00Z",
    tab: "live_now",
    endedOn: null,
    checkedAt: new Date().toISOString(),
    signals: [],
    claimOpenChecked: false,
    capital: "free",
    capitalMinUsd: null,
    keyChecksRan: 4,
    worthLevel: null,
    ...over,
  };
}

const curatedPage = (items: CuratedItem[]) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 50,
  capitalCounts: { all: 7, free: 3, deposit: 2 },
});

beforeEach(() => {
  getUser.mockReset().mockResolvedValue(null);
  listCurated.mockReset().mockResolvedValue(curatedPage([item()]));
  getRunSummary.mockReset().mockResolvedValue({ checked: 4, passed: 3, at: new Date() });
  getTrackRecord.mockReset().mockResolvedValue(null);
  getChangesSeenAt.mockReset().mockResolvedValue(null);
  listChangesSince.mockReset().mockResolvedValue([]);
});

const page = async (sp: Record<string, string | string[]> = {}) =>
  render(await AirdropsPage({ searchParams: Promise.resolve(sp) }));

describe("/airdrops", () => {
  it("ignores worth and an unknown tab for a visitor: public order, no worth anywhere (#45)", async () => {
    const { container } = await page({ tab: "xyz", sort: "worth", worth: "high" });
    const [, tab, filters, pageNo, member] = listCurated.mock.calls[0]!;
    expect([tab, pageNo, member]).toEqual(["live_now", 1, false]);
    expect(filters).not.toHaveProperty("worth");
    expect(screen.getByRole("link", { name: "Live sekarang" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Baru dicek")).toBeTruthy();
    expect(container.textContent).not.toMatch(/worth it/i);
    for (const a of container.querySelectorAll("a")) expect(a.getAttribute("href")).not.toMatch(/worth/);
  });

  it("gives a member the worth filter and the Paling worth it order", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    await page({ worth: "high" });
    const [, , filters, , member] = listCurated.mock.calls[0]!;
    expect(member).toBe(true);
    expect(filters).toMatchObject({ worth: ["high"] });
    expect(screen.getByText("Paling worth it")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Worth it: semua" })).toBeTruthy();
  });

  it("orders the ended tab by Baru ended", async () => {
    await page({ tab: "ended" });
    expect(listCurated.mock.calls[0]![1]).toBe("ended");
    expect(screen.getByText("Baru ended")).toBeTruthy();
  });

  it("keeps the other filters and the capital option when switching tabs", async () => {
    await page({ modal: "free", risk: "low" });
    expect(screen.getByRole("link", { name: "Early" }).getAttribute("href")).toBe("/airdrops?tab=early_bets&risk=low&modal=free");
    expect(screen.getByRole("link", { name: "Ended" }).getAttribute("href")).toBe("/airdrops?tab=ended&risk=low&modal=free");
  });

  it("offers Modal: Semua, Gratis and Butuh $ with their counts, in the current tab", async () => {
    await page({ tab: "early_bets", modal: "free" });
    const modal = screen.getByRole("navigation", { name: "Modal:" });
    const links = within(modal).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("aria-current")])).toEqual([
      ["Semua · 7", "/airdrops?tab=early_bets", null],
      ["Gratis · 3", "/airdrops?tab=early_bets&modal=free", "page"],
      ["Butuh $ · 2", "/airdrops?tab=early_bets&modal=deposit", null],
    ]);
    expect(listCurated.mock.calls[0]![2]).toMatchObject({ capital: "free" });
  });

  it("sums up today's run: Update hari ini, 4 dicek, 3 lolos", async () => {
    await page();
    const summary = screen.getByRole("region", { name: "Update hari ini" });
    expect(within(summary).getByTestId("summary-checked").textContent).toBe("4 dicek");
    expect(within(summary).getByTestId("summary-passed").textContent).toBe("3 lolos");
  });

  it("says an empty tab has nothing that passed, and still shows the summary", async () => {
    listCurated.mockResolvedValue(curatedPage([]));
    await page({ tab: "early_bets" });
    expect(screen.getByText("Belum ada airdrop yang lolos kurasi di tab ini.")).toBeTruthy();
    expect(screen.getByTestId("summary-checked").textContent).toBe("4 dicek");
  });

  it("treats the Modal: option alone as no filter: no Hapus filter link, and the empty-tab message", async () => {
    listCurated.mockResolvedValue(curatedPage([]));
    await page({ modal: "free" });
    expect(screen.queryByRole("link", { name: "Hapus filter" })).toBeNull();
    expect(screen.getByText("Belum ada airdrop yang lolos kurasi di tab ini.")).toBeTruthy();
  });

  it("says filters matched nothing when filters are set", async () => {
    listCurated.mockResolvedValue(curatedPage([]));
    await page({ risk: "low" });
    expect(screen.getByText("Gak ada airdrop yang cocok sama filter ini.")).toBeTruthy();
  });

  it("shows the track record above the list only when there is one", async () => {
    await page();
    expect(screen.queryByText("Track record kami")).toBeNull();
    cleanup();
    getTrackRecord.mockResolvedValue({ total: 14, listed: 6, noToken: 5, riskRaised: 3 });
    await page();
    const record = screen.getByRole("region", { name: "Track record kami" });
    expect(record.textContent).toContain("6 Token listing · 5 Ended tanpa token · 3 Belakangan jadi risky");
    expect(record.textContent).toContain("Dari 14 airdrop yang lolos sebelum token listing dan sekarang udah ended atau belakangan jadi risky.");
  });

  it("never reads changes for a visitor, and shows no changes section", async () => {
    await page();
    expect(getChangesSeenAt).not.toHaveBeenCalled();
    expect(listChangesSince).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Perubahan sejak kunjungan terakhir" })).toBeNull();
  });

  it("shows a member the changes since they last marked them seen, above the list", async () => {
    const seen = new Date("2026-10-09T08:00:00Z");
    getUser.mockResolvedValue({ id: "u1" });
    getChangesSeenAt.mockResolvedValue(seen);
    listChangesSince.mockResolvedValue([{ kind: "ended", project: { slug: "gone", name: "Gone Protocol" }, at: "2026-10-09T23:00:00Z" }]);
    await page();
    expect(getChangesSeenAt.mock.calls[0]![1]).toBe("u1");
    expect(listChangesSince.mock.calls[0]![1]).toBe(seen);
    const section = screen.getByRole("region", { name: "Perubahan sejak kunjungan terakhir" });
    expect(within(section).getByText("Udah ended")).toBeTruthy();
    const firstRow = screen.getAllByTestId("project-row")[0]!;
    expect(section.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("hides the changes section for a member with nothing new", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    await page();
    expect(listChangesSince).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("region", { name: "Perubahan sejak kunjungan terakhir" })).toBeNull();
  });
});
