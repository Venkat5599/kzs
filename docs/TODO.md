# Kairos — what is left

**Updated:** 2026-08-01 · **Repo:** https://github.com/Venkat5599/kzs

Ordered so the repo builds and every item is independently verifiable. Companion
to [`Plans/wise-booping-token.md`](../Plans/wise-booping-token.md) — that file has
the reasoning, this one is the checklist.

---

## Live right now

| | |
|---|---|
| Demo | https://kairos-nox.vercel.app |
| Mirror (VPS) | https://kairos.187.127.137.136.sslip.io |
| Gateway API | https://kairos-api.187.127.137.136.sslip.io |
| Vault (Sepolia) | `0x1b5919e3ec31daaa88a69ca4bf27aa83dbed57f8` |

## Done

- [x] PRD, Architecture, Project structure, 6 ADRs
- [x] Monorepo restructure; app at `apps/frontend`
- [x] `KairosVault` — branchless auth on native Nox primitives
- [x] `KairosSettlementRouter` — unmodified Uniswap V3
- [x] Router test suite — 13 passing
- [x] `packages/shared` — verdict rule, errors, branded types — 12 passing
- [x] **Deployed to Sepolia**, addresses recorded in README
- [x] README reframed around the confidentiality thesis
- [x] Policy engine (cap · velocity · allowlist · composite) + ring registry
- [x] Replay nullifier; 5 bugs fixed, 2 of them privacy bugs
- [x] Whole chain proven live: settle, flush, real Uniswap V3 swap
- [x] `packages/confidential` — Nox client, fail-closed verdict
- [x] `apps/gateway` — live, serving decrypted vault state
- [x] Dashboard wired to the gateway; zero console errors
- [x] Deployed to Vercel and the VPS
- [x] Dashboard copy rewritten for a non-technical reader

---

## What is left

Ordered by what a judge would notice.

### 1. Demo video
- [ ] Record: landing page → vault showing real decrypted balance → settle under
      the limit → settle over it and show it refused → publish batch → the
      Etherscan transaction where the over-limit settle *succeeded*

### 2. Polish
- [ ] `bun run test` before submitting — 25 tests should still pass
- [ ] Re-read the limitations sections; they must still be true
- [ ] Verify contracts on Etherscan so the source is readable
- [ ] **Rotate the deployer key** — it is in a chat transcript

### 3. Nice to have, not needed to submit
- [ ] `packages/{chain,authz,manifest,workflow,sdk}`
- [ ] `apps/mcp-server` — skills as MCP tools
- [ ] `services/*` — the gateway catalogue is in-process and resets on restart
- [ ] x402 402-quote path in the gateway

---

## Deploy

Both procedures are in [`infra/DEPLOY.md`](../infra/DEPLOY.md).

- Vercel: `bun run deploy:vercel` — **not** `vercel --prod`, which leaves the
  alias pointing at the previous build without saying so.
- VPS: `ssh -i ~/.ssh/agent_fabric_vps root@187.127.137.136`. Build on the VPS,
  never locally — a Windows build emits symlinks tar will not carry and a
  win32 sharp binary Linux cannot load.

---

## Traps worth knowing

- `bun` only, never `npm`/`npx`.
- Tests split: `bun run test:unit` (bun) and `bun run test:contracts` (hardhat).
- `KairosVault` cannot deploy on a bare local chain — its constructor calls
  NoxCompute, which exists only on Sepolia and Arbitrum Sepolia.
- Nox has **no boolean operators on `ebool`**. Conjunctions are arithmetic.
- `safeSub`/`safeAdd` return `(ebool, euint256)` — the flag is the point.
- A policy is a separate contract and holds no ACL grant on a handle. Grant it
  transiently or every Nox op inside it reverts.
- `addViewer` reverts on trivially-encrypted handles from `toEuint256`.
- CORS: `origin: "*"` with `credentials: true` is invalid and fails every request.
