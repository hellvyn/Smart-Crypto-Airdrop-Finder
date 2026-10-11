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
  it("offers 'Cek aktivitas wallet di Ethereum' and shows nothing before the click", () => {
    renderCheck();
    expect(button().textContent).toBe("Cek aktivitas wallet di Ethereum");
    expect(button().getAttribute("aria-label")).toBe("Cek aktivitas wallet di Ethereum untuk Main");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("disables the button while pending, posts the wallet and chain with a timeout, then shows the summary", async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    renderCheck();
    fireEvent.click(button());
    await waitFor(() => expect(button().disabled).toBe(true));
    expect(button().textContent).toBe("Lagi dicek…");

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
    expect(await screen.findByText("Aktivitas wallet di Ethereum: 142 transaksi, pertama 2021-03-05, terakhir 2026-09-30, aktif 12 bulan")).toBeTruthy();
    expect(button().disabled).toBe(false);
  });

  it("a 401 asks the user to sign in", async () => {
    fetchMock.mockResolvedValue(reply(JSON.stringify({ error: "unauthorized" }), 401));
    renderCheck();
    fireEvent.click(button());
    expect(await screen.findByText("Login dulu buat cek aktivitas wallet.")).toBeTruthy();
  });

  it("a non-JSON 500 is 'unavailable', never zero activity", async () => {
    fetchMock.mockResolvedValue(reply("<html>Internal Server Error</html>", 500));
    const { container } = renderCheck();
    fireEvent.click(button());
    expect(await screen.findByText("Data lagi gak tersedia. Coba lagi nanti.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Gak ada aktivitas/);
  });

  it("a malformed 200 is 'unavailable'", async () => {
    fetchMock.mockResolvedValue(reply(JSON.stringify({ kind: "ok", summary: { txCount: "lots" } }), 200));
    renderCheck();
    fireEvent.click(button());
    expect(await screen.findByText("Data lagi gak tersedia. Coba lagi nanti.")).toBeTruthy();
  });

  it("an aborted or failed request is 'unavailable'", async () => {
    fetchMock.mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    renderCheck();
    fireEvent.click(button());
    expect(await screen.findByText("Data lagi gak tersedia. Coba lagi nanti.")).toBeTruthy();
    expect(button().disabled).toBe(false);
  });

  it.each([
    [429, "rate_limited", "Kamu udah cek 10 kali dalam sejam. Coba lagi nanti."],
    [503, "unavailable", "Data lagi gak tersedia. Coba lagi nanti."],
    [404, "not_owner", "Wallet itu gak ada di list kamu."],
    [422, "chain_not_supported", "Chain ini belum didukung."],
  ])("maps %i to its copy", async (status, kind, text) => {
    fetchMock.mockResolvedValue(reply(JSON.stringify({ kind }), status));
    renderCheck();
    fireEvent.click(button());
    expect(await screen.findByText(text)).toBeTruthy();
  });
});
