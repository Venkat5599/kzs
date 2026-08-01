# ADR-004 — Single gateway relayer, with the exposure documented

**Status:** Accepted
**Date:** 2026-08-01

## Context

`msg.sender` is inherently public. Whatever else a confidential contract hides,
the account that submitted the transaction is visible to everyone.

If each agent submitted its own settlements, the sender field alone would rebuild
the operational diary: per-agent activity, frequency, and — combined with epoch
numbers — a usable timing profile per agent. Encrypting the amounts would not
help, because the interesting signal is *which agent is active*, not *how much*.

There is no way to make `msg.sender` private. The only lever is **who sends**.

## Decision

All settlements are submitted through a **single gateway relayer**. On-chain,
every settlement shares one sender, so per-agent activity is not distinguishable
from the sender field.

The resulting exposure is stated plainly in the PRD, the architecture document,
and the README — with equal prominence to the guarantees:

> The relayer address is public, and the relayer itself learns what it relays.

## Consequences

**Positive**

- Per-agent activity is not recoverable from `msg.sender`.
- Combined with ADR-003, the on-chain surface reduces to: a settlement occurred,
  in this epoch, submitted by this one known relayer.
- Gas and nonce management live in one place.

**Negative**

- **The relayer is trusted.** It sees every settlement in plaintext at the moment
  it constructs the transaction. Compromising it compromises confidentiality for
  every call it handles.
- It is a single point of failure for liveness. If the relayer is down,
  settlement stops — and per ADR-002 that means service is refused, not degraded.
- It is a censorship point. The relayer can decline to relay for a given agent.
- Nonce serialisation puts a ceiling on settlement throughput.

These are accepted for now because the alternative designs each trade a
documented, bounded exposure for an undocumented, unbounded one.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Per-agent submission | `msg.sender` rebuilds the per-agent diary; defeats the product |
| Relayer pool | Reduces the liveness risk but multiplies the trusted surface, and correlation across a small pool is straightforward |
| Third-party relay network | Moves trust rather than removing it, and adds an external liveness dependency |
| Account abstraction / meta-transactions | The bundler or paymaster becomes the visible sender — the same trade with more moving parts |

## Revisit when

The open question in the PRD — whether the relayer should be decentralised —
should be reopened once traffic is high enough that a pool would not be trivially
correlatable, or once a relay network with an acceptable trust model exists.
