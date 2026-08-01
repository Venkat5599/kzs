// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IV3SwapRouter} from "../../src/interfaces/IV3SwapRouter.sol";

/**
 * @dev Test doubles for the settlement router.
 *
 * The router is the one contract in this system with no Nox dependency, which
 * means it can be tested on a bare local chain with no TEE and no fork. These
 * mocks exist to keep it that way.
 */

contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * @dev Stands in for KairosVault's epochInfo. The router only ever reads
 *      `settled` and `aggregate`, so that is all this needs to model.
 */
contract MockVault {
    struct EpochRecord {
        uint32 settlementCount;
        bool flushed;
        bool settled;
        uint256 aggregate;
    }

    mapping(uint64 => EpochRecord) private _epochs;

    function setEpoch(
        uint64 epochId,
        uint32 settlementCount,
        bool flushed,
        bool settled,
        uint256 aggregate
    ) external {
        _epochs[epochId] = EpochRecord(settlementCount, flushed, settled, aggregate);
    }

    function epochInfo(
        uint64 epochId
    ) external view returns (uint32, bool, bool, uint256) {
        EpochRecord storage e = _epochs[epochId];
        return (e.settlementCount, e.flushed, e.settled, e.aggregate);
    }
}

/**
 * @dev A Uniswap V3 router that pays out at a fixed rate.
 *
 * Deliberately honours `amountOutMinimum` by reverting, so the slippage-floor
 * test exercises a real failure rather than a simulated one.
 */
contract MockSwapRouter is IV3SwapRouter {
    error TooLittleReceived(uint256 expected, uint256 actual);

    /// @dev Output per input, scaled by 1e18. 2e18 pays two out for one in.
    uint256 public rate = 1e18;

    event SwapCalled(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn);

    function setRate(uint256 rate_) external {
        rate = rate_;
    }

    function exactInputSingle(
        ExactInputSingleParams calldata params
    ) external payable override returns (uint256 amountOut) {
        IERC20(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);

        amountOut = (params.amountIn * rate) / 1e18;
        if (amountOut < params.amountOutMinimum) {
            revert TooLittleReceived(params.amountOutMinimum, amountOut);
        }

        MockERC20(params.tokenOut).mint(params.recipient, amountOut);

        emit SwapCalled(
            params.tokenIn,
            params.tokenOut,
            params.fee,
            params.recipient,
            params.amountIn
        );
    }
}
