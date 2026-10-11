// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FarmingResult } from "@/lib/farming";

const actions = vi.hoisted(() => ({
  submitResultForm: vi.fn(),
  submitShareAnonymous: vi.fn(),
}));
vi.mock("@/app/(app)/garapan/actions", () => actions);

import { ResultBox } from "@/components/farming/ResultBox";

afterEach(cleanup);
beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset().mockResolvedValue(undefined);
});

const PID = "22222222-2222-4222-8222-222222222222";
const PRICE_MISSING = "Harga belum ketemu, jumlah token tetap tersimpan.";

const result = (overrides: Partial<FarmingResult> = {}): FarmingResult => ({
  amount: 1250,
  noReward: false,
  claimedOn: "2026-10-07",
  usdAtClaim: 412,
  shareAnonymous: false,
  usdNow: 380,
  ...overrides,
});

function box(props: Partial<Parameters<typeof ResultBox>[0]> = {}) {
  return render(
    <ResultBox
      projectId={PID}
      projectName="Astra Swap"
      tokenSymbol="ASTRA"
      result={null}
      average={null}
      today="2026-10-11"
      {...props}
    />,
  );
}

async function submitted(control: HTMLElement, action: ReturnType<typeof vi.fn>): Promise<Record<string, unknown>> {
  fireEvent.click(control);
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  return Object.fromEntries((action.mock.calls[0]![0] as FormData).entries());
}

describe("ResultBox", () => {
  it("asks how much the airdrop gave, with an amount, a claim date up to today, Simpan and Gak dapet", async () => {
    box();
    const region = screen.getByRole("region", { name: "Dapet berapa dari airdrop ini?" });
    const amount = within(region).getByLabelText("Jumlah token") as HTMLInputElement;
    const date = within(region).getByLabelText("Tanggal claim") as HTMLInputElement;
    expect(date.type).toBe("date");
    expect(date.max).toBe("2026-10-11");
    fireEvent.change(amount, { target: { value: "1250" } });
    fireEvent.change(date, { target: { value: "2026-10-07" } });
    expect(await submitted(within(region).getByRole("button", { name: "Simpan" }), actions.submitResultForm)).toEqual({
      projectId: PID,
      from: "garapan",
      amount: "1250",
      claimedOn: "2026-10-07",
    });
  });

  it('"Gak dapet" sends the no-reward flag from its own form, without the required amount and date', async () => {
    box();
    expect(await submitted(screen.getByRole("button", { name: "Gak dapet" }), actions.submitResultForm)).toEqual({
      from: "garapan",
      projectId: PID,
      noReward: "1",
    });
  });

  it("shows the result with its value at claim and now, like the mockup", () => {
    box({ result: result() });
    const region = screen.getByRole("region", { name: "Hasil kamu" });
    expect(within(region).getByText("1.250 ASTRA")).toBeTruthy();
    expect(within(region).getByText("≈ $412 waktu claim (7 Okt) · sekarang ≈ $380")).toBeTruthy();
    expect(within(region).queryByText(PRICE_MISSING)).toBeNull();
    expect(screen.queryByRole("region", { name: "Dapet berapa dari airdrop ini?" })).toBeNull();
  });

  it("without a price at claim says the price was not found and keeps the token amount", () => {
    box({ result: result({ usdAtClaim: null, usdNow: null }) });
    const region = screen.getByRole("region", { name: "Hasil kamu" });
    expect(within(region).getByText(PRICE_MISSING)).toBeTruthy();
    expect(within(region).getByText("1.250 ASTRA")).toBeTruthy();
    expect(within(region).queryByText(/waktu claim/)).toBeNull();
  });

  it("leaves out today's value when today's price is not found, and writes small values in cents", () => {
    box({ result: result({ amount: 12.5, usdAtClaim: 4.16, usdNow: null }), tokenSymbol: null });
    expect(screen.getByText("≈ $4,16 waktu claim (7 Okt)")).toBeTruthy();
    expect(screen.getByText("12,5 token")).toBeTruthy();
  });

  it('shows "Gak dapet" for a result without reward', () => {
    box({ result: result({ amount: null, noReward: true, claimedOn: null, usdAtClaim: null, usdNow: null }) });
    const region = screen.getByRole("region", { name: "Hasil kamu" });
    expect(within(region).getByText("Gak dapet", { selector: "p" })).toBeTruthy();
    expect(within(region).queryByText(PRICE_MISSING)).toBeNull();
  });

  it("shows the member average only when there is one", () => {
    box({ result: result(), average: { contributors: 23, avgUsd: 296.4 } });
    expect(screen.getByText("Rata-rata member yang garap Astra Swap: ≈ $296 (dari 23 member yang mau berbagi)")).toBeTruthy();
    cleanup();
    box({ result: result(), average: null });
    expect(screen.queryByText(/Rata-rata member/)).toBeNull();
  });

  it("the anonymous-sharing box sends the wanted state", async () => {
    box({ result: result({ shareAnonymous: false }) });
    const share = screen.getByRole("checkbox", { name: "Boleh dipakai anonim buat rata-rata hasil member" });
    expect(share.getAttribute("aria-checked")).toBe("false");
    expect(await submitted(share, actions.submitShareAnonymous)).toEqual({ projectId: PID, from: "garapan", share: "1" });
    cleanup();
    actions.submitShareAnonymous.mockClear();
    box({ result: result({ shareAnonymous: true }) });
    const on = screen.getByRole("checkbox", { name: "Boleh dipakai anonim buat rata-rata hasil member" });
    expect(on.getAttribute("aria-checked")).toBe("true");
    expect(await submitted(on, actions.submitShareAnonymous)).toMatchObject({ share: "0" });
  });

  it("Ubah opens the form filled with the saved amount and date", () => {
    box({ result: result() });
    fireEvent.click(screen.getByText("Ubah"));
    expect((screen.getByLabelText("Jumlah token") as HTMLInputElement).value).toBe("1250");
    expect((screen.getByLabelText("Tanggal claim") as HTMLInputElement).value).toBe("2026-10-07");
  });

  it("credits the price data next to a USD value, and only when one is shown", () => {
    box({ result: result() });
    const note = screen.getByText(/^Data harga:/);
    expect(note.textContent).toBe("Data harga: CoinGecko, DefiLlama");
    expect(within(note).getByRole("link", { name: "CoinGecko" }).getAttribute("href")).toBe("https://www.coingecko.com/");
    expect(within(note).getByRole("link", { name: "DefiLlama" }).getAttribute("href")).toBe("https://defillama.com/");
    expect(within(note).getByRole("link", { name: "CoinGecko" }).getAttribute("rel")).toBe("noopener noreferrer nofollow");
    cleanup();
    box({ result: result({ usdAtClaim: null, usdNow: null }) });
    expect(screen.queryByText(/Data harga/)).toBeNull();
    cleanup();
    box();
    expect(screen.queryByText(/Data harga/)).toBeNull();
  });
});
