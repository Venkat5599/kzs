import { MAINNET_CHAIN } from "@kairos/chain";
import { KairosError, invalidInput, type Result, err, ok } from "@kairos/shared";

/**
 * @kairos/authz — the pure rules behind payment and session authorization.
 *
 * The gateway's routes stay thin; the logic here is deliberately transport-free
 * so it can be tested without HTTP and reused by the SDK when it constructs
 * payment envelopes client-side.
 */

/** The x402 version this project speaks. */
export const X402_VERSION = 1;

/** CAIP-2 of the settlement chain. */
export const NETWORK = MAINNET_CHAIN.caip2;

/** A header larger than this is rejected before it is parsed. */
export const MAX_HEADER_BYTES = 8 * 1024;

/** What a server will accept, in x402's `accepts` shape. */
export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  /** Price in wei, as a decimal string. Never a number — wei exceeds 2^53. */
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  /** Echoed back in the payment's `nonce` so the payee address stays stable. */
  extra: { nonce: string };
}

/** The decoded `X-PAYMENT` header. */
export interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: {
    authorization: {
      from: string;
      to: string;
      /** Wei, decimal string. */
      value: string;
      /** Unix epoch seconds, decimal string. */
      validBefore?: string;
      nonce?: string;
    };
    signature?: string;
  };
}

const WEI_RE = /^(0|[1-9][0-9]*)$/;

/** Base64-encode a payment payload into an `X-PAYMENT` header value. */
export function encodePaymentHeader(payload: PaymentPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

/**
 * Decode an `X-PAYMENT` header.
 *
 * Every failure is `invalid_input` — a malformed header is a broken client, and
 * answering it with a quote would leak that a payment was considered.
 */
export function decodePaymentHeader(header: string): PaymentPayload {
  if (header.length > MAX_HEADER_BYTES) {
    throw new KairosError("invalid_input", "X-PAYMENT header is too large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    throw new KairosError("invalid_input", "X-PAYMENT header is not valid base64 JSON");
  }
  const p = parsed as PaymentPayload;
  if (typeof p !== "object" || p === null || typeof p.x402Version !== "number" || typeof p.scheme !== "string") {
    throw new KairosError("invalid_input", "X-PAYMENT header is malformed");
  }
  return p;
}

export type PaymentCheck =
  | { readonly outcome: "ok" }
  | { readonly outcome: "malformed"; readonly reason: string }
  | { readonly outcome: "expired" }
  | { readonly outcome: "wrong_network" }
  | { readonly outcome: "amount_exceeded" };

/**
 * Validate a decoded payment against the terms a quote set.
 *
 * Returns a structured outcome instead of throwing so a route can answer 402
 * with the generic envelope for every non-ok outcome — the refusal and the
 * unpaid request stay indistinguishable.
 */
export function checkPayment(payload: PaymentPayload, requirements: PaymentRequirements, now: number = Date.now()): PaymentCheck {
  if (payload.x402Version !== X402_VERSION) return { outcome: "malformed", reason: "version" };
  if (payload.scheme !== requirements.scheme) return { outcome: "malformed", reason: "scheme" };
  if (payload.network !== requirements.network) return { outcome: "wrong_network" };

  const auth = payload.payload?.authorization;
  if (typeof auth !== "object" || auth === null) return { outcome: "malformed", reason: "authorization" };
  if (typeof auth.from !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(auth.from)) return { outcome: "malformed", reason: "from" };
  if (auth.to !== requirements.payTo) return { outcome: "malformed", reason: "to" };
  if (typeof auth.value !== "string" || !WEI_RE.test(auth.value)) return { outcome: "malformed", reason: "value" };

  // The payment may exceed the quote — overpaying is the payer's right — but a
  // payment that undercuts the quote is refused: it would settle less than the
  // agreed price.
  if (BigInt(auth.value) < BigInt(requirements.maxAmountRequired)) return { outcome: "amount_exceeded" };

  if (auth.validBefore !== undefined) {
    const expiry = Number(auth.validBefore);
    if (!Number.isFinite(expiry) || expiry * 1000 <= now) return { outcome: "expired" };
  }

  return { outcome: "ok" };
}

// ─── scoped session keys ─────────────────────────────────────────────────────

/** The spending authority a session key carries. */
export interface SessionScope {
  /** The agent address the key acts for. */
  agent: string;
  /** Per-call ceiling, wei as a decimal string. */
  capWei: string;
  /** Optional cumulative ceiling across the session, wei decimal string. */
  budgetWei?: string;
  /** Unix epoch seconds; the key is dead after this. */
  expiresAt: number;
}

/** Encode a scope as the opaque string a session key stores. */
export function encodeScope(scope: SessionScope): string {
  return JSON.stringify(scope);
}

/** Parse a scope string. `null` for anything that is not a valid scope. */
export function parseScope(raw: string): SessionScope | null {
  try {
    const s = JSON.parse(raw) as Partial<SessionScope>;
    if (typeof s.agent !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(s.agent)) return null;
    if (typeof s.capWei !== "string" || !WEI_RE.test(s.capWei)) return null;
    if (s.budgetWei !== undefined && (typeof s.budgetWei !== "string" || !WEI_RE.test(s.budgetWei))) return null;
    if (typeof s.expiresAt !== "number" || !Number.isFinite(s.expiresAt)) return null;
    return {
      agent: s.agent,
      capWei: s.capWei,
      ...(s.budgetWei !== undefined ? { budgetWei: s.budgetWei } : {}),
      expiresAt: s.expiresAt,
    };
  } catch {
    return null;
  }
}

/** Whether a scope permits a single spend of `amountWei` right now. */
export function scopeAllows(scope: SessionScope, amountWei: string, now: number = Date.now()): boolean {
  if (now >= scope.expiresAt * 1000) return false;
  if (!WEI_RE.test(amountWei)) return false;
  if (BigInt(amountWei) > BigInt(scope.capWei)) return false;
  return true;
}

/** Whether a scope permits `amountWei` given what the session has already spent. */
export function scopeAllowsWithSpend(scope: SessionScope, amountWei: string, spentWei: string, now: number = Date.now()): Result<boolean, ReturnType<typeof invalidInput>> {
  if (!scopeAllows(scope, amountWei, now)) return ok(false);
  if (scope.budgetWei === undefined) return ok(true);
  if (!WEI_RE.test(spentWei)) return err(invalidInput("spentWei must be a wei decimal string"));
  return ok(BigInt(spentWei) + BigInt(amountWei) <= BigInt(scope.budgetWei));
}
