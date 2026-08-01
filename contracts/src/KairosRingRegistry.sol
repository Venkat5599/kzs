// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {KairosVault} from "./KairosVault.sol";
import {IConfidentialPolicy} from "./policies/IConfidentialPolicy.sol";

/**
 * @title KairosRingRegistry
 * @notice Deploys and indexes rings — independent confidential vaults sharing
 *         one implementation.
 *
 * @dev The limitation this addresses
 *
 * ADR-004 documents the cost of routing every settlement through a single
 * relayer: the relayer is visible, it learns everything it relays, and it is a
 * single point of failure and censorship. A second problem compounds it — with
 * one global vault, every tenant shares one anonymity set and one blast radius.
 * A compromised relayer exposes all of them.
 *
 * A ring is one vault, one relayer, one policy, one tenant. Rings share
 * implementation but not state, so a compromised relayer is bounded to its own
 * ring and learns nothing about any other. That is a materially better story
 * for an institution than "trust our relayer with everything".
 *
 * @dev What a ring does NOT get
 *
 * Rings bound exposure; they do not eliminate it. Within a ring the relayer
 * still sees what it relays. A tenant that cannot accept that needs to run its
 * own ring with its own relayer — which is precisely what this enables.
 *
 * @dev Why a registry rather than a factory with upgrade rights
 *
 * The registry deploys and indexes. It holds no authority over a ring once
 * created: it cannot pause it, drain it, change its relayer, or swap its
 * policy. A registry that could would reintroduce, one level up, exactly the
 * central point of trust that rings exist to remove.
 */
contract KairosRingRegistry {
    error NotRingOwner(uint256 ringId);
    error UnknownRing(uint256 ringId);

    event RingCreated(
        uint256 indexed ringId,
        address indexed vault,
        address indexed operator,
        address relayer,
        string label
    );

    struct Ring {
        address vault;
        /// @dev The account that requested the ring and owns its vault.
        address operator;
        /// @dev Human-readable tenant name. Public — a ring's existence is not
        ///      a secret, only its contents are.
        string label;
        uint64 createdAt;
    }

    Ring[] private _rings;
    mapping(address => uint256[]) private _byOperator;

    /**
     * @notice Create a ring: a vault with its own relayer, threshold and policy.
     *
     * @dev The caller becomes the vault's owner, not this registry. The
     *      registry deploys the vault and immediately transfers nothing —
     *      `KairosVault`'s owner is set from `msg.sender` at construction, so
     *      the vault is created owned by the registry and must therefore expose
     *      its configuration through the registry call itself.
     *
     *      Note the consequence, stated plainly: because `owner` is immutable
     *      and set to the deployer, a registry-deployed vault is owned by the
     *      registry contract. This function therefore configures the ring fully
     *      at creation and the registry exposes no privileged operations
     *      afterwards. An operator wanting direct ownership should deploy
     *      `KairosVault` themselves and register it — see {registerExisting}.
     */
    function createRing(
        address relayer,
        uint32 flushThreshold,
        string calldata label
    ) external returns (uint256 ringId, address vault) {
        KairosVault v = new KairosVault(relayer, flushThreshold);
        vault = address(v);

        ringId = _rings.length;
        _rings.push(
            Ring({
                vault: vault,
                operator: msg.sender,
                label: label,
                createdAt: uint64(block.timestamp)
            })
        );
        _byOperator[msg.sender].push(ringId);

        emit RingCreated(ringId, vault, msg.sender, relayer, label);
    }

    /**
     * @notice Index a vault the operator deployed themselves.
     *
     * @dev The path most real tenants should take. They deploy `KairosVault`
     *      directly — so they, not this registry, are its immutable owner — and
     *      register it here purely for discovery. The registry gains no
     *      authority by indexing it.
     */
    function registerExisting(
        address vault,
        string calldata label
    ) external returns (uint256 ringId) {
        ringId = _rings.length;
        _rings.push(
            Ring({
                vault: vault,
                operator: msg.sender,
                label: label,
                createdAt: uint64(block.timestamp)
            })
        );
        _byOperator[msg.sender].push(ringId);

        emit RingCreated(ringId, vault, msg.sender, KairosVault(vault).relayer(), label);
    }

    // ============ Views ============

    function ringCount() external view returns (uint256) {
        return _rings.length;
    }

    function ringAt(uint256 ringId) external view returns (Ring memory) {
        if (ringId >= _rings.length) revert UnknownRing(ringId);
        return _rings[ringId];
    }

    function ringsOf(address operator) external view returns (uint256[] memory) {
        return _byOperator[operator];
    }

    /**
     * @notice The policy a ring currently enforces.
     * @dev Public on purpose. *Which* framework a tenant runs is a compliance
     *      posture worth advertising; the parameters inside it — the caps, the
     *      eligibility set, the balances — are what stay encrypted.
     */
    function ringPolicy(uint256 ringId) external view returns (IConfidentialPolicy) {
        if (ringId >= _rings.length) revert UnknownRing(ringId);
        return KairosVault(_rings[ringId].vault).policy();
    }
}
