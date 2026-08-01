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
 * @title CapPolicy
 * @notice A per-subject ceiling on any single settlement, held encrypted.
 *
 * @dev This is the rule the vault used to hardcode, extracted so it can be
 *      composed with others or swapped out. Behaviour is unchanged:
 *      `approved = amount <= capPerCall`, computed in the TEE.
 *
 *      The cap is never revealed. The subject may read its own via `addViewer`;
 *      nobody else can, including other subjects of the same policy.
 */
contract CapPolicy is IConfidentialPolicy {
    error NotOwner();
    error NotVault();

    event SubjectRegistered(address indexed subject);
    event SubjectRemoved(address indexed subject);

    address public immutable owner;

    /// @dev The vault permitted to call {evaluate}. A policy answering anyone
    ///      would let a stranger probe verdicts against a subject's cap.
    address public vault;

    mapping(address => euint256) private _cap;
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

    /**
     * @notice Register a subject with an encrypted per-call cap.
     * @dev Registration itself is public — an address either has a cap or does
     *      not, and that fact leaks nothing about the cap's value.
     */
    function registerSubject(
        address subject,
        externalEuint256 encryptedCap,
        bytes calldata proof
    ) external onlyOwner {
        euint256 cap = Nox.fromExternal(encryptedCap, proof);

        Nox.allowThis(cap);
        Nox.allow(cap, owner);
        if (vault != address(0)) Nox.allow(cap, vault);
        // Guarded: a trivially encrypted handle is already public, and
        // `addViewer` reverts on those. See KairosVault._addViewerIfPrivate.
        if (!Nox.isPubliclyDecryptable(cap)) Nox.addViewer(cap, subject);

        _cap[subject] = cap;
        _registered[subject] = true;

        emit SubjectRegistered(subject);
    }

    /**
     * @notice Remove a subject.
     * @dev The cap is replaced with an encrypted zero rather than deleted, so
     *      subsequent settlements fail the comparison through the ordinary
     *      branchless path. A removed subject is refused identically to one
     *      that merely exceeded its cap.
     */
    function removeSubject(address subject) external onlyOwner {
        euint256 zero = Nox.toEuint256(0);
        Nox.allowThis(zero);
        Nox.allow(zero, owner);
        if (vault != address(0)) Nox.allow(zero, vault);
        _cap[subject] = zero;
        emit SubjectRemoved(subject);
    }

    /// @inheritdoc IConfidentialPolicy
    function evaluate(
        address subject,
        euint256 amount,
        bytes calldata /* context */
    ) external override returns (ebool approved) {
        if (msg.sender != vault) revert NotVault();

        // An unregistered subject is REFUSED, not reverted.
        //
        // Reverting here would publish the refusal: the settlement transaction
        // would fail, and an observer could tell an unregistered agent from one
        // that merely exceeded its cap. That is exactly the bug that was fixed
        // in KairosVault.revokeAgent, and it was still present here.
        //
        // An unregistered subject compares against an encrypted zero, which no
        // positive amount satisfies, so it travels the ordinary branchless path.
        euint256 cap = _registered[subject] ? _cap[subject] : Nox.toEuint256(0);
        approved = Nox.le(amount, cap);

        Nox.allowThis(approved);
        // Transient: the vault needs this verdict for this transaction only.
        // A permanent grant would leave a decryptable record of every decision.
        Nox.allowTransient(approved, msg.sender);
    }

    /// @inheritdoc IConfidentialPolicy
    /// @dev Stateless — a per-call ceiling does not accumulate.
    function onSettled(address, euint256) external override {}

    function capHandle(address subject) external view returns (euint256) {
        return _cap[subject];
    }

    function isRegistered(address subject) external view returns (bool) {
        return _registered[subject];
    }
}
