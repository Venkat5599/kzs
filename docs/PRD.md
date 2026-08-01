# Kairos — Product Requirements Document

**Status:** Draft v1.0
**Owner:** Venkat5599
**Last updated:** 2026-08-01

---

## 1. Summary

Kairos gives an AI agent a spending budget it **cannot exceed** and **cannot reveal**.

Enforcing a budget on a public blockchain normally means publishing it — the cap, the running total, and every individual payment. Kairos keeps the enforcement and drops the disclosure. Budgets and per-agent caps live as encrypted handles inside a confidential contract, the comparison happens inside a TEE, and the chain stores handles rather than values.

The x402 payment standard and the MCP tool protocol are left exactly as they are. Only **authorization and accounting** move into the confidential layer.

---

## 2. Problem

x402 is an open payment standard: a server answers `402 Payment Required` with a price, the caller pays on-chain, retries with proof, and receives the resource. Public settlement is the right default for a settlement standard.

It is the wrong default for an agent's budget.

Run a fleet of agents against metered APIs over x402 and the chain publishes an operational diary:

- which agent is active, and how often
- which vendors it buys from
- how much each call costs
- how much of its allowance remains

Anyone can read it. For a company, that is a competitive leak before it is a privacy problem. A competitor can infer headcount, vendor relationships, product launches, and burn rate from payment traffic alone.

The naive fix — don't enforce the budget on-chain — is strictly worse. Then the cap is a suggestion, and a single compromised prompt drains the treasury.

**The gap:** there is no way today to enforce a hard spending limit on an autonomous agent without publishing that limit and every transaction against it.

---

## 3. Goals and non-goals

### Goals

| # | Goal | Success measure |
|---|---|---|
| G1 | Enforce a hard per-call spending cap that an agent cannot exceed | An over-cap settlement debits zero and the resource is withheld |
| G2 | Keep the cap, balance, and every settlement amount confidential | No plaintext amount, cap, or balance appears in any on-chain storage slot or event |
| G3 | Make authorization outcome itself confidential | An observer cannot distinguish an authorized settlement from a rejected one |
| G4 | Break the payment graph | Settlement events carry no addresses and no amounts |
| G5 | Preserve x402 compatibility | An agent with no knowledge of the confidential layer still transacts successfully |
| G6 | Expose capability to agents as native tools | Published skills appear as MCP tools without per-agent integration work |
| G7 | Run multi-step work as one agent call | A workflow graph executes as a single tool invocation with per-node observability |

### Non-goals

- **Hiding that a settlement occurred.** The fact of a transaction and its epoch are public by design.
- **Hiding the relayer.** `msg.sender` is inherently public. This is a stated limitation, not a defect (see §9).
- **Being a payment rail.** Kairos sits on top of x402; it does not replace settlement.
- **Being a general workflow platform.** The graph engine exists to make agent-driven spend auditable, not to compete with orchestration tools.
- **Custody.** Kairos does not hold user funds beyond the operating treasury it enforces against.

---

## 4. Users

| Persona | Need | Primary surface |
|---|---|---|
| **Platform operator** | Fund a treasury, register agents with caps, revoke a compromised agent instantly, see spend without exposing it | Dashboard |
| **AI agent** (Claude Code, MCP client) | Call metered APIs and run workflows without knowing anything about encryption | MCP server |
| **Application developer** | Integrate metered capability into a product over plain HTTP + x402 | Gateway API / SDK |
| **API vendor** | Publish a metered capability and get paid per call | Skill manifest + marketplace |
| **Auditor / skeptic** | Verify the privacy claims independently from a terminal | Public read endpoints + chain explorer |

---

## 5. Product principles

