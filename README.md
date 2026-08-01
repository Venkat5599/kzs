<div align="center">

# Kairos

### Give an AI agent a budget it cannot exceed. **Without publishing the budget.**

</div>

An agent that pays for things needs a spending limit. Enforcing that limit on a
public chain means publishing it — the cap, the running total, and every payment.

Kairos keeps the **enforcement** and drops the **disclosure**. Budgets and
per-agent caps live as encrypted handles, the comparison happens inside a TEE,
and the chain stores handles rather than values. x402 and MCP are left exactly as
they are; only *authorization and accounting* move behind the confidential layer.

---

## Documentation

| Document | What it covers |
|---|---|
| [PRD](./docs/PRD.md) | The problem, goals and non-goals, personas, functional requirements, stated limitations |
| [Architecture](./docs/ARCHITECTURE.md) | Layer and authority model, branchless authorization, the payment path, the graph engine |
| [Project structure](./docs/PROJECT_STRUCTURE.md) | The tree, the dependency rule, naming, and where a new feature goes |
| [ADRs](./docs/adr/) | The six load-bearing decisions, with the alternatives that were rejected |

New to the codebase? Read the PRD, then §1–3 of the project structure. That is
enough to place any change correctly.

---

## The two invariants

Everything else is detail. These two are the product.

**1. Authorization is branchless.** An encrypted boolean cannot gate a `require`,
and reverting on an encrypted comparison would broadcast the comparison result.
So an over-cap call debits **zero** and the transaction still **succeeds** —
on-chain, indistinguishable from an authorized one.
→ [ADR-001](./docs/adr/001-branchless-authorization.md)

**2. The gateway fails closed.** The outcome is an encrypted flag. If it cannot
be decrypted, the paid resource is **refused**. A gateway that treated an
unreadable flag as "probably fine" would hand out paid resources for free.
→ [ADR-002](./docs/adr/002-fail-closed.md)

---

## What is hidden, and what is not

Being precise about this matters more than the feature list.

**Private** — encrypted handles, decryptable only by permitted accounts:

- the treasury budget and what remains of it
- each agent's per-call cap, and its cumulative spend
- the amount of any individual settlement
- **whether a given settlement was authorized or rejected**

**Public:**

- that a settlement occurred, and in which epoch
- how many settlements a batch contained
- the relayer address that submitted the transaction

**Known limitations, stated plainly.** `msg.sender` is inherently public. Every
settlement routes through one gateway relayer, so per-agent activity is not
distinguishable on-chain — but the relayer is visible, and it learns what it
relays. Batching mitigates but does not eliminate timing correlation on a
low-traffic deployment. The gateway holds keys and is trusted.

---

## Repository layout

```
apps/       frontend · gateway · mcp-server
packages/   shared · manifest · authz · chain · confidential · workflow · sdk
services/   catalog · payments · identity · execution
contracts/  the confidential vault
docs/       PRD · ARCHITECTURE · PROJECT_STRUCTURE · adr/
```

The dependency rule, enforced in CI: `apps` → `services` → `packages` → `shared`.
A package never imports from an app.

---

## Running it

Requires [Bun](https://bun.sh).

```bash
bun install
cp .env.example .env     # DEMO_MODE=true needs no funded account
bun run dev              # dashboard on http://localhost:5173
```

Every variable is documented in [`.env.example`](./.env.example). Config is
schema-validated at boot: an invalid value is a startup failure, never a silent
default.

```bash
bun run typecheck
bun run lint
bun test
```

---

## Build status

Under active development. Milestones are tracked in [PRD §11](./docs/PRD.md#11-release-scope).

| Milestone | Scope | State |
|---|---|---|
| M1 | Confidential core — vault, branchless auth, fail-closed gateway | In progress |
| M2 | Metered capability — manifest, catalog, x402, MCP tools | Planned |
| M3 | Workflows — graph engine, node kinds, validation | Planned |
| M4 | Operator surface — dashboard wired to live endpoints | Frontend built |
| M5 | Hardening — batching, metering, observability, deployment | Planned |

---

## License

MIT
