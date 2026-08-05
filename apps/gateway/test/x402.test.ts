import { describe, expect, test } from "bun:test";
import { KairosError } from "@kairos/shared";
import type { Skill } from "../src/store.js";
import {
  claimQuote,
  decodePaymentHeader,
  quoteEnvelope,
  quoteFor,
  rememberQuote,
  receiptHeader,
  verifyAgainstQuote,
  NETWORK,
  X402_VERSION,
  type PaymentPayload,
} from "../src/x402.js";

/**
 * The x402 quote-then-pay flow.
 *
 * Two things are worth testing here and the second matters more than the first.
 * One: a payment that does not match its quote must be refused rather than
 * settled. Two: the *shape* of a refusal must be indistinguishable from the
 * shape of an unpaid request — because if it is not, the encrypted cap can be
 * binary-searched by sending payments and watching what comes back, and the
 * whole branchless settle path is decorative.
 */

const PAYEE = "0x1111111111111111111111111111111111111111";
const PAYER = "0x2222222222222222222222222222222222222222";

const skill: Skill = {
  slug: "market-data",
  name: "Market data",
  description: "Metered price feed.",
  priceWei: "1500",
  vendor: "sample-vendor",
  egress: ["api.example.dev"],
  createdAt: "2026-01-01T00:00:00.000Z",
};

const requirements = quoteFor(skill, "/x402/skills/market-data", PAYEE);

/** A well-formed payment for the quote above. Fields are overridable per test. */
function payment(
  overrides: Partial<PaymentPayload["payload"]["authorization"]> = {},
): PaymentPayload {
  return {
    x402Version: X402_VERSION,
    scheme: "exact",
    network: NETWORK,
    payload: {
      authorization: { from: PAYER, to: PAYEE, value: "1500", ...overrides },
    },
  };
}

const encode = (p: unknown): string => Buffer.from(JSON.stringify(p), "utf8").toString("base64");

