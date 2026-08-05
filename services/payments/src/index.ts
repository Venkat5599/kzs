import {
  checkPayment,
  decodePaymentHeader,
  type PaymentCheck,
  type PaymentPayload,
  type PaymentRequirements,
} from "@kairos/authz";

/**
 * @kairos/payments — the x402 payment service.
 *
 * Quotes are issued with a TTL, remembered by nonce so a stealth payee stays
 * stable across the two legs of the flow, and claimed exactly once so a
 * captured header cannot be replayed. One invariant governs everything: a
 * refusal and an unpaid request answer with the identical quote envelope —
 * the refusal must stay indistinguishable from an approval.
 */

export const QUOTE_TTL_SECONDS = 120;

export interface QuoteServiceOptions {
  ttlSeconds?: number;
}

export interface QuoteService {
  /** Build the terms for a resource and remember them. */
  issue(resource: string, priceWei: string, description: string, payTo: string, nonce?: string): PaymentRequirements;
  /** Look up and consume a quote by nonce. `null` for unknown/expired/claimed. */
  claim(nonce: string | undefined, now?: number): PaymentRequirements | null;
  /** Verify a payment header against the quoted terms. */
  verify(header: string, requirements: PaymentRequirements, now?: number): PaymentCheck;
  /** The generic 402 answer, identical for every refusal. */
  envelope(requirements: PaymentRequirements): { x402Version: number; error: string; accepts: PaymentRequirements[] };
}

/** Decode a header first; the service keeps verification pure. */
export function decodeHeader(header: string): PaymentPayload {
  return decodePaymentHeader(header);
}

export function createQuoteService(options: QuoteServiceOptions = {}): QuoteService {
  const ttlMs = (options.ttlSeconds ?? QUOTE_TTL_SECONDS) * 1000;
  const issued = new Map<string, { requirements: PaymentRequirements; expiresAt: number }>();

  function sweep(now: number): void {
    for (const [key, entry] of issued) {
      if (entry.expiresAt <= now) issued.delete(key);
    }
  }

  return {
    issue(resource, priceWei, description, payTo, nonce = crypto.randomUUID()): PaymentRequirements {
      const requirements: PaymentRequirements = {
        scheme: "exact",
        network: "eip155:11155111",
        maxAmountRequired: priceWei,
        resource,
        description,
        mimeType: "application/json",
        payTo,
        maxTimeoutSeconds: options.ttlSeconds ?? QUOTE_TTL_SECONDS,
        extra: { nonce },
      };
      sweep(Date.now());
      issued.set(nonce, { requirements, expiresAt: Date.now() + ttlMs });
      return requirements;
    },

    claim(nonce, now = Date.now()): PaymentRequirements | null {
      if (!nonce) return null;
      const entry = issued.get(nonce);
      if (!entry) return null;
      issued.delete(nonce);
      return entry.expiresAt > now ? entry.requirements : null;
    },

    verify(header, requirements, now = Date.now()): PaymentCheck {
      let payload: PaymentPayload;
      try {
        payload = decodePaymentHeader(header);
      } catch {
        return { outcome: "malformed", reason: "header" };
      }
      return checkPayment(payload, requirements, now);
    },

    envelope(requirements) {
      return {
        x402Version: 1,
        error: "payment required",
        accepts: [requirements],
      };
    },
  };
}
