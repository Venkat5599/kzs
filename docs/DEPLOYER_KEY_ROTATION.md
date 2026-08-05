# Rotating the deployer key — playbook

**Status: prepared 2026-08-05. Not executed — needs the owner's go-ahead and a
new key with a little Sepolia ETH for gas.**

## Why "rotate" is really "redeploy"

The vault, router and policies use `address public immutable owner` — set at
construction, **no `transferOwnership` exists**. The leaked key
(`0xBfc9521F81C58388374DDd553bE4818ED5de0690`, confirmed as the deployer via
the registry's creation tx and as the vault's `relayer()`) is the permanent
owner of:

- KairosVault `0x1b5919e3…` (fund, registerAgent, flushEpoch, setRelayer,
  setPolicy — the whole control surface)
- KairosSettlementRouter `0xec0ec50c…` (route/sweep)
- CapPolicy / VelocityPolicy / AllowlistPolicy / CompositePolicy
  (`0xa3917c56…`, `0x484e3d68…`, `0x4a8c6310…`, `0x1de0cde8…`)

Anyone holding the leaked key can flush epochs, swap the policy, change the
relayer and (given the relayer role) relay settlements. You cannot change the
owner address of these contracts. The only correct fix is a fresh ring owned
by a fresh key.

KairosRingRegistry and StealthAnnouncer have no owner — the registry deploys
rings (each new ring's vault owner is its deployer), the announcer is
append-only. They do not need rotating; they can be re-deployed as part of the
new ring and the old addresses retired.

## Phase 0 — new key

```bash
cast wallet new   # keep the mnemonic; the address is the new owner
export NEW_OWNER=0x…                       # the new address
export NEW_RELAYER_PRIVATE_KEY=0x…         # the new key (owner == relayer, as before)
export NEW_RELAYER=$(cast wallet address --private-key $NEW_RELAYER_PRIVATE_KEY)
# fund $NEW_RELAYER with ~0.05 Sepolia ETH (faucet: sepoliafaucet.com / Alchemy)
```

## Phase 1 — deploy the new ring

```bash
cd contracts
RELAYER_ADDRESS=$NEW_RELAYER \
FLUSH_THRESHOLD=3 \
UNISWAP_V3_ROUTER=0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E \
DEPLOYER_PRIVATE_KEY=$NEW_RELAYER_PRIVATE_KEY \
bun run deploy:ring
```

This deploys the vault, the four policies and the settlement router, and
registers the ring in the registry. Record every new address.

## Phase 2 — fund and configure the new vault

- `POST /nox/fund` (or `cast send $VAULT fund …` via the gateway) with a small
  amount — a few thousand wei is plenty for the demo.
- Register the demo agent (`0xBfc9521F…` can be re-registered as an agent of
  the NEW vault; the address being publicly known as the old owner is fine —
  it no longer controls anything).
- Set the per-call cap (10K wei, matching the current demo).

## Phase 3 — point the gateway at the new ring (VPS)

SSH to the VPS (`ssh root@187.127.137.136`), edit the gateway env:

```
VAULT_ADDRESS=<new vault>
SETTLEMENT_ROUTER_ADDRESS=<new router>
CAP_POLICY_ADDRESS=<new cap>
VELOCITY_POLICY_ADDRESS=<new velocity>
ALLOWLIST_POLICY_ADDRESS=<new allowlist>
COMPOSITE_POLICY_ADDRESS=<new composite>
RING_REGISTRY_ADDRESS=<new registry>
RELAYER_PRIVATE_KEY=$NEW_RELAYER_PRIVATE_KEY
```

Restart the gateway, then check `/chain/status` and `/nox/status` report the
new addresses and a readable budget.

## Phase 4 — update the app + docs

- `apps/frontend/lib/config.ts` — the new vault/router constants
- `.env.example` — the deployed-address block
- `README.md` — the address tables and the stealth-payout proof links
- `docs/TODO.md` — mark this item done, record the new addresses
- Redeploy Vercel (`bun run deploy:vercel`) so the site shows the new vault

## Phase 5 — verify the new ring (this also fixes the registry gap)

```bash
ETHERSCAN_API_KEY=… FLUSH_THRESHOLD=3 RELAYER_ADDRESS=$NEW_RELAYER \
bun run --cwd contracts verify:sepolia
```

Deploying from current source makes every contract verifiable — including
KairosRingRegistry, whose old bytecode carries a deploy-time metadata hash the
repo cannot reproduce (see docs/TODO.md item 2).

Then re-run the demo flow (settle under / over the cap) against the new ring.

## Phase 6 — retire the old ring

- The old vault may still hold a small balance. Draining it requires the old
  key: `cast send <old vault> flushEpoch` + sweep, or simply abandon it — it
  is Sepolia testnet dust. The README should mark the old addresses as retired
  and compromised.
- Delete the leaked key from the chat transcript (the reason this exists).
- The old `0xBfc9521F…` address must never be used as a key again — treat it
  as burned.

## Verification checklist (owner)

- [ ] New ring deployed; addresses recorded in README + .env.example
- [ ] Gateway env updated + restarted; `/nox/status` readable
- [ ] Frontend redeployed; vault page shows the new contract
- [ ] 8/8 contracts Etherscan-verified
- [ ] Demo flow (under/over cap) works against the new ring
- [ ] Leaked key deleted from the transcript; old addresses marked retired
