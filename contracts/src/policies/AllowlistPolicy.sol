// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {Nox, ebool, euint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import {IConfidentialPolicy} from "./IConfidentialPolicy.sol";

/**
 * @title AllowlistPolicy
 * @notice Eligibility — KYC, jurisdiction, accreditation — held as an encrypted flag.
 *
 * @dev This is the one that most clearly separates a confidential policy from a
 *      public compliance hook.
 *
 *      A public allowlist publishes the membership set. Anyone can enumerate
 *      who passed KYC, who was rejected, and when a status changed. For a
 *      regulated issuer that set *is* the holder register — commercially
 *      sensitive, and in several jurisdictions personal data.
 *
 *      Here eligibility is an encrypted boolean. The vault learns whether to
 *      authorize, and learns it only as ciphertext. No observer can enumerate
 *      the set, and a rejected subject is indistinguishable on-chain from one
 *      that merely exceeded a cap.
 *
 * @dev Eligibility is stored as euint256 in {0,1} rather than as ebool, because
 *      the amount is irrelevant to this rule and comparing to one is the
 *      cheapest way to produce the verdict.
 */
contract AllowlistPolicy is IConfidentialPolicy {
    error NotOwner();
    error NotVault();

    event EligibilitySet(address indexed subject);

    address public immutable owner;
    address public vault;

    /// @dev 1 = eligible, 0 = not. Encrypted; unset subjects read as zero.
    mapping(address => euint256) private _eligible;
    mapping(address => bool) private _hasEntry;

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
     * @notice Set a subject's eligibility.
     *
     * @dev The flag is derived from a plaintext bool, so the resulting handle
     *      is trivially encrypted and therefore public. That is an accepted and
     *      deliberate limitation: this variant proves the composition mechanism
     *      rather than the confidentiality of the flag itself.
     *
     *      For a deployment where the eligibility bit must itself be private,
     *      take it as an `externalEuint256` from the compliance provider — the
     *      same pattern {CapPolicy.registerSubject} uses. The evaluate path
     *      below is unchanged either way.
     */
    function setEligible(address subject, bool eligible) external onlyOwner {
        euint256 flag = Nox.toEuint256(eligible ? 1 : 0);
        Nox.allowThis(flag);
        Nox.allow(flag, owner);
        if (vault != address(0)) Nox.allow(flag, vault);

        _eligible[subject] = flag;
        _hasEntry[subject] = true;

        emit EligibilitySet(subject);
    }

    /// @inheritdoc IConfidentialPolicy
    function evaluate(
        address subject,
        euint256 /* amount */,
        bytes calldata /* context */
    ) external override returns (ebool approved) {
        if (msg.sender != vault) revert NotVault();

        // An unknown subject is not eligible — but it is refused through the
        // same encrypted comparison as a known-ineligible one, rather than by
        // reverting. Reverting would publish that the subject is unknown.
        euint256 flag = _hasEntry[subject] ? _eligible[subject] : Nox.toEuint256(0);
        approved = Nox.eq(flag, Nox.toEuint256(1));

        Nox.allowThis(approved);
        Nox.allowTransient(approved, msg.sender);
    }

    /// @inheritdoc IConfidentialPolicy
    /// @dev Stateless — eligibility does not accumulate.
    function onSettled(address, euint256) external override {}

    function eligibilityHandle(address subject) external view returns (euint256) {
        return _eligible[subject];
    }

    function hasEntry(address subject) external view returns (bool) {
        return _hasEntry[subject];
    }
}
