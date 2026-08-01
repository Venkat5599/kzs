# ADR-005 — Keep x402 and MCP wire formats unchanged

**Status:** Accepted
**Date:** 2026-08-01

## Context

Kairos adds confidential authorization and accounting to agent payments. There
were two ways to expose it.

The first is a new protocol: a Kairos-specific handshake carrying encrypted
budget context, which clients must implement to transact at all.

The second is to leave the existing standards alone and move only the
authorization and accounting behind them.

The first option is tempting because it makes the product's value explicit at the
protocol level. It is also how integration projects die: every agent, SDK, and
vendor must adopt a bespoke format before anything works, and nothing works until
everyone has.

## Decision

**The wire formats do not change.**

- **x402 stays x402.** An unpaid call returns `402 Payment Required` with a
  quote. The caller pays and retries with proof. The response surface is
  byte-compatible with plain x402.
- **MCP stays MCP.** Skills appear as ordinary tools over stdio. An agent calls
  them the way it calls any other tool.

Confidentiality is entirely an implementation detail of the gateway and the
vault. An agent that has never heard of the confidential layer transacts
successfully — it simply does not get the privacy.

## Consequences

**Positive**

- Zero integration cost for existing x402 clients and MCP agents.
- Adoption is incremental: an operator can move a single skill behind Kairos
  without touching any agent.
- The blast radius of a Kairos outage is bounded by the gateway; clients need no
  Kairos-specific error handling.
- The product is testable against off-the-shelf x402 and MCP clients, which is a
  much stronger correctness signal than testing against our own client.

**Negative**

- The privacy guarantee is invisible at the protocol level. A client cannot tell
  from the wire whether it is talking to a confidential gateway, so the demo-mode
  flag and the status endpoints carry that burden instead.
- Some information the confidential layer could usefully return — for example
  *why* a settlement was refused — has no natural place in a plain `402`, and is
  deliberately not exposed there.
- We are constrained by the standards' evolution rather than our own.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Kairos-specific payment protocol | Every client must adopt it before anything works; kills incremental adoption |
| Extended x402 with optional headers | Optional extensions get ignored, then silently depended on; the compatibility claim becomes untestable |
| MCP transport fork | Forks the agent ecosystem for no user-visible gain |
