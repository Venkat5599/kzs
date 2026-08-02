import { describe, expect, test } from "bun:test";
import { KairosError, checkStealthPayment, generateStealthKeys } from "@kairos/shared";
import type { GatewayConfig } from "../src/config.js";
import { resolveStealthPayout } from "../src/stealth.js";

/**
 * The gateway's half of stealth payouts.
 *
 * `packages/shared/test/stealth.test.ts` proves the cryptography. This proves
 * the decisions layered on top: which meta-address a payment resolves to, and
 * that a malformed one fails before any money moves rather than after.
 */

const config = (payee?: string): GatewayConfig => ({
  port: 8080,
  corsOrigins: ["*"],
  chainRpcUrl: "http://localhost:0",
  vaultAddress: "0x0000000000000000000000000000000000000000",
  ...(payee ? { payeeStealthMetaAddress: payee } : {}),
});

describe("resolveStealthPayout", () => {
  test("returns null when neither the request nor the operator names a payee", () => {
    // A deployment with no meta-address configured keeps settling exactly as it
    // did before. That is a legitimate configuration, not a broken one.
    expect(resolveStealthPayout(config())).toBeNull();
  });

  test("falls back to the operator's configured payee", () => {
    const operator = generateStealthKeys();
    const payout = resolveStealthPayout(config(operator.metaAddress));

    expect(payout).not.toBeNull();
    expect(checkStealthPayment(operator, payout!)).toBe(true);
  });

  test("an explicit payTo wins over the configured payee", () => {
    const operator = generateStealthKeys();
    const recipient = generateStealthKeys();

    const payout = resolveStealthPayout(config(operator.metaAddress), recipient.metaAddress)!;

    expect(checkStealthPayment(recipient, payout)).toBe(true);
    expect(checkStealthPayment(operator, payout)).toBe(false);
  });

  test("a malformed payTo is rejected as invalid input", () => {
    // Load-bearing: this must throw before settling. A payment that succeeds and
    // then cannot be collected is worse than one that never happened.
    try {
      resolveStealthPayout(config(), "st:eth:0xdeadbeef");
      throw new Error("expected a KairosError");
    } catch (cause) {
      expect(cause).toBeInstanceOf(KairosError);
      expect((cause as KairosError).code).toBe("invalid_input");
    }
  });

  test("two payments to one meta-address are unlinkable", () => {
    const recipient = generateStealthKeys();
    const stranger = generateStealthKeys();
    const cfg = config(recipient.metaAddress);

    const first = resolveStealthPayout(cfg)!;
    const second = resolveStealthPayout(cfg)!;

    expect(first.stealthAddress).not.toBe(second.stealthAddress);
    expect(checkStealthPayment(recipient, first)).toBe(true);
    expect(checkStealthPayment(recipient, second)).toBe(true);
    // The whole point: someone scanning the same announcements learns nothing.
    expect(checkStealthPayment(stranger, first)).toBe(false);
    expect(checkStealthPayment(stranger, second)).toBe(false);
  });
});
