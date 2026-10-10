import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const getWalletActivity = vi.fn();
vi.mock("@/lib/auth", () => ({ getUser: () => getUser() }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({}) }));
vi.mock("@/lib/wallet-activity", () => ({ getWalletActivity: (...a: unknown[]) => getWalletActivity(...a) }));

import { POST } from "../app/api/wallet-activity/route";

const WID = "33333333-3333-4333-8333-333333333333";
const post = (body: unknown, type = "application/json") =>
  POST(new Request("http://x/api/wallet-activity", { method: "POST", headers: { "content-type": type }, body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ id: "u" });
  getWalletActivity.mockReset();
});

describe("POST /api/wallet-activity", () => {
  it("is a JSON 401 when signed out, without touching the database", async () => {
    getUser.mockResolvedValue(null);
    const res = await post({ walletId: WID, chain: "ethereum" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(getWalletActivity).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed JSON", "{nope", "application/json"],
    ["wrong content type", JSON.stringify({ walletId: WID, chain: "ethereum" }), "text/plain"],
    ["missing chain", { walletId: WID }, "application/json"],
    ["non-string walletId", { walletId: 5, chain: "ethereum" }, "application/json"],
    ["null body", "null", "application/json"],
    ["empty chain", { walletId: WID, chain: "" }, "application/json"],
  ])("is 400 for %s", async (_n, body, type) => {
    expect((await post(body, type)).status).toBe(400);
    expect(getWalletActivity).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "rate_limited" }, 429],
    [{ kind: "unavailable" }, 503],
    [{ kind: "chain_not_supported" }, 422],
    [{ kind: "not_owner" }, 404],
  ])("maps %j to %i", async (result, status) => {
    getWalletActivity.mockResolvedValue(result);
    const res = await post({ walletId: WID, chain: "Ethereum" });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(result);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 200 with ISO dates on success", async () => {
    getWalletActivity.mockResolvedValue({
      kind: "ok",
      cached: true,
      summary: {
        chain: "ethereum",
        txCount: 2,
        firstTxAt: new Date("2021-01-01T00:00:00Z"),
        lastTxAt: new Date("2022-01-01T00:00:00Z"),
        activeMonths: { value: 2, exact: true },
        source: "blockscout",
        fetchedAt: new Date("2026-10-10T00:00:00Z"),
      },
    });
    const res = await post({ walletId: WID, chain: "ethereum" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kind: "ok", cached: true, summary: { txCount: 2, firstTxAt: "2021-01-01T00:00:00.000Z" } });
  });

  it("reports a thrown error as unavailable (503), never as success or zero", async () => {
    getWalletActivity.mockRejectedValue(new Error("db down"));
    const res = await post({ walletId: WID, chain: "ethereum" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ kind: "unavailable" });
  });
});
