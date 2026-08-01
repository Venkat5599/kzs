# Kairos — what is left

**Updated:** 2026-08-01 · **Repo:** https://github.com/Venkat5599/kzs

Ordered so the repo builds and every item is independently verifiable. Companion
to [`Plans/wise-booping-token.md`](../Plans/wise-booping-token.md) — that file has
the reasoning, this one is the checklist.

---

## Done

- [x] PRD, Architecture, Project structure, 6 ADRs
- [x] Monorepo restructure; app at `apps/frontend`
- [x] `KairosVault` — branchless auth on native Nox primitives
- [x] `KairosSettlementRouter` — unmodified Uniswap V3
- [x] Router test suite — 13 passing
- [x] `packages/shared` — verdict rule, errors, branded types — 12 passing
- [x] **Deployed to Sepolia**, addresses recorded in README
- [x] README reframed around the confidentiality thesis

---

## 1. Prove the vault against live Nox — do this first

Nothing else changes the score as much. The vault is deployed and its
constructor made real Nox calls, but **no settlement has ever executed**.

- [ ] Script a full cycle: `fund` → `registerAgent` → `settle` → `flushEpoch` → `proveEpochAggregate`
- [ ] Encrypt inputs with the Nox JS SDK (`encryptInput`) and pass the proof to `fromExternal`
- [ ] Assert an **under-cap** settle authorizes and debits
- [ ] Assert an **over-cap** settle debits zero **and does not revert** — the core claim
- [ ] Assert a **revoked** agent is refused
- [ ] Confirm no `Settled` event carries an address or amount
- [ ] Record tx hashes in the README so the claims are checkable by a third party

Risk: the `withinCap AND funded` conjunction reads correct but has never run.
If anything is wrong in the contract, it surfaces here.

## 2. Reframe the frontend copy

All landing copy lives in one file — `apps/frontend/lib/config.ts`.

- [ ] Lead with the DeFi composability story, not agent safety
- [ ] Add the live contract addresses with Etherscan links
- [ ] Say plainly that Uniswap is used unmodified
- [ ] Update `siteConfig.vault` / `vaultExplorer` to the new vault address
- [ ] Keep the "what is hidden vs public" section — it is the strongest part

## 3. `packages/confidential`

Where fail-closed stops being a doc and becomes code.

- [ ] Nox JS SDK client: `encryptInput`, `decrypt`, `viewACL`
- [ ] `settle()` wrapper returning a `Verdict`, routed through `verdictFromDecryption`
- [ ] Tests: authorized · refused · decrypt throws · returns null · times out
- [ ] Every failure path must produce `unreadable`, never `refused`

## 4. Remaining packages

- [ ] `packages/chain` — RPC status, chainId, explorer links, single-source `demoMode`
- [ ] `packages/authz` — scoped session keys; tests for expired, revoked, wrong scope
- [ ] `packages/manifest` — parse + validate, typed rejection on malformed input
- [ ] `packages/workflow` — graph engine on the single scheduling rule; publish-time
      validation (cycles, dangling edges, duplicate ids, missing entry); bounded execution
- [ ] `packages/sdk` — typed gateway client shared by frontend and MCP server

## 5. `apps/gateway`

- [ ] Schema-validated config; refuse to boot on invalid input
- [ ] `/chain/status` reporting `demoMode` explicitly
- [ ] x402: unpaid → `402` + quote; proof → execute; over-cap → `402`
- [ ] **Fail-closed enforced here**, with a test that cannot be skipped
- [ ] Egress restricted to each manifest's declared allowlist
- [ ] Vault routes: fund, register, revoke, settle, epoch, flush
- [ ] Structured logging with request ids — never a key, handle value, or decrypted amount

## 6. `apps/mcp-server` and `services/*`

- [ ] Skills exposed as MCP tools over stdio
- [ ] `services/catalog` · `payments` · `identity` · `execution`

## 7. Wire the dashboard

- [ ] Point `apps/frontend/lib/api.ts` at the real gateway
- [ ] Kill the 6 `ERR_CONNECTION_REFUSED` currently on `/dashboard`
- [ ] Verify in a real browser: zero console errors, 1440px and 375px

## 8. Deploy

- [ ] Gateway to the VPS behind TLS — **needs host credentials**
- [ ] Frontend to the VPS
- [ ] Health checks; confirm the dashboard reads live chain state
- [ ] CI green end to end

## 9. Before submitting

- [ ] Flip the README build-status table to what is actually true
- [ ] Verify contracts on Etherscan so the source is readable
- [ ] Re-read the limitations sections — they must still be accurate
- [ ] **Rotate the deployer key**

---

## Blockers

| Blocker | Needed from |
|---|---|
| VPS host, user, auth method | You |
| Etherscan API key (for source verification) | You — optional but worth it |

Sepolia deployer key: supplied, funded, **already used**. Rotate after the event —
it exists in a chat transcript.

---

## Notes for whoever picks this up

- `bun` only, never `npm`/`npx`.
- Tests split: `bun run test:unit` (bun runner) and `bun run test:contracts` (hardhat).
  Root `bun test` alone will try to run the hardhat suite under bun and fail.
- `KairosVault` **cannot deploy on a bare local chain** — its constructor calls
  NoxCompute, which only exists on Sepolia (11155111) and Arbitrum Sepolia (421614).
  Vault tests need a fork or the live testnet. The router has no Nox dependency
  and tests offline.
- Nox exposes **no boolean operators on `ebool`**. Conjunctions are composed
  arithmetically. Do not go looking for `Nox.and`.
- `safeSub` / `safeAdd` return `(ebool, euint256)` — the flag is the point.
