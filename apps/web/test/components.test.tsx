// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectDetailView } from "../components/ProjectDetailView";
import { Pagination } from "../components/Pagination";
import { ProjectRow } from "../components/ProjectRow";
import { RiskBadge } from "../components/RiskBadge";
import { StaleBanner } from "../components/StaleBanner";
import { StatusBadge } from "../components/StatusBadge";
import { WalletActivity } from "../components/WalletActivity";
import type { ProjectDetail } from "../lib/view";

afterEach(cleanup);

const LEVELS = ["low", "medium", "high", "critical", "insufficient_data", null] as const;
const STATUSES = ["live", "announced", "speculative", "ended", "unknown"] as const;

const CHECK_IDS = [
  "dangerous_asks",
  "phishing_list",
  "domain_age",
  "lookalike",
  "token_security",
  "contract_verified",
  "hack_history",
  "corroboration",
] as const;

function detail(over: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: "p1",
    slug: "demo",
    name: "Demo Protocol",
    status: "live",
    riskLevel: "medium",
    chains: ["ethereum"],
    nextDeadline: null,
    lastSeen: "2026-10-09T00:00:00Z",
    tokenSymbol: "DEMO",
    conflict: false,
    risk: {
      level: "medium",
      reasons: [{ code: "young_domain", severity: "medium", message: "Domain is younger than 90 days", source: "rdap" }],
      checks: CHECK_IDS.map((id, i) => ({ id, ran: i < 4 })),
      computedAt: "2026-10-10T01:00:00Z",
    },
    deadlines: [],
    tasks: [],
    links: [],
    evidence: [],
    ...over,
  };
}

describe("RiskBadge", () => {
  it("renders the Tinggi label under the Risiko heading", () => {
    render(<RiskBadge level="high" />);
    expect(screen.getByTestId("risk-badge").textContent).toBe("Risiko Tinggi");
  });

  it("never renders the word safe, at any level", () => {
    for (const level of LEVELS) {
      const { container, unmount } = render(<RiskBadge level={level} />);
      expect(container.textContent ?? "").not.toMatch(/safe|\baman\b/i);
      unmount();
    }
  });

  it("shows no numbers", () => {
    for (const level of LEVELS) {
      const { container, unmount } = render(<RiskBadge level={level} />);
      expect(container.textContent ?? "").not.toMatch(/\d/);
      unmount();
    }
  });

  it("labels Data belum cukup and Belum dinilai", () => {
    render(
      <>
        <RiskBadge level="insufficient_data" />
        <RiskBadge level={null} />
      </>,
    );
    expect(screen.getByText("Data belum cukup")).toBeTruthy();
    expect(screen.getByText("Belum dinilai")).toBeTruthy();
  });
});

describe("StatusBadge", () => {
  it("shows unknown as Belum pasti", () => {
    render(<StatusBadge status="unknown" />);
    expect(screen.getByTestId("status-badge").textContent).toBe("Status Belum pasti");
  });

  it("never renders safe or eligible", () => {
    for (const status of STATUSES) {
      const { container, unmount } = render(<StatusBadge status={status} />);
      expect(container.textContent ?? "").not.toMatch(/safe|eligible/i);
      unmount();
    }
  });
});

describe("StaleBanner", () => {
  const now = new Date("2026-10-10T12:00:00Z");

  it("shows when the last successful run is over 36 hours old", () => {
    render(<StaleBanner lastRunAt={new Date("2026-10-08T23:00:00Z")} now={now} />);
    expect(screen.getByRole("status").textContent).toBe(
      "Data mungkin udah gak update. Update terakhir yang berhasil: 2026-10-08 23:00 UTC.",
    );
  });

  it("shows when there has been no successful run", () => {
    render(<StaleBanner lastRunAt={null} now={now} />);
    expect(screen.getByRole("status").textContent).toBe("Data mungkin udah gak update. Belum ada update yang berhasil.");
  });

  it("renders nothing when data is fresh", () => {
    const { container } = render(<StaleBanner lastRunAt={new Date("2026-10-10T01:00:00Z")} now={now} />);
    expect(container.textContent).toBe("");
  });
});

