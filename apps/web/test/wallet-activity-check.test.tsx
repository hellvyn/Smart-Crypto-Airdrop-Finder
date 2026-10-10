// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WalletActivityCheck } from "../components/WalletActivityCheck";

const WID = "33333333-3333-4333-8333-333333333333";
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const reply = (body: string, status: number) => new Response(body, { status });
const renderCheck = () => render(<WalletActivityCheck walletId={WID} walletName="Main" chain="ethereum" chainLabel="Ethereum" />);
const button = () => screen.getByRole("button") as HTMLButtonElement;

describe("WalletActivityCheck", () => {
  it("offers 'Check wallet activity on Ethereum' and shows nothing before the click", () => {
    renderCheck();
    expect(button().textContent).toBe("Check wallet activity on Ethereum");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("disables the button while pending, posts the wallet and chain with a timeout, then shows the summary", async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    renderCheck();
    fireEvent.click(button());
    await waitFor(() => expect(button().disabled).toBe(true));
    expect(button().textContent).toBe("Checking…");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/wallet-activity");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ walletId: WID, chain: "ethereum" });
    expect(init.signal).toBeInstanceOf(AbortSignal);

    resolve(
      reply(
        JSON.stringify({
          kind: "ok",
          cached: false,
          summary: {
            chain: "ethereum",
            txCount: 142,
            firstTxAt: "2021-03-05T10:00:00.000Z",
            lastTxAt: "2026-09-30T23:59:59.000Z",
            activeMonths: { value: 12, exact: true },
            source: "blockscout",
            fetchedAt: "2026-10-10T00:00:00.000Z",
          },
        }),
        200,
      ),
    );
    expect(await screen.findByText("Wallet activity on Ethereum: 142 transactions, first 2021-03-05, last 2026-09-30, active 12 months")).toBeTruthy();
    expect(button().disabled).toBe(false);
  });

  it("a 401 asks the user to sign in", async () => {
    fetchMock.mockResolvedValue(reply(JSON.stringify({ error: "unauthorized" }), 401));
    renderCheck();
    fireEvent.click(button());
    expect(await screen.findByText("Sign in to check wallet activity.")).toBeTruthy();
  });

  it("a non-JSON 500 is 'unavailable', never zero activity", async () => {
    fetchMock.mockResolvedValue(reply("<html>Internal Server Error</html>", 500));
    const { container } = renderCheck();
    fireEvent.click(button());
    expect(await screen.findByText("Data unavailable, try again later.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/No activity/);
  });

  it("a malformed 200 is 'unavailable'", async () => {
    fetchMock.mockResolvedValue(reply(JSON.stringify({ kind: "ok", summary: { txCount: "lots" } }), 200));
    renderCheck();
    fireEvent.click(button());
    expect(await screen.findByText("Data unavailable, try again later.")).toBeTruthy();
  });

  it("an aborted or failed request is 'unavailable'", async () => {
    fetchMock.mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    renderCheck();
    fireEvent.click(button());
    expect(await screen.findByText("Data unavailable, try again later.")).toBeTruthy();
    expect(button().disabled).toBe(false);
  });

  it.each([
    [429, "rate_limited", "You've reached 10 checks per hour. Try again later."],
    [503, "unavailable", "Data unavailable, try again later."],
    [404, "not_owner", "That wallet isn't in your list."],
    [422, "chain_not_supported", "Chain not supported yet."],
  ])("maps %i to its copy", async (status, kind, text) => {
    fetchMock.mockResolvedValue(reply(JSON.stringify({ kind }), status));
    renderCheck();
    fireEvent.click(button());
    expect(await screen.findByText(text)).toBeTruthy();
  });
});
