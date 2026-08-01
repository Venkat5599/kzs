import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { network } from "hardhat";
import { parseUnits, getAddress } from "viem";

/**
 * Settlement router tests.
 *
 * The router is the composability hinge: it takes the plaintext aggregate the
 * vault proved and hands it to an unmodified Uniswap V3 router. It holds no
 * encrypted state, so unlike the vault it runs on a bare local chain.
 *
 * The cases that matter are the ones where a bug would either lose money or
 * quietly sever the link between what the confidential layer authorized and what
 * actually got spent.
 */

const FEE_TIER = 3000;
const FUTURE_DEADLINE = 4_000_000_000n;

/**
 * `NotOwner()` is declared on both the router and the mock vault. viem cannot
 * always tell which ABI a bare selector came from and reports it as an
 * unrecognized custom error, so match the selector as well as the name rather
 * than assert on a message that is not guaranteed to carry it.
 */
const NOT_OWNER_SELECTOR = "0x30cd7471";

function revertsWith(pattern: RegExp) {
  return (err: unknown) => {
    assert.match(String(err), pattern);
    return true;
  };
}

const notOwner = revertsWith(new RegExp(`NotOwner|${NOT_OWNER_SELECTOR}`));

async function deploy() {
  const { viem } = await network.connect();
  const [owner, outsider] = await viem.getWalletClients();

  const tokenIn = await viem.deployContract("MockERC20", ["USD Coin", "USDC", 6]);
  const tokenOut = await viem.deployContract("MockERC20", ["Wrapped Ether", "WETH", 18]);
  const vault = await viem.deployContract("MockVault", []);
  const swapRouter = await viem.deployContract("MockSwapRouter", []);

  const router = await viem.deployContract("KairosSettlementRouter", [
    vault.address,
    swapRouter.address,
  ]);

  return { viem, owner, outsider, tokenIn, tokenOut, vault, swapRouter, router };
}

