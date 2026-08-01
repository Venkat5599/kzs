import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils";

/**
 * Stealth addresses, in the shape of ERC-5564.
 *
 * @remarks Why this exists on top of the relayer
 *
 * Kairos already routes every settlement through one relayer, so on-chain no
 * two agents are distinguishable by sender. That protects the *payer* side.
 *
 * It does nothing for the *payee*. If a batch pays out to a fixed address, that
 * address accumulates a public history: how often it is paid, how much, and by
 * correlation, by whom. A stealth address fixes the other half — every payout
 * lands on a fresh, unlinkable address that only the recipient can spend.
 *
 * @remarks How it works, in four lines
 *
 * The recipient publishes a *meta-address*: two public keys, spend and view.
 * A sender generates a throwaway keypair, does ECDH against the view key, and
 * hashes the shared secret. That hash tweaks the spend key into a one-time
 * address. The sender announces only their throwaway public key.
 *
 * The recipient scans announcements, redoes the same ECDH with their view key,
 * and recognises which addresses are theirs. Only they hold the spend key, so
 * only they can move the funds. An observer sees an address that has never
 * appeared before and cannot link it to the recipient at all.
 *
 * @remarks What this does not do
 *
 * The *view* key can detect payments but not spend them, which is what lets an
 * auditor be granted visibility without custody. And a stealth address hides
 * the link, not the amount — the amount is hidden separately, by Nox.
 */

export interface StealthMetaAddress {
  /** Public key whose private half can spend. Compressed, 33 bytes hex. */
  spendingPublicKey: `0x${string}`;
  /** Public key whose private half can detect payments but not spend them. */
  viewingPublicKey: `0x${string}`;
}

export interface StealthKeys extends StealthMetaAddress {
  spendingPrivateKey: `0x${string}`;
  viewingPrivateKey: `0x${string}`;
  /** `st:eth:0x<spend><view>` — the single string a recipient publishes. */
  metaAddress: string;
}

export interface StealthPayment {
  /** The one-time address to pay. Has never appeared on-chain before. */
  stealthAddress: `0x${string}`;
  /** Throwaway public key the sender announces so the recipient can find it. */
  ephemeralPublicKey: `0x${string}`;
  /**
   * First byte of the shared-secret hash. Lets a recipient reject ~255/256 of
   * announcements without a full derivation — scanning is otherwise linear in
   * total network volume.
   */
  viewTag: number;
}

const hex = (b: Uint8Array): `0x${string}` => `0x${bytesToHex(b)}`;
const bytes = (h: string): Uint8Array => hexToBytes(h.replace(/^0x/, ""));

/** Last 20 bytes of keccak(uncompressed pubkey minus its 0x04 prefix). */
function publicKeyToAddress(publicKey: Uint8Array): `0x${string}` {
  const uncompressed = secp256k1.ProjectivePoint.fromHex(publicKey).toRawBytes(false);
  return hex(keccak_256(uncompressed.slice(1)).slice(-20));
}

/** Generate a fresh stealth key set. The private halves never leave the owner. */
export function generateStealthKeys(): StealthKeys {
  const spendingPrivateKey = secp256k1.utils.randomPrivateKey();
  const viewingPrivateKey = secp256k1.utils.randomPrivateKey();
  const spendingPublicKey = secp256k1.getPublicKey(spendingPrivateKey, true);
  const viewingPublicKey = secp256k1.getPublicKey(viewingPrivateKey, true);

  return {
    spendingPrivateKey: hex(spendingPrivateKey),
    viewingPrivateKey: hex(viewingPrivateKey),
    spendingPublicKey: hex(spendingPublicKey),
    viewingPublicKey: hex(viewingPublicKey),
    metaAddress: `st:eth:0x${bytesToHex(spendingPublicKey)}${bytesToHex(viewingPublicKey)}`,
  };
}

/** Parse the `st:eth:0x…` form back into its two public keys. */
export function parseMetaAddress(metaAddress: string): StealthMetaAddress {
  const raw = metaAddress.replace(/^st:eth:/, "").replace(/^0x/, "");
  if (raw.length !== 132) {
    throw new Error("Meta-address must contain two 33-byte compressed keys.");
  }
  return {
    spendingPublicKey: `0x${raw.slice(0, 66)}`,
    viewingPublicKey: `0x${raw.slice(66)}`,
  };
}

