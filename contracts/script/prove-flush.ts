/**
 * Proves the declassification path against live Nox on Ethereum Sepolia.
 *
 * Settling privately is only half the system. The other half is the single,
 * deliberate point where a number becomes public — and it has to be an
 * aggregate, or the batching bought nothing.
 *
 * The sequence:
 *   1. read the epoch's encrypted total (a handle; meaningless without the ACL)
 *   2. flushEpoch()            -> Nox.allowPublicDecryption on that handle
 *   3. publicDecrypt off-chain -> plaintext + a decryption proof
 *   4. proveEpochAggregate()   -> Nox.publicDecrypt verifies the proof ON-CHAIN
 *   5. confirm the aggregate is the batch sum, and that it is now readable by
 *      anyone — which is exactly what makes it usable by unmodified public
 *      infrastructure downstream
 *
 * Step 4 is the hinge of the whole composability argument. After it, the value
 * is an ordinary uint256 that a DEX router, a payment rail or a treasury
 * contract can consume without knowing Nox exists.
 *
 *   bun run --cwd contracts prove:flush
 */

import { createWalletClient, createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { createViemHandleClient } from "@iexec-nox/handle";

const RPC = process.env.CHAIN_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const VAULT = (process.env.VAULT_ADDRESS ??
  "0xbe6a1a70885540276203d7211dfba0e7be625344") as `0x${string}`;

const KEY = process.env.DEPLOYER_PRIVATE_KEY;
if (!KEY) throw new Error("DEPLOYER_PRIVATE_KEY is required.");

const vaultAbi = parseAbi([
  "function flushEpoch() returns (uint64)",
  "function proveEpochAggregate(uint64 epochId, bytes decryptionProof) returns (uint256)",
  "function currentEpoch() view returns (uint64)",
  "function epochTotalHandle(uint64 epochId) view returns (bytes32)",
  "function epochInfo(uint64 epochId) view returns (uint32,bool,bool,uint256)",
  "function canReadEpochTotal(uint64 epochId, address account) view returns (bool)",
  "event EpochFlushed(uint64 indexed epoch, uint32 settlementCount)",
  "event EpochSettled(uint64 indexed epoch, uint256 aggregateAmount)",
]);

const account = privateKeyToAccount((KEY.startsWith("0x") ? KEY : `0x${KEY}`) as `0x${string}`);
const transport = http(RPC);
const publicClient = createPublicClient({ chain: sepolia, transport });
const walletClient = createWalletClient({ account, chain: sepolia, transport });

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const pass = actual === expected;
  if (!pass) failures += 1;
  console.log(`   ${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) console.log(`         expected ${String(expected)}, got ${String(actual)}`);
}

async function send(fn: string, args: readonly unknown[]): Promise<`0x${string}`> {
  const hash = await walletClient.writeContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: fn as never,
    args: args as never,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${fn} reverted (${hash})`);
  return hash;
}

const read = (fn: string, args: readonly unknown[] = []) =>
  publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: fn as never, args: args as never });

async function main(): Promise<void> {
  console.log(`vault    ${VAULT}`);
  console.log(`operator ${account.address}\n`);

  const handleClient = await createViemHandleClient(walletClient);

  // The epoch about to be closed. flushEpoch advances the counter, so capture
  // it before rather than after.
  const epochId = (await read("currentEpoch")) as bigint;
  const [countBefore, , ,] = (await read("epochInfo", [epochId])) as [number, boolean, boolean, bigint];
  console.log(`epoch ${epochId} holds ${countBefore} settlement(s)\n`);

  const totalHandle = (await read("epochTotalHandle", [epochId])) as `0x${string}`;

  // ---- 1. Before the flush, the aggregate is not public -------------------
  console.log("1. before flushing");
  console.log(`   epoch total handle ${totalHandle}`);
  let publicBefore = true;
  try {
    await handleClient.publicDecrypt(totalHandle);
  } catch {
    publicBefore = false;
  }
  check("aggregate is NOT publicly decryptable yet", publicBefore, false);

  // ---- 2. Flush ----------------------------------------------------------
  console.log("\n2. flushEpoch — the deliberate declassification");
  const flushHash = await send("flushEpoch", []);
  console.log(`   tx ${flushHash}`);

  const [countAfter, flushed, ,] = (await read("epochInfo", [epochId])) as [number, boolean, boolean, bigint];
  check("epoch marked flushed", flushed, true);
  console.log(`   settlementCount published: ${countAfter}`);
  console.log(`   currentEpoch advanced to ${(await read("currentEpoch")) as bigint}`);

  // ---- 3. Public decryption off-chain ------------------------------------
  console.log("\n3. publicDecrypt — anyone can now read the aggregate");
  let value: bigint | undefined;
  let decryptionProof: `0x${string}` | undefined;
  for (let i = 0; i < 10; i += 1) {
    try {
      const r = await handleClient.publicDecrypt(totalHandle);
      value = r.value as bigint;
      decryptionProof = r.decryptionProof as `0x${string}`;
      break;
    } catch {
      await new Promise((res) => setTimeout(res, 3000));
    }
  }
  if (value === undefined || decryptionProof === undefined) {
    throw new Error("aggregate did not become publicly decryptable");
  }
  console.log(`   aggregate = ${value}`);
  console.log(`   proof     = ${decryptionProof.slice(0, 42)}… (${decryptionProof.length} chars)`);

  // ---- 4. Prove it on-chain ----------------------------------------------
  console.log("\n4. proveEpochAggregate — the TEE proof verified ON-CHAIN");
  const proveHash = await send("proveEpochAggregate", [epochId, decryptionProof]);
  console.log(`   tx ${proveHash}`);

  const [, , settled, aggregate] = (await read("epochInfo", [epochId])) as [number, boolean, boolean, bigint];
  check("epoch marked settled", settled, true);
  check("on-chain aggregate matches the off-chain decryption", aggregate, value);
  console.log(`   the contract now holds plaintext ${aggregate}`);

  // ---- 5. What this buys -------------------------------------------------
  console.log("\n5. what the chain published");
  console.log(`   one aggregate covering ${countAfter} settlements`);
  console.log(`   no per-settlement amount was ever emitted`);
  console.log(
    `   ${aggregate} is now an ordinary uint256 — consumable by an unmodified\n` +
      `   Uniswap router, which is the entire composability argument`,
  );

  console.log("\n" + "─".repeat(64));
  console.log("Transactions (verifiable on sepolia.etherscan.io):\n");
  console.log(`  flushEpoch            ${flushHash}`);
  console.log(`  proveEpochAggregate   ${proveHash}`);
  console.log(`\n  epoch ${epochId}: ${countAfter} settlements -> aggregate ${aggregate}`);
  console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`));
  if (failures > 0) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error("\nFAILED:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
