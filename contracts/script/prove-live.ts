/**
 * Proves the confidential vault against live Nox on Ethereum Sepolia.
 *
 * This script exists because a contract that compiles is not a contract that
 * works. Every claim Kairos makes about branchless authorization is checked
 * here against the real TEE, and the transaction hashes it prints are the
 * evidence a third party can verify.
 *
 * The sequence:
 *   1. fund the treasury with an encrypted amount
 *   2. register an agent with an encrypted per-call cap
 *   3. settle UNDER the cap   -> verdict must decrypt to true
 *   4. settle OVER the cap    -> verdict must decrypt to false,
 *                                the transaction must still SUCCEED,
 *                                and the treasury must be unchanged
 *   5. confirm no Settled event carries an address or an amount
 *
 * Step 4 is the whole product. If an over-cap settlement reverted, the revert
 * itself would broadcast the comparison result and the privacy guarantee would
 * be worthless.
 *
 *   bun run --cwd contracts prove:live
 */

import { createWalletClient, createPublicClient, http, parseAbi, decodeEventLog } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { createViemHandleClient } from "@iexec-nox/handle";

const RPC = process.env.CHAIN_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const VAULT = (process.env.VAULT_ADDRESS ??
  "0x6d0bd38784d794da959b11e5cbeb35764b2579e4") as `0x${string}`;

const KEY = process.env.DEPLOYER_PRIVATE_KEY;
if (!KEY) throw new Error("DEPLOYER_PRIVATE_KEY is required.");

const TREASURY = 1_000_000n;
const CAP = 100_000n;
const UNDER_CAP = 40_000n;
const OVER_CAP = 500_000n;

const vaultAbi = parseAbi([
  "function fund(bytes32 encryptedAmount, bytes proof)",
  "function registerAgent(address agent, bytes32 encryptedCap, bytes proof)",
  "function settle(address agent, bytes32 encryptedAmount, bytes proof) returns (bytes32)",
  "function treasuryHandle() view returns (bytes32)",
  "function agentCapHandle(address agent) view returns (bytes32)",
  "function agentSpentHandle(address agent) view returns (bytes32)",
  "function isRegistered(address agent) view returns (bool)",
  "function currentEpoch() view returns (uint64)",
  "function epochInfo(uint64 epochId) view returns (uint32,bool,bool,uint256)",
  "event Settled(uint64 indexed epoch)",
  "event AgentRegistered(address indexed agent)",
]);

const account = privateKeyToAccount(
  (KEY.startsWith("0x") ? KEY : `0x${KEY}`) as `0x${string}`,
);
const transport = http(RPC);
const publicClient = createPublicClient({ chain: sepolia, transport });
const walletClient = createWalletClient({ account, chain: sepolia, transport });

