import { KairosError } from "@kairos/shared";
import type { Skill } from "./store.js";

/**
 * The x402 quote-then-pay flow.
 *
 * x402 is the "402 Payment Required actually means something" convention: a
 * resource server answers an unpaid request with the terms it will accept, the
 * client retries carrying a payment, and the server settles it. Kairos already
 * had the second half — `/nox/settle` authorizes through the enclave — but no
 * way for a caller to *ask the price* first, which is the part that makes a
 * catalogue machine-navigable.
 *
 * Everything here is a pure function over plain values. The gateway's rule is
 * that routes stay thin and logic lives where it can be tested without HTTP
 * (`index.ts:26-32`), and this is the module that rule is asking for.
 *
 * One invariant governs the whole file, and it is the same one `/nox/settle`
 * documents at `index.ts:164-166`: **a refusal and an unpaid request must be
 * indistinguishable.** Both answer with the identical quote envelope. If a
 * refusal carried so much as an extra key, a caller could probe the encrypted
 * cap by watching response shapes — the exact thing the branchless settle path
 * exists to prevent.
 */

/** The x402 version this gateway speaks. */
export const X402_VERSION = 1;

/** CAIP-2 for Ethereum Sepolia, the only chain the vault is deployed on. */
export const NETWORK = "eip155:11155111";

/**
 * A payment header larger than this is rejected unread.
 *
 * The header is base64 that gets JSON-parsed, so without a cap a caller makes
 * the gateway allocate whatever they send before any validation runs.
 */
const MAX_HEADER_BYTES = 8 * 1024;

/** How long a quote is good for. Long enough to sign, short enough to bound replay. */
const QUOTE_TTL_SECONDS = 120;

/** What the server will accept, in x402's `accepts` shape. */
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
      /** Unix epoch seconds, decimal string — not an ISO date. */
      validBefore?: string;
      nonce?: string;
    };
    signature?: string;
  };
}

/** The body returned with every 402, paid-and-refused or never-paid alike. */
export interface QuoteEnvelope {
  x402Version: number;
  error: string;
  accepts: PaymentRequirements[];
}

/**
 * Build the terms for a skill.
 *
 * `payTo` is passed in rather than derived here, so the caller can hand us a
 * stealth address from `resolveStealthPayout` without this module growing a
 * second, divergent derivation path.
 */
export function quoteFor(
  skill: Skill,
  resource: string,
  payTo: string,
  nonce: string = crypto.randomUUID(),
): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK,
    maxAmountRequired: skill.priceWei,
    resource,
    description: skill.description || skill.name,
    mimeType: "application/json",
    payTo,
    maxTimeoutSeconds: QUOTE_TTL_SECONDS,
    extra: { nonce },
  };
}

/**
 * Quotes that have been issued and not yet spent.
 *
 * This exists because of stealth payouts. The payee is a one-time address
 * derived per request, so re-deriving it when the payment arrives would produce
 * a *different* address than the one quoted, and every honest payment would be
 * refused as "addressed to someone else". The quote has to be remembered.
 *
 * In-process and ephemeral, like the catalogue in `store.ts`. A restart forgets
 * outstanding quotes, which costs a caller one retry and is the right trade
 * against persisting payment intents the gateway does not need to keep.
 */
const issued = new Map<string, { requirements: PaymentRequirements; expiresAt: number }>();

/** Remember a quote so the payment that answers it can be checked against it. */
export function rememberQuote(requirements: PaymentRequirements, now: number = Date.now()): void {
  // Sweep on write. There is no timer to leak and no unbounded growth: an
  // unanswered quote is gone one TTL after it was issued.
  for (const [key, entry] of issued) {
    if (entry.expiresAt <= now) issued.delete(key);
  }
  issued.set(requirements.extra.nonce, {
    requirements,
    expiresAt: now + QUOTE_TTL_SECONDS * 1000,
  });
}

/**
 * Look up the quote a payment claims to answer.
 *
 * Returns `null` for unknown, expired or already-spent nonces — all of which the
 * route answers with a fresh quote, never with an explanation.
 */
