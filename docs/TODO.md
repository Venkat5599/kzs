# Kairos — what is left

**Updated:** 2026-08-05 · **Repo:** https://github.com/Venkat5599/kzs

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
- [x] `apps/mcp-server` — Kairos tools over MCP, plus the remote connector
- [x] ERC-5564 stealth addresses through the contracts, gateway and MCP
- [x] `prove:stealth-payout` run live on Sepolia — the payout lands
- [x] `apps/frontend/vercel.json` — `NEXT_PUBLIC_GATEWAY_URL` set explicitly
- [x] Seed button relabelled "Load sample catalogue"; sample rows marked as samples
- [x] `feedback.md` — the iExec Nox tooling write-up
- [x] `bun run typecheck` green in all six workspaces — `contracts` had no
      `tsconfig.json` in the compile program and 70 errors
- [x] `bun run lint` green in `contracts` — `.prettierrc` was missing, so the
      solidity plugin never loaded and all 10 contracts failed to parse
- [x] `apps/frontend/eslint.config.mjs` — ESLint 9 flat config; the `lint`
      script had no config at all and could not run
- [x] `contracts/script/verify.ts` + `verify:sepolia` — Etherscan verification,
      wired but unrun (needs `ETHERSCAN_API_KEY`)
- [x] x402 quote-then-pay — `POST /x402/skills/:slug`, quote remembered so a
      stealth payee stays stable across the two legs

---

## What is left

Ordered by what a judge would notice. Verified 2026-08-05: `bun run typecheck` is
green in all six workspaces, `bun run build` green, `bun run test` is 48/48 unit
plus 13/13 contract.

### 1. Demo video — the only submission blocker
- [ ] Record: landing page → vault showing real decrypted balance → settle under
      the limit → settle over it and show it refused → publish batch → the
      Etherscan transaction where the over-limit settle *succeeded*
- The recording currently on disk ran against a stub gateway and cannot be
  submitted under the no-mock-data criterion. Re-record against the live gateway.

### 2. Yours, not code — needs a key this environment does not hold
- [ ] **Rotate the deployer key** — it is in a chat transcript
- [ ] Run the verification: `ETHERSCAN_API_KEY=… bun run --cwd contracts verify:sepolia`.
      The script exists now; it has never been run, because no key is present here
- [ ] Re-read the limitations sections; they must still be true

### 3. Known, and deliberately not fixed
- [ ] `bun run lint` fails in `apps/frontend`: 13 errors, all from the
      React-Compiler `react-hooks/*` rules that ship with Next 16's config
      (`set-state-in-effect` ×8, `refs` ×3, `purity` ×1, plus one more). They are
      the fetch-on-mount and hydrate-from-localStorage patterns across the
      dashboard. Clearing them honestly means moving that data layer onto
      `useQuery` — react-query is already installed and a provider exists in
      `lib/wallet.tsx:186` — or `useSyncExternalStore` for the localStorage
      reads. Converting the async bodies to `.then` chains silences the rule but
      makes the code materially harder to read, which is not a trade worth making
      before the demo is recorded.

### 4. Nice to have, not needed to submit
- [ ] `packages/{chain,authz,manifest,workflow,sdk}` — only `shared` and
      `confidential` exist
- [ ] `services/*` — the gateway catalogue is in-process and resets on restart,
      and so are outstanding x402 quotes

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
