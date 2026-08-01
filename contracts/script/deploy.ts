import { network } from "hardhat";
import { formatEther, getAddress, isAddress } from "viem";

/**
 * Deploys KairosVault, and optionally KairosSettlementRouter.
 *
 * The vault's constructor calls into NoxCompute to initialise its encrypted
 * treasury, so this only works on a chain where the Nox protocol is deployed:
 * Ethereum Sepolia (11155111) or Arbitrum Sepolia (421614). On a bare local
 * chain the constructor reverts, which is why there is no local deploy path.
 *
 *   RELAYER_ADDRESS      required — the single account allowed to settle
 *   FLUSH_THRESHOLD      optional — settlements per epoch, default 25
 *   UNISWAP_V3_ROUTER    optional — deploys the swap router when set
 *
 * Usage:
 *   bun run --cwd contracts deploy:sepolia
 */

const NOX_CHAINS: Record<number, string> = {
  11155111: "Ethereum Sepolia",
  421614: "Arbitrum Sepolia",
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required. See .env.example.`);
  return value;
}

async function main(): Promise<void> {
  const { viem } = await network.connect();

  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();

  const chainName = NOX_CHAINS[chainId];
  if (!chainName) {
    throw new Error(
      `Chain ${chainId} has no Nox deployment. The vault constructor would revert. ` +
        `Supported: ${Object.entries(NOX_CHAINS)
          .map(([id, name]) => `${name} (${id})`)
          .join(", ")}.`,
    );
  }

  const [wallet] = await viem.getWalletClients();
  if (!wallet) throw new Error("No signer. Set DEPLOYER_PRIVATE_KEY.");

  const deployer = wallet.account.address;
  const balance = await publicClient.getBalance({ address: deployer });

  console.log(`network   ${chainName} (${chainId})`);
  console.log(`deployer  ${deployer}`);
  console.log(`balance   ${formatEther(balance)} ETH`);

  if (balance === 0n) {
    throw new Error("Deployer has no balance. Fund it before deploying.");
  }

  const relayer = required("RELAYER_ADDRESS");
  if (!isAddress(relayer)) throw new Error(`RELAYER_ADDRESS is not an address: ${relayer}`);

  const flushThreshold = Number(process.env.FLUSH_THRESHOLD ?? 25);
  if (!Number.isInteger(flushThreshold) || flushThreshold < 1) {
    throw new Error(`FLUSH_THRESHOLD must be a positive integer, got ${flushThreshold}`);
  }

  console.log(`\nDeploying KairosVault…`);
  console.log(`  relayer         ${getAddress(relayer)}`);
  console.log(`  flushThreshold  ${flushThreshold}`);

  const vault = await viem.deployContract("KairosVault", [
    getAddress(relayer),
    flushThreshold,
  ]);
  console.log(`  → ${vault.address}`);

  let routerAddress: string | undefined;
  const swapRouter = process.env.UNISWAP_V3_ROUTER;
  if (swapRouter) {
    if (!isAddress(swapRouter)) {
      throw new Error(`UNISWAP_V3_ROUTER is not an address: ${swapRouter}`);
    }
    console.log(`\nDeploying KairosSettlementRouter…`);
    const router = await viem.deployContract("KairosSettlementRouter", [
      vault.address,
      getAddress(swapRouter),
    ]);
    routerAddress = router.address;
    console.log(`  → ${routerAddress}`);
  } else {
    console.log(`\nSkipping KairosSettlementRouter (UNISWAP_V3_ROUTER unset).`);
  }

  console.log(`\nAdd to .env:`);
  console.log(`VAULT_ADDRESS=${vault.address}`);
  if (routerAddress) console.log(`SETTLEMENT_ROUTER_ADDRESS=${routerAddress}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
