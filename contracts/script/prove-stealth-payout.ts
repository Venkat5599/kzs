/**
 * Proves that a stealth payout actually pays — on Ethereum Sepolia.
 *
 * `prove:stealth` proves the cryptography: addresses derive, announcements are
 * findable, a stranger learns nothing, and the recipient can reconstruct the
 * private key. It stops one step short of the claim that matters most, which is
 * that money arrives.
 *
 * This closes it. A proven epoch aggregate is swapped through Uniswap's own
 * deployed router and delivered to a one-time address, and the destination
 * balance is measured before and after. An address the recipient cannot be paid
 * at is not privacy; it is a hole with good documentation.
 *
 * Like prove:swap, this stands up its own pool, because Sepolia has no reliable
 * liquidity. The pool is an ordinary Uniswap V3 pool created through Uniswap's
 * own factory — nothing about it is special, and nothing about Uniswap is
 * modified to accept a payment it cannot trace.
 *
 *   bun run --cwd contracts prove:stealth-payout
 *
 * Requires DEPLOYER_PRIVATE_KEY (the router owner — routeEpochToStealth is
 * onlyOwner) and a flushed, proven, unrouted epoch.
 */
import { network } from "hardhat";
import { parseAbi, parseUnits, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  generateStealthKeys,
  deriveStealthAddress,
  checkStealthPayment,
  computeStealthPrivateKey,
} from "@kairos/shared";

// Uniswap V3 on Ethereum Sepolia — Uniswap's own deployments.
const FACTORY = getAddress("0x0227628f3F023bb0B980b67D528571c95c6DaC1c");
const POSITION_MANAGER = getAddress("0x1238536071E1c677A632429e3655c799b22cDA52");
const SWAP_ROUTER = getAddress("0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E");

const VAULT = getAddress(process.env.VAULT_ADDRESS ?? "0x1b5919e3ec31daaa88a69ca4bf27aa83dbed57f8");
const ROUTER = getAddress(
  process.env.SETTLEMENT_ROUTER_ADDRESS ?? "0xec0ec50c8ebffb89aed3072d7c4a74671b2e8d7f",
);
const ANNOUNCER = getAddress(
  process.env.STEALTH_ANNOUNCER_ADDRESS ?? "0x07ef4c4c82a093c6eef1b44fd3750695a80b48f1",
);

const FEE = 3000;
const TICK_LOWER = -887220;
const TICK_UPPER = 887220;
/** 1:1 price. sqrt(1) * 2^96. */
const SQRT_PRICE_1_1 = 79228162514264337593543950336n;

const EPOCH = BigInt(process.env.EPOCH_ID ?? "0");

const npmAbi = parseAbi([
  "function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) payable returns (address pool)",
  "function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
]);
const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function mint(address to, uint256 amount)",
]);
const vaultAbi = parseAbi([
  "function epochInfo(uint64 epochId) view returns (uint32,bool,bool,uint256)",
]);
const routerAbi = parseAbi([
  "function routeEpochToStealth(uint64 epochId, address tokenIn, address tokenOut, uint24 poolFee, uint256 amountOutMinimum, uint256 deadline, address stealthRecipient) returns (uint256)",
  "function routed(uint64) view returns (bool)",
]);
const announcerAbi = parseAbi([
  "function announce(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey, bytes metadata)",
]);

let failures = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failures += 1;
  console.log(`   ${ok ? "PASS" : "FAIL"}  ${label}`);
};

