/**
 * The authorization verdict.
 *
 * This module is small on purpose. It encodes one rule, and that rule is the
 * entire security argument of the system:
 *
 *   A verdict that cannot be read is a refusal.
 *
 * Because settlement is branchless on-chain (docs/adr/001), the transaction
 * succeeds whether or not the payment was authorized. The receipt carries no
 * answer. The only signal is an encrypted flag, and decrypting it can fail for
 * ordinary reasons — a permission not yet propagated, an RPC blip, a timeout.
 *
 * A gateway that treated any of those as "probably fine" would hand out paid
 * resources for free. So the type below makes "unreadable" a first-class state
 * that a caller must handle explicitly, and {@link mayServeResource} is the
 * single place that decides. See docs/adr/002.
 */

export type Verdict =
  /** The TEE authorized the settlement and the debit occurred. */
  | { readonly outcome: "authorized" }
  /** The TEE refused: over cap, or the treasury could not cover it. */
  | { readonly outcome: "refused" }
  /** The flag could not be decrypted. Indeterminate — never "probably fine". */
  | { readonly outcome: "unreadable"; readonly reason: string };

export const authorized: Verdict = { outcome: "authorized" };
export const refused: Verdict = { outcome: "refused" };
export const unreadable = (reason: string): Verdict => ({ outcome: "unreadable", reason });

/**
 * The fail-closed decision. The only function permitted to authorize serving a
 * paid resource.
 *
 * Written as an explicit allow-list rather than `verdict.outcome !== "refused"`
 * so that adding a future verdict state cannot silently become permissive. A new
 * state defaults to refusal, which is the direction a mistake should fall.
 */
export function mayServeResource(verdict: Verdict): boolean {
  return verdict.outcome === "authorized";
}

/**
 * Interpret a decryption attempt as a verdict.
 *
 * Takes the raw outcome of trying to read the encrypted flag. Anything that is
 * not a definite boolean — null, undefined, a thrown error, a malformed value —
 * becomes `unreadable`, and therefore a refusal.
 */
export function verdictFromDecryption(
  decrypted: boolean | null | undefined,
  failureReason?: string,
): Verdict {
  if (decrypted === true) return authorized;
  if (decrypted === false) return refused;
  return unreadable(failureReason ?? "decryption returned no value");
}
