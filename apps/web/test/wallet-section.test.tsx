// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectDetail } from "../lib/view";

const getUser = vi.fn();
vi.mock("@/lib/auth", () => ({ getUser: () => getUser() }));
vi.mock("@/app/(auth)/actions", () => ({ signOut: async () => {} }));

import { SiteHeader } from "../components/site-header";
import { WalletActivitySection } from "../components/WalletActivitySection";

afterEach(cleanup);

function project(over: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: "p1",
    slug: "demo",
    name: "Demo Protocol",
    status: "live",
    riskLevel: "high",
    chains: ["Ethereum"],
    nextDeadline: null,
    lastSeen: "2026-10-09T00:00:00Z",
    tokenSymbol: null,
    conflict: false,
    risk: null,
    deadlines: [],
    tasks: [],
    links: [{ url: "https://claim.demo.example/check", kind: "claim" }],
    evidence: [],
    ...over,
  };
}

const WALLET = { id: "33333333-3333-4333-8333-333333333333", address: "0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae", label: "Main" };

describe("WalletActivitySection", () => {
  it("renders nothing for a signed-out visitor", () => {
    const { container } = render(<WalletActivitySection project={project()} wallets={null} />);
    expect(container.textContent).toBe("");
  });

  it("prompts a signed-in user without wallets to add one, on a supported chain", () => {
    render(<WalletActivitySection project={project()} wallets={[]} />);
    const link = screen.getByRole("link", { name: "Add a wallet to check wallet activity" });
    expect(link.getAttribute("href")).toBe("/wallets");
    expect(screen.queryByRole("button", { name: /Check wallet activity/ })).toBeNull();
  });

  it("shows no prompt without wallets when the chain is unsupported or unknown", () => {
    const a = render(<WalletActivitySection project={project({ chains: ["Sui"] })} wallets={[]} />);
    expect(a.container.textContent).toBe("");
    a.unmount();
    const b = render(<WalletActivitySection project={project({ chains: [] })} wallets={[]} />);
    expect(b.container.textContent).toBe("");
  });

  it("says Chain not supported yet for a wallet owner on an unsupported chain", () => {
    render(<WalletActivitySection project={project({ chains: ["Sui"] })} wallets={[WALLET]} />);
    expect(screen.getByText("Chain not supported yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Check wallet activity/ })).toBeNull();
  });

  it("repeats the risk badge and the official checker link next to the wallet checks", () => {
    render(<WalletActivitySection project={project()} wallets={[WALLET]} />);
    const section = screen.getByRole("region", { name: "Wallet activity" });
    const line = within(section).getByTestId("wallet-risk-line");
    expect(within(line).getByTestId("risk-badge").getAttribute("data-level")).toBe("high");
    const link = within(line).getByRole("link", { name: /Official checker \(unverified\)/ });
    expect(link.getAttribute("href")).toBe("https://claim.demo.example/check");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(within(section).getByRole("button", { name: "Check wallet activity on Ethereum for Main" })).toBeTruthy();
    expect(section.textContent?.toLowerCase()).not.toMatch(/eligible|safe/);
  });

  it("shows the risk badge alone when there is no linkable claim URL", () => {
    render(<WalletActivitySection project={project({ links: [{ url: "javascript:alert(1)", kind: "claim" }] })} wallets={[WALLET]} />);
    const line = screen.getByTestId("wallet-risk-line");
    expect(within(line).getByTestId("risk-badge")).toBeTruthy();
    expect(within(line).queryByRole("link")).toBeNull();
  });
});

describe("SiteHeader", () => {
  beforeEach(() => getUser.mockReset());

  it("links to Wallets for a signed-in user", async () => {
    getUser.mockResolvedValue({ id: "u1", email: "someone@example.test" });
    render(await SiteHeader());
    const link = screen.getByRole("link", { name: "Wallets" });
    expect(link.getAttribute("href")).toBe("/wallets");
    expect(screen.getByRole("link", { name: "Watchlist" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
  });

  it("has no Wallets link when signed out", async () => {
    getUser.mockResolvedValue(null);
    render(await SiteHeader());
    expect(screen.queryByRole("link", { name: "Wallets" })).toBeNull();
    expect(screen.getByRole("link", { name: "Log in" })).toBeTruthy();
  });
});