describe("KairosSettlementRouter", () => {
  let ctx: Awaited<ReturnType<typeof deploy>>;
  const aggregate = parseUnits("1000", 6);

  beforeEach(async () => {
    ctx = await deploy();
  });

  /** Put epoch 1 in the state the router expects: proven, with a balance to spend. */
  async function fundedProvenEpoch(amount = aggregate) {
    await ctx.vault.write.setEpoch([1n, 25, true, true, amount]);
    await ctx.tokenIn.write.mint([ctx.router.address, amount]);
  }

  describe("the happy path", () => {
    it("swaps exactly the proven aggregate, and pays the owner", async () => {
      await fundedProvenEpoch();

      await ctx.router.write.routeEpoch([
        1n,
        ctx.tokenIn.address,
        ctx.tokenOut.address,
        FEE_TIER,
        0n,
        FUTURE_DEADLINE,
      ]);

      // Rate is 1:1 in the mock, so out == in. What is being asserted is that
      // the router spent the aggregate and nothing else.
      const received = await ctx.tokenOut.read.balanceOf([ctx.owner.account.address]);
      assert.equal(received, aggregate);

      const leftover = await ctx.tokenIn.read.balanceOf([ctx.router.address]);
      assert.equal(leftover, 0n, "router should not retain the input token");
    });

    it("leaves no standing allowance on the external router", async () => {
      await fundedProvenEpoch();

      await ctx.router.write.routeEpoch([
        1n,
        ctx.tokenIn.address,
        ctx.tokenOut.address,
        FEE_TIER,
        0n,
        FUTURE_DEADLINE,
      ]);

      // A lingering approval to a third-party contract is a standing liability,
      // and this one would be against a batch-sized balance.
      const allowance = await ctx.tokenIn.read.allowance([
        ctx.router.address,
        ctx.swapRouter.address,
      ]);
      assert.equal(allowance, 0n);
    });

    it("emits the epoch and the amounts, and nothing that identifies an agent", async () => {
      await fundedProvenEpoch();

      await ctx.router.write.routeEpoch([
        1n,
        ctx.tokenIn.address,
        ctx.tokenOut.address,
        FEE_TIER,
        0n,
        FUTURE_DEADLINE,
      ]);

      const events = await ctx.router.getEvents.EpochRouted();
      assert.equal(events.length, 1);
      assert.equal(events[0]?.args.epoch, 1n);
      assert.equal(events[0]?.args.amountIn, aggregate);
      assert.equal(
        getAddress(events[0]?.args.tokenIn as string),
        getAddress(ctx.tokenIn.address),
      );
    });
  });

  describe("the amount is taken from the vault, never from the caller", () => {
    it("routes the vault's aggregate even though the router holds more", async () => {
      // The router is over-funded. If the implementation ever swapped its own
      // balance instead of the proven aggregate, the confidential accounting and
      // the actual spend would silently diverge — the failure this test exists
      // to catch.
      await ctx.vault.write.setEpoch([1n, 25, true, true, aggregate]);
      await ctx.tokenIn.write.mint([ctx.router.address, aggregate * 3n]);

      await ctx.router.write.routeEpoch([
        1n,
        ctx.tokenIn.address,
        ctx.tokenOut.address,
        FEE_TIER,
        0n,
        FUTURE_DEADLINE,
      ]);

      const swapped = await ctx.tokenOut.read.balanceOf([ctx.owner.account.address]);
      assert.equal(swapped, aggregate, "must swap the proven aggregate, not the balance");

      const retained = await ctx.tokenIn.read.balanceOf([ctx.router.address]);
      assert.equal(retained, aggregate * 2n);
    });
  });

  describe("refusals", () => {
    it("refuses an epoch that was never proven", async () => {
      // Flushed but not proven: the aggregate is not yet established on-chain.
      await ctx.vault.write.setEpoch([1n, 25, true, false, aggregate]);
      await ctx.tokenIn.write.mint([ctx.router.address, aggregate]);

      await assert.rejects(
        ctx.router.write.routeEpoch([
          1n,
          ctx.tokenIn.address,
          ctx.tokenOut.address,
          FEE_TIER,
          0n,
          FUTURE_DEADLINE,
        ]),
        /EpochNotProven/,
      );
    });

    it("refuses to route the same epoch twice", async () => {
      await fundedProvenEpoch();
      await ctx.tokenIn.write.mint([ctx.router.address, aggregate]);

      await ctx.router.write.routeEpoch([
        1n,
        ctx.tokenIn.address,
        ctx.tokenOut.address,
        FEE_TIER,
        0n,
        FUTURE_DEADLINE,
      ]);

      // Double-routing would spend a second batch against one authorization.
      await assert.rejects(
        ctx.router.write.routeEpoch([
          1n,
          ctx.tokenIn.address,
          ctx.tokenOut.address,
          FEE_TIER,
          0n,
          FUTURE_DEADLINE,
        ]),
        /EpochAlreadyRouted/,
      );
    });

    it("refuses an empty epoch", async () => {
      await ctx.vault.write.setEpoch([1n, 0, true, true, 0n]);

      await assert.rejects(
        ctx.router.write.routeEpoch([
          1n,
          ctx.tokenIn.address,
          ctx.tokenOut.address,
          FEE_TIER,
          0n,
          FUTURE_DEADLINE,
        ]),
        /NothingToRoute/,
      );
    });

    it("refuses when the router cannot cover the aggregate", async () => {
      await ctx.vault.write.setEpoch([1n, 25, true, true, aggregate]);
      await ctx.tokenIn.write.mint([ctx.router.address, aggregate / 2n]);

      await assert.rejects(
        ctx.router.write.routeEpoch([
          1n,
          ctx.tokenIn.address,
          ctx.tokenOut.address,
          FEE_TIER,
          0n,
          FUTURE_DEADLINE,
        ]),
        /InsufficientBalance/,
      );
    });

    it("refuses a stale deadline", async () => {
      await fundedProvenEpoch();

      await assert.rejects(
        ctx.router.write.routeEpoch([
          1n,
          ctx.tokenIn.address,
          ctx.tokenOut.address,
          FEE_TIER,
          0n,
          1n, // 1970
        ]),
        /DeadlinePassed/,
      );
    });

    it("refuses anyone but the owner", async () => {
      await fundedProvenEpoch();

      await assert.rejects(
        ctx.router.write.routeEpoch(
          [1n, ctx.tokenIn.address, ctx.tokenOut.address, FEE_TIER, 0n, FUTURE_DEADLINE],
          { account: ctx.outsider.account },
        ),
        notOwner,
      );
    });
  });

  describe("slippage", () => {
    it("reverts rather than accept less than the floor", async () => {
      await fundedProvenEpoch();
      // Halve the rate so the swap under-delivers against the floor below.
      await ctx.swapRouter.write.setRate([5n * 10n ** 17n]);

      await assert.rejects(
        ctx.router.write.routeEpoch([
          1n,
          ctx.tokenIn.address,
          ctx.tokenOut.address,
          FEE_TIER,
          aggregate, // demand 1:1
          FUTURE_DEADLINE,
        ]),
        /TooLittleReceived/,
      );
    });

    it("does not mark the epoch routed when the swap reverts", async () => {
      await fundedProvenEpoch();
      await ctx.swapRouter.write.setRate([5n * 10n ** 17n]);

      await assert.rejects(
        ctx.router.write.routeEpoch([
          1n,
          ctx.tokenIn.address,
          ctx.tokenOut.address,
          FEE_TIER,
          aggregate,
          FUTURE_DEADLINE,
        ]),
      );

      // routed[] is written before the external call, so this only holds because
      // the whole transaction reverts. If that ever stops being true, a failed
      // swap would permanently strand an epoch.
      assert.equal(await ctx.router.read.routed([1n]), false);

      await ctx.swapRouter.write.setRate([10n ** 18n]);
      await ctx.router.write.routeEpoch([
        1n,
        ctx.tokenIn.address,
        ctx.tokenOut.address,
        FEE_TIER,
        aggregate,
        FUTURE_DEADLINE,
      ]);
      assert.equal(await ctx.router.read.routed([1n]), true);
    });
  });

  describe("sweep", () => {
    it("returns stray tokens, and only for the owner", async () => {
      await ctx.tokenIn.write.mint([ctx.router.address, 500n]);

      await assert.rejects(
        ctx.router.write.sweep([ctx.tokenIn.address, ctx.outsider.account.address, 500n], {
          account: ctx.outsider.account,
        }),
        notOwner,
      );

      await ctx.router.write.sweep([ctx.tokenIn.address, ctx.owner.account.address, 500n]);
      assert.equal(await ctx.tokenIn.read.balanceOf([ctx.router.address]), 0n);
    });
  });
});
