# ADR-003 — Batch debits into epochs rather than settling per call

**Status:** Accepted
**Date:** 2026-08-01

## Context

Encrypting amounts hides *how much* was paid. It does not hide *when*, *how
often*, or *in what pattern*.

If every metered API call produced its own settlement transaction, the chain
would carry a one-transaction-per-call trail. Even with every value encrypted,
an observer could read:

- how many calls an operator makes per hour, and when activity starts and stops
- bursts that correlate with a product launch, a deploy, or a customer signing
- correlation with a vendor's own traffic, recovering the counterparty by timing

That is most of the operational diary the product exists to suppress. Ciphertext
with a public timestamp is still intelligence.

## Decision

Debits **batch**. A settlement accumulates into an encrypted epoch total rather
than emitting an individual on-chain event. The owner flushes the epoch as a
single aggregate event.

Settlement events carry **no addresses and no amounts** — only an epoch number.

## Consequences

**Positive**

- The one-call-one-transaction timing trail disappears. Calls inside an epoch are
  mutually indistinguishable.
- Logs cannot be assembled into a payment graph, since no event carries a
  counterparty.
- Fewer on-chain writes; settlement cost is amortised across the epoch.

**Negative**

- The **number** of settlements in a flushed epoch is public. Batch size is a
  coarse volume signal.
- Timing privacy degrades as traffic thins. On a low-traffic deployment an epoch
  may contain a single settlement, at which point batching provides nothing.
  This is documented as a limitation rather than papered over.
- The epoch introduces state the owner must flush. An unflushed epoch is a
  liveness concern, and epoch length is a real tuning parameter trading privacy
  against operator latency.
- Reconciliation is per-epoch, not per-call, so operational tooling must be built
  around aggregates.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Settle per call | Publishes the timing trail; ciphertext alone is not enough |
| Fixed-size batches | Flush timing becomes a function of volume, which leaks volume |
| Random delay per settlement | Adds latency to every call and only blurs, rather than removes, the per-call trail |
| Off-chain accounting, periodic on-chain checkpoint | The cap stops being enforced on-chain, which is the product |
