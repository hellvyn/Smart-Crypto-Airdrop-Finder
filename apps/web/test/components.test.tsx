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
  it("renders the High label", () => {
    render(<RiskBadge level="high" />);
    expect(screen.getByText("High")).toBeTruthy();
  });

  it("never renders the word safe, at any level", () => {
    for (const level of LEVELS) {
      const { container, unmount } = render(<RiskBadge level={level} />);
      expect(container.textContent ?? "").not.toMatch(/safe/i);
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

  it("labels Insufficient data and Not assessed", () => {
    render(
      <>
        <RiskBadge level="insufficient_data" />
        <RiskBadge level={null} />
      </>,
    );
    expect(screen.getByText("Insufficient data")).toBeTruthy();
    expect(screen.getByText("Not assessed")).toBeTruthy();
  });
});

describe("StatusBadge", () => {
  it("shows unknown as Unconfirmed", () => {
    render(<StatusBadge status="unknown" />);
    expect(screen.getByText("Unconfirmed")).toBeTruthy();
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
    expect(screen.getByRole("status").textContent).toMatch(/out of date/i);
  });

  it("shows when there has been no successful run", () => {
    render(<StaleBanner lastRunAt={null} now={now} />);
    expect(screen.getByRole("status")).toBeTruthy();
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
    expect(screen.getByText("Unconfirmed")).toBeTruthy();
    expect(screen.getByText("Critical")).toBeTruthy();
    expect(screen.getByText(/2026-11-01/)).toBeTruthy();
    expect(screen.getByText(/ethereum, base/)).toBeTruthy();
  });

  it("shows Chain unknown when there are no chains", () => {
    render(
      <ProjectRow
        item={{ slug: "x", name: "X", status: "live", riskLevel: null, chains: [], nextDeadline: null, lastSeen: "2026-10-09T00:00:00Z" }}
      />,
    );
    expect(screen.getByText("Chain unknown")).toBeTruthy();
    expect(screen.getByText("Not assessed")).toBeTruthy();
  });
});

describe("ProjectDetailView", () => {
  it("shows Chain unknown and no wallet check button when chains is empty", () => {
    render(<ProjectDetailView project={detail({ chains: [] })} />);
    expect(screen.getByText("Chain unknown")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/check (my )?wallet/i)).toBeNull();
  });

  it("shows the two conflicting status quotes with a Conflicting sources label", () => {
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
    expect(screen.getByText("Conflicting sources")).toBeTruthy();
    expect(screen.getByText(/The airdrop is live now/)).toBeTruthy();
    expect(screen.getByText(/The airdrop has ended/)).toBeTruthy();
  });

  it("does not show Conflicting sources without a conflict", () => {
    render(<ProjectDetailView project={detail()} />);
    expect(screen.queryByText("Conflicting sources")).toBeNull();
  });

  it("shows check coverage", () => {
    render(<ProjectDetailView project={detail()} />);
    expect(screen.getByText(/4\/8 checks ran/)).toBeTruthy();
  });

  it("shows the reasons and the level without a number", () => {
    render(<ProjectDetailView project={detail()} />);
    expect(screen.getByText("Domain is younger than 90 days")).toBeTruthy();
    expect(screen.getByText("Medium")).toBeTruthy();
  });

  it("renders the claim link as an unverified official checker next to the risk badge", () => {
    render(
      <ProjectDetailView
        project={detail({ links: [{ url: "https://claim.demo.example/check", kind: "claim" }] })}
      />,
    );
    const link = screen.getByRole("link", { name: /Official checker \(unverified\)/ });
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
    const list = screen.getByRole("list", { name: "Evidence" });
    expect(within(list).getByText(/Listed on DefiLlama/)).toBeTruthy();
    expect(within(list).getByRole("link").getAttribute("href")).toBe("https://defillama.com/airdrops");
    expect(within(list).getByText(/2026-10-08/)).toBeTruthy();
  });

  it("says when there is no risk assessment yet", () => {
    render(<ProjectDetailView project={detail({ risk: null, riskLevel: null })} />);
    expect(screen.getByText("Not assessed")).toBeTruthy();
    expect(screen.queryByText(/checks ran/)).toBeNull();
  });

  it("uses wallet activity wording only, never eligible or safe", () => {
    const { container } = render(<ProjectDetailView project={detail()} />);
    expect(container.textContent ?? "").not.toMatch(/eligible|\bsafe\b/i);
  });
});

