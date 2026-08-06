import { misconfigured, parseMetaAddress } from "@kairos/shared";
import { isAddress, type Address, type Hex } from "viem";

/**
 * Gateway configuration.
 *
 * Validated at boot. An invalid value is a startup failure, never a silent
 * default — a gateway that quietly falls back to a stub while the dashboard
 * claims a real settlement is the specific failure this guards against.
 */
export interface GatewayConfig {
  port: number;
  corsOrigins: string[];
  chainRpcUrl: string;
  vaultAddress: Address;
  capPolicyAddress?: Address;
  allowlistPolicyAddress?: Address;
  velocityPolicyAddress?: Address;
  velocityAllowanceWei?: bigint;
  relayerPrivateKey?: Hex;
  /** ERC-5564 bulletin board. Without it a stealth payment cannot be found. */
  stealthAnnouncerAddress?: Address;
  /** Where a proven epoch aggregate is swapped and paid out. */
  settlementRouterAddress?: Address;
  /**
   * The operator's stealth meta-address, `st:eth:0x…`.
   *
   * Set once and every payment made through MCP lands on a fresh one-time
   * address. Left unset, payouts behave as before — that is a legitimate
   * deployment, not a degraded one, so it is optional rather than required.
   */
  payeeStealthMetaAddress?: string;
}

function address(name: string, value: string | undefined, required: boolean): Address | undefined {
  if (!value) {
    if (required) throw misconfigured(`${name} is required.`);
    return undefined;
  }
  if (!isAddress(value)) throw misconfigured(`${name} is not an address.`, { name });
  return value as Address;
}

export function loadConfig(): GatewayConfig {
  const port = Number(process.env.GATEWAY_PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw misconfigured(`GATEWAY_PORT must be a valid port, got ${process.env.GATEWAY_PORT}`);
  }

  const vault = address("VAULT_ADDRESS", process.env.VAULT_ADDRESS, true)!;
  const capPolicy = address("CAP_POLICY_ADDRESS", process.env.CAP_POLICY_ADDRESS, false);
  const velocityPolicy = address("VELOCITY_POLICY_ADDRESS", process.env.VELOCITY_POLICY_ADDRESS, false);
  const allowlistPolicy = address("ALLOWLIST_POLICY_ADDRESS", process.env.ALLOWLIST_POLICY_ADDRESS, false);
  const velocityAllowanceWei = process.env.VELOCITY_ALLOWANCE_WEI?.trim()
    ? BigInt(process.env.VELOCITY_ALLOWANCE_WEI)
    : undefined;

  const key = process.env.RELAYER_PRIVATE_KEY?.trim();
  if (key && !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    // Deliberately does not echo the value.
    throw misconfigured("RELAYER_PRIVATE_KEY is not a 32-byte hex key.");
  }

  const announcer = address("STEALTH_ANNOUNCER_ADDRESS", process.env.STEALTH_ANNOUNCER_ADDRESS, false);
  const router = address("SETTLEMENT_ROUTER_ADDRESS", process.env.SETTLEMENT_ROUTER_ADDRESS, false);

  // Parsed at boot rather than per request. A malformed meta-address discovered
  // mid-payment would leave the operator believing payouts were private while
  // they were landing somewhere ordinary — so it is a startup failure instead.
  const payee = process.env.PAYEE_STEALTH_META_ADDRESS?.trim();
  if (payee) {
    try {
      parseMetaAddress(payee);
    } catch {
      throw misconfigured("PAYEE_STEALTH_META_ADDRESS is malformed.", {
        hint: "Expected st:eth:0x… carrying two 33-byte compressed keys.",
      });
    }
  }

  return {
    port,
    corsOrigins: (process.env.GATEWAY_CORS_ORIGINS ?? "*").split(",").map((s) => s.trim()),
    chainRpcUrl: process.env.CHAIN_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
    vaultAddress: vault,
    ...(capPolicy ? { capPolicyAddress: capPolicy } : {}),
    ...(velocityPolicy ? { velocityPolicyAddress: velocityPolicy } : {}),
    ...(allowlistPolicy ? { allowlistPolicyAddress: allowlistPolicy } : {}),
    ...(velocityAllowanceWei !== undefined ? { velocityAllowanceWei } : {}),
    ...(key ? { relayerPrivateKey: key as Hex } : {}),
    ...(announcer ? { stealthAnnouncerAddress: announcer } : {}),
    ...(router ? { settlementRouterAddress: router } : {}),
    ...(payee ? { payeeStealthMetaAddress: payee } : {}),
  };
}
