import { describe, expect, it } from "bun:test";
import { encodePaymentHeader, type PaymentPayload } from "@kairos/authz";
import { createQuoteService } from "../src/index.js";

function payment(over: Partial<PaymentPayload> = {}): PaymentPayload {
  return {
    x402Version: 1,
    scheme: "exact",
    network: "eip155:11155111",
    payload: {
      authorization: {
        from: "0x2222222222222222222222222222222222222222",
        to: "0x1111111111111111111111111111111111111111",
        value: "1500",
        validBefore: String(Math.floor(Date.now() / 1000) + 60),
        nonce: "abc",
      },
    },
    ...over,
  };
}

describe("quote service", () => {
  it("issues and claims a quote exactly once", () => {
    const svc = createQuoteService();
    const q = svc.issue("sample", "1500", "Sample", "0x1111111111111111111111111111111111111111");
    expect(svc.claim(q.extra.nonce)).toEqual(q);
    expect(svc.claim(q.extra.nonce)).toBeNull(); // replayed
  });

  it("forgets quotes after the TTL", () => {
    const svc = createQuoteService({ ttlSeconds: 1 });
    const q = svc.issue("sample", "1500", "Sample", "0x1111111111111111111111111111111111111111");
    expect(svc.claim(q.extra.nonce, Date.now() + 2000)).toBeNull();
  });

  it("accepts a payment that matches the quote", () => {
    const svc = createQuoteService();
    const q = svc.issue("sample", "1500", "Sample", "0x1111111111111111111111111111111111111111");
    const header = encodePaymentHeader(payment());
    expect(svc.verify(header, q).outcome).toBe("ok");
  });

  it("refuses an expired payment with the same shape as an unpaid request", () => {
    const svc = createQuoteService();
    const q = svc.issue("sample", "1500", "Sample", "0x1111111111111111111111111111111111111111");
    const expired = encodePaymentHeader(payment({ payload: { authorization: { ...payment().payload.authorization, validBefore: "1" } } }));
    expect(svc.verify(expired, q).outcome).toBe("expired");
  });

  it("answers every refusal with the identical envelope", () => {
    const svc = createQuoteService();
    const q = svc.issue("sample", "1500", "Sample", "0x1111111111111111111111111111111111111111");
    const env = svc.envelope(q);
    expect(env.error).toBe("payment required");
    expect(env.accepts).toHaveLength(1);
  });
});