describe("unsafe claim link", () => {
  it("hides the Official checker label entirely when the claim URL is not http(s)", () => {
    render(<ProjectDetailView project={detail({ links: [{ url: "javascript:alert(1)", kind: "claim" }] })} />);
    expect(screen.queryByText(/Official checker/)).toBeNull();
    expect(document.querySelector("a[href^='javascript']")).toBeNull();
  });
});

describe("Pagination", () => {
  it("links Previous and Next and keeps the filters", () => {
    render(<Pagination page={2} pageSize={50} total={120} filters={{ status: ["live"], risk: ["high"], chain: "base" }} />);
    expect(screen.getByRole("link", { name: "Previous" }).getAttribute("href")).toBe("/airdrops?status=live&risk=high&chain=base");
    expect(screen.getByRole("link", { name: "Next" }).getAttribute("href")).toBe("/airdrops?status=live&risk=high&chain=base&page=3");
    expect(screen.getByText("51-100 of 120")).toBeTruthy();
  });

  it("has no Next on the last page and no Previous on the first", () => {
    const { unmount } = render(<Pagination page={1} pageSize={50} total={55} filters={{}} />);
    expect(screen.queryByRole("link", { name: "Previous" })).toBeNull();
    expect(screen.getByRole("link", { name: "Next" }).getAttribute("href")).toBe("/airdrops?page=2");
    unmount();
    render(<Pagination page={2} pageSize={50} total={55} filters={{}} />);
    expect(screen.queryByRole("link", { name: "Next" })).toBeNull();
    expect(screen.getByRole("link", { name: "Previous" }).getAttribute("href")).toBe("/airdrops");
  });

  it("renders nothing for a single page", () => {
    const { container } = render(<Pagination page={1} pageSize={50} total={3} filters={{}} />);
    expect(container.textContent).toBe("");
  });

  it("links back to the last page when the page is past the end", () => {
    render(<Pagination page={9} pageSize={50} total={55} filters={{}} />);
    expect(screen.getByRole("link", { name: "Previous" }).getAttribute("href")).toBe("/airdrops?page=2");
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
      screen.getByText("Wallet activity on Ethereum: 142 transactions, first 2021-03-05, last 2026-09-30, active 12 months"),
    ).toBeTruthy();
  });

  it("appends + to the months when the count is not exact", () => {
    render(<WalletActivity chainLabel="Ethereum" result={{ kind: "ok", summary: { ...summary, activeMonths: { value: 40, exact: false } }, cached: true }} />);
    expect(screen.getByText(/active 40\+ months/)).toBeTruthy();
  });

  it("uses singular forms", () => {
    render(
      <WalletActivity
        chainLabel="Ethereum"
        result={{ kind: "ok", summary: { ...summary, txCount: 1, activeMonths: { value: 1, exact: true } }, cached: false }}
      />,
    );
    expect(screen.getByText(/: 1 transaction, first .*active 1 month$/)).toBeTruthy();
  });

  it("says 'No activity on Ethereum' for a wallet without transactions", () => {
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
    expect(screen.getByText("No activity on Ethereum")).toBeTruthy();
  });

  it("an unavailable provider shows the retry copy and never a zero", () => {
    const { container } = render(<WalletActivity chainLabel="Ethereum" result={{ kind: "unavailable" }} />);
    expect(screen.getByText("Data unavailable, try again later.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/0/);
    expect(container.textContent).not.toMatch(/No activity/);
  });

  it("explains the rate limit, the other failures, and never says eligible", () => {
    const kinds = [
      [{ kind: "rate_limited" }, "You've reached 10 checks per hour. Try again later."],
      [{ kind: "chain_not_supported" }, "Chain not supported yet."],
      [{ kind: "not_owner" }, "That wallet isn't in your list."],
      [{ kind: "signed_out" }, "Sign in to check wallet activity."],
    ] as const;
    for (const [result, text] of kinds) {
      const { container, unmount } = render(<WalletActivity chainLabel="Ethereum" result={result} />);
      expect(screen.getByText(text)).toBeTruthy();
      expect(container.textContent?.toLowerCase()).not.toContain("eligib");
      unmount();
    }
  });
});