async function main(): Promise<void> {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const [wallet] = await viem.getWalletClients();
  if (!wallet) throw new Error("No signer. Set DEPLOYER_PRIVATE_KEY.");
  const me = wallet.account.address;

  console.log(`operator  ${me}`);
  console.log(`vault     ${VAULT}`);
  console.log(`router    ${ROUTER}`);
  console.log(`announcer ${ANNOUNCER}\n`);

  // ---- 0. The aggregate must already be proven ---------------------------
  const [count, , settled, aggregate] = (await publicClient.readContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "epochInfo",
    args: [EPOCH],
  })) as [number, boolean, boolean, bigint];

  if (!settled) throw new Error(`Epoch ${EPOCH} is not proven. Run prove:flush first.`);
  if (aggregate === 0n) throw new Error(`Epoch ${EPOCH} has nothing to route.`);
  if (
    await publicClient.readContract({
      address: ROUTER,
      abi: routerAbi,
      functionName: "routed",
      args: [EPOCH],
    })
  ) {
    throw new Error(`Epoch ${EPOCH} already routed. Set EPOCH_ID to an unrouted epoch.`);
  }
  console.log(`epoch ${EPOCH}: ${count} settlements -> proven aggregate ${aggregate}\n`);

  // ---- 1. The recipient's meta-address, and a one-time address from it -----
  console.log("1. derive a one-time address for the recipient");
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

  const stranger = generateStealthKeys();
  check(
    "a stranger scanning the announcement learns nothing",
    !checkStealthPayment(stranger, payment),
  );

  // ---- 2. Announce, so the payment is findable ----------------------------
  console.log("\n2. announce the ephemeral key on-chain");
  const annHash = await wallet.writeContract({
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
  const annReceipt = await publicClient.waitForTransactionReceipt({ hash: annHash });
  check("announcement landed", annReceipt.status === "success");
  console.log(`   tx ${annHash}`);

  // ---- 3. A token pair and a real Uniswap pool ----------------------------
  console.log("\n3. deploy a token pair and pool it through Uniswap's factory");
  const tokenA = await viem.deployContract("MockERC20", ["Kairos USD", "kUSD", 18]);
  const tokenB = await viem.deployContract("MockERC20", ["Kairos ETH", "kETH", 18]);

  // Uniswap requires token0 < token1 by address.
  const [token0, token1] =
    BigInt(tokenA.address) < BigInt(tokenB.address)
      ? [tokenA.address, tokenB.address]
      : [tokenB.address, tokenA.address];

  const liquidityEach = parseUnits("1000000", 18);
  for (const t of [tokenA.address, tokenB.address]) {
    await publicClient.waitForTransactionReceipt({
      hash: await wallet.writeContract({
        address: t,
        abi: erc20Abi,
        functionName: "mint",
        args: [me, liquidityEach],
      }),
    });
  }

  await publicClient.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: POSITION_MANAGER,
      abi: npmAbi,
      functionName: "createAndInitializePoolIfNecessary",
      args: [token0, token1, FEE, SQRT_PRICE_1_1],
    }),
  });
  console.log(`   factory ${FACTORY} (Uniswap's, unmodified)`);

  for (const t of [token0, token1]) {
    await publicClient.waitForTransactionReceipt({
      hash: await wallet.writeContract({
        address: t,
        abi: erc20Abi,
        functionName: "approve",
        args: [POSITION_MANAGER, liquidityEach],
      }),
    });
  }

  await publicClient.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: POSITION_MANAGER,
      abi: npmAbi,
      functionName: "mint",
      args: [
        {
          token0,
          token1,
          fee: FEE,
          tickLower: TICK_LOWER,
          tickUpper: TICK_UPPER,
          amount0Desired: liquidityEach,
          amount1Desired: liquidityEach,
          amount0Min: 0n,
          amount1Min: 0n,
          recipient: me,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 1800),
        },
      ],
    }),
  });
  console.log(`   liquidity provided`);

  // ---- 4. Fund the router with exactly the aggregate ----------------------
  const tokenIn = token0;
  const tokenOut = token1;
  await publicClient.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: tokenIn,
      abi: erc20Abi,
      functionName: "mint",
      args: [ROUTER, aggregate],
    }),
  });
  console.log(`\n4. router funded with the aggregate (${aggregate})`);

  // ---- 5. Route it to the stealth address — the load-bearing step ---------
  console.log("\n5. routeEpochToStealth — through Uniswap's deployed SwapRouter02");
  const before = (await publicClient.readContract({
    address: tokenOut,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [payment.stealthAddress],
  })) as bigint;
  check("the stealth address starts empty", before === 0n);

  const routeHash = await wallet.writeContract({
    address: ROUTER,
    abi: routerAbi,
    functionName: "routeEpochToStealth",
    args: [
      EPOCH,
      tokenIn,
      tokenOut,
      FEE,
      // A slippage floor of 1 wei is not production practice; a real deployment
      // needs a live quote. The claim under test here is the destination, not
      // the execution price.
      1n,
      BigInt(Math.floor(Date.now() / 1000) + 1800),
      payment.stealthAddress,
    ],
  });
  const routeReceipt = await publicClient.waitForTransactionReceipt({ hash: routeHash });
  check("route transaction succeeded", routeReceipt.status === "success");
  console.log(`   tx ${routeHash}`);
  console.log(`   swapRouter ${SWAP_ROUTER} (Uniswap's, unmodified)`);

  const after = (await publicClient.readContract({
    address: tokenOut,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [payment.stealthAddress],
  })) as bigint;

  // The whole point. Everything above is derivation; this is the assertion that
  // money arrived at an address nobody can link to its owner.
  check("the stealth address received the payout", after > before);
  console.log(`   received ${after - before} of ${tokenOut}`);

  console.log("\n" + "-".repeat(64));
  console.log(`  announce  ${annHash}`);
  console.log(`  route     ${routeHash}`);
  console.log(`\n  paid ${after - before} to ${payment.stealthAddress}`);
  console.log(`  an address that had never appeared on-chain until this payout,`);
  console.log(`  that only its recipient can identify, and that they can spend from.`);
  console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`));
  if (failures > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("\nFAILED:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
