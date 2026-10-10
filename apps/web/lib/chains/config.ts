// Chains the wallet activity check supports. Only EVM chains served by a Blockscout instance for now.
export const EVM_CHAINS: Record<string, { blockscoutBase: string }> = {
  ethereum: { blockscoutBase: "https://eth.blockscout.com" },
};

/** Display names for the chain ids in EVM_CHAINS. */
export const CHAIN_LABELS: Record<string, string> = {
  ethereum: "Ethereum",
};

const ALIASES: Record<string, string> = {
  ethereum: "ethereum",
  eth: "ethereum",
  "ethereum mainnet": "ethereum",
  mainnet: "ethereum",
};

/** Maps a project's free-text chain name to a supported EVM chain id, or null (not an EVM chain we support). */
export function chainIdFromName(name: string): string | null {
  if (typeof name !== "string") return null;
  const id = ALIASES[name.trim().toLowerCase()];
  return id !== undefined && Object.hasOwn(EVM_CHAINS, id) ? id : null;
}

export function chainLabel(chainId: string): string {
  return CHAIN_LABELS[chainId] ?? chainId;
}
