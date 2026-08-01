# Kairos — Project Structure

**Status:** Draft v1.0
**Last updated:** 2026-08-01
**Companion documents:** [PRD](./PRD.md) · [Architecture](./ARCHITECTURE.md)

This document is the answer to "where does this code go?". It is normative — a
pull request that violates the dependency rule in §3 is wrong even if it works.

---

## 1. Top level

```
kairos/
├── apps/                  Deployable units. Each has an entry point and a lifecycle.
│   ├── web/               Next.js — marketing site + operator dashboard
│   ├── gateway/           HTTP API. The only process that holds keys.
│   └── mcp-server/        MCP stdio server — skills become agent tools
│
├── packages/              Libraries. No entry point, no side effects on import.
│   ├── shared/            Types, errors, result helpers. Depends on nothing.
│   ├── manifest/          Skill manifest parse + validate
│   ├── authz/             Scoped session keys: issue, verify, revoke
│   ├── chain/             Public-chain reads, transfers, explorer links
│   ├── confidential/      Vault client: encrypt, settle, decrypt
│   ├── workflow/          Graph engine, scheduler, node kinds
│   └── sdk/               Typed client for the gateway API
│
├── services/              Stateful concerns behind an interface.
│   ├── catalog/           Published skills and workflows
│   ├── payments/          Metering and usage records
│   ├── identity/          Agents, owners, permissions
│   └── execution/         Workflow run persistence and history
│
├── contracts/             Solidity. Independent of the TypeScript workspace.
│   ├── src/               The confidential vault contract
│   ├── test/              Contract tests, incl. over-cap and underflow paths
│   └── script/            Deployment and verification
│
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── PROJECT_STRUCTURE.md   ← this file
│   └── adr/               One file per architecture decision
│
├── .github/workflows/     CI
├── package.json           Workspace root
├── tsconfig.base.json     Shared compiler options
└── .env.example           Every variable, documented, no real values
```

---

## 2. What belongs in each tier

| Tier | Belongs here | Does **not** belong here |
|---|---|---|
| `apps/` | Wiring, routing, HTTP concerns, process lifecycle, config loading | Business logic worth testing in isolation |
| `packages/` | Pure logic, domain rules, clients, parsers, engines | HTTP handlers, framework imports, process exit |
| `services/` | Persistence and stateful coordination behind an interface | Transport concerns, request parsing |
| `contracts/` | On-chain logic and its tests | Anything importable by TypeScript except generated ABI/types |

**The test:** if you cannot unit-test it without starting a server, it is probably
in the wrong tier.

---

## 3. The dependency rule

```
apps  ──▶  services  ──▶  packages  ──▶  shared
                              │             ▲
                              └─────────────┘
```

Normative:

1. `apps/*` **may** import from `services/*`, `packages/*`, `shared`.
2. `services/*` **may** import from `packages/*`, `shared`.
3. `packages/*` **may** import from other `packages/*` and `shared`.
4. `packages/*` **must never** import from `apps/*` or `services/*`.
5. `shared` **must never** import from anything in the workspace.
6. Nothing imports from `contracts/` except generated ABI and types.

**No cycles between packages.** If two packages need each other, the shared piece
belongs in `shared` or in a third package.

CI enforces this. A violation fails the build.

---

## 4. Inside a package

```
packages/<name>/
├── src/
│   ├── index.ts        Public surface. The ONLY file other code imports from.
│   ├── <domain>.ts     Implementation, split by concept not by layer
│   ├── types.ts        Types this package owns
│   └── errors.ts       Errors this package raises
├── test/               Mirrors src/ one-to-one
├── package.json
├── tsconfig.json
└── README.md           What it is, in three sentences
```

Rules:

- **`index.ts` is the contract.** Importing a package's internal file from
  outside that package is forbidden. If you need it, export it.
- **Split by concept, not by layer.** `settlement.ts`, `epoch.ts`, `agent.ts` —
  not `models.ts`, `utils.ts`, `helpers.ts`.
- **No `utils.ts`.** It is a bin for code nobody named. Name the concept.
- **Every package has a README.** Three sentences is enough; zero is not.

---

## 5. Inside an app

