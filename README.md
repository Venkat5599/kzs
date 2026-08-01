<div align="center">

# Kairos

### A confidentiality layer for public DeFi infrastructure.

**Enforce a spending budget on-chain. Publish neither the budget, the balance, nor a single amount. Then route the settlement through an unmodified Uniswap V3 pool.**

</div>

---

## Live on Ethereum Sepolia

| | Address |
|---|---|
| **KairosVault** | [`0xa3cca0a1611b7157c4211789eebf96a5234330e0`](https://sepolia.etherscan.io/address/0xa3cca0a1611b7157c4211789eebf96a5234330e0) |
| **KairosSettlementRouter** | [`0x5e0c9e0cedc2c34eb8147b27d9dd9abb9c5d570b`](https://sepolia.etherscan.io/address/0x5e0c9e0cedc2c34eb8147b27d9dd9abb9c5d570b) |
| NoxCompute (protocol) | [`0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF`](https://sepolia.etherscan.io/address/0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF) |
| Uniswap V3 SwapRouter02 | [`0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E`](https://sepolia.etherscan.io/address/0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E) |

Chain `11155111`. The Uniswap router above is **Uniswap's own deployment**. Kairos
does not fork it, wrap it, or ask it to change.

---

## The problem, stated precisely

Public settlement standards are public by design, and that is correct for a
settlement standard. It is wrong for a **budget**.

Meter any spend through a transparent protocol and the chain publishes an
operational diary: who is spending, how often, against which counterparty, for
how much, and how much allowance remains. Anyone can read it. For a business that
is a competitive leak before it is a privacy problem.

The naive fix — don't enforce the limit on-chain — is strictly worse. Then the
cap is a suggestion, and one compromised caller drains the treasury.

**Kairos keeps the enforcement and drops the disclosure.** Budgets, per-caller
caps and settlement amounts live as Nox encrypted handles. Comparison happens
inside the TEE. The chain stores handles, never values.

The concrete deployment target is autonomous AI agents paying for metered APIs
over x402 — the case where the diary problem is sharpest, because agents transact
constantly and mechanically. But nothing in the vault is agent-specific. It is a
confidential budget primitive; agents are the first tenant.

---

## Why this is not a proof of concept

Three claims, each backed by something you can read or run.

### 1. Privacy is added by layering, not by forking

`KairosSettlementRouter` consumes the plaintext aggregate the vault proved and
calls `exactInputSingle` on Uniswap's deployed SwapRouter02 through its existing
ABI. [`IV3SwapRouter.sol`](./contracts/src/interfaces/IV3SwapRouter.sol) is an
**interface declaration only** — there is no forked AMM in this repository.

Composability survives because the public protocol never learns it is being used
differently. What reaches the pool is one counterparty and one batch total.
What never reaches it: per-call amounts, per-agent caps, and every identity.

### 2. Authorization is branchless, so refusal itself is private

An `ebool` cannot gate a `require`, and reverting on an encrypted comparison
would broadcast the comparison result — the exact fact being hidden. So no
control flow in `settle()` reads an encrypted value.

An over-cap settlement **debits zero and the transaction still succeeds**, on
chain indistinguishable from an authorized one. Nox exposes no boolean operators
on `ebool`, so `withinCap AND funded` is composed arithmetically instead —
project `funded` onto `{0,1}`, gate it through `withinCap`, compare to one.

→ [ADR-001](./docs/adr/001-branchless-authorization.md) · [`KairosVault.settle`](./contracts/src/KairosVault.sol)

### 3. The batching actually breaks the graph

Settlement events carry **no address and no amount** — only an epoch number.
Debits accumulate into an encrypted epoch total that the owner flushes as one
aggregate via `allowPublicDecryption`, verified on-chain with `publicDecrypt`.
There is no one-transaction-per-call trail to correlate by timing.

→ [ADR-003](./docs/adr/003-epoch-batching.md)

---

## How Nox is actually used

Not one primitive behind a thin wrapper. The vault leans on the protocol:

| Nox surface | Where, and why |
|---|---|
| `fromExternal` + proof | Every encrypted input is proof-validated before it is trusted |
| `le`, `eq` | Cap comparison and the conjunction, entirely inside the TEE |
| `select` | Branchless reduction of an over-cap request to zero |
| `transfer` | **Atomic encrypted balance movement.** Insufficiency returns an `ebool`, not a revert — so underfunding is as private as over-cap |
| `mint` | Funding raises balance and total supply atomically |
| `allowThis`, `allow` | Contract and owner retain access across handle rotation |
| `addViewer` | An agent sees its own cap, spend and verdict — and nothing of anyone else's |
| `allowPublicDecryption` | The single deliberate declassification point, per epoch |
| `publicDecrypt` | On-chain verification of the decryption proof |
| `isAllowed` | Lets a caller distinguish "not permitted" from "not yet flushed" |

Balance arithmetic is **not** hand-rolled around encrypted values. `settle()`
calls `Nox.transfer`, because reimplementing atomic confidential movement on top
of a protocol that already guarantees it is how you introduce the bug.

The relayer is granted **nothing**. It submits transactions without being
entitled to read a single outcome.

---

## The payment path

```
caller ──▶ gateway ──▶ KairosVault.settle(encrypted amount)
                            │  le(amount, cap) in the TEE
                            │  branchless debit via Nox.transfer
                            │  tx succeeds either way
                            ▼
                       encrypted verdict flag
                            │
              gateway decrypts ──── unreadable? ──▶ REFUSE
                            │
                        authorized ──▶ serve the resource
                            │
                            ▼
             epoch accumulates ──▶ flushEpoch ──▶ proveEpochAggregate
                                                        │
                                                        ▼
                                          unmodified Uniswap V3 swap
```

**Fail closed is the whole security argument.** The verdict is an encrypted flag,
and decryption can fail for ordinary reasons. A gateway that treated an
unreadable flag as "probably fine" would hand out paid resources for free. So
`mayServeResource` is an allow-list on `authorized`, and its test suite is
permanently required.

→ [ADR-002](./docs/adr/002-fail-closed.md) · [`authorization.ts`](./packages/shared/src/authorization.ts)

---

## What is hidden, and what is not

Being precise here matters more than the feature list.

**Encrypted** — handles on-chain, decryptable only by permitted accounts:
the treasury and what remains of it · each caller's cap · each caller's
cumulative spend · the amount of any individual settlement · **whether a given
settlement was authorized or refused**

**Public:** that a settlement occurred and in which epoch · how many settlements
a flushed batch contained · the relayer address · the epoch aggregate, once
deliberately released

**Limitations, stated as prominently as the guarantees.** `msg.sender` is
inherently public: all settlements share one gateway relayer, so per-caller
activity is not distinguishable — but the relayer is visible and learns what it
relays. Batching mitigates but does not eliminate timing correlation on a
low-traffic deployment. The gateway holds keys and is trusted.

---

## Documentation

| Document | Covers |
|---|---|
| [PRD](./docs/PRD.md) | Problem, goals and non-goals, requirements, limitations |
| [Architecture](./docs/ARCHITECTURE.md) | Authority model, authorization, payment path, graph engine |
| [Project structure](./docs/PROJECT_STRUCTURE.md) | The tree, the dependency rule, where a feature goes |
| [ADRs](./docs/adr/) | Six load-bearing decisions, with rejected alternatives |

---

## Repository

```
apps/       frontend · gateway · mcp-server
packages/   shared · manifest · authz · chain · confidential · workflow · sdk
services/   catalog · payments · identity · execution
contracts/  KairosVault · KairosSettlementRouter
docs/       PRD · ARCHITECTURE · PROJECT_STRUCTURE · adr/
```

Dependency rule, enforced in CI: `apps` → `services` → `packages` → `shared`.
A package never imports from an app.

---

## Running it

Requires [Bun](https://bun.sh).

```bash
bun install
cp .env.example .env
bun run dev            # dashboard on http://localhost:5173
bun run test           # unit + contract suites
```

Config is schema-validated at boot: an invalid value is a startup failure, never
a silent default. Every variable is documented in [`.env.example`](./.env.example).

---

## Build status

Honest about what is proven and what is not.

| Piece | State |
|---|---|
| `KairosVault` — branchless auth on Nox primitives | **Deployed to Sepolia** |
| `KairosSettlementRouter` — unmodified Uniswap V3 | **Deployed to Sepolia** |
| Router test suite | 13 passing |
| `packages/shared` — fail-closed verdict rule | 12 passing |
| Vault encrypted paths against live Nox | Not yet exercised end to end |
| `apps/gateway`, remaining packages, `services/*` | In progress |
| Dashboard wired to a live gateway | In progress |

The vault is deployed and its constructor executed real Nox calls — the treasury
and epoch handles on-chain are genuine encrypted handles. A full
fund → register → settle → flush cycle against the live TEE has not yet been run,
and this table will say so until it has.

---

## License

MIT
