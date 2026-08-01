import { network } from "hardhat";
async function main() {
  const { viem } = await network.connect();
  const pc = await viem.getPublicClient();
  const [w] = await viem.getWalletClients();
  console.log("deployer", w!.account.address);
  const ann = await viem.deployContract("StealthAnnouncer", []);
  console.log("STEALTH_ANNOUNCER_ADDRESS=" + ann.address);
  const router = await viem.deployContract("KairosSettlementRouter", [
    process.env.VAULT_ADDRESS as `0x${string}`,
    process.env.UNISWAP_V3_ROUTER as `0x${string}`,
  ]);
  console.log("SETTLEMENT_ROUTER_ADDRESS=" + router.address);
  void pc;
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
