// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {
    Nox,
    ebool,
    euint256,
    externalEuint256
} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import {IConfidentialPolicy} from "./policies/IConfidentialPolicy.sol";

/**
 * @title KairosVault
 * @notice A spending budget an AI agent cannot exceed, and cannot reveal.
 *
 * @dev The problem this solves
 *
 * x402 is a public-by-design payment standard. Metering agent traffic through it
 * publishes an operational diary: which agent is active, how often, against which
 * vendor, for how much, and how much allowance remains. Not enforcing the budget
 * on-chain is worse — then the cap is advisory and one compromised prompt drains
 * the treasury.
 *
 * KairosVault keeps the enforcement and drops the disclosure. Balances, caps and
 * settlement amounts live as Nox encrypted handles. Comparison happens inside the
 * TEE. The chain stores handles, never values.
 *
 * @dev Three properties, and how each is obtained
 *
 * 1. AUTHORIZATION IS BRANCHLESS.
 *    An `ebool` cannot gate a `require`, and reverting on an encrypted comparison
 *    would broadcast the comparison result — the exact fact we are hiding. So no
 *    control flow depends on an encrypted value. An over-cap settlement debits
 *    zero and the transaction still succeeds, indistinguishable on-chain from an
 *    authorized one. See {settle} and docs/adr/001.
 *
 * 2. BALANCE MOVEMENT USES NOX'S OWN PRIMITIVES.
 *    {settle} does not hand-roll arithmetic around encrypted balances. It calls
 *    `Nox.transfer`, which moves an encrypted amount between two encrypted
 *    balances atomically inside the TEE and reports insufficiency as an encrypted
 *    flag rather than a revert. Underfunding is therefore confidential for the
 *    same reason over-cap is.
 *
 * 3. THE PAYMENT GRAPH IS BROKEN.
 *    Settlement events carry no address and no amount — only an epoch number.
 *    Debits accumulate into an encrypted epoch balance that the owner flushes as
 *    one aggregate, so there is no one-transaction-per-call trail to correlate by
 *    timing. See {flushEpoch} and docs/adr/003.
 *
 * @dev Composability
 *
 * Nothing here modifies x402 or any downstream protocol. The vault is a
 * confidentiality layer bolted alongside public infrastructure: the aggregate
 * released by {flushEpoch} is an ordinary plaintext number that an unmodified
 * DEX, router or payment rail can consume. Privacy is added by layering and
 * batching, not by forking the protocols underneath.
 */