1. **Fail closed.** If the authorization flag cannot be decrypted, the paid action does not proceed. A gateway that treats an unreadable flag as "probably fine" hands out the resource for free. This is the entire security argument.
2. **Branchless authorization.** An encrypted boolean cannot gate a `require`. Reverting on an encrypted comparison leaks the comparison result. Over-cap calls debit zero and the transaction still succeeds.
3. **Precision over marketing.** Every privacy claim is stated with its exact boundary. What leaks is documented as prominently as what does not.
4. **The chain stores handles, never values.**
5. **Unchanged wire protocols.** x402 stays x402; MCP stays MCP.
6. **Verifiable from a terminal.** Every claim in the docs is checkable with `curl` against live infrastructure.

---

## 6. Functional requirements

### 6.1 Confidential vault

| ID | Requirement | Priority |
|---|---|---|
| FR-1.1 | Fund the treasury with an encrypted amount | P0 |
| FR-1.2 | Register an agent with an encrypted per-call cap | P0 |
| FR-1.3 | Settle a payment; compare amount against cap inside the TEE | P0 |
| FR-1.4 | Debit zero on an over-cap call without reverting | P0 |
| FR-1.5 | Report authorization outcome as an encrypted flag readable only by owner and that agent | P0 |
| FR-1.6 | Decrypt budget and epoch total for permitted accounts only | P0 |
| FR-1.7 | Revoke an agent in a single transaction | P0 |
| FR-1.8 | Batch debits into an encrypted epoch total; flush as one aggregate event | P1 |
| FR-1.9 | Report vault address, relayer, and current epoch publicly | P1 |

### 6.2 Gateway and x402

| ID | Requirement | Priority |
|---|---|---|
| FR-2.1 | Answer `402 Payment Required` with a quote for an unpaid call | P0 |
| FR-2.2 | Execute the resource call on retry with valid payment proof | P0 |
| FR-2.3 | Fail closed when the authorization flag is unreadable | P0 |
| FR-2.4 | Restrict outbound calls to the manifest's declared egress scope | P0 |
| FR-2.5 | Combined settle-and-execute in one call | P1 |
| FR-2.6 | Report chain configuration, including an explicit demo-mode flag | P0 |
| FR-2.7 | Meter usage per agent and per skill | P1 |
| FR-2.8 | Issue scoped, expiring session keys | P1 |

### 6.3 Skill catalog

| ID | Requirement | Priority |
|---|---|---|
| FR-3.1 | Publish a capability from a declarative manifest | P0 |
| FR-3.2 | Validate the manifest and reject malformed input with a clear error | P0 |
| FR-3.3 | List published skills | P0 |
| FR-3.4 | Expose each skill as an MCP tool | P0 |

### 6.4 Workflow engine

| ID | Requirement | Priority |
|---|---|---|
| FR-4.1 | Execute a directed graph of nodes as one agent tool call | P0 |
| FR-4.2 | Schedule a node when every predecessor has settled and at least one incoming edge fired | P0 |
| FR-4.3 | Support node kinds: trigger, http, condition, onchain, delay, transform, loop | P0 |
| FR-4.4 | Branch on `true` / `false` edges from a condition node | P0 |
| FR-4.5 | Run ready nodes concurrently; a join waits for every upstream branch | P0 |
| FR-4.6 | Per-node retry with backoff, and per-node timeout | P1 |
| FR-4.7 | Reject cycles, dangling edges, duplicate ids, and missing entry points at publish time | P0 |
| FR-4.8 | Persist run history with per-node status, attempts, and duration | P1 |
| FR-4.9 | Hard stop at a bounded number of node executions per run | P0 |

### 6.5 Dashboard

| ID | Requirement | Priority |
|---|---|---|
| FR-5.1 | Show live treasury state, decrypted for the owner | P0 |
| FR-5.2 | State plainly what an observer sees vs what stays private | P0 |
| FR-5.3 | Show a mode banner sourced from the same endpoint as the gateway | P0 |
| FR-5.4 | Manage skills, workflows, MCP servers, session keys, and marketplace | P1 |
| FR-5.5 | Visual workflow editor where a branch is drawn, not described | P1 |

---

## 7. Non-functional requirements

