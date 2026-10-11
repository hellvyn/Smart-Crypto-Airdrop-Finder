// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectDetail } from "../lib/view";
import { projectDetail } from "./fixtures/project-detail";

const getUser = vi.fn();
vi.mock("@/lib/auth", () => ({ getUser: () => getUser() }));
vi.mock("@/app/(auth)/actions", () => ({ signOut: async () => {} }));

import { SiteHeader } from "../components/site-header";
import { WalletActivitySection } from "../components/WalletActivitySection";

afterEach(cleanup);

function project(over: Partial<ProjectDetail> = {}): ProjectDetail {
  return projectDetail({
    slug: "demo",
    name: "Demo Protocol",
    riskLevel: "high",
    chains: ["Ethereum"],
    risk: null,
    links: [{ url: "https://claim.demo.example/check", kind: "claim", status: "official" }],
    ...over,
  });
}

const WALLET = { id: "33333333-3333-4333-8333-333333333333", address: "0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae", label: "Main" };

describe("WalletActivitySection", () => {
  it("renders nothing for a signed-out visitor", () => {
    const { container } = render(<WalletActivitySection project={project()} wallets={null} />);
    expect(container.textContent).toBe("");
  });

  it("prompts a signed-in user without wallets to add one, on a supported chain", () => {
    render(<WalletActivitySection project={project()} wallets={[]} />);
    const link = screen.getByRole("link", { name: "Tambah wallet buat cek aktivitas wallet" });
    expect(link.getAttribute("href")).toBe("/wallets");
    expect(screen.queryByRole("button", { name: /Cek aktivitas wallet/ })).toBeNull();
  });

  it("shows no prompt without wallets when the chain is unsupported or unknown", () => {
    const a = render(<WalletActivitySection project={project({ chains: ["Sui"] })} wallets={[]} />);
    expect(a.container.textContent).toBe("");
    a.unmount();
    const b = render(<WalletActivitySection project={project({ chains: [] })} wallets={[]} />);
    expect(b.container.textContent).toBe("");
  });

  it("says Chain ini belum didukung for a wallet owner on an unsupported chain", () => {
    render(<WalletActivitySection project={project({ chains: ["Sui"] })} wallets={[WALLET]} />);
    expect(screen.getByText("Chain ini belum didukung.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Cek aktivitas wallet/ })).toBeNull();
  });

  it("repeats the risk badge and the official checker link next to the wallet checks", () => {
    render(<WalletActivitySection project={project()} wallets={[WALLET]} />);
    const section = screen.getByRole("region", { name: "Aktivitas wallet" });
    const line = within(section).getByTestId("wallet-risk-line");
    expect(within(line).getByTestId("risk-badge").getAttribute("data-level")).toBe("high");
    const link = within(line).getByRole("link", { name: "Checker official (belum verified)" });
    expect(link.getAttribute("href")).toBe("https://claim.demo.example/check");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(within(section).getByRole("button", { name: "Cek aktivitas wallet di Ethereum untuk Main" })).toBeTruthy();
    expect(section.textContent?.toLowerCase()).not.toMatch(/eligible|safe|\baman\b/);
  });

  it("shows the risk badge alone when there is no linkable claim URL", () => {
    render(<WalletActivitySection project={project({ links: [{ url: "javascript:alert(1)", kind: "claim", status: null }] })} wallets={[WALLET]} />);
    const line = screen.getByTestId("wallet-risk-line");
    expect(within(line).getByTestId("risk-badge")).toBeTruthy();
    expect(within(line).queryByRole("link")).toBeNull();
  });
});

describe("SiteHeader", () => {
  beforeEach(() => getUser.mockReset());

  it("links to Wallet for a signed-in user", async () => {
    getUser.mockResolvedValue({ id: "u1", email: "someone@example.test" });
    render(await SiteHeader());
    const link = screen.getByRole("link", { name: "Wallet" });
    expect(link.getAttribute("href")).toBe("/wallets");
    expect(screen.getByRole("link", { name: "Watchlist" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Akun" })).toBeTruthy();
  });

  it("has no Wallet link when signed out", async () => {
    getUser.mockResolvedValue(null);
    render(await SiteHeader());
    expect(screen.queryByRole("link", { name: "Wallet" })).toBeNull();
    expect(screen.getByRole("link", { name: "Login" })).toBeTruthy();
  });
});
