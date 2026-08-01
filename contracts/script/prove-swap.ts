/**
 * Routes a confidentially-authorized epoch aggregate through a REAL Uniswap V3
 * pool on Ethereum Sepolia.
 *
 * This is the composability claim, executed rather than argued. Everything
 * upstream of this point is confidential: per-call amounts, per-agent caps,
 * balances, and whether any given settlement was authorized. What arrives here
 * is a single plaintext aggregate, and it is spent through Uniswap's own
 * deployed router over its existing ABI.
 *
 * Uniswap is not forked, wrapped, or asked to change. It never learns that the
 * amount it receives is the sum of settlements whose individual values are
 * still encrypted. That is the whole point: privacy is added by layering above
 * the public protocol, not by modifying it.
 *
 * The script stands up its own pool because Sepolia has no reliable liquidity,
 * but the pool it creates is an ordinary Uniswap V3 pool created through
 * Uniswap's own factory. Nothing about it is special.
 *
 *   bun run --cwd contracts prove:swap
 */

import { network } from "hardhat";
import { parseAbi, parseUnits, formatUnits, getAddress } from "viem";

// Uniswap V3 on Ethereum Sepolia — Uniswap's own deployments.
const FACTORY = getAddress("0x0227628f3F023bb0B980b67D528571c95c6DaC1c");
const POSITION_MANAGER = getAddress("0x1238536071E1c677A632429e3655c799b22cDA52");
const SWAP_ROUTER = getAddress("0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E");

const VAULT = getAddress(process.env.VAULT_ADDRESS ?? "0x6d0bd38784d794da959b11e5cbeb35764b2579e4");
const ROUTER = getAddress(
  process.env.SETTLEMENT_ROUTER_ADDRESS ?? "0x58f97ba8803bf4b19494ff316910298c8b843633",
);

const FEE = 3000;
/** Full range for the 0.3% tier (tick spacing 60). */
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
  "function routeEpoch(uint64 epochId, address tokenIn, address tokenOut, uint24 poolFee, uint256 amountOutMinimum, uint256 deadline) returns (uint256)",
  "function routed(uint64) view returns (bool)",
  "event EpochRouted(uint64 indexed epoch, uint256 amountIn, uint256 amountOut, address indexed tokenIn, address indexed tokenOut)",
]);

