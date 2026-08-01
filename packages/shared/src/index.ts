/**
 * @kairos/shared — types, errors and the verdict rule.
 *
 * Depends on nothing in the workspace, by design (docs/PROJECT_STRUCTURE.md §3).
 * This file is the package's entire public surface; importing an internal path
 * from outside the package is forbidden.
 */

export {
  KairosError,
  type KairosErrorCode,
  invalidInput,
  unauthenticated,
  forbidden,
  notFound,
  conflict,
  paymentRequired,
  verdictUnreadable,
  upstreamFailure,
  rateLimited,
  misconfigured,
  internal,
  toKairosError,
} from "./errors.js";

export {
  type Result,
  ok,
  err,
  attempt,
  attemptAsync,
  unwrap,
} from "./result.js";

export {
  type Verdict,
  authorized,
  refused,
  unreadable,
  mayServeResource,
  verdictFromDecryption,
} from "./authorization.js";

export {
  type Address,
  type Hex,
  type EncryptedHandle,
  type AgentId,
  type EpochId,
  isAddress,
  isHex,
} from "./types.js";
