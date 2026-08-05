// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {Nox, ebool, euint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import {IConfidentialPolicy} from "./IConfidentialPolicy.sol";

/**
 * @title CompositePolicy
 * @notice Several policies, all of which must approve.
 *
 * @dev The interesting problem: AND without boolean operators
 *
 * Nox exposes no `and`, `or` or `not` on `ebool`. Comparisons produce `ebool`
 * and `select` consumes it, but there is no way to combine two of them
 * directly. Conjunction has to be built out of arithmetic.
 *
 * The construction below, which is the same one {KairosVault.settle} uses for
 * `withinCap AND funded`, generalised to N terms:
 *
 *   acc = 1
 *   for each policy:
 *       acc = select(approved_i, acc, 0)   // acc survives only if approved
 *   verdict = (acc == 1)
 *
 * `acc` reaches the end as one exactly when every term approved. A single
 * refusal collapses it to zero and no later term can restore it.
 *
 * @dev Why this is constant-work
 *
 * There is deliberately no early exit. Short-circuiting on the first refusal
 * would make gas a function of *which* policy refused — a side channel that
 * would hand an observer the one fact the encryption is protecting. Every
 * policy is evaluated on every settlement, always, whatever the outcome.
 *
 * That is more expensive than short-circuiting. It is supposed to be.
 */
contract CompositePolicy is IConfidentialPolicy {
    error NotOwner();
    error NotVault();
    error NoPolicies();
    error TooManyPolicies(uint256 given, uint256 max);

    event PoliciesSet(uint256 count);

    /// @dev Bounded so a settlement cannot be made to run out of gas by
    ///      appending policies. Every one runs on every call.
    uint256 public constant MAX_POLICIES = 8;

    address public immutable owner;
    address public vault;

    IConfidentialPolicy[] private _policies;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setVault(address vault_) external onlyOwner {
        vault = vault_;
    }

    function setPolicies(IConfidentialPolicy[] calldata policies) external onlyOwner {
        if (policies.length == 0) revert NoPolicies();
        if (policies.length > MAX_POLICIES) revert TooManyPolicies(policies.length, MAX_POLICIES);

        delete _policies;
        for (uint256 i = 0; i < policies.length; ++i) {
            _policies.push(policies[i]);
        }
        emit PoliciesSet(policies.length);
    }

    /// @inheritdoc IConfidentialPolicy
    function evaluate(
        address subject,
        euint256 amount,
        bytes calldata context
    ) external override returns (ebool approved) {
        if (msg.sender != vault) revert NotVault();

        euint256 zero = Nox.toEuint256(0);
        euint256 one = Nox.toEuint256(1);

        uint256 n = _policies.length;

        // An empty composite must REFUSE, not approve.
        //
        // Starting the accumulator at one and skipping the loop would make an
        // unconfigured composite authorize everything — a vault whose owner
        // installed the policy but had not yet populated it would be wide open,
        // and nothing on-chain would look wrong. Seeding from `n` makes the
        // safe direction the default.
        euint256 acc = n == 0 ? zero : one;
        for (uint256 i = 0; i < n; ++i) {
            // Same reason the vault grants us access: each child is its own
            // contract and would otherwise revert on the first Nox op.
            Nox.allowTransient(amount, address(_policies[i]));
            ebool term = _policies[i].evaluate(subject, amount, context);
            // Collapses acc to zero on refusal, and nothing later can undo it.
            acc = Nox.select(term, acc, zero);
        }

        approved = Nox.eq(acc, one);

        Nox.allowThis(approved);
        Nox.allowTransient(approved, msg.sender);
    }

    /// @inheritdoc IConfidentialPolicy
    /// @dev Fans out to every child so stateful policies accumulate correctly.
    function onSettled(address subject, euint256 debited) external override {
        if (msg.sender != vault) revert NotVault();
        uint256 n = _policies.length;
        for (uint256 i = 0; i < n; ++i) {
            Nox.allowTransient(debited, address(_policies[i]));
            _policies[i].onSettled(subject, debited);
        }
    }

    function policyCount() external view returns (uint256) {
        return _policies.length;
    }

    function policyAt(uint256 i) external view returns (IConfidentialPolicy) {
        return _policies[i];
    }
}
