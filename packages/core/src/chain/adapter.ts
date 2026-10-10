// Chain adapter contract for activity lookups. Pure types and validators only:
// no network or DB access here. Concrete adapters live outside @saf/core.

export interface ActivitySummary {
  chain: string;
  txCount: number;
  firstTxAt: Date | null;
  lastTxAt: Date | null;
  activeMonths: { value: number; exact: boolean };
  source: string;
  fetchedAt: Date;
}

export interface ChainAdapter {
  family: "evm";
  chains: string[];
  isValidAddress(address: string): boolean;
  getActivity(address: string, chain: string): Promise<ActivitySummary>;
}

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export const isEvmAddress = (address: string): boolean => EVM_ADDRESS_PATTERN.test(address);
