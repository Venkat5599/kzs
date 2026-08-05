// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/**
 * @title StealthAnnouncer
 * @notice The public bulletin board that makes stealth payments findable.
 *
 * @dev The problem it solves
 *
 * A stealth address is derived off-chain from the recipient's meta-address and
 * a throwaway key the sender generates. The recipient can re-derive it — but
 * only if they learn the sender's throwaway public key. Handing that over
 * privately would need a channel that does not exist.
 *
 * So it is published here, in the open. That is safe: the ephemeral public key
 * reveals nothing without the recipient's *viewing* private key, and reveals
 * nothing about which recipient it was meant for. Anyone can read every
 * announcement; only the intended recipient can tell which are theirs.
 *
 * @dev Why scanning is cheap
 *
 * A recipient must check every announcement, which is linear in total network
 * volume. `viewTag` — the first byte of the shared-secret hash — lets them
 * reject roughly 255 of every 256 with one hash instead of an elliptic-curve
 * operation. It leaks nothing beyond one byte of a hash nobody else can
 * reproduce.
 *
 * @dev What this contract deliberately does not do
 *
 * It holds no funds, has no owner, and cannot be paused. It is an append-only
 * log. Anything more would be a party that could censor or unmask, and the
 * point of the design is that no such party exists.
 *
 * Shaped after ERC-5564. Kept minimal rather than importing the full standard,
 * because the surface actually used here is one event.
 */
contract StealthAnnouncer {
    /**
     * @notice A stealth payment was made. The recipient is not named — that is
     *         the entire point — and cannot be inferred by anyone else.
     *
     * @param schemeId          1 = secp256k1 with view tags (the ERC-5564 default).
     * @param stealthAddress    The one-time address that was paid.
     * @param caller            Who announced. Under Kairos this is the shared
     *                          relayer, so it identifies nobody.
     * @param ephemeralPubKey   The sender's throwaway public key, compressed.
     * @param metadata          First byte is the view tag; the rest is free.
     */
    event Announcement(
        uint256 indexed schemeId,
        address indexed stealthAddress,
        address indexed caller,
        bytes ephemeralPubKey,
        bytes metadata
    );

    /// @notice A recipient published or rotated their meta-address.
    event StealthMetaAddressSet(
        address indexed registrant,
        uint256 indexed schemeId,
        bytes metaAddress
    );

    error InvalidEphemeralKey();
    error InvalidMetaAddress();

    /// @dev registrant => schemeId => meta-address (two compressed pubkeys).
    mapping(address => mapping(uint256 => bytes)) public stealthMetaAddressOf;

    /**
     * @notice Publish the meta-address others derive stealth addresses from.
     *
     * @dev Public on purpose. It says "payments to me can be constructed", not
     *      "this payment was to me" — every derived address is unlinkable both
     *      to it and to every other.
     */
    function registerKeys(uint256 schemeId, bytes calldata metaAddress) external {
        // Two 33-byte compressed secp256k1 keys: spending, then viewing.
        if (metaAddress.length != 66) revert InvalidMetaAddress();
        stealthMetaAddressOf[msg.sender][schemeId] = metaAddress;
        emit StealthMetaAddressSet(msg.sender, schemeId, metaAddress);
    }

    /**
     * @notice Announce a stealth payment so its recipient can find it.
     *
     * @dev Permissionless by necessity. A gate would need to know who is
     *      allowed to announce, and knowing that is knowing who is paying whom.
     */
    function announce(
        uint256 schemeId,
        address stealthAddress,
        bytes calldata ephemeralPubKey,
        bytes calldata metadata
    ) external {
        if (ephemeralPubKey.length != 33) revert InvalidEphemeralKey();
        emit Announcement(schemeId, stealthAddress, msg.sender, ephemeralPubKey, metadata);
    }

    /// @notice Whether an address has published a meta-address for a scheme.
    function hasKeys(address registrant, uint256 schemeId) external view returns (bool) {
        return stealthMetaAddressOf[registrant][schemeId].length == 66;
    }
}
