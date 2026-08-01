// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {
    Nox,
    ebool,
    euint256,
    externalEuint256
} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import {IConfidentialPolicy} from "./IConfidentialPolicy.sol";

/**
 * @title VelocityPolicy
 * @notice A cumulative ceiling: how much a subject may spend in total, not per call.
 *
 * @dev Why this needs {onSettled}
 *
 * A per-call cap is a pure predicate — it can be decided from the request
 * alone. A velocity limit cannot: it depends on what has already been spent,
 * and `evaluate` runs for refused settlements too.
 *
 * If accumulation happened in `evaluate`, a refused settlement would consume
 * quota it never used, and an attacker could exhaust a subject's allowance by
 * submitting settlements guaranteed to fail. So accumulation happens in
 * {onSettled}, which the vault calls with the amount **actually** debited.
 *
 * @dev Why the refused case leaks nothing
 *
 * The vault passes an encrypted zero on refusal rather than skipping the call.
 * The policy therefore performs the same operations, writing the same number of
 * handles, whether or not the settlement was authorized. It cannot tell the
 * difference, and neither can an observer.
 */
contract VelocityPolicy is IConfidentialPolicy {
    error NotOwner();
    error NotVault();
    error SubjectNotRegistered(address subject);

    event SubjectRegistered(address indexed subject);
    event SubjectReset(address indexed subject);

    address public immutable owner;
    address public vault;

    /// @dev Total the subject may spend across all settlements. Encrypted.
    mapping(address => euint256) private _allowance;
    /// @dev Total spent so far. Encrypted.
    mapping(address => euint256) private _consumed;
    mapping(address => bool) private _registered;

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

    function registerSubject(
        address subject,
        externalEuint256 encryptedAllowance,
        bytes calldata proof
    ) external onlyOwner {
        euint256 allowance = Nox.fromExternal(encryptedAllowance, proof);
        euint256 consumed = Nox.toEuint256(0);

        _grant(allowance, subject);
        _grant(consumed, subject);

        _allowance[subject] = allowance;
        _consumed[subject] = consumed;
        _registered[subject] = true;

        emit SubjectRegistered(subject);
    }

    /// @notice Reset consumption, e.g. at the start of a billing period.
    function resetConsumed(address subject) external onlyOwner {
        euint256 consumed = Nox.toEuint256(0);
        _grant(consumed, subject);
        _consumed[subject] = consumed;
        emit SubjectReset(subject);
    }

    /// @inheritdoc IConfidentialPolicy
    function evaluate(
        address subject,
        euint256 amount,
        bytes calldata /* context */
    ) external override returns (ebool approved) {
        if (msg.sender != vault) revert NotVault();
        if (!_registered[subject]) revert SubjectNotRegistered(subject);

        // Would this settlement take the subject past its total allowance?
        // `add` rather than `safeAdd`: an overflow here would require an
        // allowance near 2^256, and the safe variant's flag would need
        // composing into the verdict for no practical gain.
        euint256 projected = Nox.add(_consumed[subject], amount);
        approved = Nox.le(projected, _allowance[subject]);

        Nox.allowThis(approved);
        Nox.allowTransient(approved, msg.sender);
    }

    /// @inheritdoc IConfidentialPolicy
    function onSettled(address subject, euint256 debited) external override {
        if (msg.sender != vault) revert NotVault();
        if (!_registered[subject]) revert SubjectNotRegistered(subject);

        // `debited` is an encrypted zero when the settlement was refused, so
        // this runs identically either way.
        euint256 consumed = Nox.add(_consumed[subject], debited);
        _grant(consumed, subject);
        _consumed[subject] = consumed;
    }

    function _grant(euint256 handle, address subject) private {
        Nox.allowThis(handle);
        Nox.allow(handle, owner);
        if (vault != address(0)) Nox.allow(handle, vault);
        if (!Nox.isPubliclyDecryptable(handle)) Nox.addViewer(handle, subject);
    }

    function allowanceHandle(address subject) external view returns (euint256) {
        return _allowance[subject];
    }

    function consumedHandle(address subject) external view returns (euint256) {
        return _consumed[subject];
    }

    function isRegistered(address subject) external view returns (bool) {
        return _registered[subject];
    }
}