async function main(): Promise<void> {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const [wallet] = await viem.getWalletClients();
  if (!wallet) throw new Error("No signer. Set DEPLOYER_PRIVATE_KEY.");
  const me = wallet.account.address;

  console.log(`operator ${me}`);
  console.log(`vault    ${VAULT}`);
  console.log(`router   ${ROUTER}\n`);

  // ---- 0. The aggregate must already be proven --------------------------
  const [count, , settled, aggregate] = (await publicClient.readContract({
    address: VAULT,
    abi: vaultAbi,
    functionName: "epochInfo",
    args: [EPOCH],
  })) as [number, boolean, boolean, bigint];

  if (!settled) throw new Error(`Epoch ${EPOCH} is not proven. Run prove:flush first.`);
  console.log(`epoch ${EPOCH}: ${count} settlements -> proven aggregate ${aggregate}`);
  console.log("this number is the ONLY thing crossing into public infrastructure\n");

  if (await publicClient.readContract({ address: ROUTER, abi: routerAbi, functionName: "routed", args: [EPOCH] })) {
    throw new Error(`Epoch ${EPOCH} already routed. Set EPOCH_ID to an unrouted epoch.`);
  }

  // ---- 1. Two ordinary ERC20s -------------------------------------------
  console.log("1. deploy a token pair");
  const tokenA = await viem.deployContract("MockERC20", ["Kairos USD", "kUSD", 18]);
  const tokenB = await viem.deployContract("MockERC20", ["Kairos ETH", "kETH", 18]);
  console.log(`   kUSD ${tokenA.address}`);
  console.log(`   kETH ${tokenB.address}`);

  // Uniswap requires token0 < token1 by address.
  const [token0, token1] =
    BigInt(tokenA.address) < BigInt(tokenB.address)
      ? [tokenA.address, tokenB.address]
      : [tokenB.address, tokenA.address];

  const liquidityEach = parseUnits("1000000", 18);
  for (const t of [tokenA.address, tokenB.address]) {
    await publicClient.waitForTransactionReceipt({
      hash: await wallet.writeContract({ address: t, abi: erc20Abi, functionName: "mint", args: [me, liquidityEach] }),
    });
  }

  // ---- 2. A real Uniswap V3 pool, via Uniswap's own factory --------------
  console.log("\n2. create and initialise the pool through Uniswap's factory");
  const createHash = await wallet.writeContract({
    address: POSITION_MANAGER,
    abi: npmAbi,
    functionName: "createAndInitializePoolIfNecessary",
    args: [token0, token1, FEE, SQRT_PRICE_1_1],
  });
  await publicClient.waitForTransactionReceipt({ hash: createHash });
  console.log(`   tx ${createHash}`);
  console.log(`   factory ${FACTORY} (Uniswap's, unmodified)`);

  // ---- 3. Provide liquidity ---------------------------------------------
  console.log("\n3. provide liquidity");
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

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const mintHash = await wallet.writeContract({
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
        deadline,
      },
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash: mintHash });
  console.log(`   tx ${mintHash}`);

  // ---- 4. Fund the settlement router with the aggregate ------------------
  // In production the treasury funds this; here we mint it, because the point
  // being demonstrated is the routing, not the funding.
  console.log("\n4. fund the settlement router with exactly the aggregate");
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
  console.log(`   router holds ${aggregate} of ${tokenIn}`);

  // ---- 5. Route ----------------------------------------------------------
  console.log("\n5. routeEpoch — through Uniswap's deployed SwapRouter02");
  const before = (await publicClient.readContract({
    address: tokenOut,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [me],
  })) as bigint;

  const routeHash = await wallet.writeContract({
    address: ROUTER,
    abi: routerAbi,
    functionName: "routeEpoch",
    args: [EPOCH, tokenIn, tokenOut, FEE, 1n, BigInt(Math.floor(Date.now() / 1000) + 1800)],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: routeHash });
  if (receipt.status !== "success") throw new Error(`routeEpoch reverted (${routeHash})`);
  console.log(`   tx ${routeHash}`);

  const after = (await publicClient.readContract({
    address: tokenOut,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [me],
  })) as bigint;

  const received = after - before;
  console.log(`   swapped ${aggregate} -> received ${received}`);
  console.log(`   swapRouter ${SWAP_ROUTER} (Uniswap's, unmodified)`);

  const leftover = (await publicClient.readContract({
    address: tokenIn,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [ROUTER],
  })) as bigint;

  let failures = 0;
  const check = (label: string, ok: boolean) => {
    if (!ok) failures += 1;
    console.log(`   ${ok ? "PASS" : "FAIL"}  ${label}`);
  };

  console.log("");
  check("the swap executed against a real Uniswap V3 pool", received > 0n);
  check("the router spent exactly the proven aggregate", leftover === 0n);
  check(
    "the epoch is marked routed, so it cannot be spent twice",
    (await publicClient.readContract({ address: ROUTER, abi: routerAbi, functionName: "routed", args: [EPOCH] })) === true,
  );

  console.log("\n" + "─".repeat(64));
  console.log("Transactions (verifiable on sepolia.etherscan.io):\n");
  console.log(`  create pool   ${createHash}`);
  console.log(`  add liquidity ${mintHash}`);
  console.log(`  routeEpoch    ${routeHash}`);
  console.log(`\n  ${count} confidential settlements -> aggregate ${aggregate}`);
  console.log(`  -> swapped for ${formatUnits(received, 18)} kETH through Uniswap V3`);
  console.log(`\n  Uniswap saw: one counterparty, one amount, one swap.`);
  console.log(`  Uniswap did NOT see: any per-settlement amount, cap, or identity.`);
  console.log("\n" + (failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`));
  if (failures > 0) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error("\nFAILED:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
