/**
 * Cross-cutting types.
 *
 * The branded aliases are not decoration. An `EncryptedHandle` and a plaintext
 * `Hex` string are both 0x-prefixed hex at runtime, and confusing one for the
 * other is precisely the mistake that would log a value where a handle was
 * intended. Branding makes the compiler catch it.
 */

declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

/** A 0x-prefixed hex string of arbitrary length. */
export type Hex = `0x${string}`;

/** A 20-byte EVM address, 0x-prefixed. */
export type Address = Brand<Hex, "Address">;

/**
 * A Nox encrypted handle — a 32-byte reference to a value held by the TEE.
 *
 * A handle is not a value and carries no information about one. It is safe to
 * store and to return over the wire; it is only meaningful to an account the
 * ACL permits to decrypt it.
 */
export type EncryptedHandle = Brand<Hex, "EncryptedHandle">;

/** The address an agent settles under. */
export type AgentId = Address;

/** A batching epoch. Monotonic, public. */
export type EpochId = Brand<bigint, "EpochId">;

const HEX = /^0x[0-9a-fA-F]*$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function isHex(value: unknown): value is Hex {
  return typeof value === "string" && HEX.test(value);
}

export function isAddress(value: unknown): value is Address {
  return typeof value === "string" && ADDRESS.test(value);
}
