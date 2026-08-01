import { network } from "hardhat";
import { formatEther, getAddress, isAddress } from "viem";

/**
 * Deploys a complete Kairos ring: vault, policy stack, settlement router and
 * the registry that indexes it.
 *
 * A ring is one tenant's confidential vault — its own relayer, its own policy,
 * its own encrypted state. Rings share this implementation but not their state,
 * so a compromised relayer is bounded to its own ring.
 *
 * The policy stack deployed here is a composite of three rules, all of which
 * must approve before a settlement is authorized:
 *
 *   CapPolicy        per-call ceiling
 *   VelocityPolicy   cumulative allowance
 *   AllowlistPolicy  eligibility (KYC / jurisdiction)
 *
 *   RELAYER_ADDRESS     required
 *   FLUSH_THRESHOLD     default 3
 *   UNISWAP_V3_ROUTER   optional, deploys the settlement router
 *   RING_LABEL          default "kairos-ring-0"
 *
 *   bun run --cwd contracts deploy:ring
 */

const NOX_CHAINS: Record<number, string> = {
  11155111: "Ethereum Sepolia",
  421614: "Arbitrum Sepolia",
};

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required. See .env.example.`);
  return v;
}

async function main(): Promise<void> {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();

  const chainName = NOX_CHAINS[chainId];
  if (!chainName) throw new Error(`Chain ${chainId} has no Nox deployment.`);

  const [wallet] = await viem.getWalletClients();
  if (!wallet) throw new Error("No signer. Set DEPLOYER_PRIVATE_KEY.");
  const deployer = wallet.account.address;
  const balance = await publicClient.getBalance({ address: deployer });

  console.log(`network   ${chainName} (${chainId})`);
  console.log(`deployer  ${deployer}`);
  console.log(`balance   ${formatEther(balance)} ETH`);
  if (balance === 0n) throw new Error("Deployer has no balance.");

  const relayer = getAddress(required("RELAYER_ADDRESS"));
  const flushThreshold = Number(process.env.FLUSH_THRESHOLD ?? 3);
  const label = process.env.RING_LABEL ?? "kairos-ring-0";

  // ---- policies ----------------------------------------------------------
  console.log(`\nDeploying policy stack…`);
  const cap = await viem.deployContract("CapPolicy", []);
  console.log(`  CapPolicy        ${cap.address}`);
  const velocity = await viem.deployContract("VelocityPolicy", []);
  console.log(`  VelocityPolicy   ${velocity.address}`);
  const allowlist = await viem.deployContract("AllowlistPolicy", []);
  console.log(`  AllowlistPolicy  ${allowlist.address}`);
  const composite = await viem.deployContract("CompositePolicy", []);
  console.log(`  CompositePolicy  ${composite.address}`);

  // ---- vault -------------------------------------------------------------
  console.log(`\nDeploying KairosVault…`);
  console.log(`  relayer         ${relayer}`);
  console.log(`  flushThreshold  ${flushThreshold}`);
  const vault = await viem.deployContract("KairosVault", [relayer, flushThreshold]);
  console.log(`  → ${vault.address}`);

  // ---- wiring ------------------------------------------------------------
  // Each policy answers only its vault, and the composite answers only the
  // vault too. A policy that answered anyone would let a stranger probe
  // verdicts against a subject's encrypted limits.
  console.log(`\nWiring…`);
  // Sequential, awaiting each receipt. Firing these concurrently reuses the
  // nonce and the node rejects the later ones as "replacement transaction
  // underpriced".
  const settle = async (hash: `0x${string}`) => {
    await publicClient.waitForTransactionReceipt({ hash });
  };
  await settle(await cap.write.setVault([composite.address]));
  await settle(await velocity.write.setVault([composite.address]));
  await settle(await allowlist.write.setVault([composite.address]));
  await settle(await composite.write.setVault([vault.address]));
  await settle(
    await composite.write.setPolicies([[cap.address, velocity.address, allowlist.address]]),
  );
  await settle(await vault.write.setPolicy([composite.address]));
  console.log(`  vault.policy = CompositePolicy(cap, velocity, allowlist)`);

  // ---- router ------------------------------------------------------------
  let routerAddress: string | undefined;
  const swapRouter = process.env.UNISWAP_V3_ROUTER;
  if (swapRouter && isAddress(swapRouter)) {
    console.log(`\nDeploying KairosSettlementRouter…`);
    const router = await viem.deployContract("KairosSettlementRouter", [
      vault.address,
      getAddress(swapRouter),
    ]);
    routerAddress = router.address;
    console.log(`  → ${routerAddress}`);
  }

  // ---- registry ----------------------------------------------------------
  console.log(`\nDeploying KairosRingRegistry…`);
  const registry = await viem.deployContract("KairosRingRegistry", []);
  console.log(`  → ${registry.address}`);
  await publicClient.waitForTransactionReceipt({
    hash: await registry.write.registerExisting([vault.address, label]),
  });
  console.log(`  ring 0 "${label}" → ${vault.address}`);
  console.log(`  (registered, not deployed by the registry — the deployer stays owner)`);

  console.log(`\nAdd to .env:`);
  console.log(`VAULT_ADDRESS=${vault.address}`);
  console.log(`CAP_POLICY_ADDRESS=${cap.address}`);
  console.log(`VELOCITY_POLICY_ADDRESS=${velocity.address}`);
  console.log(`ALLOWLIST_POLICY_ADDRESS=${allowlist.address}`);
  console.log(`COMPOSITE_POLICY_ADDRESS=${composite.address}`);
  console.log(`RING_REGISTRY_ADDRESS=${registry.address}`);
  if (routerAddress) console.log(`SETTLEMENT_ROUTER_ADDRESS=${routerAddress}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