```
apps/gateway/
├── src/
│   ├── index.ts         Boot: load config, build the app, listen
│   ├── config.ts        Schema-validated env. Refuses to boot on invalid input.
│   ├── routes/          One file per route group; thin
│   ├── middleware/      Auth, request id, error mapping
│   └── <concern>.ts     Wiring that is genuinely app-specific
├── test/
└── package.json
```

```
apps/web/
├── app/                 Next.js App Router. Route groups in (parentheses).
│   ├── (marketing)/     Public site
│   ├── dashboard/       Operator surfaces
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── <section>.tsx    Marketing sections, one file each
│   └── fabric/          Dashboard surfaces and their shared primitives
├── lib/                 Client config, API client, motion, wallet
├── public/
└── package.json
```

**Routes are thin.** A route handler parses input, calls into a package or
service, and maps the result to a response. Logic that lives in a route handler
cannot be tested without HTTP, which means it will not be tested.

---

## 6. Naming

| Thing | Convention | Example |
|---|---|---|
| Directories | kebab-case | `mcp-server`, `session-keys` |
| TypeScript files | kebab-case | `epoch-flush.ts` |
| React components | kebab-case file, PascalCase export | `nox-vault-section.tsx` → `NoxVaultSection` |
| Types and interfaces | PascalCase, no `I` prefix | `SettlementResult` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_NODE_EXECUTIONS` |
| Test files | mirror source, `.test.ts` | `src/epoch.ts` → `test/epoch.test.ts` |
| Solidity | PascalCase, one contract per file | `KairosVault.sol` |
| Env vars | SCREAMING_SNAKE_CASE, prefixed by domain | `GATEWAY_PORT`, `CHAIN_RPC_URL` |
| Public env (web) | must carry the framework's public prefix | `NEXT_PUBLIC_API_URL` |

---

## 7. Where a new feature goes

Follow the questions in order; the first "yes" is your answer.

1. **Is it on-chain logic?** → `contracts/src/`, with a test in `contracts/test/`.
2. **Is it a pure rule, parser, or engine?** → a `packages/*` package. New concept
   → new package. Extension of an existing concept → existing package.
3. **Does it own persisted state?** → a `services/*` service, behind an interface.
4. **Is it an HTTP endpoint?** → `apps/gateway/src/routes/`, thin, delegating down.
5. **Is it an agent-facing tool?** → `apps/mcp-server/`, wrapping the SDK.
6. **Is it a screen?** → `apps/web/app/`, with its section component in
   `apps/web/components/`.
7. **Is it a type or error more than one package needs?** → `packages/shared`.

If two answers apply, split the feature. A feature that cannot be split usually
means the tiers were drawn wrong.

---

## 8. Testing layout

| Test kind | Lives in | Runs against |
|---|---|---|
| Unit | `packages/*/test/`, `services/*/test/` | Pure functions, no network |
| Contract | `contracts/test/` | A local chain |
| Integration | `apps/gateway/test/` | A booted gateway, mocked vendors |
| End-to-end | `apps/web/test/e2e/` | A running stack in a real browser |

Two paths are **required** to have tests, permanently:

- The **fail-closed** decision — an unreadable authorization flag must refuse.
- The **branchless authorization** paths — over-cap and underflow.

These are the security argument. They do not ship untested.

---

## 9. Configuration

- Every variable appears in `.env.example` with a comment. No real values.
- Config is parsed by a schema at process start. An invalid value is a **boot
  failure**, never a silent default.
- Secrets exist only in `apps/gateway`. If a secret is needed anywhere else, the
  design is wrong.
- The demo-mode flag has exactly **one** source of truth and is surfaced
  identically to the API and the dashboard, so the UI cannot claim a real
  settlement while running against a stub.

---

## 10. Documentation duties

| When you | You must also |
|---|---|
| Add a package | Write its `README.md` and add a row to §1 of this file |
| Make a structural decision | Add an ADR in `docs/adr/` |
| Change a privacy boundary | Update the limitations sections in **both** the PRD and ARCHITECTURE |
| Add an env variable | Add it to `.env.example` with a comment |

Documentation that drifts from the code is worse than no documentation, because
it is believed.
