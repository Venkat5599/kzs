# Feedback on the iExec Nox tooling

Written while building Kairos — a confidential agent-budget vault that routes
proven epoch aggregates through an unmodified Uniswap V3 router, and pays out to
ERC-5564 stealth addresses.

This is the honest version. The parts that were good were genuinely good, and the
friction is described precisely enough to be actionable rather than just
complained about.

---

## What worked well

**`Nox.sol` reads like Solidity, not like a framework.** `euint256` and `ebool`
behave enough like their plaintext counterparts that the vault's core logic is
recognisably ordinary code. `Nox.mint`, `Nox.transfer` and `Nox.fromExternal`
covered the whole surface we needed without dropping to anything lower level.
Someone who knows Solidity can read `KairosVault.sol` and follow it.

**Composability actually survived.** This was the claim we were most sceptical of
going in. `KairosSettlementRouter` hands a plaintext epoch aggregate to Uniswap's
own deployed `IV3SwapRouter` over its existing ABI — same interface, same pools,
no fork, no wrapper. Uniswap never learns it is being handed the sum of
settlements whose individual values are still encrypted. That the confidentiality
layer can sit *above* a public protocol without modifying it is the single most
valuable property of Nox, and it held up in practice on Sepolia.

**`encryptInput` on the client is the right shape.** One call returns
`{ handle, handleProof }` and both go straight into the contract call. No
ceremony, no key management leaking into application code. The gateway holds one
relayer key and nothing else.

**Decryption returning "not permitted" as a value, not an exception,** made the
fail-closed design tractable. We could treat "you may not read this" as an
ordinary answer and render it as such, rather than catching an error and guessing
what it meant.

---

## Friction, in order of how much it cost us

### 1. `ebool` cannot gate `require`, and the docs do not lead with this

This is the most important thing a new Nox developer needs to know, and we
learned it by hitting it. An encrypted comparison cannot control revert
behaviour, because reverting *is* the leak — an observer distinguishes authorized
from refused by whether the transaction succeeded.

The consequence is architectural, not cosmetic: **every confidential
authorization must be branchless.** In Kairos, `settle()` always succeeds and
always writes; whether it debited anything is itself encrypted. That is the right
design, but we arrived at it by discovering the constraint rather than being told
it.

**Suggestion:** put this at the top of the getting-started guide, framed as
"confidential control flow is branchless", with a worked before/after. It
reframes how you write the whole contract. It is not an edge case.

### 2. Write receipts carry no return data, so verdicts must be inferred

`settle()` returns an encrypted flag on-chain, but a transaction receipt gives
the client nothing back. To learn the outcome we had to read the agent's
encrypted spend *before* the call, read it *after*, and compare the delta against
the requested amount:

```ts
const before = (await this.agent(agent)).spentWei;
const hash   = await this.send("settle", [agent, handle, handleProof]);
const after  = (await this.agent(agent)).spentWei;
verdict = verdictFromDecryption(BigInt(after) - BigInt(before) === amountWei);
```

Three round-trips where one would do, and the inference is subtle enough to get
wrong — an absolute comparison instead of a delta reports *every* settlement as
authorized, because spend accumulates. We hit exactly that bug.

**Suggestion:** a way to fetch the encrypted return value of a write by
transaction hash. Even a helper that packages the read-write-read pattern with
the delta comparison built in would remove a real footgun.

### 3. ACL re-granting is manual, repetitive, and silently load-bearing

Every mutation of an encrypted value requires re-granting access:

```solidity
_treasury = newTreasury;
Nox.allowThis(_treasury);
Nox.allow(_treasury, owner);
```

Two extra lines per value per write, and forgetting them does not fail loudly —
it produces a handle nobody can decrypt, which surfaces much later as an
unreadable read. In a contract with several encrypted values updated together,
this is easy to get wrong and hard to notice.

**Suggestion:** either persist the ACL across reassignment by default, or provide
a modifier/helper that re-grants a declared set after a write. Failing that, a
compile-time or test-time lint for "encrypted value assigned without a following
`allowThis`" would catch most of it.

### 4. Local iteration depends on live testnet

We could not exercise the confidential path without Sepolia and a funded key.
Every change to authorization logic meant a deploy and a real transaction, which
made the fail-closed edge cases — particularly "verdict is unreadable" — awkward
to test deliberately. Our unit tests cover the pure logic
(`verdictFromDecryption`, the stealth derivation); the Nox-touching layer is
covered only by live proof scripts.

**Suggestion:** a local mock or in-memory TEE stub, even one that skips real
attestation, would meaningfully improve the development loop. Being able to force
"decryption not permitted" on demand would let people test the fail-closed path
that privacy systems depend on most.

### 5. Smaller notes

- **Handle types are stringly-typed at the client boundary.** `encryptInput(v,
  "uint256", addr)` takes the type as a string; a typo is a runtime error. A typed
  overload would catch it at compile time.
- **Epoch/aggregate decryption semantics took a careful read.** That
  `proveEpochAggregate` deliberately releases a plaintext total, and why that is
  safe, is the crux of the batching argument. Worth a dedicated doc page — it is
  the part reviewers ask about first.
- **`@iexec-nox/handle` version churn.** We pinned to a beta
  (`^0.1.0-beta.13`); a stability note on what is expected to change before 1.0
  would help people decide how much to build on it.

---

## Would we build on it again

Yes. The branchless constraint is the hard part, and once internalised it stops
being an obstacle and starts being the design. The property that made this
project possible — adding confidentiality on top of a public protocol without
touching that protocol — is genuinely rare, and Nox delivers it.

The gaps above are developer-experience gaps, not capability gaps. Nothing we
wanted to build was impossible; several things were harder to get right than they
needed to be, and the ACL and verdict-inference issues are the two most likely to
produce silent, privacy-relevant bugs in someone else's code.