describe("ProjectRow", () => {
  it("links to the detail page and shows both badges and the deadline", () => {
    render(
      <ProjectRow
        item={{
          slug: "demo",
          name: "Demo Protocol",
          status: "unknown",
          riskLevel: "critical",
          chains: ["ethereum", "base"],
          nextDeadline: { date: "2026-11-01", kind: "claim", precision: "exact" },
          lastSeen: "2026-10-09T00:00:00Z",
        }}
      />,
    );
    expect(screen.getByRole("link", { name: "Demo Protocol" }).getAttribute("href")).toBe("/projects/demo");
    expect(screen.getByText("Belum pasti")).toBeTruthy();
    expect(screen.getByText("Kritis")).toBeTruthy();
    expect(screen.getByText("Claim 2026-11-01 (tanggal tepat)")).toBeTruthy();
    expect(screen.getByText("ethereum, base")).toBeTruthy();
  });

  it("shows Chain belum diketahui and no deadline when there are none", () => {
    render(
      <ProjectRow
        item={{ slug: "x", name: "X", status: "live", riskLevel: null, chains: [], nextDeadline: null, lastSeen: "2026-10-09T00:00:00Z" }}
      />,
    );
    expect(screen.getByText("Chain belum diketahui")).toBeTruthy();
    expect(screen.getByText("Belum ada deadline yang jelas")).toBeTruthy();
    expect(screen.getByText("Belum dinilai")).toBeTruthy();
  });
});

