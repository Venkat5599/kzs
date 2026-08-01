import { misconfigured } from "@kairos/shared";
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
  relayerPrivateKey?: Hex;
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

  const key = process.env.RELAYER_PRIVATE_KEY?.trim();
  if (key && !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    // Deliberately does not echo the value.
    throw misconfigured("RELAYER_PRIVATE_KEY is not a 32-byte hex key.");
  }

  return {
    port,
    corsOrigins: (process.env.GATEWAY_CORS_ORIGINS ?? "*").split(",").map((s) => s.trim()),
    chainRpcUrl: process.env.CHAIN_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
    vaultAddress: vault,
    ...(capPolicy ? { capPolicyAddress: capPolicy } : {}),
    ...(key ? { relayerPrivateKey: key as Hex } : {}),
  };
}
