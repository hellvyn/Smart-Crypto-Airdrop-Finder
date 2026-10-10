// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import LandingPage from "@/app/(public)/page";
import { TodayCheck } from "@/components/landing/TodayCheck";
import { TrackRecord } from "@/components/landing/TrackRecord";

afterEach(cleanup);

async function renderLanding(searchParams: Record<string, string | string[] | undefined> = {}) {
  return render(await LandingPage({ searchParams: Promise.resolve(searchParams) }));
}

describe("landing page", () => {
  it("leads with the hero and sends visitors to the list and to the why section", async () => {
    await renderLanding();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Airdrop yang worth it digarap, udah kami cek duluan.");
    expect(
      screen.getByText(
        "Kami udah terlalu sering lihat orang kena link claim palsu di grup Telegram. Makanya aturannya simpel. Airdrop yang gak lolos 4 security check gak bakal tampil di sini, se-hype apa pun.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Lihat airdrop" }).getAttribute("href")).toBe("/airdrops");
    expect(screen.getByRole("link", { name: "Kenapa AirdropIQ" }).getAttribute("href")).toBe("#cara");
  });

  it("has the why section at #cara with its badge, heading, stamp and both paragraphs", async () => {
    const { container } = await renderLanding();
    const cara = container.querySelector("section#cara");
    expect(cara).not.toBeNull();
    const why = within(cara as HTMLElement);
    expect(why.getByText("Re-check tiap pagi, 06.00 WIB")).toBeTruthy();
    expect(why.getByRole("heading", { level: 2 }).textContent).toBe("Tiap hari semua airdrop kami cek ulang dari nol.");
    expect(why.getByRole("img", { name: "LOLOS 4/4 CEK ATAU GAK TAMPIL" })).toBeTruthy();
    expect(
      why.getByText(
        "Jujur aja, kebanyakan web airdrop cuma copas announcement. Kami gak. Source-nya kami baca sendiri, link claim-nya kami cek, baru setelah itu airdrop-nya boleh masuk list.",
      ),
    ).toBeTruthy();
    expect(
      why.getByText(
        "Badge verified cuma kami pasang kalau datanya cocok. Project ngaku di-backing VC gede tapi buktinya gak ada? Kami tulis apa adanya: masih klaim.",
      ),
    ).toBeTruthy();
  });

  it("compares free and member in 12 rows, 6 free and 6 member only", async () => {
    await renderLanding();
    const table = screen.getByRole("table", { name: "Apa bedanya gratis sama member?" });
    const rows = within(table).getAllByRole("row").slice(1);
    const summary = rows.map((row) => {
      const cells = within(row).getAllByRole("cell");
      return [
        within(row).getByRole("rowheader").textContent,
        cells[0]!.querySelector("[role=img]")?.getAttribute("aria-label"),
        cells[1]!.querySelector("[role=img]")?.getAttribute("aria-label"),
      ];
    });
    expect(summary).toEqual([
      ["List airdrop yang lolos checkYang live sekarang, early, dan yang udah ended.", "Ada", "Ada"],
      ["Security check4 check utama, plus warning kalau ada pola scam.", "Ada", "Ada"],
      ["Status link claimOfficial, beda domain, atau di-hide karena phishing.", "Ada", "Ada"],
      ["Sumber yang beda ceritaKalau dua source gak sinkron, kamu lihat dua-duanya.", "Ada", "Ada"],
      ["Step garapStep-by-step, udah dalam Bahasa Indonesia.", "Ada", "Ada"],
      ["Track recordEnding dari airdrop yang pernah kami loloskan.", "Ada", "Ada"],
      ["Level worth itSepadan gak sama effort-nya, plus urutan dari yang paling worth it.", "Gak ada", "Ada"],
      ["AI verdictGarap, pantau, atau skip. Tiap alasan ada kutipan source-nya.", "Gak ada", "Ada"],
      ["Estimasi effortBerapa menit per hari, modal, dan gas fee.", "Gak ada", "Ada"],
      ["Morning briefingAirdrop baru dan update penting, dirangkum sebelum kamu buka grup.", "Gak ada", "Ada"],
      ["Farming CoachTanya mau garap yang mana dulu, sesuai modal dan jumlah wallet kamu.", "Gak ada", "Ada"],
      ["Farming tracker & watchlistDaily checklist, heatmap, dan update kalau ada yang berubah.", "Gak ada", "Ada"],
    ]);
  });

  it("offers no signup, no price and no em dash anywhere (#46)", async () => {
    const { container } = await renderLanding();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/daftar|sign ?up|register/i);
    expect(text).not.toMatch(/\$|Rp|harga|\/bulan/i);
    expect(text).not.toContain("—");
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/airdrops", "#cara"]);
  });

  it("ends with the footer disclaimer", async () => {
    const { container } = await renderLanding();
    const footer = container.querySelector("footer") as HTMLElement;
    expect(footer.textContent).toContain("© 2026 AirdropIQ");
    expect(footer.textContent).toContain("Not financial advice. Tetap DYOR sebelum connect wallet.");
  });

  it("does not render the run numbers or the track record until Plan 6 provides them", async () => {
    const { container } = await renderLanding();
    expect(container.querySelector("#jejak")).toBeNull();
    expect(screen.queryByText("Track record kami")).toBeNull();
    expect(screen.getByText("Update hari ini")).toBeTruthy();
    expect(screen.queryByText("lolos")).toBeNull();
  });

  it("tells a user who just deleted their account that it is gone, and nobody else", async () => {
    await renderLanding({ deleted: "1" });
    expect(screen.getByRole("status").textContent).toBe("Akun kamu udah dihapus.");
    cleanup();
    await renderLanding({ deleted: "yes" });
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("TodayCheck", () => {
  it("shows the box, the time and the LOLOS 4/4 CEK stamp without numbers when there is no run summary", () => {
    const { container } = render(<TodayCheck summary={null} />);
    expect(screen.getByText("Update hari ini")).toBeTruthy();
    expect(screen.getByText("06.00 WIB")).toBeTruthy();
    expect(screen.getByRole("img", { name: "LOLOS 4/4 CEK" })).toBeTruthy();
    expect(container.textContent).not.toMatch(/\d+\s*airdrop dicek|Tampil tanpa lolos check/);
  });

  it("shows how many airdrops were checked and passed when the run summary is known", () => {
    render(<TodayCheck summary={{ checked: 37, passed: 12 }} />);
    expect(screen.getByTestId("today-checked").textContent).toBe("37airdrop dicek");
    expect(screen.getByTestId("today-passed").textContent).toBe("12lolos");
    expect(screen.getByText(/Tampil tanpa lolos check:/).textContent).toBe("Tampil tanpa lolos check: 0");
  });
});

describe("TrackRecord", () => {
  it("renders nothing without a track record", () => {
    const { container } = render(<TrackRecord record={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing below 10 airdrops, too few to count as proof (#43)", () => {
    const { container } = render(<TrackRecord record={{ total: 9, listed: 4, noToken: 3, riskRaised: 2 }} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the three outcomes and the population at #jejak", () => {
    const { container } = render(<TrackRecord record={{ total: 14, listed: 6, noToken: 5, riskRaised: 3 }} />);
    expect(container.querySelector("section#jejak")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Track record kami");
    expect(screen.getByRole("img", { name: "6 Token listing" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "5 Ended tanpa token" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "3 Belakangan jadi risky" })).toBeTruthy();
    expect(screen.getByText("Dari 14 airdrop yang lolos sebelum token listing dan sekarang udah ended.")).toBeTruthy();
  });
});
