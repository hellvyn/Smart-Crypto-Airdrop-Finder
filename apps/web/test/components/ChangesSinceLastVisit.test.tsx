// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ markChangesSeen: vi.fn() }));
vi.mock("@/app/(app)/changes/actions", () => actions);
const formStatus = vi.hoisted(() => ({ pending: false }));
vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  useFormStatus: () => ({ pending: formStatus.pending, data: null, method: null, action: null }),
}));

import { ChangesSinceLastVisit } from "@/components/ChangesSinceLastVisit";
import type { ChangeFeed, ChangeItem, DeadlineItem } from "@/lib/changes";

afterEach(cleanup);
beforeEach(() => {
  actions.markChangesSeen.mockReset().mockResolvedValue(undefined);
  formStatus.pending = false;
});

const AT = "2026-10-09T23:00:00Z";
const one = { slug: "one", name: "One Protocol" };
const near: DeadlineItem = { project: one, deadlineKind: "claim", date: "2026-10-11", approximate: false };

const feed = (changes: ChangeItem[], deadlines: DeadlineItem[] = []): ChangeFeed => ({ changes, deadlines });
const panel = () => screen.getByRole("region", { name: "Perubahan sejak kunjungan terakhir" });
const changeList = () => within(panel()).getByRole("list", { name: "Perubahan" });
const deadlineList = () => within(panel()).getByRole("list", { name: "Deadline dekat" });

describe("ChangesSinceLastVisit", () => {
  it("renders nothing when there is neither a change nor a near deadline", () => {
    const { container } = render(<ChangesSinceLastVisit feed={feed([])} />);
    expect(container.innerHTML).toBe("");
  });

  it("titles the panel and links each change to its project", () => {
    render(<ChangesSinceLastVisit feed={feed([{ kind: "curated_out", project: one, at: AT }])} />);
    expect(within(changeList()).getByRole("link", { name: "One Protocol" }).getAttribute("href")).toBe("/projects/one");
    expect(within(changeList()).getByText("Keluar dari list")).toBeTruthy();
  });

  it.each<[string, ChangeItem]>([
    ["Keluar dari list", { kind: "curated_out", project: one, at: AT }],
    ["Masuk list", { kind: "curated_in", project: one, at: AT }],
    ["Udah ended", { kind: "ended", project: one, at: AT }],
    ["Status berubah: Diumumkan → Live", { kind: "status", project: one, from: "announced", to: "live", at: AT }],
    ["Risiko berubah: Rendah → Tinggi", { kind: "risk", project: one, from: "low", to: "high", at: AT }],
    ["Risiko berubah: Belum dinilai → Sedang", { kind: "risk", project: one, from: null, to: "medium", at: AT }],
  ])("writes %s", (text, item) => {
    render(<ChangesSinceLastVisit feed={feed([item])} />);
    expect(within(changeList()).getAllByRole("listitem")[0]!.textContent).toBe(`One Protocol ${text}`);
  });

  it("writes the collapsed first-run entries as one line that links to the watchlist", () => {
    render(<ChangesSinceLastVisit feed={feed([{ kind: "curated_in_many", count: 30, at: AT }])} />);
    const item = within(changeList()).getAllByRole("listitem")[0]!;
    expect(item.textContent).toBe("30 project masuk list");
    expect(within(item).getByRole("link", { name: "30 project masuk list" }).getAttribute("href")).toBe("/watchlist");
  });

  it("keeps the order it is given", () => {
    render(
      <ChangesSinceLastVisit
        feed={feed([
          { kind: "ended", project: one, at: AT },
          { kind: "curated_in", project: { slug: "two", name: "Two" }, at: AT },
        ])}
      />,
    );
    expect(within(changeList()).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "One Protocol Udah ended",
      "Two Masuk list",
    ]);
  });

  it.each<[string, DeadlineItem]>([
    ["Deadline claim dalam 48 jam (11 Okt 2026)", near],
    [
      "Deadline akhir campaign dalam 48 jam (sekitar 12 Okt 2026)",
      { project: one, deadlineKind: "campaign_end", date: "2026-10-12", approximate: true },
    ],
  ])("lists a near deadline in its own group: %s", (text, d) => {
    render(<ChangesSinceLastVisit feed={feed([], [d])} />);
    const item = within(deadlineList()).getAllByRole("listitem")[0]!;
    expect(item.textContent).toBe(`One Protocol ${text}`);
    expect(within(item).getByRole("link", { name: "One Protocol" }).getAttribute("href")).toBe("/projects/one");
  });

  it("with only near deadlines, shows them without a change list and without 'Tandai sudah dibaca' (they cannot be dismissed)", () => {
    render(<ChangesSinceLastVisit feed={feed([], [near])} />);
    expect(deadlineList()).toBeTruthy();
    expect(within(panel()).queryByRole("list", { name: "Perubahan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tandai sudah dibaca" })).toBeNull();
  });

  it("with only changes, shows no deadline group", () => {
    render(<ChangesSinceLastVisit feed={feed([{ kind: "ended", project: one, at: AT }])} />);
    expect(within(panel()).queryByRole("list", { name: "Deadline dekat" })).toBeNull();
  });

  it("'Tandai sudah dibaca' submits markChangesSeen without sending any time", async () => {
    render(<ChangesSinceLastVisit feed={feed([{ kind: "ended", project: one, at: AT }], [near])} />);
    fireEvent.click(screen.getByRole("button", { name: "Tandai sudah dibaca" }));
    await waitFor(() => expect(actions.markChangesSeen).toHaveBeenCalledTimes(1));
    expect([...(actions.markChangesSeen.mock.calls[0]![0] as FormData).keys()]).toEqual([]);
  });

  it("disables the button and says so while the form is being sent", () => {
    formStatus.pending = true;
    render(<ChangesSinceLastVisit feed={feed([{ kind: "ended", project: one, at: AT }])} />);
    const button = screen.getByRole("button", { name: "Lagi ditandai..." }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
