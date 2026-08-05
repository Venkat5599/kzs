/**
 * @kairos/chain — the networks Kairos deploys on.
 *
 * One source of truth for chain facts that otherwise get copied between the
 * contracts' deploy scripts, the gateway config and the frontend. Nox compute
 * proxy addresses are lifted from the Nox SDK (`Nox.sol::noxComputeContract`),
 * not inferred.
 */

/** A chain Kairos can operate on. */
export interface ChainInfo {
  /** EIP-155 chain id. */
  id: number;
  /** Human name, e.g. "Ethereum Sepolia". */
  name: string;
  /** CAIP-2 identifier, used by x402 payment headers. */
  caip2: string;
  /** Public RPC endpoint. */
  rpcUrl: string;
  /** Block explorer base URL (no trailing slash). */
  explorer: string;
  /** The deployed NoxCompute proxy on this chain. */
  noxCompute: string;
}

/**
 * Supported chains. The confidential layer only exists where the Nox SDK
 * resolves a compute proxy, so this list is bounded by the SDK's own table.
 */
export const CHAINS: readonly ChainInfo[] = [
  {
    id: 11155111,
    name: "Ethereum Sepolia",
    caip2: "eip155:11155111",
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    explorer: "https://sepolia.etherscan.io",
    noxCompute: "0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF",
  },
  {
    id: 421614,
    name: "Arbitrum Sepolia",
    caip2: "eip155:421614",
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    explorer: "https://sepolia.arbiscan.io",
    noxCompute: "0xd464B198f06756a1d00be223634b85E0a731c229",
  },
];

/** Resolve a chain by EIP-155 id, or `null` when unsupported. */
export function chainById(id: number): ChainInfo | null {
  return CHAINS.find((c) => c.id === id) ?? null;
}

/** Resolve a chain by CAIP-2 identifier (e.g. "eip155:11155111"), or `null`. */
export function chainByCaip2(caip2: string): ChainInfo | null {
  return CHAINS.find((c) => c.caip2 === caip2) ?? null;
}

/** Resolve a chain by id, throwing a descriptive error for unsupported chains. */
export function requireChain(id: number): ChainInfo {
  const chain = chainById(id);
  if (!chain) {
    throw new Error(`Unsupported chain id ${id}. Kairos deploys on: ${CHAINS.map((c) => `${c.name} (${c.id})`).join(", ")}.`);
  }
  return chain;
}

/** The chain the production deployment is live on. */
export const MAINNET_CHAIN = requireChain(11155111);