describe("ProjectDetailView", () => {
  it("shows Chain belum diketahui and no wallet check button when chains is empty", () => {
    render(<ProjectDetailView project={detail({ chains: [] })} />);
    expect(screen.getByText("Chain belum diketahui")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/cek aktivitas wallet/i)).toBeNull();
  });

  it("lists the chains", () => {
    render(<ProjectDetailView project={detail({ chains: ["ethereum", "base"] })} />);
    expect(screen.getByText("Chain: ethereum, base")).toBeTruthy();
  });

  it("shows the two conflicting status quotes under Sumber yang beda cerita", () => {
    render(
      <ProjectDetailView
        project={detail({
          conflict: true,
          evidence: [
            { field: "status", value: "live", quote: "The airdrop is live now", sourceUrl: "https://a.example/post", at: "2026-10-08T00:00:00Z" },
            { field: "status", value: "ended", quote: "The airdrop has ended", sourceUrl: "https://b.example/post", at: "2026-10-09T00:00:00Z" },
          ],
        })}
      />,
    );
    expect(screen.getByRole("heading", { name: "Sumber yang beda cerita" })).toBeTruthy();
    expect(
      screen.getByText("Source-nya gak sepakat soal status airdrop ini. Anggap aja statusnya belum pasti."),
    ).toBeTruthy();
    const quotes = screen.getByRole("list", { name: "Kutipan status yang beda" });
    expect(within(quotes).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Lihat kutipan yang beda cerita di atas.")).toBeTruthy();
    expect(screen.getByText(/The airdrop is live now/)).toBeTruthy();
    expect(screen.getByText(/The airdrop has ended/)).toBeTruthy();
  });

  it("does not show Sumber yang beda cerita without a conflict", () => {
    render(<ProjectDetailView project={detail()} />);
    expect(screen.queryByText("Sumber yang beda cerita")).toBeNull();
  });

  it("names the sections in Indonesian and says when each one is empty", () => {
    render(<ProjectDetailView project={detail()} />);
    for (const name of ["Risiko", "Deadline", "Step garap", "Link", "Bukti"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeTruthy();
    }
    expect(screen.getByText("Belum ada deadline.")).toBeTruthy();
    expect(screen.getByText("Belum ada step.")).toBeTruthy();
    expect(screen.getByText("Gak ada link lain.")).toBeTruthy();
    expect(screen.getByText("Belum ada bukti yang tercatat.")).toBeTruthy();
    expect(screen.getByText("Dinilai 2026-10-10")).toBeTruthy();
  });

  it("shows deadlines with their kind and precision, and an unknown date in words", () => {
    render(
      <ProjectDetailView
        project={detail({
          deadlines: [
            { kind: "snapshot", date: "2026-10-20", precision: "exact", text: "Snapshot tanggal 20" },
            { kind: "tge", date: null, precision: "quarter", text: "" },
          ],
          tasks: ["Bridge ke mainnet"],
        })}
      />,
    );
    const deadlines = screen.getByRole("heading", { name: "Deadline" }).parentElement!;
    expect(within(deadlines).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Snapshot: 2026-10-20 (tanggal tepat) · Snapshot tanggal 20",
      "TGE: tanggal belum diketahui (kuartalnya aja)",
    ]);
    expect(screen.getByText("Bridge ke mainnet")).toBeTruthy();
  });

  it("says when no reason was recorded", () => {
    render(<ProjectDetailView project={detail({ risk: { ...detail().risk!, reasons: [] } })} />);
    expect(screen.getByText("Gak ada alasan risiko yang tercatat.")).toBeTruthy();
  });

  it("shows check coverage", () => {
    render(<ProjectDetailView project={detail()} />);
    expect(
      screen.getByText(
        "4/9 security check jalan. Belum bisa dicek: Risiko kontrak token, Kontrak verified, Riwayat hack, Cross-check antar source, Review AI.",
      ),
    ).toBeTruthy();
  });

  it("shows the reasons and the level without a number", () => {
    render(<ProjectDetailView project={detail()} />);
    const reasons = screen.getByRole("list", { name: "Alasan risiko" });
    expect(within(reasons).getByRole("listitem").textContent).toBe("Tingkat sedang: Domain is younger than 90 days (rdap)");
    expect(screen.getByText("Sedang")).toBeTruthy();
  });

  it("renders the claim link as an unverified official checker next to the risk badge", () => {
    render(
      <ProjectDetailView
        project={detail({ links: [{ url: "https://claim.demo.example/check", kind: "claim" }] })}
      />,
    );
    const link = screen.getByRole("link", { name: "Checker official (belum verified)" });
    expect(link.getAttribute("href")).toBe("https://claim.demo.example/check");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(link.getAttribute("target")).toBe("_blank");
    const badge = screen.getByTestId("risk-badge");
    expect(badge.parentElement).toBe(link.closest("[data-testid='risk-line']"));
  });

  it("does not turn non-http links into anchors, and never injects HTML", () => {
    const { container } = render(
      <ProjectDetailView
        project={detail({
          links: [{ url: "javascript:alert(1)", kind: "website" }],
          evidence: [
            { field: "dangerous_ask", value: "x", quote: "<img src=x onerror=alert(1)>", sourceUrl: "javascript:alert(2)", at: "2026-10-08T00:00:00Z" },
          ],
        })}
      />,
    );
    expect(container.querySelector("a[href^='javascript']")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("shows evidence with a source link and a date", () => {
    render(
      <ProjectDetailView
        project={detail({
          evidence: [
            { field: "defillama_listing", value: "listed", quote: "Listed on DefiLlama", sourceUrl: "https://defillama.com/airdrops", at: "2026-10-08T05:00:00Z" },
          ],
        })}
      />,
    );
    const list = screen.getByRole("list", { name: "Bukti" });
    expect(within(list).getByText(/Listed on DefiLlama/)).toBeTruthy();
    expect(within(list).getByRole("link").getAttribute("href")).toBe("https://defillama.com/airdrops");
    expect(within(list).getByText(/2026-10-08/)).toBeTruthy();
    expect(within(list).getByText("Listing DefiLlama")).toBeTruthy();
  });

  it("says when there is no risk assessment yet", () => {
    render(<ProjectDetailView project={detail({ risk: null, riskLevel: null })} />);
    expect(screen.getByText("Belum dinilai")).toBeTruthy();
    expect(screen.getByText("Project ini belum dinilai.")).toBeTruthy();
    expect(screen.queryByText(/security check jalan/)).toBeNull();
  });

  it("uses wallet activity wording only, never eligible or safe", () => {
    const { container } = render(<ProjectDetailView project={detail()} />);
    expect(container.textContent ?? "").not.toMatch(/eligible|\bsafe\b|\baman\b/i);
  });
});

describe("unsafe claim link", () => {
  it("hides the official checker label entirely when the claim URL is not http(s)", () => {
    render(<ProjectDetailView project={detail({ links: [{ url: "javascript:alert(1)", kind: "claim" }] })} />);
    expect(screen.queryByText(/Checker official/)).toBeNull();
    expect(document.querySelector("a[href^='javascript']")).toBeNull();
  });
});

describe("Pagination", () => {
  it("links Sebelumnya and Berikutnya and keeps the filters", () => {
    render(<Pagination page={2} pageSize={50} total={120} filters={{ status: ["live"], risk: ["high"], chain: "base" }} />);
    expect(screen.getByRole("navigation", { name: "Halaman" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sebelumnya" }).getAttribute("href")).toBe("/airdrops?status=live&risk=high&chain=base");
    expect(screen.getByRole("link", { name: "Berikutnya" }).getAttribute("href")).toBe("/airdrops?status=live&risk=high&chain=base&page=3");
    expect(screen.getByText("51-100 dari 120")).toBeTruthy();
  });

  it("has no Berikutnya on the last page and no Sebelumnya on the first", () => {
    const { unmount } = render(<Pagination page={1} pageSize={50} total={55} filters={{}} />);
    expect(screen.queryByRole("link", { name: "Sebelumnya" })).toBeNull();
    expect(screen.getByRole("link", { name: "Berikutnya" }).getAttribute("href")).toBe("/airdrops?page=2");
    unmount();
    render(<Pagination page={2} pageSize={50} total={55} filters={{}} />);
    expect(screen.queryByRole("link", { name: "Berikutnya" })).toBeNull();
    expect(screen.getByRole("link", { name: "Sebelumnya" }).getAttribute("href")).toBe("/airdrops");
  });

  it("renders nothing for a single page", () => {
    const { container } = render(<Pagination page={1} pageSize={50} total={3} filters={{}} />);
    expect(container.textContent).toBe("");
  });

  it("links back to the last page when the page is past the end", () => {
    render(<Pagination page={9} pageSize={50} total={55} filters={{}} />);
    expect(screen.getByRole("link", { name: "Sebelumnya" }).getAttribute("href")).toBe("/airdrops?page=2");
    expect(screen.getByText("Halaman 9 dari 2")).toBeTruthy();
  });
});

describe("WalletActivity", () => {
  const summary = {
    chain: "ethereum",
    txCount: 142,
    firstTxAt: new Date("2021-03-05T10:00:00Z"),
    lastTxAt: new Date("2026-09-30T23:59:59Z"),
    activeMonths: { value: 12, exact: true },
    source: "blockscout",
    fetchedAt: new Date("2026-10-10T00:00:00Z"),
  };

  it("shows the transaction count, first and last dates and active months", () => {
    render(<WalletActivity chainLabel="Ethereum" result={{ kind: "ok", summary, cached: false }} />);
    expect(
      screen.getByText("Aktivitas wallet di Ethereum: 142 transaksi, pertama 2021-03-05, terakhir 2026-09-30, aktif 12 bulan"),
    ).toBeTruthy();
  });

  it("appends + to the months when the count is not exact, and says when the result is cached", () => {
    const { container } = render(
      <WalletActivity chainLabel="Ethereum" result={{ kind: "ok", summary: { ...summary, activeMonths: { value: 40, exact: false } }, cached: true }} />,
    );
    expect(container.textContent).toBe(
      "Aktivitas wallet di Ethereum: 142 transaksi, pertama 2021-03-05, terakhir 2026-09-30, aktif 40+ bulan (dicek dalam 6 jam terakhir)",
    );
  });

  it("uses the same words for one transaction and one month", () => {
    render(
      <WalletActivity
        chainLabel="Ethereum"
        result={{ kind: "ok", summary: { ...summary, txCount: 1, activeMonths: { value: 1, exact: true } }, cached: false }}
      />,
    );
    expect(
      screen.getByText("Aktivitas wallet di Ethereum: 1 transaksi, pertama 2021-03-05, terakhir 2026-09-30, aktif 1 bulan"),
    ).toBeTruthy();
  });

  it("says 'Gak ada aktivitas di Ethereum' for a wallet without transactions", () => {
    render(
      <WalletActivity
        chainLabel="Ethereum"
        result={{
          kind: "ok",
          summary: { ...summary, txCount: 0, firstTxAt: null, lastTxAt: null, activeMonths: { value: 0, exact: true } },
          cached: false,
        }}
      />,
    );
    expect(screen.getByText("Gak ada aktivitas di Ethereum")).toBeTruthy();
  });

  it("an unavailable provider shows the retry copy and never a zero", () => {
    const { container } = render(<WalletActivity chainLabel="Ethereum" result={{ kind: "unavailable" }} />);
    expect(screen.getByText("Data lagi gak tersedia. Coba lagi nanti.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/0/);
    expect(container.textContent).not.toMatch(/Gak ada aktivitas/);
  });

  it("explains the rate limit, the other failures, and never says eligible", () => {
    const kinds = [
      [{ kind: "rate_limited" }, "Kamu udah cek 10 kali dalam sejam. Coba lagi nanti."],
      [{ kind: "chain_not_supported" }, "Chain ini belum didukung."],
      [{ kind: "not_owner" }, "Wallet itu gak ada di list kamu."],
      [{ kind: "signed_out" }, "Login dulu buat cek aktivitas wallet."],
    ] as const;
    for (const [result, text] of kinds) {
      const { container, unmount } = render(<WalletActivity chainLabel="Ethereum" result={result} />);
      expect(screen.getByText(text)).toBeTruthy();
      expect(container.textContent?.toLowerCase()).not.toContain("eligib");
      unmount();
    }
  });
});
