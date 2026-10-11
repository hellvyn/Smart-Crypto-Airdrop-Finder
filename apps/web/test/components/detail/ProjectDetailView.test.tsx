// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectDetailView } from "@/components/ProjectDetailView";
import type { ProjectDetail } from "@/lib/view";
import { SOURCE_A, analyst, projectDetail } from "../../fixtures/project-detail";

afterEach(cleanup);

const NOW = new Date("2026-10-10T03:00:00Z");
const view = (over: Partial<ProjectDetail> = {}, member = false) =>
  render(<ProjectDetailView project={projectDetail(over)} member={member} now={NOW} />);

describe("ProjectDetailView", () => {
  it("lays the sections out in the page order, the side boxes last", () => {
    view({}, true);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "01 · AI verdict",
      "02 · Sumber yang beda cerita",
      "03 · Step garap",
      "04 · Security check",
      "05 · Estimasi effort",
      "06 · Kenapa lolos",
      "Ringkasan",
      "Update terbaru",
    ]);
  });

  it("heads the page with the name, status, risk in the glossary's head form, claim badge and check time", () => {
    view({ claimOpenChecked: true, tokenSymbol: "NEB" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Nebula Perps (NEB)");
    expect(screen.getByTestId("status-badge").textContent).toBe("Status Live");
    expect(screen.getByTestId("risk-head").textContent).toBe("Risiko rendah");
    expect(screen.getByText("Claim open · link dicek")).toBeTruthy();
    expect(screen.getByText("Dicek hari ini")).toBeTruthy();
    expect(screen.getByText("4/4 security check jalan")).toBeTruthy();
    expect(screen.getByRole("img", { name: "LOLOS 4/4 CEK 10.10.2026" })).toBeTruthy();
  });

  it("has no claim badge without a checked open claim, and no stamp for a project that did not pass", () => {
    view({ curation: { ...projectDetail().curation!, passed: false, tab: null, publicFailReason: "Risiko tinggi" } });
    expect(screen.queryByText("Claim open · link dicek")).toBeNull();
    expect(screen.queryByRole("img", { name: /LOLOS/ })).toBeNull();
  });

  it("says Risiko belum dinilai without an assessment", () => {
    view({ risk: null, riskLevel: null });
    expect(screen.getByTestId("risk-head").textContent).toBe("Risiko belum dinilai");
  });

  it("shows a member the worth level and the AI verdict, a visitor neither", () => {
    const curation = { ...projectDetail().curation!, worthLevel: "high" as const };
    view({ curation, analyst: analyst() }, true);
    expect(screen.getByText("Sangat worth it")).toBeTruthy();
    expect(screen.getByText("Garap")).toBeTruthy();
    cleanup();
    const { container } = view({ curation: { ...curation, worthLevel: null } });
    expect(container.textContent).not.toMatch(/worth it/i);
    expect(screen.queryByText("Garap")).toBeNull();
    expect(screen.getAllByText("Member only").length).toBeGreaterThanOrEqual(2);
  });

  it("gives a member the Analyst's Indonesian steps when it has them, and the source steps otherwise", () => {
    const steps = [{ text: "Bridge to Arbitrum", cadence: "once" as const }];
    view({ steps, analyst: analyst({ steps_id: [{ text: "Bridge ke Arbitrum", cadence: "once" }] }) }, true);
    expect(screen.getByText("Bridge ke Arbitrum")).toBeTruthy();
    expect(screen.queryByText("Bridge to Arbitrum")).toBeNull();
    cleanup();
    view({ steps, analyst: analyst({ steps_id: [] }) }, true);
    expect(screen.getByText("Bridge to Arbitrum")).toBeTruthy();
  });

  it("summarises the chains, deadlines, the project's own links and the key parameters a source states", () => {
    view({
      chains: ["ethereum", "base"],
      deadlines: [
        { kind: "snapshot", date: "2026-11-30", precision: "exact", text: "Snapshot" },
        { kind: "tge", date: null, precision: "quarter", text: "" },
      ],
      links: [
        { url: "https://nebula.example/", kind: "website", status: null },
        { url: "javascript:alert(1)", kind: "website", status: null },
        { url: "https://claim.nebula.example/", kind: "claim", status: "official" },
      ],
      facts: [
        { field: "key_parameter:allocation", value: "10% of supply", quote: "10% of supply", sourceUrl: SOURCE_A, at: "2026-10-09T00:00:00Z" },
      ],
    });
    const summary = screen.getByRole("heading", { name: "Ringkasan" }).closest("section")!;
    expect(within(summary).getByText("Chain: ethereum, base")).toBeTruthy();
    expect(within(summary).getByText("Snapshot: 2026-11-30 (tanggal tepat)")).toBeTruthy();
    expect(within(summary).getByText("TGE: tanggal belum diketahui (kuartalnya aja)")).toBeTruthy();
    expect(within(summary).getByRole("link", { name: "nebula.example" }).getAttribute("href")).toBe("https://nebula.example/");
    expect(within(summary).getByText("javascript:alert(1)")).toBeTruthy();
    expect(within(summary).getByText("Alokasi: 10% of supply")).toBeTruthy();
    expect(document.querySelector("a[href^='javascript']")).toBeNull();
  });

  it("says Chain belum diketahui when there is none", () => {
    view({ chains: [] });
    expect(screen.getByText("Chain belum diketahui")).toBeTruthy();
  });

  it("never says safe or eligible", () => {
    const { container } = view({ analyst: analyst() }, true);
    expect(container.textContent).not.toMatch(/\bsafe\b|\baman\b|eligible/i);
  });
});
