// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IV3SwapRouter} from "./interfaces/IV3SwapRouter.sol";
import {KairosVault} from "./KairosVault.sol";

/**
 * @title KairosSettlementRouter
 * @notice Routes a confidentially-authorized epoch aggregate through an
 *         unmodified Uniswap V3 router.
 *
 * @dev Why this contract exists
 *
 * The interesting claim is not "we encrypted some numbers". It is that a budget
 * can be enforced and kept private while still transacting against public DeFi
 * infrastructure that was never built for privacy — and without forking that
 * infrastructure.
 *
 * This contract is where that claim is cashed. It holds no encrypted state and
 * knows nothing about TEEs. It consumes the plaintext aggregate that
 * {KairosVault.proveEpochAggregate} produced and hands it to Uniswap V3 through
 * the standard `IV3SwapRouter` interface. Uniswap is used exactly as any other
 * caller uses it: same interface, same pools, same accounting.
 *
 * @dev How privacy survives the hop
 *
 * Privacy is preserved by WHAT reaches the public protocol, not by changing the
 * public protocol:
 *
 *  - Per-call amounts never reach it. Only the epoch aggregate does, so the swap
 *    reveals a batch total rather than a payment.
 *  - No agent identity reaches it. The router is the swap's `msg.sender`, so the
 *    pool sees one counterparty regardless of how many agents contributed.
 *  - Per-agent caps and balances never leave the vault at all.
 *
 * What the public chain learns is: this router swapped N tokens, once, covering
 * some number of settlements. That is strictly less than plain x402 publishes per
 * individual call.
 *
 * @dev Composability
 *
 * Uniswap is untouched — this contract imports an interface, not a modified
 * implementation. Anything Uniswap composes with, it still composes with. The
 * same pattern retargets to any router or rail that accepts a plaintext amount:
 * the confidentiality layer sits above, and the public protocol below is
 * unaware of it.
 */
contract KairosSettlementRouter {
    using SafeERC20 for IERC20;

    // ============ Errors ============

    error NotOwner();
    error EpochNotProven(uint64 epoch);
    error EpochAlreadyRouted(uint64 epoch);
    error NothingToRoute(uint64 epoch);
    error InsufficientBalance(uint256 required, uint256 available);
    error DeadlinePassed();
    error InvalidRecipient();

    // ============ Events ============

    /// @notice An epoch aggregate was swapped. No agent, no per-call amount.
    event EpochRouted(
        uint64 indexed epoch,
        uint256 amountIn,
        uint256 amountOut,
        address indexed tokenIn,
        address indexed tokenOut
    );

    // ============ Storage ============

    address public immutable owner;
    KairosVault public immutable vault;
    IV3SwapRouter public immutable swapRouter;

    /// @dev Epochs already routed. Guards against swapping one batch twice.
    mapping(uint64 => bool) public routed;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(KairosVault vault_, IV3SwapRouter swapRouter_) {
        owner = msg.sender;
        vault = vault_;
        swapRouter = swapRouter_;
    }

    /**
     * @notice Swap a proven epoch aggregate through Uniswap V3.
     *
     * @param epochId    The epoch to route. Must already be flushed and proven.
     * @param tokenIn    Token held by this router and paid into the pool.
     * @param tokenOut   Token received.
     * @param poolFee    Uniswap V3 fee tier, e.g. 3000 for 0.3%.
     * @param amountOutMinimum Slippage floor. Never pass zero from production
     *                   code — an unbounded swap is sandwichable, and the fact
     *                   that this contract batches makes it a fatter target than
     *                   an individual payment would be.
     * @param deadline   Wall-clock bound on execution.
     *
     * @dev The amount is read back from the vault rather than passed in. A
     *      caller-supplied amount would let the operator route a number the
     *      confidential accounting never authorized, which would quietly sever
     *      the link between what was enforced and what was spent.
     */
    function routeEpoch(
        uint64 epochId,
        address tokenIn,
        address tokenOut,
        uint24 poolFee,
        uint256 amountOutMinimum,
        uint256 deadline
    ) external onlyOwner returns (uint256 amountOut) {
        return _route(epochId, tokenIn, tokenOut, poolFee, amountOutMinimum, deadline, owner);
    }

    /**
     * @notice Route a batch, paying out to a stealth address.
     *
     * @dev The relayer hides the payer: every agent shares one sender, so no
     *      two agents are distinguishable on-chain. This closes the other half.
     *
     *      Paying a fixed address would build a public history — how often this
     *      operator is paid, how much, and by correlation with whom. A stealth
     *      address has never appeared on-chain before and cannot be linked to
     *      the recipient by anyone but the recipient.
     *
     *      The address is derived off-chain (packages/shared/stealth.ts) and the
     *      ephemeral key is published to StealthAnnouncer so the recipient can
     *      find it. This contract only needs somewhere to send the proceeds.
     */
    function routeEpochToStealth(
        uint64 epochId,
        address tokenIn,
        address tokenOut,
        uint24 poolFee,
        uint256 amountOutMinimum,
        uint256 deadline,
        address stealthRecipient
    ) external onlyOwner returns (uint256 amountOut) {
        if (stealthRecipient == address(0)) revert InvalidRecipient();
        return _route(epochId, tokenIn, tokenOut, poolFee, amountOutMinimum, deadline, stealthRecipient);
    }

    function _route(
        uint64 epochId,
        address tokenIn,
        address tokenOut,
        uint24 poolFee,
        uint256 amountOutMinimum,
        uint256 deadline,
        address recipient
    ) private returns (uint256 amountOut) {
        if (block.timestamp > deadline) revert DeadlinePassed();
        if (routed[epochId]) revert EpochAlreadyRouted(epochId);

        (, , bool settled, uint256 aggregate) = vault.epochInfo(epochId);
        if (!settled) revert EpochNotProven(epochId);
        if (aggregate == 0) revert NothingToRoute(epochId);

        uint256 available = IERC20(tokenIn).balanceOf(address(this));
        if (available < aggregate) revert InsufficientBalance(aggregate, available);

        // Mark before the external call. The swap re-enters nothing we own, but
        // ordering the write first costs nothing and removes the question.
        routed[epochId] = true;

        // forceApprove rather than approve: some ERC20s (USDT among them) revert
        // when moving a non-zero allowance to another non-zero value.
        IERC20(tokenIn).forceApprove(address(swapRouter), aggregate);

        amountOut = swapRouter.exactInputSingle(
            IV3SwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: poolFee,
                recipient: recipient,
                amountIn: aggregate,
                amountOutMinimum: amountOutMinimum,
                sqrtPriceLimitX96: 0
            })
        );

        // Leave no standing allowance behind.
        IERC20(tokenIn).forceApprove(address(swapRouter), 0);

        emit EpochRouted(epochId, aggregate, amountOut, tokenIn, tokenOut);
    }

    /**
     * @notice Recover tokens sent here directly.
     * @dev The router is a waypoint, not a treasury. Anything that lands here
     *      outside the settlement path should be able to leave.
     */
    function sweep(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
}
