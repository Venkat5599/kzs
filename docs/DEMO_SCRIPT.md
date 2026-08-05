# Kairos — demo video script (10/10)

**Runtime target:** 2:30–3:00 · **Record:** wf-recorder on
`http://localhost:5173` — a production build of the fixed frontend served
locally, pointing at the live gateway. This is NOT a stub: the gateway
(`https://kairos-api.187.127.137.136.sslip.io`) is real mode
(`/chain/status` reports `demoMode:false`, Sepolia) and the frontend proxies
it, so every number on screen is live. The deployed site
`kairos-nox.vercel.app` will show the identical UI once the
`fix/frontend-robustness` branch is merged — the only difference is the URL
in the address bar.
Every number shown below is read from the live gateway/chain on the
day of recording — if a figure differs when you record, narrate the real one.

**Hard rule (no-mock-data):** anything on screen must come from the live
gateway or Etherscan. If a step's numbers changed, say the real numbers.

---

## The one-sentence pitch (record this as the first line of narration)

"Kairos is a spending budget that lives on-chain, stays encrypted, and can
never be read — or raised — by the agent it governs."

---

## Shot list

### 1 · Landing — the thesis (0:00–0:30)
- Open `http://localhost:5173`. Slow scroll from hero to "The leak" section.
- Pause on the two-column comparison ("A settlement in the open" vs "The same
  settlement on Kairos") — this is the whole pitch in one frame.
- Narration: "Public rails publish an operational diary — who paid, how much,
  how often. Kairos publishes one event per batch: no address, no amount, only
  the epoch. The budget, the balance and every individual payment stay
  encrypted inside an iExec Nox TEE. The settlement still goes through
  Uniswap's own V3 router — unmodified."
- Click **Open dashboard** (top right).

### 2 · Confidential vault — the money is real (0:30–1:00)
- On the dashboard sidebar click **Confidential vault**.
- Let the page settle. Point at the "Money available" card — it shows a real
  decrypted balance (e.g. 1.9M wei) that only this dashboard can read.
- Point at "Spent in this batch" and "4 payments grouped together so far".
- Narration: "This is the live vault on Sepolia. The balance is encrypted on
  chain — it reads as a Nox handle to anyone else — and the gateway decrypts
  it only for the owner. Note every payment goes through one shared sender,
  `0xBfc9521F…`, so nobody can tell the agents apart."
- Scroll to "Make a payment". Do NOT hover over the cap-policy board yet.

### 3 · Settle under the limit — it moves (1:00–1:30)
- In **Make a payment**: agent = the vault's agent address
  `0xBfc9521F81C58388374DDd553bE4818ED5de0690`, amount = `5000`, click
  **Settle**. (Under the 10K wei per-call cap → authorized.)
- Wait for the success state (the gateway relays the real transaction).
- Narration: "A payment under the cap. The amount is checked inside secure
  hardware against the agent's encrypted limit — the chain never sees the
  comparison. The transaction succeeds."

### 4 · Settle over the limit — it refuses, silently (1:30–2:00)
- Same agent, amount = `40000` (over the 10K cap), click **Settle**.
- The UI shows the refusal state (the gateway returns HTTP 402 → the budget
  did its job). Keep the vault page on screen.
- Narration: "Now over the limit. Refused — and this is the part that makes
  the privacy model work: the refusal is *indistinguishable from an approval*
  on chain. The transaction still succeeds; only the encrypted flag differs.
  An observer watching the chain cannot tell the two apart."
- Scroll up and click **Publish batch** (owner action, flushes the epoch).

### 5 · Publish the batch — one number for N payments (2:00–2:25)
- After publish, the "Batch settlement" panel shows the released aggregate.
- Narration: "Every payment in this batch just collapsed into one public
  number — the aggregate of the epoch. Individual amounts stay encrypted and
  cannot be decomposed back out of it. That one number is what reaches
  Uniswap."

### 6 · The Etherscan receipt — the money actually landed (2:25–2:50)
- Open the settlement transaction on Sepolia Etherscan (from the published
  batch / the gateway response; the vault is
  `0x1b5919e3ec31daaa88a69ca4bf27aa83dbed57f8`).
- Show: it went through `KairosSettlementRouter` → `SwapRouter02`
  (`0x3bFA4769…`) — Uniswap's own deployment — and the `Settled` event has
  only the epoch, no amount.
- Narration: "Here is the receipt. The swap ran through Uniswap's own
  deployed router, over its existing ABI. And the event carries one field: the
  epoch. Not who, not how much. That's the whole system in one transaction."

### 7 · Close (2:50–3:00)
- Back to the landing hero.
- Narration: "A budget your agent cannot exceed — and cannot reveal. Kairos.
  Private budgets, public settlement. Live on Sepolia today."

---

## Production notes
- Record at 1920×1080; slow, deliberate scrolls (Lenis smooth-scroll is on).
- Cursor polish matters: no idle hovering, no rapid mouse circles.
- Keep the sidebar visible during dashboard shots — it's the navigation
  context judges need.
- **Do not** show: the Marketplace sample catalogue as if real (it is marked
  as samples), the MCP page, or anything with "Invalid Date"/"undefined".
- If the batch was already flushed or the balance changed between shots,
  re-read the live numbers and narrate what is actually on screen.
- Etherscan page loads can be slow — pre-open the tx in a tab before
  recording that shot, and cut the loading gap in Recordly.
- The over-limit refusal is the single most important beat. Never cut it.

## Setup checklist before recording
- [ ] The local production server is running (it is — served from
      `/home/arch/kzs/apps/frontend`; if it ever stops, restart with
      `cd /home/arch/kzs/apps/frontend && NEXT_PUBLIC_GATEWAY_URL=https://kairos-api.187.127.137.136.sslip.io bun run start -p 5173`)
- [ ] Live site loads, wallet-free browsing works (it does — no connect needed
      for the vault read path)
- [ ] `/chain/status` on the gateway reports `demoMode:false`
- [ ] The vault has a funded, registered agent with a cap (currently
      `0xBfc9521F81C58388374DDd553bE4818ED5de0690`, cap 10K wei — confirm it
      still has headroom or pick the amount under the current cap)
- [ ] Sepolia Etherscan tx page for the settle pre-loaded
- [ ] wf-recorder recording window sized to the browser only