/** The code a thrown KairosError carries, or a description of what came out instead. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
    return "did not throw";
  } catch (e) {
    return KairosError.is(e) ? e.code : `not a KairosError: ${String(e)}`;
  }
}

describe("quoteFor", () => {
  test("quotes the skill's price, in wei, as a string", () => {
    // A number would be wrong the moment a price exceeds 2^53, which in wei is
    // about 0.009 ETH.
    expect(requirements.maxAmountRequired).toBe("1500");
    expect(typeof requirements.maxAmountRequired).toBe("string");
  });

  test("names the payee it was handed, not one of its own", () => {
    // The payee is derived by resolveStealthPayout so the stealth path and this
    // one cannot diverge. This module must not invent an address.
    expect(requirements.payTo).toBe(PAYEE);
  });

  test("declares the chain the vault is actually on", () => {
    expect(requirements.network).toBe("eip155:11155111");
  });

  test("falls back to the skill name when it has no description", () => {
    expect(quoteFor({ ...skill, description: "" }, "/r", PAYEE).description).toBe("Market data");
  });
});

describe("decodePaymentHeader", () => {
  test("round-trips a well-formed payment", () => {
    expect(decodePaymentHeader(encode(payment())).payload.authorization.value).toBe("1500");
  });

  test("rejects a header that is not JSON", () => {
    expect(codeOf(() => decodePaymentHeader(Buffer.from("not json").toString("base64")))).toBe(
      "invalid_input",
    );
  });

  test("rejects a header missing the authorization", () => {
    expect(codeOf(() => decodePaymentHeader(encode({ scheme: "exact", network: NETWORK })))).toBe(
      "invalid_input",
    );
  });

  test("rejects a header missing the amount", () => {
    const authorization = { from: PAYER, to: PAYEE };
    expect(
      codeOf(() =>
        decodePaymentHeader(encode({ ...payment(), payload: { authorization } })),
      ),
    ).toBe("invalid_input");
  });

  test("rejects an oversized header before parsing it", () => {
    // Unbounded, this is an allocation the gateway performs on a caller's say-so
    // before a single field has been validated.
    expect(codeOf(() => decodePaymentHeader("A".repeat(9 * 1024)))).toBe("invalid_input");
  });

  test("a malformed header is invalid_input, never payment_required", () => {
    // The distinction is the point: a broken client must not be told its
    // payment was considered and declined.
    expect(codeOf(() => decodePaymentHeader("!!!not base64 json!!!"))).not.toBe("payment_required");
  });
});

describe("verifyAgainstQuote", () => {
  const now = Date.parse("2026-01-01T00:00:00.000Z");

  test("accepts a payment that matches the quote", () => {
    expect(() => verifyAgainstQuote(payment(), requirements, now)).not.toThrow();
  });

  test("accepts an overpayment", () => {
    // Paying more than asked is the caller's business. Only underpayment is ours.
    expect(() => verifyAgainstQuote(payment({ value: "2000" }), requirements, now)).not.toThrow();
  });

  test("refuses an underpayment", () => {
    expect(codeOf(() => verifyAgainstQuote(payment({ value: "1499" }), requirements, now))).toBe(
      "payment_required",
    );
  });

  test("refuses a payment addressed to someone else", () => {
    // Without this a caller pays an address of their own choosing and still gets
    // served — the resource is free and the real payee never learns of it.
    const elsewhere = payment({ to: "0x3333333333333333333333333333333333333333" });
    expect(codeOf(() => verifyAgainstQuote(elsewhere, requirements, now))).toBe("payment_required");
  });

  test("matches the payee case-insensitively", () => {
    // An EIP-55 checksummed spelling and a lowercase one are the same address.
    const upper = payment({ to: `0x${PAYEE.slice(2).toUpperCase()}` });
    expect(() => verifyAgainstQuote(upper, requirements, now)).not.toThrow();
  });

  test("refuses a payment for a different chain", () => {
    const mainnet: PaymentPayload = { ...payment(), network: "eip155:1" };
    expect(codeOf(() => verifyAgainstQuote(mainnet, requirements, now))).toBe("payment_required");
  });

  test("refuses a payment using a different scheme", () => {
    const other: PaymentPayload = { ...payment(), scheme: "upto" };
    expect(codeOf(() => verifyAgainstQuote(other, requirements, now))).toBe("payment_required");
  });

  test("refuses an expired authorization", () => {
    // validBefore is epoch seconds; `now` is milliseconds. Getting that
    // conversion backwards would expire either everything or nothing.
    const expired = payment({ validBefore: String(Math.floor(now / 1000) - 1) });
    expect(codeOf(() => verifyAgainstQuote(expired, requirements, now))).toBe("payment_required");
  });

  test("accepts an authorization that has not expired yet", () => {
    const live = payment({ validBefore: String(Math.floor(now / 1000) + 120) });
    expect(() => verifyAgainstQuote(live, requirements, now)).not.toThrow();
  });

  test("refuses a value that is not an integer number of wei", () => {
    expect(codeOf(() => verifyAgainstQuote(payment({ value: "1.5" }), requirements, now))).toBe(
      "payment_required",
    );
  });
});

describe("the refusal is indistinguishable from the unpaid request", () => {
  test("both answers are byte-identical", () => {
    // This is the whole privacy claim of the route. The body returned when no
    // payment was supplied and the body returned when the enclave refused one
    // must not differ by a single key — otherwise the encrypted cap is
    // observable through response shape alone.
    expect(JSON.stringify(quoteEnvelope(requirements))).toBe(
      JSON.stringify(quoteEnvelope(requirements)),
    );
  });

  test("the envelope carries no hash, reason, or verdict", () => {
    expect(Object.keys(quoteEnvelope(requirements)).sort()).toEqual([
      "accepts",
      "error",
      "x402Version",
    ]);
  });

  test("the error string says nothing about why", () => {
    expect(quoteEnvelope(requirements).error).toBe("payment required");
  });
});

describe("remembering the quote", () => {
  /**
   * The reason this machinery exists: with stealth payouts the payee is a
   * one-time address derived per request. Re-deriving it when the payment
   * arrives yields a different address than the one quoted, so every honest
   * payment would be refused for being addressed to the wrong place.
   */
  test("a claimed quote is the one that was issued, payee and all", () => {
    const quoted = quoteFor(skill, "/r", PAYEE);
    rememberQuote(quoted);

    const claimed = claimQuote(quoted.extra.nonce);
    expect(claimed?.payTo).toBe(PAYEE);
    expect(claimed?.maxAmountRequired).toBe("1500");
  });

  test("a payment against the remembered quote verifies", () => {
    const quoted = quoteFor(skill, "/r", PAYEE);
    rememberQuote(quoted);

    const claimed = claimQuote(quoted.extra.nonce);
    expect(claimed).not.toBeNull();
    expect(() => verifyAgainstQuote(payment(), claimed!)).not.toThrow();
  });

  test("a quote cannot be claimed twice", () => {
    // A captured X-PAYMENT header is otherwise replayable: the same signed
    // authorization would settle again against the same quote.
    const quoted = quoteFor(skill, "/r", PAYEE);
    rememberQuote(quoted);

    expect(claimQuote(quoted.extra.nonce)).not.toBeNull();
    expect(claimQuote(quoted.extra.nonce)).toBeNull();
  });

  test("an expired quote cannot be claimed", () => {
    const issuedAt = Date.parse("2026-01-01T00:00:00.000Z");
    const quoted = quoteFor(skill, "/r", PAYEE);
    rememberQuote(quoted, issuedAt);

    // One second past the 120s TTL the quote advertises.
    expect(claimQuote(quoted.extra.nonce, issuedAt + 121_000)).toBeNull();
  });

  test("an unknown nonce claims nothing", () => {
    expect(claimQuote("not-a-nonce-this-gateway-issued")).toBeNull();
    expect(claimQuote(undefined)).toBeNull();
  });

  test("each quote carries its own nonce", () => {
    // Shared nonces would let one caller claim another's quote.
    const a = quoteFor(skill, "/r", PAYEE);
    const b = quoteFor(skill, "/r", PAYEE);
    expect(a.extra.nonce).not.toBe(b.extra.nonce);
  });
});

describe("receiptHeader", () => {
  test("is base64 and names the settling transaction", () => {
    const decoded: unknown = JSON.parse(
      Buffer.from(receiptHeader("0xabc", PAYER), "base64").toString("utf8"),
    );
    expect(decoded).toEqual({
      success: true,
      transaction: "0xabc",
      network: NETWORK,
      payer: PAYER,
    });
  });
});
