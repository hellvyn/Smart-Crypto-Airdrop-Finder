// Wallet activity for EVM chains from a public Blockscout instance. The address is sent to Blockscout only (the
// explorer the user could open themselves), never to a third-party "eligibility checker".
import { isEvmAddress, type ActivitySummary, type ChainAdapter } from "@saf/core";
import { EVM_CHAINS } from "./config";

const TIMEOUT_MS = 10_000;
const PAGE_SIZE = 1000;

interface EtherscanResponse {
  status?: unknown;
  message?: unknown;
  result?: unknown;
}

const NO_TRANSACTIONS = "no transactions found";

export class BlockscoutAdapter implements ChainAdapter {
  readonly family = "evm" as const;
  readonly chains = Object.keys(EVM_CHAINS);

  constructor(private readonly fetchImpl: typeof fetch) {}

  isValidAddress(address: string): boolean {
    return isEvmAddress(address);
  }

  async getActivity(address: string, chain: string): Promise<ActivitySummary> {
    const config = Object.hasOwn(EVM_CHAINS, chain) ? EVM_CHAINS[chain] : undefined;
    if (!config) throw new Error(`Unsupported chain: ${chain}`);
    if (!this.isValidAddress(address)) throw new Error("Invalid EVM address");
    const addr = address.toLowerCase();
    const base = config.blockscoutBase;

    const counters = (await this.getJson(`${base}/api/v2/addresses/${addr}/counters`)) as { transactions_count?: unknown };
    const txCount = Number(counters?.transactions_count);
    if (!Number.isSafeInteger(txCount) || txCount < 0) throw new Error("Blockscout returned an invalid transaction count");

    const txlist = `${base}/api?module=account&action=txlist&address=${addr}`;
    const first = await this.txList(`${txlist}&sort=asc&page=1&offset=1`);
    if (first === null) return summary(chain, 0, null, null, 0, true);
    const recent = await this.txList(`${txlist}&sort=desc&page=1&offset=${PAGE_SIZE}`);
    if (recent === null) return summary(chain, 0, null, null, 0, true);

    const firstTxAt = txDate(first[0]);
    const lastTxAt = txDate(recent[0]);
    const months = new Set(recent.map((t) => txDate(t).toISOString().slice(0, 7)));
    return summary(chain, txCount, firstTxAt, lastTxAt, months.size, recent.length < PAGE_SIZE);
  }

  private async getJson(url: string): Promise<unknown> {
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
    if (res.status !== 200) throw new Error(`Blockscout request failed with HTTP ${res.status}`);
    return res.json();
  }

  /** The transactions of an Etherscan-style `txlist` call; null when the address has none. Throws on any error. */
  private async txList(url: string): Promise<Record<string, unknown>[] | null> {
    const body = (await this.getJson(url)) as EtherscanResponse | null;
    if (body === null || typeof body !== "object") throw new Error("Blockscout returned an invalid response");
    if (String(body.status) === "0") {
      if (typeof body.message === "string" && body.message.trim().toLowerCase() === NO_TRANSACTIONS) return null;
      throw new Error("Blockscout returned an error");
    }
    if (!Array.isArray(body.result) || body.result.length === 0) throw new Error("Blockscout returned an invalid transaction list");
    return body.result as Record<string, unknown>[];
  }
}

function txDate(tx: Record<string, unknown> | undefined): Date {
  const seconds = Number(tx?.timeStamp);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) throw new Error("Blockscout returned an invalid timestamp");
  return new Date(seconds * 1000);
}

function summary(
  chain: string,
  txCount: number,
  firstTxAt: Date | null,
  lastTxAt: Date | null,
  months: number,
  exact: boolean,
): ActivitySummary {
  return { chain, txCount, firstTxAt, lastTxAt, activeMonths: { value: months, exact }, source: "blockscout", fetchedAt: new Date() };
}
