import { describe, expect, it } from "bun:test";
import {
  authorized,
  mayServeResource,
  refused,
  unreadable,
  verdictFromDecryption,
  type Verdict,
} from "../src/authorization.js";

/**
 * The fail-closed rule.
 *
 * PROJECT_STRUCTURE §8 names this suite as permanently required. It may not be
 * deleted or skipped. If it is ever failing, the system serves paid resources to
 * unauthorized callers, which is the one failure mode the product cannot have.
 */

describe("mayServeResource", () => {
  it("serves only an explicit authorization", () => {
    expect(mayServeResource(authorized)).toBe(true);
  });

  it("refuses an explicit refusal", () => {
    expect(mayServeResource(refused)).toBe(false);
  });

  it("refuses when the verdict is unreadable", () => {
    // The whole argument in one assertion. An unreadable flag is not a hint that
    // things are probably fine; it is a refusal.
    expect(mayServeResource(unreadable("rpc timeout"))).toBe(false);
  });

  it("refuses every unreadable reason, without inspecting the reason", () => {
    const reasons = [
      "rpc timeout",
      "acl not propagated",
      "malformed handle",
      "gateway unreachable",
      "",
    ];
    for (const reason of reasons) {
      expect(mayServeResource(unreadable(reason))).toBe(false);
    }
  });

  it("refuses a verdict state it has never seen", () => {
    // Guards the allow-list. If mayServeResource is ever rewritten as
    // `outcome !== "refused"`, a future state would silently become permissive
    // and this test is what catches it.
    const future = { outcome: "quantum_indeterminate" } as unknown as Verdict;
    expect(mayServeResource(future)).toBe(false);
  });
});

describe("verdictFromDecryption", () => {
  it("maps a decrypted true to authorized", () => {
    expect(verdictFromDecryption(true)).toEqual(authorized);
  });

  it("maps a decrypted false to refused", () => {
    expect(verdictFromDecryption(false)).toEqual(refused);
  });

  it("maps null and undefined to unreadable, never to a decision", () => {
    // A nullish result means the read did not happen. Coercing it to false would
    // look like a refusal and behave like one — but it would also mean a genuine
    // outage was silently recorded as the agent being over budget.
    expect(verdictFromDecryption(null).outcome).toBe("unreadable");
    expect(verdictFromDecryption(undefined).outcome).toBe("unreadable");
  });

  it("never serves a resource off a nullish decryption", () => {
    expect(mayServeResource(verdictFromDecryption(null))).toBe(false);
    expect(mayServeResource(verdictFromDecryption(undefined))).toBe(false);
  });

  it("carries the failure reason through for the operator", () => {
    const verdict = verdictFromDecryption(undefined, "kms unreachable");
    expect(verdict).toEqual({ outcome: "unreadable", reason: "kms unreachable" });
  });

  it("supplies a default reason when none is given", () => {
    const verdict = verdictFromDecryption(null);
    if (verdict.outcome !== "unreadable") throw new Error("expected unreadable");
    expect(verdict.reason.length).toBeGreaterThan(0);
  });

  it("treats a truthy non-boolean as unreadable rather than authorized", () => {
    // JS truthiness is the classic way this rule gets broken: `if (decrypted)`
    // would authorize on the string "false", on 1, and on {}.
    const junk = ["true", "false", 1, 0, {}, []];
    for (const value of junk) {
      const verdict = verdictFromDecryption(value as unknown as boolean);
      expect(verdict.outcome).toBe("unreadable");
      expect(mayServeResource(verdict)).toBe(false);
    }
  });
});
