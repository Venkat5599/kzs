// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {ebool, euint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

/**
 * @title IConfidentialPolicy
 * @notice A rule a settlement must satisfy, evaluated entirely inside the TEE.
 *
 * @dev Why this interface exists
 *
 * The vault used to hardcode one rule: `amount <= capPerCall`. Real issuers do
 * not have one rule. They have per-call ceilings, velocity limits, eligibility
 * checks, and jurisdiction-specific constraints — and those change without the
 * settlement logic changing.
 *
 * So the rule is pluggable. The vault owns *enforcement*; a policy owns *the
 * rule*. This mirrors the transfer-hook pattern used by regulated token
 * standards, with one difference that is the entire point:
 *
 *   **A public compliance hook publishes the rule and the outcome.**
 *   **A confidential policy proves the rule was enforced while revealing
 *     neither its parameters nor its verdict.**
 *
 * @dev The invariant every implementation must hold
 *
 * **A policy MUST be branchless.** It must never revert, never `require`, and
 * never branch on a decrypted value, because reverting on an encrypted
 * comparison broadcasts the comparison result — which is exactly the fact the
 * system exists to hide.
 *
 * A single non-branchless policy breaks the guarantee for the whole vault, not
 * just for itself. If a rule cannot be expressed branchlessly, it does not
 * belong in a policy.
 *
 * Reverting for *public* reasons — an unregistered subject, a bad caller — is
 * permitted, because those facts are already public.
 */
interface IConfidentialPolicy {
    /**
     * @notice Decide whether a settlement satisfies this rule.
     *
     * @param subject The account being settled against.
     * @param amount  The requested amount, encrypted.
     * @param context Opaque, policy-specific data. Ignored by simple policies.
     *
     * @return approved An **encrypted** verdict. Never a plaintext bool, and
     *         never expressed as a revert.
     *
     * @dev The implementation must grant the caller access to `approved`
     *      (`Nox.allowTransient` is sufficient and preferable — the grant
     *      should not outlive the transaction that needed it).
     */
    function evaluate(
        address subject,
        euint256 amount,
        bytes calldata context
    ) external returns (ebool approved);

    /**
     * @notice Notify the policy of an authorized debit.
     *
     * @dev Called by the vault AFTER a settlement resolves, with the amount
     *      actually debited — encrypted zero when the settlement was refused.
     *      Stateless policies ignore this; stateful ones (velocity, quotas)
     *      accumulate here rather than in {evaluate}, because `evaluate` runs
     *      for refused settlements too and must not count them.
     *
     *      Passing an encrypted zero on refusal is deliberate: the policy
     *      cannot tell an authorized settlement from a refused one, so its
     *      state updates leak nothing either.
     */
    function onSettled(address subject, euint256 debited) external;
}
