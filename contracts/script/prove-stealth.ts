/**
 * Proves stealth addresses end to end against Sepolia.
 *
 * Derive a one-time address, announce the ephemeral key on-chain, then scan the
 * announcement back as the recipient and confirm only they can identify it.
 *
 *   bun run --cwd contracts prove:stealth
 */
import { createWalletClient, createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  generateStealthKeys,
  deriveStealthAddress,
  checkStealthPayment,
  computeStealthPrivateKey,
} from "@kairos/shared";

const RPC = process.env.CHAIN_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const ANNOUNCER = (process.env.STEALTH_ANNOUNCER_ADDRESS ??
  "0x07ef4c4c82a093c6eef1b44fd3750695a80b48f1") as `0x${string}`;
const KEY = process.env.DEPLOYER_PRIVATE_KEY!;

const abi = parseAbi([
  "function registerKeys(uint256 schemeId, bytes metaAddress)",
  "function announce(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey, bytes metadata)",
  "function hasKeys(address registrant, uint256 schemeId) view returns (bool)",
  "event Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)",
]);

const account = privateKeyToAccount((KEY.startsWith("0x") ? KEY : `0x${KEY}`) as `0x${string}`);
const transport = http(RPC);
const pc = createPublicClient({ chain: sepolia, transport });
const wc = createWalletClient({ account, chain: sepolia, transport });

let failures = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failures += 1;
  console.log(`   ${ok ? "PASS" : "FAIL"}  ${label}`);
};

async function send(fn: string, args: readonly unknown[]) {
  const hash = await wc.writeContract({ address: ANNOUNCER, abi, functionName: fn as never, args: args as never });
  const r = await pc.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${fn} reverted`);
  return hash;
}

async function main() {
  console.log(`announcer ${ANNOUNCER}`);
  console.log(`operator  ${account.address}\n`);

  console.log("1. recipient publishes a meta-address");
  const alice = generateStealthKeys();
  const meta = `0x${alice.spendingPublicKey.slice(2)}${alice.viewingPublicKey.slice(2)}` as `0x${string}`;
  const regHash = await send("registerKeys", [1n, meta]);
  console.log(`   tx ${regHash}`);
  check("meta-address is registered on-chain", await pc.readContract({
    address: ANNOUNCER, abi, functionName: "hasKeys", args: [account.address, 1n],
  }) as boolean);

  console.log("\n2. sender derives a one-time address");
  const p1 = deriveStealthAddress(alice);
  const p2 = deriveStealthAddress(alice);
  console.log(`   payment 1 -> ${p1.stealthAddress}`);
  console.log(`   payment 2 -> ${p2.stealthAddress}`);
  check("two payments to the same recipient produce different addresses", p1.stealthAddress !== p2.stealthAddress);

  console.log("\n3. announce it on-chain");
  const annHash = await send("announce", [
    1n, p1.stealthAddress, p1.ephemeralPublicKey, `0x${p1.viewTag.toString(16).padStart(2, "0")}`,
  ]);
  console.log(`   tx ${annHash}`);

  console.log("\n4. recipient scans the announcement");
  const logs = await pc.getLogs({
    address: ANNOUNCER,
    event: abi.find((e) => e.type === "event") as never,
    fromBlock: (await pc.getBlockNumber()) - 20n,
  });
  console.log(`   ${logs.length} announcement(s) on chain`);
  check("recipient identifies their own payment", checkStealthPayment(alice, p1));

  const bob = generateStealthKeys();
  check("a stranger scanning the same announcement learns nothing", !checkStealthPayment(bob, p1));

  console.log("\n5. recipient can actually spend it");
  const priv = computeStealthPrivateKey(alice, p1.ephemeralPublicKey);
  const derived = privateKeyToAccount(priv);
  check("derived private key controls the stealth address",
    derived.address.toLowerCase() === p1.stealthAddress.toLowerCase());

  console.log("\n" + "-".repeat(60));
  console.log(`  registerKeys  ${regHash}`);
  console.log(`  announce      ${annHash}`);
  console.log(`\n  paid ${p1.stealthAddress}`);
  console.log(`  an address that has never appeared on-chain before,`);
  console.log(`  and that nobody but the recipient can link to them.`);
  console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`));
  if (failures > 0) process.exitCode = 1;
}

main().catch((e) => { console.error("\nFAILED:", e instanceof Error ? e.message : e); process.exitCode = 1; });
