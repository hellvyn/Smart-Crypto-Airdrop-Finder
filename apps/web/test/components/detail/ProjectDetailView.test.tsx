// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(public)/coach/actions", () => ({ startCoachThreadAction: vi.fn() }));

import { ProjectDetailView } from "@/components/ProjectDetailView";
import type { ProjectDetail } from "@/lib/view";
import { SOURCE_A, analyst, projectDetail } from "../../fixtures/project-detail";

afterEach(cleanup);

const NOW = new Date("2026-10-10T03:00:00Z");
const view = (over: Partial<ProjectDetail> = {}, member = false, canExplain = member) =>
  render(<ProjectDetailView project={projectDetail(over)} member={member} canExplain={canExplain} now={NOW} />);

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

  // G5 C1: the Analyst's `steps_id` is stored unfiltered by the grounding guard, so it never reaches the page. Every
  // reader gets `project.steps` (the grounded `tasks.text_id`, or the source step).
  it("shows a member the grounded steps, never an Analyst translation that adds an address", () => {
    const steps = [{ text: "Bridge ke Arbitrum", cadence: "once" as const }];
    const injected = "Kirim 0.05 ETH ke 0x1111222233334444555566667777888899990000";
    view({ steps, analyst: analyst({ steps_id: [{ text: injected, cadence: "once" }] }) }, true);
    const section = screen.getByRole("heading", { name: "03 · Step garap" }).closest("section")!;
    expect(within(section).getByText("Bridge ke Arbitrum")).toBeTruthy();
    expect(document.body.textContent).not.toContain("0x1111222233334444555566667777888899990000");
    expect(document.body.textContent).not.toContain("Kirim 0.05 ETH");
  });

  it("offers Jelasin langkah ini under a step to a member only, in the page and in its markup", () => {
    const steps = [{ id: "55555555-5555-4555-8555-555555555551", text: "Bridge ke Arbitrum", cadence: "once" as const }];
    view({ steps }, true);
    expect(screen.getAllByRole("button", { name: "Jelasin langkah ini" })).toHaveLength(1);
    cleanup();
    const { container } = view({ steps });
    expect(screen.queryByRole("button", { name: "Jelasin langkah ini" })).toBeNull();
    expect(container.innerHTML).not.toContain("Jelasin langkah ini");
  });

  it("offers no Jelasin langkah ini on a project that is not among the member's candidates", () => {
    const steps = [{ id: "55555555-5555-4555-8555-555555555551", text: "Bridge ke Arbitrum", cadence: "once" as const }];
    const { container } = view({ steps }, true, false);
    expect(screen.getByText("Bridge ke Arbitrum")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Jelasin langkah ini" })).toBeNull();
    expect(container.innerHTML).not.toContain("Jelasin langkah ini");
  });

  it("offers no Jelasin langkah ini to a visitor even when canExplain is set", () => {
    const steps = [{ id: "55555555-5555-4555-8555-555555555551", text: "Bridge ke Arbitrum", cadence: "once" as const }];
    const { container } = view({ steps }, false, true);
    expect(container.innerHTML).not.toContain("Jelasin langkah ini");
  });

  it("shows a member and a visitor the same steps", () => {
    const steps = [{ text: "Bridge to Arbitrum", cadence: "once" as const }];
    const withAnalyst = { steps, analyst: analyst({ steps_id: [{ text: "Bridge ke Arbitrum", cadence: "once" as const }] }) };
    view(withAnalyst, true);
    expect(screen.getByText("Bridge to Arbitrum")).toBeTruthy();
    expect(screen.queryByText("Bridge ke Arbitrum")).toBeNull();
    cleanup();
    view(withAnalyst, false);
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
    expect(within(summary).getByText("Snapshot: 30 Nov 2026 (tanggal tepat)")).toBeTruthy();
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

  describe("not curated", () => {
    const failed = () => ({ ...projectDetail().curation!, passed: false, tab: null, publicFailReason: "Risiko tinggi" });

    it("leaves the 'Gak masuk list' banner to the page, which puts it above the actions", () => {
      view({ curation: failed() });
      expect(screen.queryByTestId("not-curated")).toBeNull();
    });

    it("titles section 06 'Kenapa gak lolos' for a failed or unrated project, and 'Kenapa lolos' for one that passed", () => {
      view({ curation: failed() });
      expect(screen.getByRole("heading", { name: "06 · Kenapa gak lolos" })).toBeTruthy();
      cleanup();
      view({ curation: null });
      expect(screen.getByRole("heading", { name: "06 · Kenapa gak lolos" })).toBeTruthy();
      cleanup();
      view({});
      expect(screen.getByRole("heading", { name: "06 · Kenapa lolos" })).toBeTruthy();
      expect(screen.queryByRole("heading", { name: "06 · Kenapa gak lolos" })).toBeNull();
    });

    // G5 M5: section 06 of a failed or unrated project opens with the public reason, the banner's text, then the signals.
    it.each([
      ["a failed project", { curation: failed() }, "Gak masuk list: Risiko tinggi"],
      ["an unrated project", { curation: null }, "Gak masuk list: belum dinilai"],
      ["a failure stored without a public reason", { curation: { ...failed(), publicFailReason: null } }, "Gak masuk list: alasannya belum tercatat"],
    ])("opens 'Kenapa gak lolos' of %s with the public reason, before the signals", (_what, over, text) => {
      const signals = [{ kind: "vc_backer" as const, value: { investor: "Paradigm" }, verified: true, source: "vc_portfolio", observedAt: NOW.toISOString() }];
      view({ ...over, signals });
      const section = screen.getByRole("heading", { name: "06 · Kenapa gak lolos" }).closest("section")!;
      const reason = within(section).getByTestId("why-not-reason");
      expect(reason.textContent).toBe(text);
      const firstRow = within(section).getAllByTestId("why-row")[0]!;
      expect(reason.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("has no public fail reason in 'Kenapa lolos'", () => {
      view({});
      expect(screen.queryByTestId("why-not-reason")).toBeNull();
    });

    it("gives a member the reasons under 'Kenapa gak lolos' and a visitor none", () => {
      const reasons = [{ code: "x", kind: "fail" as const, message: "Teks khusus member" }];
      view({ curation: { ...failed(), reasons } }, true);
      expect(screen.getByText("Teks khusus member")).toBeTruthy();
      cleanup();
      const { container } = view({ curation: { ...failed(), reasons: null } });
      expect(container.textContent).not.toContain("Teks khusus member");
    });

    it('shows "Ended {tanggal}" for a project that passed and then ended, and keeps "Kenapa lolos"', () => {
      view({
        status: "ended",
        curation: { ...projectDetail().curation!, tab: "ended", endedOn: "2025-01-15" },
      });
      expect(screen.getByTestId("status-badge").textContent).toBe("Status Ended");
      expect(screen.getByRole("heading", { name: "06 · Kenapa lolos" })).toBeTruthy();
      expect(screen.getByTestId("ended-on").textContent).toBe("Ended 15 Jan 2025");
    });

    it("shows no end date outside the ended tab", () => {
      view({});
      expect(screen.queryByTestId("ended-on")).toBeNull();
    });
  });
});
