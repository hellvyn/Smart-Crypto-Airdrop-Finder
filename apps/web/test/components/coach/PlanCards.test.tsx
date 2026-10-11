// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanCardInfo } from "@/lib/coach-view";
import type { PlanRecommendation } from "@/lib/coach-client";

const actions = vi.hoisted(() => ({ startFarmingAction: vi.fn() }));
vi.mock("@/app/(app)/garapan/actions", () => actions);

import { PlanCards } from "@/components/coach/PlanCards";

afterEach(cleanup);
beforeEach(() => actions.startFarmingAction.mockReset().mockResolvedValue({ ok: true }));

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const NOL = "Langkah 0: bikin wallet dulu, lalu simpan seed phrase-nya di kertas, jangan di HP";

const recs: PlanRecommendation[] = [
  {
    project_id: A,
    slug: "alpha",
    name: "Alpha",
    reasons: [
      { text: "Programnya masih aktif.", quote: "Alpha points program is live" },
      { text: "Langkahnya ringan.", quote: "Bridge sedikit ETH ke Base" },
    ],
    minutes_per_day: 15,
    capital_note: "Gratis, mungkin tetap butuh sedikit gas kalau di mainnet.",
  },
  {
    project_id: B,
    slug: "beta",
    name: "Beta",
    reasons: [{ text: "Ada deadline dekat.", quote: "Claim ditutup bulan depan" }],
    minutes_per_day: 20,
    capital_note: "Butuh deposit minimal $50.",
  },
];

const cards: PlanCardInfo[] = [
  { id: A, slug: "alpha", name: "Alpha", riskLevel: "low", capital: "free", capitalMinUsd: null, logoSource: null },
  { id: B, slug: "beta", name: "Beta", riskLevel: "medium", capital: "deposit", capitalMinUsd: 50, logoSource: "defillama" },
];

const view = (over: Partial<Parameters<typeof PlanCards>[0]> = {}) =>
  render(<PlanCards recommendations={recs} cards={cards} level="intermediate" hasWallet langkahNol={NOL} {...over} />);

const card = (name: string) => screen.getByRole("article", { name });

describe("PlanCards", () => {
  it("draws a card per project with logo, risk, capital, minutes, reasons with their quotes", () => {
    view();
    const alpha = within(card("Alpha"));
    expect(alpha.getByTestId("logo-fallback")).toBeTruthy();
    expect(alpha.getByTestId("risk-badge").getAttribute("data-level")).toBe("low");
    expect(alpha.getByText("Gratis")).toBeTruthy();
    expect(alpha.getByText("Estimasi 15 menit per hari")).toBeTruthy();
    expect(alpha.getByText("Programnya masih aktif.")).toBeTruthy();
    expect(alpha.getByText('"Alpha points program is live"')).toBeTruthy();
    expect(alpha.getByText("Langkahnya ringan.")).toBeTruthy();
    const beta = within(card("Beta"));
    expect(beta.getByText("Butuh $50+")).toBeTruthy();
    expect(beta.getByRole("img", { name: "Logo Beta" })).toBeTruthy();
  });

  it("links a project's name to its own page and nothing to an outside host", () => {
    const { container } = view();
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href).toMatch(/^\/(projects\/|garapan$)/);
    expect(within(card("Alpha")).getByRole("link", { name: "Alpha" }).getAttribute("href")).toBe("/projects/alpha");
  });

  it("renders a model's markup and URL as plain text", () => {
    const evil = [{ ...recs[0]!, reasons: [{ text: "<b>x</b> https://evil.example/a", quote: "<img src=x onerror=alert(1)>" }] }];
    const { container } = view({ recommendations: evil });
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("img[src='x']")).toBeNull();
    expect([...container.querySelectorAll("a")].some((a) => (a.getAttribute("href") ?? "").includes("evil"))).toBe(false);
    expect(screen.getByText(/<b>x<\/b> https:\/\/evil\.example\/a/)).toBeTruthy();
  });

  it("puts the security reminder above the cards for a Pemula only", () => {
    const { rerender } = view({ level: "beginner" });
    const note = screen.getByTestId("coach-security");
    expect(note.textContent).toContain("Seed phrase dan private key gak pernah dibagi ke siapa pun");
    expect(note.compareDocumentPosition(card("Alpha")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    rerender(<PlanCards recommendations={recs} cards={cards} level="pro" hasWallet langkahNol={NOL} />);
    expect(screen.queryByTestId("coach-security")).toBeNull();
  });

  it("starts the plan with Langkah 0 for a member without a wallet only", () => {
    const { rerender } = view({ hasWallet: false });
    expect(screen.getByTestId("coach-langkah-nol").textContent).toBe(NOL);
    rerender(<PlanCards recommendations={recs} cards={cards} level="pro" hasWallet langkahNol={NOL} />);
    expect(screen.queryByTestId("coach-langkah-nol")).toBeNull();
  });

  it("adds the gas note to a free project once, and not to a project that needs a deposit", () => {
    view();
    const alpha = card("Alpha").textContent ?? "";
    expect(alpha.match(/mungkin tetap butuh sedikit gas kalau di mainnet/g)).toHaveLength(1);
    expect(card("Beta").textContent).not.toContain("gas kalau di mainnet");
    cleanup();
    view({ recommendations: [{ ...recs[0]!, capital_note: "Gak perlu modal." }] });
    expect(card("Alpha").textContent).toContain("mungkin tetap butuh sedikit gas kalau di mainnet");
  });

  it("starts farming through startFarmingAction and then points to Garapan saya", async () => {
    view();
    fireEvent.click(within(card("Alpha")).getByRole("button", { name: "Mulai garap" }));
    await waitFor(() => expect(actions.startFarmingAction).toHaveBeenCalledWith(A));
    const link = await within(card("Alpha")).findByRole("link", { name: "Buka Garapan saya" });
    expect(link.getAttribute("href")).toBe("/garapan");
    expect(within(card("Alpha")).queryByRole("button", { name: "Mulai garap" })).toBeNull();
    expect(within(card("Beta")).getByRole("button", { name: "Mulai garap" })).toBeTruthy();
  });

  it("shows why starting was refused, such as the project limit, and keeps the button", async () => {
    actions.startFarmingAction.mockResolvedValue({ ok: false, error: "project_limit" });
    view();
    fireEvent.click(within(card("Beta")).getByRole("button", { name: "Mulai garap" }));
    expect((await within(card("Beta")).findByRole("alert")).textContent).toMatch(/\S/);
    expect(within(card("Beta")).getByRole("button", { name: "Mulai garap" })).toBeTruthy();
  });

  it("still draws a plain card for a project the list no longer has", () => {
    view({ cards: [cards[0]!] });
    expect(within(card("Beta")).getByText("Estimasi 20 menit per hari")).toBeTruthy();
    expect(within(card("Beta")).getByRole("button", { name: "Mulai garap" })).toBeTruthy();
  });
});
