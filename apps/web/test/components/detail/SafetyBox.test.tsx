// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SafetyBox } from "@/components/detail/SafetyBox";
import type { ProjectDetail } from "@/lib/view";
import { allChecks, check, projectDetail } from "../../fixtures/project-detail";

afterEach(cleanup);

type Risk = NonNullable<ProjectDetail["risk"]>;

function box(over: { risk?: Partial<Risk> | null; member?: boolean; links?: ProjectDetail["links"]; scamFlags?: ProjectDetail["scamFlags"] } = {}) {
  const base = projectDetail().risk!;
  const risk = over.risk === null ? null : { ...base, ...over.risk };
  return render(
    <SafetyBox
      risk={risk}
      links={over.links ?? []}
      member={over.member ?? false}
      scamFlags={over.scamFlags ?? null}
    />,
  );
}

const strip = () =>
  Object.fromEntries(
    within(screen.getByRole("list", { name: "Ringkasan cek" }))
      .getAllByRole("listitem")
      .map((li) => [li.querySelector("[data-part='label']")?.textContent, li.querySelector("[data-part='value']")?.textContent]),
  );
const advancedRows = () => within(screen.getByRole("list", { name: "Advanced check" })).queryAllByRole("listitem");

describe("SafetyBox", () => {
  it("is titled 04 · Security check with the morning re-check time in WIB", () => {
    box();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("04 · Security check");
    expect(screen.getByText("Re-check tiap 2 hari · terakhir 06.00 WIB")).toBeTruthy();
  });

  it("counts the layers, sources read, links checked and red flags", () => {
    box({
      links: [
        { url: "https://claim.nebula.example/", kind: "claim", status: "official" },
        { url: "https://app.nebula.example/", kind: "app", status: "unchecked" },
        { url: "https://docs.nebula.example/", kind: "docs", status: null },
      ],
    });
    // 7 checks ran (ai_review included) + the claim link check.
    expect(strip()).toEqual({ "Lapis cek": "8", "Source dibaca": "4", "Link dicek": "1", "Red flag": "0" });
  });

  it("counts every warning of medium or more as a red flag, and an info reason as none", () => {
    box({
      risk: {
        reasons: [
          { code: "speculative", severity: "info", message: "Belum ada pengumuman airdrop.", source: "extraction" },
        ],
      },
    });
    expect(strip()["Red flag"]).toBe("0");
    cleanup();
    box({
      risk: {
        level: "high",
        reasons: [
          { code: "young_domain", severity: "medium", message: "nebula.example baru didaftarkan 20 hari lalu.", source: "rdap" },
          { code: "ai_scam_pattern", severity: "high", message: "Analisis AI: teks sumber minta seed phrase.", source: "ai" },
          { code: "speculative", severity: "info", message: "Belum ada pengumuman airdrop.", source: "extraction" },
        ],
      },
    });
    expect(strip()["Red flag"]).toBe("2");
    expect(screen.getByText("Analisis AI: teks sumber minta seed phrase.")).toBeTruthy();
  });

  it("counts distinct sources read, from the cross-check when the scanner did not say, and never documents", () => {
    box({ risk: { checks: allChecks().map((c) => (c.id === "dangerous_asks" ? { ...c, detail: null } : c)) } });
    // corroboration counted 3 distinct sources; the 2 source document URLs are not a source count.
    expect(strip()["Source dibaca"]).toBe("3");
    cleanup();
    box({ risk: { checks: allChecks().map((c) => ({ ...c, detail: null })) } });
    expect(strip()["Source dibaca"]).toBeUndefined();
    expect(strip()["Lapis cek"]).toBe("7");
  });

  it("says which checks could not run", () => {
    box();
    expect(screen.getByText("7/9 cek jalan. Belum bisa dicek: Risiko kontrak token, Kontrak verified.")).toBeTruthy();
  });

  it("shows the 4 key checks as must-pass cards with what each one looked at", () => {
    box();
    expect(screen.getByText("Wajib lolos")).toBeTruthy();
    expect(screen.getByText("Satu aja gagal jalan, project ini gak bakal tampil. Bukan dianggap lolos.")).toBeTruthy();
    const cards = screen.getAllByTestId("key-check");
    expect(cards.map((c) => c.querySelector("[data-part='code']")?.textContent)).toEqual(["Cek 01", "Cek 02", "Cek 03", "Cek 04"]);
    expect(cards.map((c) => c.querySelector("[data-part='title']")?.textContent)).toEqual([
      "Minta seed phrase / bayar dulu",
      "Domain tiruan",
      "Umur domain",
      "Database phishing",
    ]);
    expect(cards.map((c) => c.querySelector("[data-part='source']")?.textContent)).toEqual([
      "Scanner AirdropIQ",
      "Database AirdropIQ",
      "RDAP registry",
      "GoPlus Security",
    ]);
    expect(cards.map((c) => c.querySelector("[data-part='result']")?.textContent)).toEqual([
      "Gak ada",
      "Gak ada yang mirip",
      "2 tahun 3 bulan",
      "Bersih",
    ]);
    expect(cards.map((c) => c.querySelector("[data-part='detail']")?.textContent)).toEqual([
      'Semua teks dari 4 source di-scan, termasuk tiap step garap. Kalimat peringatan kayak "never share your seed phrase" gak dihitung.',
      "Link project ini dibandingin sama 1.240 domain official di database kami.",
      "Terdaftar 12 Jul 2024. Domain official di bawah 90 hari, atau link claim di bawah 30 hari, langsung bikin risiko naik.",
      "8 domain dan link dicocokin satu-satu ke database phishing.",
    ]);
  });

  it("still shows a card stored without detail, with no detail sentence and no made-up number", () => {
    box({ risk: { checks: allChecks().map((c) => ({ ...c, detail: null })) } });
    const cards = screen.getAllByTestId("key-check");
    expect(cards).toHaveLength(4);
    for (const card of cards) expect(card.querySelector("[data-part='detail']")).toBeNull();
    expect(cards[2]?.querySelector("[data-part='result']")?.textContent).toBe("Gak ada domain baru");
  });

  it("marks a key check that did not run, and one that found something", () => {
    box({
      risk: {
        level: "high",
        reasons: [{ code: "lookalike_domain", severity: "high", message: "nebu1a.example mirip nama.", source: "heuristic" }],
        checks: allChecks().map((c) =>
          c.id === "phishing_list" ? { ...c, ran: false, detail: null } : c.id === "lookalike" ? { ...c, flagged: true } : c,
        ),
      },
    });
    const cards = screen.getAllByTestId("key-check");
    expect(cards[1]?.querySelector("[data-part='result']")?.textContent).toBe("Ada yang mirip");
    expect(cards[1]?.getAttribute("data-tone")).toBe("warn");
    expect(cards[3]?.querySelector("[data-part='result']")?.textContent).toBe("Gak jalan");
    expect(cards[3]?.getAttribute("data-tone")).toBe("warn");
  });

  it("says there is a new domain when the age check found one, instead of the official domain's reassuring age", () => {
    box({
      risk: {
        level: "high",
        reasons: [
          { code: "new_claim_domain", severity: "high", message: "Link claim claim-x.example bukan domain resmi dan baru didaftarkan 5 hari lalu.", source: "rdap" },
        ],
        checks: allChecks().map((c) => (c.id === "domain_age" ? { ...c, flagged: true } : c)),
      },
    });
    const card = screen.getAllByTestId("key-check")[2]!;
    expect(card.querySelector("[data-part='result']")?.textContent).toBe("Ada domain baru");
    expect(card.getAttribute("data-tone")).toBe("warn");
    expect(card.textContent).not.toContain("2 tahun");
    expect(card.textContent).not.toContain("Terdaftar");
  });

  it("lists only the advanced checks that ran, never token_security that did not", () => {
    box({ member: true });
    expect(advancedRows().map((r) => r.querySelector("[data-part='title']")?.textContent)).toEqual([
      "Riwayat hack",
      "Cross-check antar source",
      "AI baca halaman claim",
    ]);
    expect(screen.queryByText("Risiko kontrak token")).toBeNull();
  });

  it("shows a member what each advanced check found, with its source", () => {
    box({ member: true });
    expect(advancedRows().map((r) => [r.querySelector("[data-part='result']")?.textContent, r.querySelector("[data-part='source']")?.textContent])).toEqual([
      ["0 kasus", "DefiLlama Hacks"],
      ["3 source", "Database AirdropIQ"],
      ["Gak ada pola scam", "Analisis AI"],
    ]);
    expect(screen.queryByText("Member only")).toBeNull();
  });

  it("stamps a visitor's advanced checks Member only, and points a flagged one to the public warning", () => {
    box({
      member: false,
      risk: {
        level: "medium",
        reasons: [{ code: "hack_history", severity: "medium", message: "Project ini punya 1 catatan hack.", source: "defillama" }],
        checks: allChecks().map((c) => (c.id === "hack_history" ? check("hack_history", { flagged: true }) : c.ran && ["corroboration", "ai_review"].includes(c.id) ? { ...c, detail: null } : c)),
      },
    });
    const rows = advancedRows();
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain("Ada temuan. Lihat alasan risiko di atas.");
    expect(rows[0]?.textContent).not.toContain("Member only");
    expect(rows.slice(1).map((r) => r.querySelector("[data-part='stamp']")?.textContent)).toEqual(["Member only", "Member only"]);
    expect(screen.getByText("Project ini punya 1 catatan hack.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("0 kasus");
  });

  it("lists the claim and app links with their status, and never links a phishing one", () => {
    const { container } = box({
      links: [
        { url: "https://claim.nebula.example/", kind: "claim", status: "official" },
        { url: "https://nebula-bonus.example/", kind: "app", status: "different_domain" },
        { url: "https://nebula-claim.example/", kind: "claim", status: "phishing" },
        { url: "https://docs.nebula.example/", kind: "docs", status: null },
      ],
    });
    const links = screen.getByRole("list", { name: "Link claim & app" });
    expect(within(links).getAllByRole("listitem")).toHaveLength(3);
    expect(within(links).getByText("✓ Official domain")).toBeTruthy();
    expect(within(links).getByText("⚠ Beda domain dari web official")).toBeTruthy();
    expect(within(links).getByText("Link di-hide: kedeteksi phishing")).toBeTruthy();
    expect(container.querySelector("a[href*='nebula-claim']")).toBeNull();
    expect(container.textContent).not.toContain("nebula-claim");
  });

  it("shows a member the AI scam flags with their quotes, as text", () => {
    const { container } = box({
      member: true,
      scamFlags: [{ pattern: "urgency", quote: "Only <b>2 hours</b> left", explanation: "Menekan pembaca supaya buru-buru." }],
    });
    expect(screen.getByText("Menekan pembaca supaya buru-buru.")).toBeTruthy();
    expect(screen.getByText(/"Only <b>2 hours<\/b> left"/)).toBeTruthy();
    expect(screen.getByRole("list", { name: "Temuan Analisis AI di teks source" }).querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<b>2 hours</b>");
  });

  it("says the project was not assessed yet when there is no assessment", () => {
    box({ risk: null });
    expect(screen.getByText("Project ini belum dinilai.")).toBeTruthy();
    expect(screen.queryByTestId("key-check")).toBeNull();
  });

  it("never says safe", () => {
    const { container } = box({ member: true });
    expect(container.textContent).not.toMatch(/\bsafe\b|\baman\b|dijamin/i);
  });
});