contract KairosVault {
    // ============ Errors ============

    error NotOwner();
    error NotRelayer();
    error AgentNotRegistered(address agent);
    error AgentAlreadyRegistered(address agent);
    error EpochNotFlushable();
    error EpochAlreadySettled(uint64 epoch);
    error EpochNotFlushed(uint64 epoch);
    error HandleAlreadyUsed(bytes32 handle);
    error NoPolicy();

    // ============ Events ============
    //
    // Deliberately anaemic. An event that carried the agent or the amount would
    // hand back exactly what the encrypted handles withhold. `epoch` is the only
    // field, and it is already public by construction.

    event PolicySet(address indexed policy);
    event AgentRegistered(address indexed agent);

    /// @notice A settlement was processed. Not whether it was authorized.
    event Settled(uint64 indexed epoch);

    /// @notice An epoch was closed and its aggregate released for public decryption.
    event EpochFlushed(uint64 indexed epoch, uint32 settlementCount);

    /// @notice A flushed epoch's plaintext aggregate was proven on-chain.
    event EpochSettled(uint64 indexed epoch, uint256 aggregateAmount);

    // ============ Types ============

    struct Agent {
        /// @dev Cumulative authorized spend. Encrypted.
        ///
        ///      The per-call cap deliberately does NOT live here. Rules belong
        ///      to the installed policy; the vault keeps only settlement state.
        euint256 spent;
        bool registered;
    }

    struct Epoch {
        /// @dev Encrypted sum of everything debited during this epoch.
        euint256 total;
        uint32 settlementCount;
        bool flushed;
        bool settled;
        /// @dev Plaintext aggregate, populated only after {proveEpochAggregate}.
        uint256 aggregate;
    }

    // ============ Storage ============

    address public immutable owner;

    /// @dev The single account permitted to submit settlements.
    ///
    /// `msg.sender` is inherently public. Routing every settlement through one
    /// relayer means per-agent activity is not distinguishable from the sender
    /// field. The cost is that the relayer is visible and learns what it relays;
    /// that is stated plainly rather than hidden. See docs/adr/004.
    address public relayer;

    /// @dev The confidential treasury. Encrypted balance held by the vault itself.
    euint256 private _treasury;

    /// @dev Total confidential supply ever minted into this vault.
    euint256 private _totalSupply;

    uint64 public currentEpoch;

    /// @dev Settlements required before an epoch may be flushed. Longer epochs
    ///      buy timing privacy at the cost of operator latency.
    uint32 public immutable flushThreshold;

    /// @dev The rule every settlement must satisfy. Swappable by the owner, so
    ///      a ring can change its compliance framework without redeploying the
    ///      vault or migrating encrypted balances.
    IConfidentialPolicy public policy;

    /// @dev Nullifier set. A settlement handle may be spent exactly once.
    ///
    ///      Without this the relayer could resubmit a captured (handle, proof)
    ///      pair and debit the same authorized amount repeatedly. The vault
    ///      cannot detect the replay from the ciphertext — the handle is
    ///      identical by construction — so it is recorded in the clear. The
    ///      handle reveals nothing about the value it references.
    mapping(bytes32 => bool) public handleSpent;

    mapping(address => Agent) private _agents;
    mapping(uint64 => Epoch) private _epochs;

    // ============ Modifiers ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    // ============ Construction ============

    constructor(address relayer_, uint32 flushThreshold_) {
        owner = msg.sender;
        relayer = relayer_;
        flushThreshold = flushThreshold_;

        // A zeroed handle is not a usable encrypted zero. Initialise the
        // treasury and supply so the first settlement has real handles to work
        // against, and grant this contract permission to keep operating on them.
        _treasury = Nox.toEuint256(0);
        Nox.allowThis(_treasury);
        Nox.allow(_treasury, owner);

        _totalSupply = Nox.toEuint256(0);
        Nox.allowThis(_totalSupply);
        Nox.allow(_totalSupply, owner);

        _openEpoch(0);
    }

    // ============ Treasury ============

    /**
     * @notice Fund the treasury with an encrypted amount.
     * @dev Uses `Nox.mint`, which raises the encrypted balance and the encrypted
     *      total supply atomically and reports overflow as an encrypted flag.
     *      The flag is retained for the owner rather than acted on, because
     *      branching on it here would leak whether the mint succeeded.
     */
    function fund(externalEuint256 encryptedAmount, bytes calldata proof) external onlyOwner {
        euint256 amount = Nox.fromExternal(encryptedAmount, proof);

        (ebool success, euint256 newTreasury, euint256 newSupply) =
            Nox.mint(_treasury, amount, _totalSupply);

        _treasury = newTreasury;
        _totalSupply = newSupply;

        Nox.allowThis(_treasury);
        Nox.allow(_treasury, owner);
        Nox.allowThis(_totalSupply);
        Nox.allow(_totalSupply, owner);

        // The owner may read whether their own funding landed. Nobody else may.
        Nox.allow(success, owner);
    }

    // ============ Agents ============

    /**
     * @notice Register an agent with an encrypted per-call cap.
     * @dev The agent becomes a viewer of its own cap and spend — it can see its
     *      own limit without any other party, including other agents, learning it.
     */
    /**
     * @notice Admit an agent to this ring.
     *
     * @dev Deliberately takes no cap. Authorization is the policy's job now, so
     *      a cap stored here would be a second source of truth that nothing
     *      reads — the kind of dead field someone later mistakes for the
     *      enforced value. Register the agent's limits with the policy
     *      (e.g. {CapPolicy.registerSubject}).
     *
     *      What the vault still owns is cumulative spend, because that is
     *      settlement state rather than a rule.
     */
    function registerAgent(address agent) external onlyOwner {
        if (_agents[agent].registered) revert AgentAlreadyRegistered(agent);

        euint256 spent = Nox.toEuint256(0);
        Nox.allowThis(spent);
        Nox.allow(spent, owner);
        _addViewerIfPrivate(spent, agent);

        _agents[agent] = Agent({spent: spent, registered: true});

        emit AgentRegistered(agent);
    }

    /**
     * @notice Revocation lives in the policy, not here — deliberately.
     *
     * @dev An earlier version flipped a `registered` flag on this contract, and
     *      `settle` reverted for a revoked agent. That was a privacy bug: the
     *      revert is public, so revocation was announced on-chain and a revoked
     *      agent was distinguishable from one that merely exceeded its cap. The
     *      comment above it claimed the opposite, which is worse than saying
     *      nothing.
     *
     *      Revocation is now a policy operation — {CapPolicy.removeSubject}, or
     *      {AllowlistPolicy.setEligible} with false. Both replace the subject's
     *      encrypted state such that the policy returns an encrypted refusal,
     *      and the settlement then travels the ordinary branchless path: it
     *      debits zero, it succeeds, and it is indistinguishable on-chain from
     *      any other refusal.
     *
     *      Registering an agent stays here because cumulative spend is
     *      settlement state. Deciding whether it may spend is the policy's job.
     */

    // ============ Settlement ============

    /**
     * @notice Settle a payment against an agent's confidential budget.
     *
     * @dev This function is the product. Read the ordering carefully — every step
     *      is branchless, and the absence of an `if` is deliberate rather than an
     *      oversight.
     *
     *      The transaction succeeds whether or not the payment was authorized.
     *      The verdict leaves as an encrypted flag that only the owner and this
     *      agent can decrypt. A caller that cannot read the flag must refuse the
     *      resource — see docs/adr/002. That obligation cannot be enforced here;
     *      it is enforced in the gateway and tested there.
     */
    function settle(
        address agent,
        externalEuint256 encryptedAmount,
        bytes calldata proof
    ) external onlyRelayer returns (ebool authorized) {
        Agent storage a = _agents[agent];

        // Registration is public information — an unregistered address is not a
        // confidential fact — so this guard leaks nothing and may revert.
        if (!a.registered) revert AgentNotRegistered(agent);

        if (address(policy) == address(0)) revert NoPolicy();

        // The nullifier. A handle is public data — it names a ciphertext, it is
        // not one — so recording it in the clear leaks nothing, and without it a
        // captured (handle, proof) pair could be replayed by the relayer to
        // debit the same authorized amount again.
        bytes32 rawHandle = externalEuint256.unwrap(encryptedAmount);
        if (handleSpent[rawHandle]) revert HandleAlreadyUsed(rawHandle);
        handleSpent[rawHandle] = true;

        euint256 amount = Nox.fromExternal(encryptedAmount, proof);
        euint256 zero = Nox.toEuint256(0);
        euint256 one = Nox.toEuint256(1);

        // 1. Does this settlement satisfy the installed policy? The rule lives
        //    outside this contract and is evaluated entirely inside the TEE, so
        //    the vault learns the verdict only as ciphertext.
        // The policy is a separate contract, so it holds no ACL grant on this
        // handle by default and every Nox op it attempts would revert. Grant it
        // transiently: the policy needs the amount for this transaction and has
        // no business retaining access to it afterwards.
        Nox.allowThis(amount);
        Nox.allowTransient(amount, address(policy));

        ebool withinCap = policy.evaluate(agent, amount, "");

        // 2. Reduce an over-cap request to zero. A zero transfer is a no-op that
        //    still succeeds, so the over-cap path stays on the same code path as
        //    the authorized one.
        euint256 requested = Nox.select(withinCap, amount, zero);

        // 3. Move the funds with Nox's own atomic primitive. Insufficiency comes
        //    back as an encrypted flag; the balances are left untouched on
        //    failure. Hand-rolling this with sub/select would reimplement, less
        //    safely, what the protocol already guarantees.
        Epoch storage epoch = _epochs[currentEpoch];
        (ebool funded, euint256 newTreasury, euint256 newEpochTotal) =
            Nox.transfer(_treasury, epoch.total, requested);

        _treasury = newTreasury;
        epoch.total = newEpochTotal;

        // 4. authorized = withinCap AND funded.
        //
        //    The Nox library exposes no boolean operators on `ebool`, so the
        //    conjunction is built arithmetically: project `funded` onto {0,1},
        //    gate it through `withinCap`, and compare the result to one. Every
        //    operation is data-independent.
        euint256 fundedAsUint = Nox.select(funded, one, zero);
        euint256 gated = Nox.select(withinCap, fundedAsUint, zero);
        authorized = Nox.eq(gated, one);

        // 5. Record the spend that actually occurred — zero when refused.
        euint256 debited = Nox.select(authorized, amount, zero);
        a.spent = Nox.add(a.spent, debited);

        // Tell the policy what was actually debited — an encrypted zero when
        // refused. Stateful policies (velocity, quotas) accumulate here rather
        // than in evaluate, which also runs for refused settlements. Because the
        // refused case passes an encrypted zero rather than skipping the call,
        // the policy performs identical work either way and learns nothing.
        Nox.allowTransient(debited, address(policy));
        policy.onSettled(agent, debited);

        // 6. Permissions. The verdict is legible to the owner and to the agent it
        //    concerns, and to nobody else. Note the relayer is NOT granted access:
        //    it submits the transaction but is not entitled to the outcome.
        Nox.allowThis(_treasury);
        Nox.allow(_treasury, owner);
        Nox.allowThis(epoch.total);
        Nox.allow(epoch.total, owner);
        Nox.allowThis(a.spent);
        Nox.allow(a.spent, owner);
        _addViewerIfPrivate(a.spent, agent);
        Nox.allowThis(authorized);
        Nox.allow(authorized, owner);
        Nox.allow(authorized, agent);

        unchecked {
            epoch.settlementCount += 1;
        }

        // No agent. No amount. No verdict. Only that the epoch advanced.
        emit Settled(currentEpoch);
    }

    // ============ Epochs ============

    /**
     * @notice Close the current epoch and release its aggregate for decryption.
     *
     * @dev This is the single point where a number becomes public, and it is an
     *      aggregate covering every settlement in the batch. It cannot be
     *      decomposed back into the payments that produced it.
     *
     *      `settlementCount` is emitted because it is unavoidable — an observer
     *      can count `Settled` events regardless — and pretending otherwise would
     *      overstate the guarantee.
     */
    function flushEpoch() external onlyOwner returns (uint64 flushedEpoch) {
        Epoch storage epoch = _epochs[currentEpoch];
        if (epoch.settlementCount < flushThreshold) revert EpochNotFlushable();

        // Releasing the aggregate is the deliberate declassification step: from
        // here the value is readable by anyone, which is what makes it usable by
        // unmodified public infrastructure downstream.
        Nox.allowPublicDecryption(epoch.total);
        epoch.flushed = true;

        flushedEpoch = currentEpoch;
        emit EpochFlushed(flushedEpoch, epoch.settlementCount);

        _openEpoch(currentEpoch + 1);
    }

    /**
     * @notice Prove a flushed epoch's plaintext aggregate on-chain.
     *
     * @dev Takes the decryption proof produced off-chain and verifies it through
     *      the TEE's own validation. The result is a plaintext `uint256` that
     *      downstream protocols consume as an ordinary amount — this is the hinge
     *      on which composability turns. A DEX router, a payment rail or a
     *      treasury contract can act on it without knowing Nox exists.
     */
    function proveEpochAggregate(
        uint64 epochId,
        bytes calldata decryptionProof
    ) external onlyOwner returns (uint256 aggregate) {
        Epoch storage epoch = _epochs[epochId];
        if (!epoch.flushed) revert EpochNotFlushed(epochId);
        if (epoch.settled) revert EpochAlreadySettled(epochId);

        aggregate = Nox.publicDecrypt(epoch.total, decryptionProof);

        epoch.aggregate = aggregate;
        epoch.settled = true;

        emit EpochSettled(epochId, aggregate);
    }

    /**
     * @dev Grant `viewer` read access, unless the handle is public.
     *
     * `Nox.toEuint256(x)` produces a *trivially encrypted* handle: the value is
     * derivable from the plaintext, so Nox classifies it as public. `allow` and
     * `allowThis` silently skip such handles, but `addViewer` reverts on them
     * with `PublicHandleACLForbidden`.
     *
     * A freshly-registered agent's `spent` is exactly that — a trivially
     * encrypted zero — so registering an agent would revert without this guard.
     * Skipping is correct rather than merely convenient: a public handle is
     * already readable by everyone, so there is no viewer left to add.
     *
     * Found by running against live Nox on Sepolia, not by reading the docs.
     */
    function _addViewerIfPrivate(euint256 handle, address viewer) private {
        if (!Nox.isPubliclyDecryptable(handle)) {
            Nox.addViewer(handle, viewer);
        }
    }

    function _openEpoch(uint64 epochId) private {
        currentEpoch = epochId;

        Epoch storage epoch = _epochs[epochId];
        epoch.total = Nox.toEuint256(0);
        Nox.allowThis(epoch.total);
        Nox.allow(epoch.total, owner);
    }

    // ============ Administration ============

    /**
     * @notice Rotate the relayer.
     * @dev The relayer learns what it relays, so rotating it is a real security
     *      operation rather than routine configuration.
     */
    function setRelayer(address relayer_) external onlyOwner {
        relayer = relayer_;
    }

    /**
     * @notice Install the policy every settlement must satisfy.
     *
     * @dev Swappable so a ring can change its compliance framework without
     *      redeploying or migrating encrypted balances. The policy governs
     *      authorization only — it can never move funds, and a policy that
     *      approves everything still cannot spend past the treasury, because
     *      solvency is enforced separately by `Nox.transfer`.
     *
     *      The policy MUST be branchless. A policy that reverts on refusal
     *      leaks the refusal and breaks the guarantee for the whole vault.
     *      See IConfidentialPolicy.
     */
    function setPolicy(IConfidentialPolicy policy_) external onlyOwner {
        policy = policy_;
        emit PolicySet(address(policy_));
    }

    // ============ Views ============
    //
    // These return handles, not values. Reading one tells a caller nothing unless
    // the ACL already permits them to decrypt it — which is the entire point.

    function treasuryHandle() external view returns (euint256) {
        return _treasury;
    }

    function totalSupplyHandle() external view returns (euint256) {
        return _totalSupply;
    }

    function agentSpentHandle(address agent) external view returns (euint256) {
        return _agents[agent].spent;
    }

    function isRegistered(address agent) external view returns (bool) {
        return _agents[agent].registered;
    }

    function epochTotalHandle(uint64 epochId) external view returns (euint256) {
        return _epochs[epochId].total;
    }

    function epochInfo(
        uint64 epochId
    ) external view returns (uint32 settlementCount, bool flushed, bool settled, uint256 aggregate) {
        Epoch storage epoch = _epochs[epochId];
        return (epoch.settlementCount, epoch.flushed, epoch.settled, epoch.aggregate);
    }

    /**
     * @notice Whether `account` may decrypt this epoch's aggregate.
     * @dev Surfaced so a caller can tell "not permitted" from "not yet flushed"
     *      without guessing from a failed decryption.
     */
    function canReadEpochTotal(uint64 epochId, address account) external view returns (bool) {
        return Nox.isAllowed(_epochs[epochId].total, account);
    }
}