| Area | Requirement |
|---|---|
| **Security** | Keys exist in exactly one process. No secret reaches the browser or an agent. |
| **Security** | Every outbound call is constrained to a declared egress allowlist. |
| **Security** | Session keys are scoped and expiring; revocation is immediate. |
| **Correctness** | Authorization logic carries unit tests including the over-cap and underflow paths. |
| **Reliability** | An unreachable confidential layer degrades to refusing service, never to allowing it. |
| **Observability** | Every settlement and workflow run is traceable to an operator-visible record. |
| **Performance** | Quote response under 300 ms p95. Settlement bounded by chain finality. |
| **Accessibility** | Dashboard meets WCAG 2.2 AA: keyboard reachable, labelled controls, respects reduced motion. |
| **Compatibility** | A plain x402 client with no Kairos knowledge transacts successfully. |
| **Portability** | Local development requires no funded chain account (explicit demo mode). |

---

## 8. Key flows

### 8.1 Metered call

1. Agent posts to a skill endpoint.
2. Gateway answers `402` with a quote.
3. Agent retries with payment proof.
4. Gateway submits an encrypted settlement to the vault.
5. Vault compares amount against cap inside the TEE, debits branchlessly, and returns an encrypted authorization flag.
6. Gateway decrypts the flag. **If it cannot be read, stop.**
7. On authorized: call the vendor within declared egress, return the result.
8. On rejected: return `402`.

### 8.2 Agent onboarding

1. Operator funds the treasury with an encrypted amount.
2. Operator registers an agent with an encrypted per-call cap.
3. Agent receives a scoped session key.
4. Agent discovers available skills as MCP tools.

### 8.3 Compromise response

1. Operator revokes the agent in one transaction.
2. Subsequent settlements for that agent debit zero and are refused.
3. Historical spend remains encrypted and readable only by permitted accounts.

---

## 9. Stated limitations

Documented as prominently as the guarantees, because a privacy product that overstates itself is worse than one that does not exist.

| Limitation | Detail |
|---|---|
| **The relayer is visible** | `msg.sender` is inherently public. All settlements share one gateway relayer, so per-agent activity is not distinguishable on-chain — but the relayer address is public, and the relayer itself learns what it relays. |
| **Occurrence is public** | That a settlement happened, and in which epoch, is public. Only the participants and amounts are hidden. |
| **Batch size is public** | The number of settlements in a flushed epoch is visible. |
| **Timing correlation** | Batching mitigates but does not eliminate timing analysis for a low-traffic deployment. |
| **The gateway is trusted** | It holds keys and performs decryption. Compromising it compromises confidentiality for calls it handles. |

---

## 10. Success metrics

| Metric | Target |
|---|---|
| Plaintext amounts in on-chain state or events | 0 |
| Over-cap calls that receive the resource | 0 |
| Unreadable-flag calls that receive the resource | 0 |
| Plain x402 clients that transact successfully | 100% |
| Privacy claims independently verifiable from a terminal | 100% |
| Test coverage on authorization and graph scheduling | ≥ 90% |

---

## 11. Release scope

**M1 — Confidential core.** Vault contract, branchless authorization, encrypted fund/register/settle, owner decryption, fail-closed gateway.

**M2 — Metered capability.** Skill manifest, catalog, x402 quote/settle, egress scoping, MCP tool exposure.

**M3 — Workflows.** Graph engine, node kinds, validation, run history.

**M4 — Operator surface.** Dashboard with vault, skills, workflows, session keys, marketplace.

**M5 — Production hardening.** Batching and flush, metering, observability, session key lifecycle, rate limiting, deployment.

---

## 12. Open questions

- Should the relayer be decentralized, or is a documented trusted relayer acceptable for the target user?
- What is the right default epoch length, trading timing privacy against operator latency?
- Should per-agent caps support time windows (per hour, per day) in addition to per call?
- Does the marketplace need on-chain vendor reputation, or is off-chain sufficient at this stage?
