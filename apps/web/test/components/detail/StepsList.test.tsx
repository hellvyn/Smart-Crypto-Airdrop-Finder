// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/coach/actions", () => ({ startCoachThreadAction: vi.fn() }));

import { StepsList } from "@/components/detail/StepsList";

afterEach(cleanup);

describe("StepsList", () => {
  it("is titled 03 · Step garap", () => {
    render(<StepsList steps={[]} links={[]} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("03 · Step garap");
  });

  it("groups the steps by cadence, Daily, then Weekly, then Sekali, keeping their order", () => {
    render(
      <StepsList
        steps={[
          { text: "Bridge aset ke Arbitrum.", cadence: "once" },
          { text: "Trade minimal sekali.", cadence: "daily" },
          { text: "Cek points tiap Senin.", cadence: "weekly" },
          { text: "Connect akun X.", cadence: "once" },
          { text: "Check-in di dashboard.", cadence: "daily" },
        ]}
        links={[]}
      />,
    );
    const groups = screen.getAllByRole("list").map((list) => [
      list.getAttribute("aria-label"),
      within(list).getAllByRole("listitem").map((li) => li.textContent),
    ]);
    expect(groups).toEqual([
      ["Daily", ["Trade minimal sekali.", "Check-in di dashboard."]],
      ["Weekly", ["Cek points tiap Senin."]],
      ["Sekali", ["Bridge aset ke Arbitrum.", "Connect akun X."]],
    ]);
  });

  it("says so when there is no step", () => {
    render(<StepsList steps={[]} links={[]} />);
    expect(screen.getByText("Belum ada step.")).toBeTruthy();
  });

  it("shows the check status of a link a step names, and never links a phishing one", () => {
    const { container } = render(
      <StepsList
        steps={[
          { text: "Trade di app.nebula.example tiap hari.", cadence: "daily" },
          { text: "Claim di claim-nebula.example.", cadence: "once" },
        ]}
        links={[
          { url: "https://app.nebula.example/trade", kind: "app", status: "official" },
          { url: "https://claim-nebula.example/", kind: "claim", status: "phishing" },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "app.nebula.example/trade" }).getAttribute("href")).toBe("https://app.nebula.example/trade");
    expect(screen.getByText("✓ Official domain")).toBeTruthy();
    expect(screen.getByText("Link di-hide: kedeteksi phishing")).toBeTruthy();
    expect(container.querySelector("a[href*='claim-nebula']")).toBeNull();
  });

  it("renders a step's markup and URL as text", () => {
    const { container } = render(<StepsList steps={[{ text: "<b>Go</b> https://x.example", cadence: "once" }]} links={[]} />);
    expect(container.querySelector("b, a")).toBeNull();
    expect(screen.getByText("<b>Go</b> https://x.example")).toBeTruthy();
  });

  it("matches a link's host in a step only as a whole host, never inside a longer one", () => {
    const links = [{ url: "https://x.io/claim", kind: "claim", status: "official" as const }];
    render(<StepsList steps={[{ text: "Swap di max.io dan x.io.evil.example tiap hari.", cadence: "daily" }]} links={links} />);
    expect(screen.queryByText("✓ Official domain")).toBeNull();
    cleanup();
    render(<StepsList steps={[{ text: "Claim lewat x.io, lalu cek points.", cadence: "once" }]} links={links} />);
    expect(screen.getByText("✓ Official domain")).toBeTruthy();
    cleanup();
    render(<StepsList steps={[{ text: "Buka https://x.io/claim.", cadence: "once" }]} links={links} />);
    expect(screen.getByText("✓ Official domain")).toBeTruthy();
  });
});

describe("StepsList: Jelasin langkah ini", () => {
  const PID = "44444444-4444-4444-8444-444444444444";
  const S1 = "55555555-5555-4555-8555-555555555551";
  const steps = [
    { id: S1, text: "Bridge aset ke Arbitrum.", cadence: "once" as const },
    { text: "Step tanpa id.", cadence: "daily" as const },
  ];

  it("gives a member a button under each step that has an id, and nothing under one that has none", () => {
    render(<StepsList steps={steps} links={[]} member projectId={PID} />);
    expect(screen.getAllByRole("button", { name: "Jelasin langkah ini" })).toHaveLength(1);
    const item = screen.getByText("Bridge aset ke Arbitrum.").closest("li")!;
    expect(within(item).getByRole("button", { name: "Jelasin langkah ini" })).toBeTruthy();
  });

  it("gives a visitor no control and no trace of it in the markup", () => {
    const { container } = render(<StepsList steps={steps} links={[]} projectId={PID} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.innerHTML).not.toContain("Jelasin langkah ini");
  });
});
