import { describe, expect, it } from "bun:test";
import {
  NETWORK,
  X402_VERSION,
  checkPayment,
  decodePaymentHeader,
  encodePaymentHeader,
  encodeScope,
  parseScope,
  scopeAllows,
  scopeAllowsWithSpend,
  type PaymentPayload,
  type PaymentRequirements,
} from "../src/index.js";

const REQ: PaymentRequirements = {
  scheme: "exact",
  network: NETWORK,
  maxAmountRequired: "1500",
  resource: "sample-market-data",
  description: "Sample",
  mimeType: "application/json",
  payTo: "0x1111111111111111111111111111111111111111",
  maxTimeoutSeconds: 120,
  extra: { nonce: "abc" },
};

function payload(over: Partial<PaymentPayload> = {}): PaymentPayload {
  return {
    x402Version: X402_VERSION,
    scheme: "exact",
    network: NETWORK,
    payload: {
      authorization: {
        from: "0x2222222222222222222222222222222222222222",
        to: REQ.payTo,
        value: "1500",
        validBefore: String(Math.floor(Date.now() / 1000) + 60),
        nonce: "abc",
      },
    },
    ...over,
  };
}

describe("x402 envelope", () => {
  it("round-trips through the header", () => {
    const p = payload();
    expect(decodePaymentHeader(encodePaymentHeader(p))).toEqual(p);
  });

  it("rejects an oversized header as invalid input", () => {
    expect(() => decodePaymentHeader("a".repeat(9000))).toThrow(/too large/);
  });

  it("rejects garbage base64", () => {
    expect(() => decodePaymentHeader("!!!not-base64!!!")).toThrow();
  });
});

describe("checkPayment", () => {
  it("accepts a payment matching the quote", () => {
    expect(checkPayment(payload(), REQ).outcome).toBe("ok");
  });

  it("accepts an overpayment but refuses an underpayment", () => {
    expect(checkPayment(payload({ payload: { authorization: { ...payload().payload.authorization, value: "9000" } } }), REQ).outcome).toBe("ok");
    expect(checkPayment(payload({ payload: { authorization: { ...payload().payload.authorization, value: "100" } } }), REQ).outcome).toBe("amount_exceeded");
  });

  it("refuses a wrong network", () => {
    expect(checkPayment(payload({ network: "eip155:1" }), REQ).outcome).toBe("wrong_network");
  });

  it("refuses an expired payment", () => {
    const expired = payload({ payload: { authorization: { ...payload().payload.authorization, validBefore: "1" } } });
    expect(checkPayment(expired, REQ).outcome).toBe("expired");
  });

  it("refuses a payment to the wrong payee", () => {
    const wrong = payload({ payload: { authorization: { ...payload().payload.authorization, to: "0x3333333333333333333333333333333333333333" } } });
    expect(checkPayment(wrong, REQ).outcome).toBe("malformed");
  });
});

describe("session scopes", () => {
  const scope = { agent: "0x2222222222222222222222222222222222222222", capWei: "10000", budgetWei: "50000", expiresAt: Math.floor(Date.now() / 1000) + 3600 };

  it("round-trips through encode/parse", () => {
    expect(parseScope(encodeScope(scope))).toEqual(scope);
  });

  it("returns null for garbage", () => {
    expect(parseScope("not json")).toBeNull();
    expect(parseScope('{"agent":"0x","capWei":"x"}')).toBeNull();
  });

  it("enforces cap and expiry", () => {
    expect(scopeAllows(scope, "5000")).toBe(true);
    expect(scopeAllows(scope, "50000")).toBe(false); // over cap
    expect(scopeAllows({ ...scope, expiresAt: 1 }, "5000")).toBe(false); // expired
  });

  it("enforces the cumulative budget", () => {
    const under = scopeAllowsWithSpend(scope, "10000", "40000");
    expect(under.ok).toBe(true);
    if (under.ok) expect(under.value).toBe(true);

    const over = scopeAllowsWithSpend(scope, "10000", "46000");
    expect(over.ok).toBe(true);
    if (over.ok) expect(over.value).toBe(false);

    const { budgetWei: _drop, ...noBudget } = scope;
    void _drop;
    const noLimit = scopeAllowsWithSpend(noBudget, "10000", "999999999");
    expect(noLimit.ok).toBe(true);
    if (noLimit.ok) expect(noLimit.value).toBe(true);
  });
});
