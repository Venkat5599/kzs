# ADR-002 — Fail closed on an unreadable authorization flag

**Status:** Accepted
**Date:** 2026-08-01
**Depends on:** [ADR-001](./001-branchless-authorization.md)

## Context

Because authorization is branchless (ADR-001), the settlement transaction
succeeds whether or not the payment was authorized. The transaction receipt
carries no verdict. The only signal is an **encrypted flag**, readable by the
owner and the agent concerned.

The gateway must decrypt that flag before releasing the paid resource. Decryption
can fail for mundane reasons: a permission not yet propagated, a transient RPC
error, a malformed handle, a timeout.

The question is what the gateway does when it cannot read the flag.

## Decision

**Refuse.** An unreadable flag is treated as *not authorized*, always.

Every code path that touches the flag defaults to refusal. There is no branch in
which an error, a timeout, a null, or an exception results in the resource being
served. The default value of the decision variable is "deny", and it is only ever
raised to "allow" by a successfully decrypted flag that says so.

This is asserted by a permanent unit test. The test may not be deleted or skipped.

## Consequences

**Positive**

- The security argument holds under failure, not only under success. A system
  that is secure only when its dependencies are healthy is not secure.
- The failure mode is loss of availability, which is visible and recoverable —
  rather than loss of funds, which is neither.

**Negative**

- Transient infrastructure problems become customer-visible refusals. This is
  the correct trade, but it must be monitored: a spike in fail-closed refusals is
  an incident signal, not noise.
- An operator under pressure will be tempted to add a "degraded mode" that
  serves on an unreadable flag. That is a security regression, not a mitigation.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Fail open on decryption error | Hands out paid resources for free. A single induced RPC failure becomes free unlimited access. |
| Retry indefinitely, then fail open | The fail-open branch still exists; an attacker only needs to hold the failure open longer. |
| Serve, then reconcile later | Irreversible: the vendor call has already been made and paid for. |
| Cache the last known verdict | The verdict is per-settlement. A cached "authorized" is a replay primitive. |
