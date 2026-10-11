// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ markChangesSeen: vi.fn() }));
vi.mock("@/app/(public)/airdrops/actions", () => actions);

import { ChangesSinceLastVisit } from "@/components/ChangesSinceLastVisit";
import type { ChangeItem } from "@/lib/changes";

afterEach(cleanup);
beforeEach(() => actions.markChangesSeen.mockReset().mockResolvedValue(undefined));

const AT = "2026-10-09T23:00:00Z";
const one = { slug: "one", name: "One Protocol" };

const items = () => screen.getAllByRole("listitem");

describe("ChangesSinceLastVisit", () => {
  it("renders nothing when there is no change", () => {
    const { container } = render(<ChangesSinceLastVisit items={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("titles the section and links each item to its project", () => {
    render(<ChangesSinceLastVisit items={[{ kind: "curated_out", project: one, at: AT }]} />);
    const section = screen.getByRole("region", { name: "Perubahan sejak kunjungan terakhir" });
    expect(within(section).getByRole("link", { name: "One Protocol" }).getAttribute("href")).toBe("/projects/one");
    expect(within(section).getByText("Keluar dari list")).toBeTruthy();
  });

  it.each<[string, ChangeItem]>([
    ["Keluar dari list", { kind: "curated_out", project: one, at: AT }],
    ["Masuk list", { kind: "curated_in", project: one, at: AT }],
    ["Udah ended", { kind: "ended", project: one, at: AT }],
    ["Status berubah: Diumumkan → Live", { kind: "status", project: one, from: "announced", to: "live", at: AT }],
    ["Risiko berubah: Rendah → Tinggi", { kind: "risk", project: one, from: "low", to: "high", at: AT }],
    ["Risiko berubah: Belum dinilai → Sedang", { kind: "risk", project: one, from: null, to: "medium", at: AT }],
    [
      "Deadline claim dalam 48 jam (11 Okt 2026)",
      { kind: "deadline", project: one, deadlineKind: "claim", date: "2026-10-11", approximate: false, at: AT },
    ],
    [
      "Deadline akhir campaign dalam 48 jam (sekitar 12 Okt 2026)",
      { kind: "deadline", project: one, deadlineKind: "campaign_end", date: "2026-10-12", approximate: true, at: AT },
    ],
  ])("writes %s", (text, item) => {
    render(<ChangesSinceLastVisit items={[item]} />);
    expect(items()[0]!.textContent).toBe(`One Protocol ${text}`);
  });

  it("writes the collapsed first-run entries as one line without a project link", () => {
    render(<ChangesSinceLastVisit items={[{ kind: "curated_in_many", count: 30, at: AT }]} />);
    expect(items()[0]!.textContent).toBe("30 project masuk list");
    expect(within(items()[0]!).queryByRole("link")).toBeNull();
  });

  it("keeps the order it is given", () => {
    render(
      <ChangesSinceLastVisit
        items={[
          { kind: "ended", project: one, at: AT },
          { kind: "curated_in", project: { slug: "two", name: "Two" }, at: AT },
        ]}
      />,
    );
    expect(items().map((li) => li.textContent)).toEqual(["One Protocol Udah ended", "Two Masuk list"]);
  });

  it("'Tandai sudah dibaca' submits markChangesSeen without sending any time", async () => {
    render(<ChangesSinceLastVisit items={[{ kind: "ended", project: one, at: AT }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Tandai sudah dibaca" }));
    await waitFor(() => expect(actions.markChangesSeen).toHaveBeenCalledTimes(1));
    expect([...(actions.markChangesSeen.mock.calls[0]![0] as FormData).keys()]).toEqual([]);
  });
});
