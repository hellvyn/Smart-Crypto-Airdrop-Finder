// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ saveCoachProfileAction: vi.fn() }));
vi.mock("@/app/(app)/coach/actions", () => actions);

import { ProfileForm } from "@/components/coach/ProfileForm";

afterEach(cleanup);
beforeEach(() => actions.saveCoachProfileAction.mockReset().mockResolvedValue({ ok: true }));

const HINT = "Banyak airdrop bisa digarap tanpa modal. Pilih 'Gratis aja' kalau belum mau keluar uang sama sekali.";

function renderForm(onSaved = vi.fn()) {
  render(<ProfileForm chains={["base", "ethereum"]} initial={null} submitLabel="Simpan dan bikin rencana" onSaved={onSaved} />);
  return onSaved;
}

/** Chooses the option whose text is `name` in whichever dropdown has it. */
function pick(name: string): void {
  for (const select of screen.getAllByRole("combobox") as HTMLSelectElement[]) {
    const option = [...select.options].find((o) => o.text === name);
    if (option) {
      fireEvent.change(select, { target: { value: option.value } });
      return;
    }
  }
  throw new Error(`no option ${name}`);
}
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Simpan dan bikin rencana" }));

describe("ProfileForm", () => {
  it("shows a message per empty required field and saves nothing", async () => {
    renderForm();
    submit();
    for (const text of [
      "Pilih level kamu.",
      "Pilih modal yang siap kamu pakai.",
      "Pilih udah atau belum punya wallet.",
      "Pilih waktu per hari.",
      "Pilih tujuan kamu.",
    ]) {
      expect(await screen.findByText(text)).toBeTruthy();
    }
    expect(actions.saveCoachProfileAction).not.toHaveBeenCalled();
  });

  it("shows the Pemula hint under the capital field only for a Pemula, word for word", () => {
    renderForm();
    expect(screen.queryByText(HINT)).toBeNull();
    pick("Menengah");
    expect(screen.queryByText(HINT)).toBeNull();
    pick("Pemula");
    expect(screen.getByText(HINT)).toBeTruthy();
  });

  it("hides the wallet count for Belum and asks for it (1 to 10) for Udah", async () => {
    renderForm();
    expect(screen.queryByLabelText("Jumlah wallet")).toBeNull();
    pick("Udah");
    expect(screen.getByLabelText("Jumlah wallet")).toBeTruthy();
    pick("Belum");
    expect(screen.queryByLabelText("Jumlah wallet")).toBeNull();
    pick("Udah");
    submit();
    expect(await screen.findByText("Isi jumlah wallet, 1 sampai 10.")).toBeTruthy();
    // The dropdown offers 1 to 10 only.
    expect([...(screen.getByLabelText("Jumlah wallet") as HTMLSelectElement).options].map((o) => o.value)).toEqual([
      "",
      ...Array.from({ length: 10 }, (_, i) => String(i + 1)),
    ]);
  });

  it("saves the profile it was filled with, chains included, then calls onSaved", async () => {
    const onSaved = renderForm();
    pick("Pemula");
    pick("Gratis aja ($0)");
    pick("Belum");
    pick("30 menit");
    pick("Belajar dulu");
    fireEvent.click(screen.getByRole("checkbox", { name: "base" }));
    submit();
    const expected = {
      level: "beginner",
      capital_band: "free",
      has_wallet: false,
      wallet_count: null,
      minutes_per_day: 30,
      goal: "learn",
      chains: ["base"],
    };
    await waitFor(() => expect(actions.saveCoachProfileAction).toHaveBeenCalledWith(expected));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expected));
  });

  it("keeps the form and says so when the server refuses the profile", async () => {
    actions.saveCoachProfileAction.mockResolvedValue({ ok: false, message: "Profil belum tersimpan. Cek isiannya, lalu coba lagi." });
    const onSaved = renderForm();
    pick("Pro");
    pick("> $1.000");
    pick("Udah");
    fireEvent.change(screen.getByLabelText("Jumlah wallet"), { target: { value: "4" } });
    pick("120+ menit");
    pick("Cuan cepat");
    submit();
    expect((await screen.findByRole("alert")).textContent).toContain("Profil belum tersimpan");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("starts from a saved profile", () => {
    render(
      <ProfileForm
        chains={["base"]}
        initial={{ level: "pro", capital_band: "up_to_100", has_wallet: true, wallet_count: 3, minutes_per_day: 60, goal: "long_term", chains: ["base"] }}
        submitLabel="Simpan profil"
        onSaved={() => {}}
      />,
    );
    expect((screen.getByLabelText("Level kamu") as HTMLSelectElement).value).toBe("pro");
    expect((screen.getByLabelText("Jumlah wallet") as HTMLSelectElement).value).toBe("3");
    expect((screen.getByRole("checkbox", { name: "base" }) as HTMLInputElement).checked).toBe(true);
  });
});