export function claimQuote(nonce: string | undefined, now: number = Date.now()): PaymentRequirements | null {
  if (!nonce) return null;
  const entry = issued.get(nonce);
  if (!entry) return null;
  // Deleted on claim, so a captured header cannot be replayed against the same
  // quote a second time.
  issued.delete(nonce);
  return entry.expiresAt > now ? entry.requirements : null;
}

/** The envelope a caller gets for any 402, whatever the underlying reason. */
export function quoteEnvelope(requirements: PaymentRequirements): QuoteEnvelope {
  return {
    x402Version: X402_VERSION,
    // Deliberately generic. "payment required" is all a caller is told, whether
    // they sent nothing or the enclave refused what they sent.
    error: "payment required",
    accepts: [requirements],
  };
}

/**
 * Decode the `X-PAYMENT` header.
 *
 * Every failure is `invalid_input`, never a 402 — a malformed header is a broken
 * client, and answering it with a quote would tell that client its payment was
 * considered and declined.
 */
export function decodePaymentHeader(header: string): PaymentPayload {
  if (header.length > MAX_HEADER_BYTES) {
    throw new KairosError("invalid_input", "X-PAYMENT header is too large");
  }

  let json: string;
  try {
    json = Buffer.from(header, "base64").toString("utf8");
  } catch {
    throw new KairosError("invalid_input", "X-PAYMENT header is not valid base64");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new KairosError("invalid_input", "X-PAYMENT header is not valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new KairosError("invalid_input", "X-PAYMENT header is not an object");
  }

  const candidate = parsed as Partial<PaymentPayload>;
  const authorization = candidate.payload?.authorization;
  if (
    typeof candidate.scheme !== "string" ||
    typeof candidate.network !== "string" ||
    !authorization ||
    typeof authorization.from !== "string" ||
    typeof authorization.to !== "string" ||
    typeof authorization.value !== "string"
  ) {
    throw new KairosError("invalid_input", "X-PAYMENT header is missing required fields", {
      hint: "Expected { x402Version, scheme, network, payload: { authorization: { from, to, value } } }.",
    });
  }

  return candidate as PaymentPayload;
}

/**
 * Check a payment against the terms that were quoted.
 *
 * Throws `payment_required` on a mismatch rather than returning false, so a
 * caller cannot forget to check the result. The route maps that to the same 402
 * envelope an unpaid request gets.
 */
export function verifyAgainstQuote(
  payment: PaymentPayload,
  requirements: PaymentRequirements,
  now: number = Date.now(),
): void {
  const refuse = (reason: string): never => {
    // The reason is for the gateway's log, never for the response body.
    throw new KairosError("payment_required", reason);
  };

  if (payment.scheme !== requirements.scheme) refuse("payment scheme does not match the quote");
  if (payment.network !== requirements.network) refuse("payment network does not match the quote");

  const { authorization } = payment.payload;
  if (authorization.to.toLowerCase() !== requirements.payTo.toLowerCase()) {
    refuse("payment is addressed to someone other than the quoted payee");
  }

  let value: bigint;
  let required: bigint;
  try {
    value = BigInt(authorization.value);
    required = BigInt(requirements.maxAmountRequired);
  } catch {
    return refuse("payment value is not an integer number of wei");
  }
  // `>=`, not `===`: overpaying is the caller's business, underpaying is not.
  if (value < required) refuse("payment is below the quoted price");

  if (authorization.validBefore !== undefined) {
    const validBefore = Number(authorization.validBefore);
    if (!Number.isFinite(validBefore)) refuse("validBefore is not a Unix timestamp");
    // validBefore is epoch *seconds*; `now` is milliseconds.
    if (validBefore * 1000 <= now) refuse("payment authorization has expired");
  }
}

/**
 * The `X-PAYMENT-RESPONSE` receipt, base64 as the convention requires.
 *
 * Only ever built for an authorized settlement — it names a transaction, and a
 * receipt for a refusal would assert a payment that never happened.
 */
export function receiptHeader(transaction: string, payer: string): string {
  return Buffer.from(
    JSON.stringify({ success: true, transaction, network: NETWORK, payer }),
    "utf8",
  ).toString("base64");
}
