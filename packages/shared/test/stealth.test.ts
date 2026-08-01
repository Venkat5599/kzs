import { describe, expect, it } from "bun:test";
import {
  generateStealthKeys,
  parseMetaAddress,
  deriveStealthAddress,
  checkStealthPayment,
  computeStealthPrivateKey,
} from "../src/stealth.js";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

/**
 * Stealth addresses.
 *
 * The property under test is unlinkability: two payments to the same recipient
 * must land on addresses that share nothing an observer can use, while the
 * recipient can still find and spend both.
 */
describe("stealth addresses", () => {
  it("gives every payment a fresh address", () => {
    const keys = generateStealthKeys();
    const seen = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      seen.add(deriveStealthAddress(keys).stealthAddress);
    }
    // Reuse would defeat the entire mechanism.
    expect(seen.size).toBe(20);
  });

  it("lets the recipient recognise their own payment", () => {
    const keys = generateStealthKeys();
    const payment = deriveStealthAddress(keys);
    expect(checkStealthPayment(keys, payment)).toBe(true);
  });

  it("does not let a stranger recognise it", () => {
    const alice = generateStealthKeys();
    const bob = generateStealthKeys();
    const toAlice = deriveStealthAddress(alice);
    // Bob scanning the same announcement learns nothing.
    expect(checkStealthPayment(bob, toAlice)).toBe(false);
  });

  it("derives a private key that actually controls the address", () => {
    // The load-bearing test. An address the recipient cannot spend from is
    // worse than no privacy at all — it is lost funds.
    const keys = generateStealthKeys();
    const payment = deriveStealthAddress(keys);

    const priv = computeStealthPrivateKey(keys, payment.ephemeralPublicKey);
    const pub = secp256k1.getPublicKey(hexToBytes(priv.slice(2)), false);
    const addr = `0x${bytesToHex(keccak_256(pub.slice(1)).slice(-20))}`;

    expect(addr.toLowerCase()).toBe(payment.stealthAddress.toLowerCase());
  });

  it("round-trips a meta-address", () => {
    const keys = generateStealthKeys();
    const parsed = parseMetaAddress(keys.metaAddress);
    expect(parsed.spendingPublicKey).toBe(keys.spendingPublicKey);
    expect(parsed.viewingPublicKey).toBe(keys.viewingPublicKey);
  });

  it("rejects a malformed meta-address instead of deriving nonsense", () => {
    expect(() => parseMetaAddress("st:eth:0xdeadbeef")).toThrow();
  });

  it("uses the view tag to reject cheaply", () => {
    const alice = generateStealthKeys();
    const bob = generateStealthKeys();
    const toAlice = deriveStealthAddress(alice);
    // Wrong tag must short-circuit before any curve work.
    expect(checkStealthPayment(bob, { ...toAlice, viewTag: (toAlice.viewTag + 1) % 256 })).toBe(false);
  });
});
