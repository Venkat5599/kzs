# ADR-001 — Branchless authorization instead of reverting comparisons

**Status:** Accepted
**Date:** 2026-08-01

## Context

The vault must decide whether a settlement is within an agent's per-call cap and
within the remaining treasury. Both the amount and the cap are encrypted values.

The obvious implementation is a guard:

```solidity
require(amount <= cap, "over cap");
```

This cannot work. `Nox.le(amount, cap)` returns an **encrypted** boolean, and an
encrypted boolean cannot gate a `require`. Worse, if it could, the revert itself
would be public — an observer would learn the comparison result from whether the
transaction succeeded. The failure mode leaks exactly the fact the system exists
to hide.

The same applies to the treasury check. A subtraction that reverts on underflow
broadcasts whether the treasury covered the payment.

## Decision

Authorization is **branchless**. No control flow depends on an encrypted value.

```solidity
ebool    withinCap = Nox.le(amount, s.capPerCall);
euint256 requested = Nox.select(withinCap, amount, zero);

// safeSub reports underflow as an encrypted flag rather than reverting.
(ebool funded, euint256 remaining) = Nox.safeSub(budget, requested);

euint256 debited = Nox.select(funded, requested, zero);
budget           = Nox.select(funded, remaining, budget);
```

An over-cap call debits **zero** and the transaction still **succeeds**. On-chain
it is indistinguishable from an authorized settlement. The outcome is written to
an encrypted flag readable only by the owner and the agent concerned.

## Consequences

**Positive**

- Authorization outcome is confidential, not merely the amounts.
- Gas cost is constant regardless of outcome, so gas is not a side channel.
- No revert path means no error-message side channel.

**Negative**

- The caller cannot learn the outcome from the transaction receipt. It must
  decrypt the flag, which makes ADR-002 (fail closed) mandatory rather than
  optional.
- Every arithmetic operation must have a non-reverting variant. Ordinary
  `SafeMath`-style checks are unusable in this contract.
- The code is harder to read than a guard clause. Reviewers unfamiliar with the
  constraint will try to "simplify" it back into a `require`. Hence this ADR.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| `require` on a decrypted comparison | Decrypting on-chain defeats the purpose entirely |
| Revert on over-cap | The revert is public and leaks the comparison result |
| Return a plaintext boolean | Same leak, one step removed |
| Off-chain check, on-chain settle | The cap becomes advisory; a compromised agent bypasses it |