/**
 * Derive a one-time address to pay.
 *
 * Called by the sender. Produces an address the recipient controls but which is
 * not linkable to them by anyone else — including the sender, after the fact.
 */
export function deriveStealthAddress(meta: StealthMetaAddress): StealthPayment {
  const ephemeralPrivateKey = secp256k1.utils.randomPrivateKey();
  const ephemeralPublicKey = secp256k1.getPublicKey(ephemeralPrivateKey, true);

  // ECDH against the viewing key: the recipient can redo this half with their
  // viewing private key, and nobody else can do it at all.
  const shared = secp256k1.getSharedSecret(ephemeralPrivateKey, bytes(meta.viewingPublicKey), true);
  const secretHash = keccak_256(shared.slice(1));

  // Tweak the spending key by the shared secret. The recipient's spending
  // private key plus the same tweak is the private key for the result — so only
  // they can spend it, and the tweak is unguessable without the viewing key.
  const tweak = secp256k1.ProjectivePoint.BASE.multiply(
    BigInt(`0x${bytesToHex(secretHash)}`) % secp256k1.CURVE.n,
  );
  const stealthPoint = secp256k1.ProjectivePoint.fromHex(
    bytes(meta.spendingPublicKey),
  ).add(tweak);

  return {
    stealthAddress: publicKeyToAddress(stealthPoint.toRawBytes(true)),
    ephemeralPublicKey: hex(ephemeralPublicKey),
    viewTag: secretHash[0] ?? 0,
  };
}

/**
 * Check whether an announced payment belongs to this recipient.
 *
 * Runs the view-tag rejection first, so scanning a busy network costs one hash
 * per announcement rather than a full curve operation.
 */
export function checkStealthPayment(
  keys: Pick<StealthKeys, "viewingPrivateKey" | "spendingPublicKey">,
  announcement: Pick<StealthPayment, "ephemeralPublicKey" | "viewTag" | "stealthAddress">,
): boolean {
  const shared = secp256k1.getSharedSecret(
    bytes(keys.viewingPrivateKey),
    bytes(announcement.ephemeralPublicKey),
    true,
  );
  const secretHash = keccak_256(shared.slice(1));

  if ((secretHash[0] ?? 0) !== announcement.viewTag) return false;

  const tweak = secp256k1.ProjectivePoint.BASE.multiply(
    BigInt(`0x${bytesToHex(secretHash)}`) % secp256k1.CURVE.n,
  );
  const stealthPoint = secp256k1.ProjectivePoint.fromHex(
    bytes(keys.spendingPublicKey),
  ).add(tweak);

  return (
    publicKeyToAddress(stealthPoint.toRawBytes(true)).toLowerCase() ===
    announcement.stealthAddress.toLowerCase()
  );
}

/**
 * The private key for a stealth address this recipient owns.
 *
 * Needed to move the funds. Derived, never stored — which is the point: there
 * is nothing to leak between receiving and spending.
 */
export function computeStealthPrivateKey(
  keys: Pick<StealthKeys, "viewingPrivateKey" | "spendingPrivateKey">,
  ephemeralPublicKey: `0x${string}`,
): `0x${string}` {
  const shared = secp256k1.getSharedSecret(
    bytes(keys.viewingPrivateKey),
    bytes(ephemeralPublicKey),
    true,
  );
  const secretHash = keccak_256(shared.slice(1));

  const spend = BigInt(`0x${bytesToHex(bytes(keys.spendingPrivateKey))}`);
  const tweak = BigInt(`0x${bytesToHex(secretHash)}`) % secp256k1.CURVE.n;

  return `0x${((spend + tweak) % secp256k1.CURVE.n).toString(16).padStart(64, "0")}`;
}

/** Random 32 bytes, exposed so callers need not import the hash utils. */
export const randomSalt = (): `0x${string}` => hex(randomBytes(32));
