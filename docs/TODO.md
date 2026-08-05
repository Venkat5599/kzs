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
- [x] Frontend lint 100% clean — the last 4 warnings cleared with `useCallback`
      (the fetch-on-mount effects in the apis/mcp/workflows sections) and a
      named eslint config export
- [x] Fixed the dashboard hydration mismatch — `gatewayUrl` rendered the
      absolute URL server-side but `/gw` client-side, so every dashboard load
      threw a recoverable error. Split into `gatewayUrl` (absolute, for display
      and copied commands) and `apiBase` (the same-origin `/gw` proxy, for
      fetches)
- [x] Fixed the `/dashboard/apis/[slug]` crash — the page read
      `skill.manifest.*` but the gateway serves flat fields; it now renders
      the real shape and the x402 invoke flow works
- [x] Fixed duplicate React keys across APIs / Workflows / MCP / Marketplace —
      the catalogue is slug-keyed (samples carry no id); keys now fall back to
      the slug, and the `id` fields are typed optional
- [x] Normalized gateway rows to the shapes the UI renders: API samples show
      their real `priceWei`/`egress` (no more "pay undefined ETH"), MCP servers
      show `name`/no bogus "Invalid Date", workflows derive steps/tags from the
      graph (no more "0 steps")
- [x] `NEXT_PUBLIC_FABRIC_MCP_URL` now defaults to the gateway origin instead
      of `localhost:8403`, so the MCP connect URL is real on every deploy
- [x] `docs/DEMO_SCRIPT.md` — full 10/10 recording script (shots, narration,
      exact addresses, production notes)

---

## What is left

Ordered by what a judge would notice. Verified 2026-08-05: `bun run typecheck` is
green in all six workspaces, `bun run build` green, `bun run test` is 48/48 unit
plus 13/13 contract.

### 1. Demo video — the only submission blocker
- [ ] Record the demo following `docs/DEMO_SCRIPT.md` (script is done; the
      recording is the remaining step): landing page → vault showing real
      decrypted balance → settle under the limit → settle over it and show it
      refused → publish batch → the Etherscan transaction where the over-limit
      settle *succeeded*
- The recording currently on disk ran against a stub gateway and cannot be
  submitted under the no-mock-data criterion. Re-record against the live
  gateway.

### 2. Yours, not code — needs a key this environment does not hold
- [ ] **Rotate the deployer key** — it is in a chat transcript
- [x] **Etherscan verification run (2026-08-05)** — 7/8 contracts verified:
      KairosVault, KairosSettlementRouter, CapPolicy, VelocityPolicy,
      AllowlistPolicy, CompositePolicy, StealthAnnouncer. All source-published;
      every claim in the README is now checkable. The deploy-time values were
      read from the chain, not guessed: vault relayer
      `0xBfc9521F81C58388374DDd553bE4818ED5de0690`, `flushThreshold` = 3 (the
      script's default of 25 would have failed the vault).
- [ ] **KairosRingRegistry verification is unrecoverable from this repo.** The
      deployed bytecode is byte-identical to the repo's compile except for the
      embedded solc metadata hash (proven: 9785 identical bytes, only the
      metadata differs) — the deploy-time compiler input differed in a
      non-code way (an uncommitted node_modules/toolchain resolution state;
      the deps are caret-ranged: `hardhat ^3.2.0`, `hardhat-toolbox-viem
      ^5.0.3`, `@iexec-nox/handle ^0.1.0-beta`). Fix options for the owner:
      (a) verify from the machine that ran `deploy:ring` (its build-info holds
      the exact input), or (b) redeploy the registry from current source —
      it takes no constructor args — and verify the new address.
- [ ] Re-read the limitations sections; they must still be true

### 3. Known, and deliberately not fixed
- [x] ~~`bun run lint` fails in `apps/frontend`: 13 errors, all from the
      React-Compiler `react-hooks/*` rules~~ — cleared. The remaining 4
      warnings were fixed with `useCallback` (the honest fix; no `.then`
      chains that would silence the rule by making the code unreadable).
      `bun run lint` is now 0 errors, 0 warnings in every workspace.

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
