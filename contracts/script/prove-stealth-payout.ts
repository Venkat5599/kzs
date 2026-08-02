/**
 * Proves that a stealth payout actually pays — on Ethereum Sepolia.
 *
 * `prove:stealth` proves the cryptography: addresses derive, announcements are
 * findable, a stranger learns nothing, and the recipient can reconstruct the
 * private key. It stops one step short of the claim that matters most, which is
 * that money arrives.
 *
 * This closes it. An epoch aggregate is routed through
 * {KairosSettlementRouter.routeEpochToStealth} and the destination balance is
 * measured before and after. An address the recipient cannot be paid at is not
 * privacy; it is a hole with good documentation.
 *
 *   bun run --cwd contracts prove:stealth-payout
 *
 * Requires DEPLOYER_PRIVATE_KEY (the router owner — routeEpochToStealth is
 * onlyOwner) and a flushed, proven epoch whose aggregate the router can cover.
 */
import { createWalletClient, createPublicClient, http, parseAbi, formatUnits } from "viem";
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
const ROUTER = (process.env.SETTLEMENT_ROUTER_ADDRESS ??
  "0xec0ec50c8ebffb89aed3072d7c4a74671b2e8d7f") as `0x${string}`;
const VAULT = (process.env.VAULT_ADDRESS ??
  "0x1b5919e3ec31daaa88a69ca4bf27aa83dbed57f8") as `0x${string}`;

const TOKEN_IN = process.env.STEALTH_TOKEN_IN as `0x${string}` | undefined;
const TOKEN_OUT = process.env.STEALTH_TOKEN_OUT as `0x${string}` | undefined;
const POOL_FEE = Number(process.env.STEALTH_POOL_FEE ?? "3000");
const EPOCH = BigInt(process.env.EPOCH_ID ?? "0");

const KEY = process.env.DEPLOYER_PRIVATE_KEY;
if (!KEY) throw new Error("DEPLOYER_PRIVATE_KEY is required. See .env.example.");
if (!TOKEN_IN || !TOKEN_OUT) {
  throw new Error(
    "STEALTH_TOKEN_IN and STEALTH_TOKEN_OUT are required — the pair the router holds and pays " +
      "out. Run prove:swap first if Sepolia has no liquidity for yours.",
  );
}

const announcerAbi = parseAbi([
  "function announce(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey, bytes metadata)",
]);
const routerAbi = parseAbi([
  "function routeEpochToStealth(uint64 epochId, address tokenIn, address tokenOut, uint24 poolFee, uint256 amountOutMinimum, uint256 deadline, address stealthRecipient) returns (uint256)",
  "function routed(uint64 epochId) view returns (bool)",
]);
const vaultAbi = parseAbi([
  "function epochInfo(uint64 epochId) view returns (uint32,bool,bool,uint256)",
]);
const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
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

async function main() {
  console.log(`router    ${ROUTER}`);
  console.log(`announcer ${ANNOUNCER}`);
  console.log(`operator  ${account.address}`);
  console.log(`epoch     ${EPOCH}\n`);

  console.log("1. the epoch is proven and has something to route");
  const [, , settled, aggregate] = (await pc.readContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "epochInfo",
    args: [EPOCH],
  })) as [number, boolean, boolean, bigint];
  check("epoch aggregate is proven", settled);
  check("aggregate is non-zero", aggregate > 0n);

  const alreadyRouted = (await pc.readContract({
    address: ROUTER,
    abi: routerAbi,
    functionName: "routed",
    args: [EPOCH],
  })) as boolean;
  check("epoch has not already been routed", !alreadyRouted);
  if (failures > 0) {
    console.log("\nPreconditions unmet — flush and prove an epoch first (prove:flush).");
    process.exitCode = 1;
    return;
  }

  console.log("\n2. the recipient derives a one-time address");
  const recipient = generateStealthKeys();
  const payment = deriveStealthAddress(recipient);
  console.log(`   paying -> ${payment.stealthAddress}`);
  check("recipient recognises the address as theirs", checkStealthPayment(recipient, payment));

  const derived = privateKeyToAccount(
    computeStealthPrivateKey(recipient, payment.ephemeralPublicKey),
  );
  check(
    "recipient holds the private key for it",
    derived.address.toLowerCase() === payment.stealthAddress.toLowerCase(),
  );

  console.log("\n3. announce it so the payment is findable");
  const annHash = await wc.writeContract({
    address: ANNOUNCER,
    abi: announcerAbi,
    functionName: "announce",
    args: [
      1n,
      payment.stealthAddress,
      payment.ephemeralPublicKey,
      `0x${payment.viewTag.toString(16).padStart(2, "0")}` as `0x${string}`,
    ],
  });
  const annReceipt = await pc.waitForTransactionReceipt({ hash: annHash });
  check("announcement landed", annReceipt.status === "success");
  console.log(`   tx ${annHash}`);

  console.log("\n4. route the epoch to it — the load-bearing step");
  const [symbol, decimals] = await Promise.all([
    pc.readContract({ address: TOKEN_OUT!, abi: erc20Abi, functionName: "symbol" }) as Promise<string>,
    pc.readContract({ address: TOKEN_OUT!, abi: erc20Abi, functionName: "decimals" }) as Promise<number>,
  ]);

  const before = (await pc.readContract({
    address: TOKEN_OUT!,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [payment.stealthAddress],
  })) as bigint;
  check("the stealth address starts empty", before === 0n);

  const routeHash = await wc.writeContract({
    address: ROUTER,
    abi: routerAbi,
    functionName: "routeEpochToStealth",
    args: [
      EPOCH,
      TOKEN_IN!,
      TOKEN_OUT!,
      POOL_FEE,
      // A slippage floor of zero is sandwichable and must never ship in
      // production. It is used here because the proof is about destination, not
      // execution price, and a real floor would need a live quote.
      0n,
      BigInt(Math.floor(Date.now() / 1000) + 900),
      payment.stealthAddress,
    ],
  });
  const routeReceipt = await pc.waitForTransactionReceipt({ hash: routeHash });
  check("route transaction succeeded", routeReceipt.status === "success");
  console.log(`   tx ${routeHash}`);

  const after = (await pc.readContract({
    address: TOKEN_OUT!,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [payment.stealthAddress],
  })) as bigint;

  // The whole point of the script. Everything above is derivation; this is the
  // assertion that money actually arrived at an address nobody can link.
  check("the stealth address received the payout", after > before);
  console.log(`   balance ${formatUnits(after - before, decimals)} ${symbol}`);

  console.log("\n5. nobody else can tell it is theirs");
  const stranger = generateStealthKeys();
  check(
    "a stranger scanning the announcement learns nothing",
    !checkStealthPayment(stranger, payment),
  );

  console.log("\n" + "-".repeat(60));
  console.log(`  announce  ${annHash}`);
  console.log(`  route     ${routeHash}`);
  console.log(
    `\n  paid ${formatUnits(after - before, decimals)} ${symbol} to ${payment.stealthAddress}`,
  );
  console.log(`  an address that had never appeared on-chain until this payout,`);
  console.log(`  that only its recipient can identify, and that they can spend from.`);
  console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`));
  if (failures > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("\nFAILED:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
