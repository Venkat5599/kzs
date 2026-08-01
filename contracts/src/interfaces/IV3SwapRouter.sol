// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.35;

/**
 * @title IV3SwapRouter
 * @notice Minimal interface to Uniswap's V3 SwapRouter02.
 *
 * @dev Declared locally rather than imported from `@uniswap/swap-router-contracts`
 *      because that package pins an older pragma and pulls a large dependency
 *      tree for one struct and one function.
 *
 *      This is an INTERFACE ONLY. Uniswap's deployed router is used unmodified —
 *      that is the whole point. Nothing in Kairos forks, wraps or re-implements
 *      the AMM; the confidentiality layer sits above it and speaks its existing
 *      ABI. Any protocol exposing a comparable entry point can be substituted
 *      without touching the vault.
 *
 *      Note this is SwapRouter02, whose `ExactInputSingleParams` has no
 *      `deadline` field (the original SwapRouter did). Callers enforce their own
 *      deadline — see {KairosSettlementRouter.routeEpoch}.
 */
interface IV3SwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    /// @notice Swaps `amountIn` of one token for as much as possible of another.
    function exactInputSingle(
        ExactInputSingleParams calldata params
    ) external payable returns (uint256 amountOut);
}
