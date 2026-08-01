/**
 * The error taxonomy every Kairos package raises against.
 *
 * Two rules, both load-bearing:
 *
 * 1. Errors carry a stable `code`. HTTP status mapping happens once, at the
 *    gateway edge, so packages never import transport concerns and a code can be
 *    matched on without string-matching a message.
 *
 * 2. Messages are safe to show a caller. No key, no decrypted amount, no
 *    handle contents ever enters an error message — an error is one of the
 *    easiest places to leak the thing the whole system exists to protect.
 */

export type KairosErrorCode =
  /** Input failed schema validation at a boundary. */
  | "invalid_input"
  /** Caller is not authenticated. */
  | "unauthenticated"
  /** Caller is authenticated but not permitted. */
  | "forbidden"
  /** Named thing does not exist. */
  | "not_found"
  /** Request conflicts with current state. */
  | "conflict"
  /** Payment required, or refused by the confidential layer. */
  | "payment_required"
  /** The authorization verdict could not be read. Always refuse. */
  | "verdict_unreadable"
  /** A downstream vendor or chain call failed. */
  | "upstream_failure"
  /** Caller exceeded a rate limit. */
  | "rate_limited"
  /** Configuration is invalid. Raised at boot. */
  | "misconfigured"
  /** Anything genuinely unexpected. */
  | "internal";

export class KairosError extends Error {
  readonly code: KairosErrorCode;
  /** Machine-readable context. Must never contain secrets. */
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: KairosErrorCode,
    message: string,
    details: Record<string, unknown> = {},
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "KairosError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }

  static is(value: unknown): value is KairosError {
    return value instanceof KairosError;
  }
}

export const invalidInput = (message: string, details?: Record<string, unknown>): KairosError =>
  new KairosError("invalid_input", message, details);

export const unauthenticated = (message = "Authentication required."): KairosError =>
  new KairosError("unauthenticated", message);

export const forbidden = (message = "Not permitted."): KairosError =>
  new KairosError("forbidden", message);

export const notFound = (what: string, id?: string): KairosError =>
  new KairosError("not_found", `${what} not found.`, id === undefined ? {} : { id });

export const conflict = (message: string, details?: Record<string, unknown>): KairosError =>
  new KairosError("conflict", message, details);

export const paymentRequired = (message: string, details?: Record<string, unknown>): KairosError =>
  new KairosError("payment_required", message, details);

/**
 * The authorization verdict could not be decrypted.
 *
 * This is not a transient annoyance to be retried into submission — it is the
 * fail-closed trigger. Whatever raised it must have already refused the paid
 * action. See docs/adr/002.
 */
export const verdictUnreadable = (reason: string): KairosError =>
  new KairosError(
    "verdict_unreadable",
    "Authorization verdict could not be read; refusing.",
    { reason },
  );

export const upstreamFailure = (
  what: string,
  details?: Record<string, unknown>,
  cause?: unknown,
): KairosError =>
  new KairosError("upstream_failure", `Upstream call failed: ${what}.`, details, { cause });

export const rateLimited = (retryAfterSeconds: number): KairosError =>
  new KairosError("rate_limited", "Too many requests.", { retryAfterSeconds });

export const misconfigured = (message: string, details?: Record<string, unknown>): KairosError =>
  new KairosError("misconfigured", message, details);

export const internal = (message = "Internal error.", cause?: unknown): KairosError =>
  new KairosError("internal", message, {}, { cause });

/**
 * Coerce an unknown thrown value into a KairosError.
 *
 * The original message is deliberately NOT copied onto the result: a stray
 * driver or RPC error can carry a connection string or a key fragment, and this
 * is exactly the seam where that would escape into a response body. It is kept
 * on `cause` for the logger, which redacts.
 */
export function toKairosError(value: unknown): KairosError {
  if (KairosError.is(value)) return value;
  return internal("Internal error.", value);
}
