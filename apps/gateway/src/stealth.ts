import type { ConfidentialClient } from "@kairos/confidential";
import { KairosError, deriveStealthAddress, parseMetaAddress } from "@kairos/shared";
import type { GatewayConfig } from "./config.js";

/**
 * The payee half of Kairos privacy, shared by the two payment surfaces.
 *
 * `POST /nox/settle` and the MCP connector's `kairos_pay` must behave
 * identically here — one deriving a stealth address while the other quietly did
 * not would be the worst kind of failure, because the operator would have no way
 * to tell which path a given payment took.
 *
 * Lives in its own module because `index.ts` already imports `mcp.ts`, so the
 * shared code cannot sit in either without a cycle.
 */

export interface StealthPayout {
  /** The one-time address this payment is destined for. */
  address: `0x${string}`;
  ephemeralPublicKey: `0x${string}`;
  viewTag: number;
  /** Announcement tx, or null when the payment could not be published. */
  announcement: string | null;
  /** Present only when the announcement failed. Absent is the good case. */
  warning?: string;
}

/**
 * Derive the address a payment should land on.
 *
 * Resolution order is the explicit request, then the operator's configured
 * payee, then nothing. Returning `null` is a legitimate outcome: a deployment
 * with no meta-address configured settles exactly as it did before.
 */
export function resolveStealthPayout(
  config: GatewayConfig,
  payTo?: string,
): ReturnType<typeof deriveStealthAddress> | null {
  const meta = payTo?.trim() || config.payeeStealthMetaAddress;
  if (!meta) return null;

  try {
    return deriveStealthAddress(parseMetaAddress(meta));
  } catch {
    throw new KairosError("invalid_input", "payTo is not a valid stealth meta-address", {
      hint: "Expected st:eth:0x… carrying two 33-byte compressed keys.",
    });
  }
}

/**
 * Publish an authorized payment so its recipient can find it.
 *
 * **Only ever call this on an authorized settlement.** Announcing a refusal
 * would write a false entry to a public append-only log, and would leak that an
 * attempt happened at all — precisely what the branchless settle path exists to
 * hide.
 *
 * A failed announcement does not undo the payment. The money was authorized;
 * being findable is a separate fact, and the caller is told which one failed
 * rather than handed a refusal that never happened.
 */
export async function announceStealthPayout(
  confidential: ConfidentialClient,
  payment: ReturnType<typeof deriveStealthAddress>,
): Promise<StealthPayout> {
  const base = {
    address: payment.stealthAddress,
    ephemeralPublicKey: payment.ephemeralPublicKey,
    viewTag: payment.viewTag,
  };

  if (!confidential.canAnnounceStealth) {
    return {
      ...base,
      announcement: null,
      warning:
        "Derived but not announced — no announcer configured, or the gateway is " +
        "read-only. Save the ephemeral public key: without it the recipient " +
        "cannot discover this payment.",
    };
  }

  try {
    const announcement = await confidential.announceStealthPayment({
      stealthAddress: payment.stealthAddress,
      ephemeralPublicKey: payment.ephemeralPublicKey,
      viewTag: payment.viewTag,
    });
    return { ...base, announcement };
  } catch (cause) {
    // Operationally this must be visible: an unannounced payment is a payment
    // the recipient cannot find.
    console.warn(
      `[stealth] announce failed for ${payment.stealthAddress}:`,
      cause instanceof Error ? cause.message : cause,
    );
    return {
      ...base,
      announcement: null,
      warning:
        "Payment authorized, but the announcement failed. Save the ephemeral " +
        "public key — without it the recipient cannot derive this address.",
    };
  }
}