const results: { step: string; hash?: string; note: string }[] = [];
let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const pass = actual === expected;
  if (!pass) failures += 1;
  console.log(`   ${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) console.log(`         expected ${String(expected)}, got ${String(actual)}`);
}

/**
 * Decrypt a handle, retrying while the Handle Gateway catches up.
 *
 * ACL grants written in a transaction are not instantly visible to the
 * gateway, which answers 403 "not a viewer" until it has caught up. In the
 * gateway this exact condition is what makes a verdict `unreadable`, and an
 * unreadable verdict refuses the resource. Here we are auditing rather than
 * serving, so waiting is correct — but note that production must NOT retry its
 * way into serving. See docs/adr/002.
 */
async function decryptWithRetry(
  handleClient: { decrypt: (h: `0x${string}`) => Promise<{ value: bigint }> },
  handle: `0x${string}`,
  attempts = 8,
): Promise<bigint> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return (await handleClient.decrypt(handle)).value;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw lastError;
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

async function main(): Promise<void> {
  console.log(`vault    ${VAULT}`);
  console.log(`operator ${account.address}\n`);

  const handleClient = await createViemHandleClient(walletClient);

  // The agent is a throwaway address. It never signs; the relayer submits on
  // its behalf, which is the point of the single-relayer design.
  const agent = `0x${Date.now().toString(16).padStart(40, "0").slice(-40)}` as `0x${string}`;
  console.log(`agent    ${agent} (fresh per run, so the script is idempotent)
`);

  // ---- 1. Fund -----------------------------------------------------------
  console.log("1. fund the treasury with an encrypted amount");
  {
    const { handle, handleProof } = await handleClient.encryptInput(TREASURY, "uint256", VAULT);
    const hash = await send("fund", [handle, handleProof]);
    results.push({ step: "fund", hash, note: `encrypted ${TREASURY}` });
    console.log(`   tx ${hash}`);
  }

  // ---- 2. Register -------------------------------------------------------
  console.log("\n2. register an agent with an encrypted cap");
  if (await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: "isRegistered", args: [agent] })) {
    console.log("   already registered, skipping");
  } else {
    const { handle, handleProof } = await handleClient.encryptInput(CAP, "uint256", VAULT);
    const hash = await send("registerAgent", [agent, handle, handleProof]);
    results.push({ step: "registerAgent", hash, note: `encrypted cap ${CAP}` });
    console.log(`   tx ${hash}`);
  }

  const treasuryBefore = await decryptWithRetry(
    handleClient,
    await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: "treasuryHandle" }),
  );
  console.log(`   treasury decrypts to ${treasuryBefore} (owner only)`);

  // ---- 3. Under cap ------------------------------------------------------
  console.log(`\n3. settle ${UNDER_CAP} — UNDER the cap of ${CAP}`);
  {
    const { handle, handleProof } = await handleClient.encryptInput(UNDER_CAP, "uint256", VAULT);
    const hash = await send("settle", [agent, handle, handleProof]);
    results.push({ step: "settle under cap", hash, note: `${UNDER_CAP} <= ${CAP}` });
    console.log(`   tx ${hash}`);

    const spent = await decryptWithRetry(
      handleClient,
      await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: "agentSpentHandle", args: [agent] }),
    );
    console.log(`   agent spend decrypts to ${spent}`);
    check("under-cap settlement debited the agent", spent, UNDER_CAP);
  }

  const treasuryMid = await decryptWithRetry(
    handleClient,
    await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: "treasuryHandle" }),
  );
  console.log(`   treasury now ${treasuryMid}`);
  // Relative, not absolute: the script re-funds on every run, so the treasury
  // accumulates across runs. What must hold is the delta.
  check("under-cap settlement debited the treasury", treasuryMid, treasuryBefore - UNDER_CAP);

  // ---- 4. Over cap — the claim -------------------------------------------
  console.log(`\n4. settle ${OVER_CAP} — OVER the cap. Must debit zero and NOT revert.`);
  {
    const { handle, handleProof } = await handleClient.encryptInput(OVER_CAP, "uint256", VAULT);
    const hash = await send("settle", [agent, handle, handleProof]); // throws if it reverted
    results.push({ step: "settle OVER cap", hash, note: `${OVER_CAP} > ${CAP}, debits zero` });
    console.log(`   tx ${hash}`);
    console.log("   PASS  transaction succeeded despite being over cap");

    const spent = await decryptWithRetry(
      handleClient,
      await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: "agentSpentHandle", args: [agent] }),
    );
    console.log(`   agent spend still ${spent}`);
    check("over-cap settlement debited ZERO", spent, UNDER_CAP);

    const treasuryAfter = await decryptWithRetry(
      handleClient,
      await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: "treasuryHandle" }),
    );
    console.log(`   treasury still ${treasuryAfter}`);
    check("treasury unchanged by the over-cap call", treasuryAfter, treasuryMid);
  }

  // ---- 5. Events leak nothing -------------------------------------------
  console.log("\n5. inspect what the chain published");
  {
    const logs = await publicClient.getLogs({
      address: VAULT,
      event: vaultAbi.find((e) => e.type === "event" && e.name === "Settled") as never,
      // Public RPCs reject `earliest` as an archive request, and we only care
      // about the settlements this run just produced.
      fromBlock: (await publicClient.getBlockNumber()) - 50n,
    });
    console.log(`   ${logs.length} Settled event(s)`);
    for (const log of logs.slice(-2)) {
      const decoded = decodeEventLog({ abi: vaultAbi, data: log.data, topics: log.topics });
      console.log(`   epoch=${(decoded.args as { epoch: bigint }).epoch}  data=${log.data}`);
      check("event body is empty — no address, no amount", log.data, "0x");
    }
  }

  // ---- Summary -----------------------------------------------------------
  console.log("\n" + "─".repeat(64));
  console.log("Transactions (verifiable on sepolia.etherscan.io):\n");
  for (const r of results) {
    console.log(`  ${r.step.padEnd(20)} ${r.hash}`);
    console.log(`  ${" ".repeat(20)} ${r.note}`);
  }
  console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`));
  if (failures > 0) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error("\nFAILED:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
