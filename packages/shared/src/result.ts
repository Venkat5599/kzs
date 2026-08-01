import { KairosError, toKairosError } from "./errors.js";

/**
 * A result type for operations whose failure is an expected outcome rather than
 * an exception.
 *
 * This exists for one specific reason. The authorization verdict has three
 * states — authorized, refused, and unreadable — and the third must never be
 * mistaken for either of the others. A boolean return would force `false` to
 * mean both "refused" and "could not tell", and a thrown exception invites a
 * `catch` that swallows. An explicit result makes the third state impossible to
 * ignore, because the caller cannot read `.value` without narrowing first.
 */

export type Result<T, E extends KairosError = KairosError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E extends KairosError>(error: E): Result<never, E> => ({ ok: false, error });

/** Run a throwing function and capture the failure as a Result. */
export function attempt<T>(fn: () => T): Result<T> {
  try {
    return ok(fn());
  } catch (cause) {
    return err(toKairosError(cause));
  }
}

/** Await a promise and capture rejection as a Result. */
export async function attemptAsync<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await fn());
  } catch (cause) {
    return err(toKairosError(cause));
  }
}

/**
 * Unwrap a Result, throwing on failure.
 *
 * Use at an outer boundary that already has error handling. Never use it to get
 * past a verdict check — that reintroduces the swallow this type exists to
 * prevent.
 */
export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw result.error;
}
