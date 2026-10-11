// @vitest-environment jsdom
// The landing's "Apa bedanya gratis sama member?" table. Features that do not exist yet are marked "Segera" and are
// never shown as included for members (owner, 2026-10-11: a paid product must not claim what it cannot do yet).
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PlanComparison } from "@/components/landing/PlanComparison";

afterEach(cleanup);

const rowOf = (title: string) =>
  within(screen.getByRole("table")).getAllByRole("row").find((r) => within(r).queryByRole("rowheader")?.querySelector(".landing-feature")?.textContent === title)!;

const memberCell = (row: HTMLElement) => within(row).getAllByRole("cell")[1]!;
const freeCell = (row: HTMLElement) => within(row).getAllByRole("cell")[0]!;

describe("PlanComparison", () => {
  it.each(["Morning briefing", "Farming Coach"])("marks %s as coming soon: a Segera tag by the title, Segera for members", (title) => {
    render(<PlanComparison />);
    const row = rowOf(title);
    const header = within(row).getByRole("rowheader");
    expect(within(header).getByText("Segera").getAttribute("data-soon")).toBe("");
    expect(memberCell(row).textContent).toBe("Segera");
    expect(memberCell(row).querySelector("[role=img]")).toBeNull();
    expect(within(row).queryByRole("img", { name: "Ada" })).toBeNull();
    expect(freeCell(row).querySelector("[role=img]")?.getAttribute("aria-label")).toBe("Gak ada");
  });

  it("shows every other member feature as included, without a Segera tag", () => {
    render(<PlanComparison />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    const others = rows.filter((r) => !["Morning briefing", "Farming Coach"].includes(r.querySelector(".landing-feature")?.textContent ?? ""));
    expect(others).toHaveLength(10);
    for (const row of others) {
      expect(memberCell(row).querySelector("[role=img]")?.getAttribute("aria-label")).toBe("Ada");
      expect(within(row).queryByText("Segera")).toBeNull();
    }
  });
});
