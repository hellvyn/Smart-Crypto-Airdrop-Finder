// @vitest-environment jsdom
// The landing's "Apa bedanya gratis sama member?" table. A feature that does not exist yet is marked "Segera" and is
// never shown as included for members (owner, 2026-10-11). Coach and Briefing went live on 2026-10-11.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PlanComparison } from "@/components/landing/PlanComparison";

afterEach(cleanup);

const rowOf = (title: string) =>
  within(screen.getByRole("table")).getAllByRole("row").find((r) => within(r).queryByRole("rowheader")?.querySelector(".landing-feature")?.textContent === title)!;

const memberCell = (row: HTMLElement) => within(row).getAllByRole("cell")[1]!;
const freeCell = (row: HTMLElement) => within(row).getAllByRole("cell")[0]!;

describe("PlanComparison", () => {
  it.each(["Morning briefing", "AI Coach"])("shows %s as included for members, now that it is live (no Segera)", (title) => {
    render(<PlanComparison />);
    const row = rowOf(title);
    expect(within(row).queryByText("Segera")).toBeNull();
    expect(memberCell(row).querySelector("[role=img]")?.getAttribute("aria-label")).toBe("Ada");
    expect(freeCell(row).querySelector("[role=img]")?.getAttribute("aria-label")).toBe("Gak ada");
  });

  it("shows every member feature as included, without a Segera tag", () => {
    render(<PlanComparison />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(12);
    for (const row of rows) {
      expect(memberCell(row).querySelector("[role=img]")?.getAttribute("aria-label")).toBe("Ada");
      expect(within(row).queryByText("Segera")).toBeNull();
    }
  });
});
