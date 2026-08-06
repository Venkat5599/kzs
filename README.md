<div align="center">

# Kairos

### A confidentiality layer for public DeFi infrastructure.

**Enforce a spending budget on-chain. Publish neither the budget, the balance, nor a single amount. Then route the settlement through an unmodified Uniswap V3 pool.**

</div>

**An AI agent can hold a budget it cannot read and cannot raise.** Connect Kairos to
Claude Code over MCP and ask it to pay. The amount is encrypted, checked against a cap
inside a TEE, and the agent learns exactly one thing: allowed, or not. It never sees
the treasury, never learns its own limit, and never holds a key.

**Both halves of a payment are hidden, not one.** Every settlement shares a single
relayer, so the chain cannot tell which agent paid — and payouts land on ERC-5564
stealth addresses that have never appeared on-chain, so it cannot accumulate a record
of who was paid either. Most privacy work covers the payer and stops there.

**A refusal is indistinguishable from an approval.** An encrypted boolean cannot gate
a `require`, because reverting *is* the leak. So authorization is branchless: the
transaction succeeds either way and only the encrypted flag differs.

**And none of it forks anything.** The settlement is swapped through Uniswap's own
deployed V3 router, over its existing ABI, against its existing pools.

**[ Live demo ↗ ](https://kairos-nox.vercel.app)** · **[ Dashboard ↗ ](https://kairos-nox.vercel.app/dashboard)** · **[ Mirror ↗ ](https://kairos.187.127.137.136.sslip.io)**

---

## Live on Ethereum Sepolia

| | Address |
|---|---|
| **KairosRingRegistry** | [`0x00b439e437dabea9d3562f40dacd42be8372fee8`](https://sepolia.etherscan.io/address/0x00b439e437dabea9d3562f40dacd42be8372fee8) |
| **KairosVault** (ring 0) | [`0x1b5919e3ec31daaa88a69ca4bf27aa83dbed57f8`](https://sepolia.etherscan.io/address/0x1b5919e3ec31daaa88a69ca4bf27aa83dbed57f8) |
| **KairosSettlementRouter** | [`0xec0ec50c8ebffb89aed3072d7c4a74671b2e8d7f`](https://sepolia.etherscan.io/address/0xec0ec50c8ebffb89aed3072d7c4a74671b2e8d7f) |
| **StealthAnnouncer** (ERC-5564) | [`0x07ef4c4c82a093c6eef1b44fd3750695a80b48f1`](https://sepolia.etherscan.io/address/0x07ef4c4c82a093c6eef1b44fd3750695a80b48f1) |
| NoxCompute (protocol) | [`0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF`](https://sepolia.etherscan.io/address/0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF) |
| CompositePolicy | [`0x1de0cde89f528948783776af5737a9510ce9f89a`](https://sepolia.etherscan.io/address/0x1de0cde89f528948783776af5737a9510ce9f89a) |
| ├ CapPolicy | [`0xa3917c56d009e53c0fb58536f2765fc7ea41f7c6`](https://sepolia.etherscan.io/address/0xa3917c56d009e53c0fb58536f2765fc7ea41f7c6) |
| ├ VelocityPolicy | [`0x484e3d6865b6389ae8b9f6b479ed97cc2dafc9d8`](https://sepolia.etherscan.io/address/0x484e3d6865b6389ae8b9f6b479ed97cc2dafc9d8) |
| └ AllowlistPolicy | [`0x4a8c63103478484d74caf73cc7a28729a45c616b`](https://sepolia.etherscan.io/address/0x4a8c63103478484d74caf73cc7a28729a45c616b) |
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

## The policy engine

The vault used to hardcode one rule. Real issuers have several, and they change
without the settlement logic changing — so the rule is pluggable and the vault
owns enforcement only.

| Policy | Rule | Kept confidential |
|---|---|---|
| `CapPolicy` | per-call ceiling | the ceiling |
| `VelocityPolicy` | cumulative allowance | allowance and consumption |
| `AllowlistPolicy` | eligibility / KYC | **the membership set itself** |
| `CompositePolicy` | all must approve | which one refused |

That third row is the one worth pausing on. A public compliance hook — the
pattern regulated token standards use — publishes its allowlist. Anyone can
enumerate who passed KYC and who was rejected. For an issuer that set *is* the
holder register: commercially sensitive, and in several jurisdictions personal
data. Here it is an encrypted flag. The vault learns whether to authorize, and
learns it only as ciphertext.

### Conjunction without boolean operators

Nox exposes no `and`, `or` or `not` on `ebool`. So `CompositePolicy` builds
conjunction arithmetically:

```solidity
euint256 acc = one;
for each policy:
    ebool term = policy.evaluate(subject, amount, context);
    acc = Nox.select(term, acc, zero);   // collapses on refusal, never recovers
approved = Nox.eq(acc, one);
```

There is deliberately **no early exit**. Short-circuiting on the first refusal
would make gas a function of *which* policy refused — a side channel handing an
observer the fact the encryption protects. Every policy runs on every
settlement, whatever the outcome. That costs more. It is supposed to.

### Rings

`KairosRingRegistry` indexes independent vaults — each with its own relayer,
policy and encrypted state. ADR-004 documents that a single relayer sees
everything it relays; a ring bounds that blast radius to one tenant.

The registry deploys and indexes but holds **no authority** over a ring
afterwards. It cannot pause, drain, or reconfigure one. A registry that could
would reintroduce, one level up, the central point of trust rings exist to
remove.

### A replay gap, closed

A settlement handle may now be spent exactly once. Without the nullifier the
relayer could resubmit a captured `(handle, proof)` pair and debit the same
authorized amount repeatedly. The handle is public data — it *names* a
ciphertext, it is not one — so recording it in the clear leaks nothing.

### A privacy bug found and fixed

`revokeAgent` used to flip a `registered` flag, after which `settle` reverted
with `AgentNotRegistered`. That revert is **public**, so revocation was
announced on-chain and a revoked agent was distinguishable from one that merely
exceeded its cap — while the comment above it claimed the opposite.

Revocation now belongs to the policy, where it refuses branchlessly like every
other rule.


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

## Proven on live Nox — not asserted

`bun run --cwd contracts prove:live` runs a full cycle against the deployed vault
and the real TEE. Every hash below is on Sepolia and checkable by anyone.

| Step | Transaction |
|---|---|
| Fund treasury (encrypted `1000000`) | [`0xb03746fc…2deb2a`](https://sepolia.etherscan.io/tx/0xb03746fc76ed188642d7de7672b909c9ee6054e39a1ec17ec91b0032382deb2a) |
| Register agent (encrypted cap `100000`) | [`0x6c609698…84469c`](https://sepolia.etherscan.io/tx/0x6c60969833b00feeec4df00745fed849df4afb2d0ee16ec95e1faa6b2084469c) |
| Settle `40000` — **under** cap | [`0xe820d1c1…78c84211`](https://sepolia.etherscan.io/tx/0xe820d1c1e54d81ea2e34e419d0b81bea5fc8858cc9f9b4d2ef109d4478c84211) |
| Settle `500000` — **over** cap | [`0xf3307db6…ed7fda`](https://sepolia.etherscan.io/tx/0xf3307db636eafd383a0cf041d83bf9ced8942f325cea6e3f095595eb42ed7fda) |

What the run asserted, and what passed:

```
3. settle 40000 - UNDER the cap of 100000
   agent spend decrypts to 40000
   PASS  under-cap settlement debited the agent
   treasury now 2880000
   PASS  under-cap settlement debited the treasury

4. settle 500000 - OVER the cap. Must debit zero and NOT revert.
   PASS  transaction succeeded despite being over cap
   agent spend still 40000
   PASS  over-cap settlement debited ZERO
   treasury still 2880000
   PASS  treasury unchanged by the over-cap call

5. inspect what the chain published
   epoch=0  data=0x
   PASS  event body is empty - no address, no amount

ALL CHECKS PASSED
```

**Read the over-cap transaction on Etherscan.** It succeeded. Its receipt is
indistinguishable from the authorized one above it. Nothing in the logs says
which of the two was refused — that is the guarantee, demonstrated rather than
described.

The treasury and spend figures above were decrypted by the owner through the
Nox handle client. An account without the ACL grant gets `403 not a viewer`.

### The batch, declassified — and what the aggregate proves

`bun run --cwd contracts prove:flush` closes an epoch and proves its aggregate
on-chain.

| Step | Transaction |
|---|---|
| `flushEpoch` — `allowPublicDecryption` on the epoch total | [`0x8cfd08a7…866e1a`](https://sepolia.etherscan.io/tx/0x8cfd08a73ed4fd73780f7b66058d0dce301334fef60d809504f72195eb866e1a) |
| `proveEpochAggregate` — TEE proof verified **on-chain** | [`0x0a906726…762946`](https://sepolia.etherscan.io/tx/0x0a906726e1381b01c77ad43231a274adca57298afa3548aefc5fed2c23762946) |

```
epoch 0 holds 6 settlement(s)

1. before flushing
   PASS  aggregate is NOT publicly decryptable yet

2. flushEpoch - the deliberate declassification
   PASS  epoch marked flushed
   settlementCount published: 6

3. publicDecrypt - anyone can now read the aggregate
   aggregate = 120000

4. proveEpochAggregate - the TEE proof verified ON-CHAIN
   PASS  epoch marked settled
   PASS  on-chain aggregate matches the off-chain decryption

ALL CHECKS PASSED
```

**Read that aggregate carefully.** Six settlements produced `120000`, which is
exactly three lots of `40000` — the three under-cap calls. The three over-cap
calls contributed **zero**. The batch total independently confirms the
branchless authorization worked, without any individual amount ever being
emitted.

The handle was verifiably *not* publicly decryptable before the flush, and was
after. That is the single declassification point, and it releases a sum rather
than a payment.

After step 4 the contract holds a plain `uint256`. That is the hinge: an
unmodified Uniswap router can consume it without knowing Nox exists.


### The swap — composability, executed

`bun run --cwd contracts prove:swap` routes the proven aggregate through a real
Uniswap V3 pool created by **Uniswap's own factory**.

| Step | Transaction |
|---|---|
| Create + initialise pool (Uniswap factory) | [`0x7c565f64…645208`](https://sepolia.etherscan.io/tx/0x7c565f64f8f12bd28b1fa97a20240ba4b454991c41e4b736f4fff67c0d645208) |
| Add liquidity (Uniswap position manager) | [`0x327c775c…8b6ed2`](https://sepolia.etherscan.io/tx/0x327c775caf27a23c5386c57eb95400424320861efed906266b528d0f628b6ed2) |
| **`routeEpoch` — swap via SwapRouter02** | [`0x0d0b8e76…b60621`](https://sepolia.etherscan.io/tx/0x0d0b8e76e362752b402804c048c38bf126240ff806d1bbfea9a745d83ab60621) |

```
epoch 0: 6 settlements -> proven aggregate 120000
this number is the ONLY thing crossing into public infrastructure

5. routeEpoch - through Uniswap's deployed SwapRouter02
   swapped 120000 -> received 119639
   PASS  the swap executed against a real Uniswap V3 pool
   PASS  the router spent exactly the proven aggregate
   PASS  the epoch is marked routed, so it cannot be spent twice

  Uniswap saw: one counterparty, one amount, one swap.
  Uniswap did NOT see: any per-settlement amount, cap, or identity.
```

`120000 -> 119639` is the 0.3% fee tier doing exactly what it should. The pool,
the factory, the position manager and the router are all Uniswap's deployed
contracts, used through their existing ABIs. This repository contains no forked
AMM — only [`IV3SwapRouter.sol`](./contracts/src/interfaces/IV3SwapRouter.sol),
an interface declaration.

**The complete path, all of it on Sepolia:**

```
6 confidential settlements   amounts, caps and verdicts encrypted
   3 authorized, 3 refused   refusals indistinguishable on-chain
            |
            v
   encrypted epoch total     no address or amount ever emitted
            |
      flushEpoch             one deliberate declassification
            |
            v
      aggregate 120000       verified on-chain by TEE proof
            |
       routeEpoch
            v
   Uniswap V3 swap           unmodified, unaware, composable
```


### A bug this found

The first live run reverted with `PublicHandleACLForbidden()`. `Nox.toEuint256(0)`
produces a *trivially encrypted* handle, which Nox classifies as public;
`allow`/`allowThis` silently skip public handles, but `addViewer` reverts on them.
A newly-registered agent's `spent` is exactly that.

Fixed with an `isPubliclyDecryptable` guard before every `addViewer`. Skipping is
correct rather than convenient: a public handle is already readable by everyone,
so there is no viewer left to add. No amount of reading the documentation would
have surfaced this — only running it did.

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

**The payee, hidden too.** The relayer hides the payer; a fixed payout address
would still accumulate a public history of how often this recipient is paid and
how much. So payouts land on ERC-5564 stealth addresses. Set
`PAYEE_STEALTH_META_ADDRESS` and every payment — including every payment an agent
makes through MCP — derives a fresh address that has never appeared on-chain.

This happens in two moments, and the distinction is load-bearing. **Settling**
debits the encrypted budget and publishes the sender's ephemeral key to
[`StealthAnnouncer`](https://sepolia.etherscan.io/address/0x07ef4c4c82a093c6eef1b44fd3750695a80b48f1),
which is what makes the payment findable; **routing** the epoch is what moves the
money to it, through `routeEpochToStealth`. The payout is per-epoch rather than
per-call because a transfer on every payment would republish precisely the timing
the batch exists to hide. Announcement happens only on an authorized settlement —
publishing a refusal would write a false entry to a public log and betray that an
attempt was made at all.

Connected over MCP, an agent gets `kairos_stealth_keys` to generate a meta-address
and `kairos_stealth_check` to identify its own payments. It cannot trigger a
payout: an agent able to drain the router on demand would have a blast radius
larger than the cap it was given.

**Proven on Sepolia, not asserted.** `bun run --cwd contracts prove:stealth-payout`
routes a proven epoch aggregate to a freshly derived address and checks the balance
actually moved. An address the recipient cannot be paid at is not privacy, it is a
hole with good documentation.

```
epoch 0: 4 settlements -> proven aggregate 80000

  PASS  recipient recognises the address as theirs
  PASS  recipient holds the private key for it
  PASS  a stranger scanning the announcement learns nothing
  PASS  announcement landed
  PASS  the stealth address starts empty
  PASS  route transaction succeeded
  PASS  the stealth address received the payout

  paid 79759 to 0x9833a34c7ab8b39539d7efe739cc801b41787277
```

| | Transaction |
|---|---|
| announce | [`0x5d37d94b…d8d3e61`](https://sepolia.etherscan.io/tx/0x5d37d94b5955ed0666f6bf088eb6245232bf06a8c68b2cfb1ed905a85d8d3e61) |
| routeEpochToStealth | [`0xa0240364…f59783de`](https://sepolia.etherscan.io/tx/0xa02403640a6094dc5ab1c717347bef44447971dfe9c3a6085b36de7cf59783de) |
| the paid address | [`0x9833a34c…41787277`](https://sepolia.etherscan.io/address/0x9833a34c7ab8b39539d7efe739cc801b41787277) |

80000 in, 79759 out — the difference is Uniswap's own 0.3% pool fee, taken by an
unmodified router that never learned it was settling encrypted balances. The
recipient address had never appeared on-chain before that transaction.

**Limitations, stated as prominently as the guarantees.** `msg.sender` is
inherently public: all settlements share one gateway relayer, so per-caller
activity is not distinguishable — but the relayer is visible and learns what it
relays. Batching mitigates but does not eliminate timing correlation on a
low-traffic deployment. The gateway holds keys and is trusted. A stealth address
hides the link, not the amount — the amount is hidden separately, by Nox.

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
| `KairosVault` — branchless auth on Nox primitives | **Deployed + proven on Sepolia** |
| Full cycle: fund, register, settle under/over cap | **Proven live** |
| `flushEpoch` + `proveEpochAggregate` | **Proven live** |
| `KairosSettlementRouter` → real Uniswap V3 swap | **Executed live** |
| Router test suite | 13 passing |
| `packages/shared` — fail-closed verdict rule | 12 passing |
| `packages/{chain,manifest,authz,workflow,sdk}` | Built + tested (52 tests) |
| `services/{catalog,payments,identity,execution}` | Built + tested; gateway wired (`CATALOG_STORE_FILE` persistence, `/fabric/run/workflow`, `/s/:slug` + `/s/:slug/auto-pay`, flush readiness check) |
| Dashboard wired to a live gateway | **Live** — every page reads the real gateway (`demoMode:false`, Sepolia) |

The confidential core is complete and verified end to end on Sepolia. The
service layer around it — gateway routes, the remaining packages, the
services, and the dashboard — is built, tested, merged and **deployed**
(the VPS gateway runs the current code; the catalogue is seeded via
`POST /fabric/marketplace/seed` + `/fabric/workflows/seed` after each
restart, or persists with `CATALOG_STORE_FILE`).

---

## License

MIT
