# Kairos — full-feature demo video script (all screens)

**Runtime:** no fixed limit — show every feature, take as long as each
screen needs. **Record:** wf-recorder on `http://localhost:5173`
(production build, live gateway — `demoMode:false`, Sepolia). Every number
on screen is real; narrate whatever is actually there on the day. If a
shot depends on the VPS gateway redeploy, it is marked **[needs gateway
redeploy]** — skip it and cut to the next shot until then.

**Hard rule (no-mock-data):** never present the Marketplace samples or any
sample row as real catalogue business. They are labeled samples — say so.

---

## One-sentence pitch (first line of narration)

"Kairos is a spending budget that lives on-chain, stays encrypted, and can
never be read — or raised — by the agent it governs. This is everything on
the dashboard, top to bottom."

---

## Shot list

### 1 · Landing — the thesis (0:00–0:40)
- Open `http://localhost:5173`. Slow scroll: hero → "The leak" two-column
  comparison → feature bands → limitations → footer.
- Pause on "A settlement in the open" vs "The same settlement on Kairos".
- Narration: "Public rails publish who paid, how much, how often. Kairos
  publishes one event per batch — no address, no amount. The budget and
  every payment stay encrypted inside an iExec Nox TEE, and the settlement
  still goes through Uniswap's own V3 router, unmodified. Honest about its
  limits: single relayer, timing correlation, gateway trust — all stated
  on the page."
- Click **Open dashboard**.

### 2 · Dashboard home — the live system at a glance (0:40–1:10)
- Sidebar visible. Point at: Total APIs (5), Total Requests (real count,
  e.g. 9–11), Success Rate (deliberately null — the gateway cannot know
  whether a settlement was authorized, and it refuses to invent telemetry),
  Total Earnings (live wei).
- Scroll the request-activity list (recent calls from the live gateway).
- Narration: "Five payment-gated APIs, real request history, and one honest
  blank: the success rate. The system is built so it *cannot* tell you
  whether a payment was authorized — it would have to break its own
  confidentiality to do so."

### 3 · Confidential vault — the money is real (1:10–1:50)
- Click **Confidential vault**.
- "Money available" shows the real decrypted balance (e.g. 1.9M wei) —
  "only you can read this".
- "Spent in this batch" + payment count; "This agent has spent" + its 10K
  wei per-payment cap; every payment sends from one shared address
  `0xBfc9521F…`.
- Narration: "The vault on Sepolia. Balances are Nox handles on-chain — the
  gateway decrypts them only for the owner. All agents pay through one
  shared sender so nobody can tell them apart."
- Show the **Cap policy** board: Restricted 1K / Standard 10K / Trusted 100K
  tiers. (Optional beat: drag an agent chip into a tier — each drop sends a
  real tx. Skip the drag if you want to keep the recording tight.)

### 4 · Fund + register an agent (1:50–2:15)
- **Add money**: amount `1000000`, **Fund** → "The amount is scrambled in
  your browser before it is sent."
- **Give an agent a spending limit**: agent address + cap `10000`,
  **Register**.
- Narration: "Money in, and a cap set. Both are encrypted in the browser
  before the transaction — the chain only ever sees handles."

### 5 · Settle under the limit — it moves (2:15–2:45)
- **Make a payment**: agent prefilled (`0xBfc9521F81C58388374DDd553bE4818ED5de0690`),
  amount `5000`, **Settle** (under the 10K cap → authorized).
- Wait for the success card with its Etherscan link.
- Narration: "Under the cap: authorized. The comparison ran inside secure
  hardware against the encrypted limit — the chain never saw the numbers."

### 6 · Settle over the limit — refused, indistinguishably (2:45–3:15)
- Same agent, amount `40000`, **Settle**.
- Refusal card: "Rejected — over cap or budget. An observer cannot tell the
  two outcomes apart on-chain."
- Narration: "Over the cap: refused — and the transaction still succeeded
  on-chain, debiting zero. The refusal is indistinguishable from an
  approval to anyone watching. That is the privacy model, not a bug."

### 7 · Publish the batch — N payments become one number (3:15–3:35)
- Click **Publish batch** (owner action). Requires 3+ payments in the
  batch; the settle shots above provide them.
- Narration: "Every payment in this batch just collapsed into one public
  aggregate. Individual amounts stay encrypted and cannot be decomposed
  back out of it. That one number is what downstream DeFi can consume."

### 8 · Stealth payments — pay without a public history (3:35–4:10)
- Click **Stealth payments**.
- **Generate keys** → a fresh meta-address + spending/viewing keys appear,
  with the warning: "Save both private keys now. They are not stored here."
- Paste the meta-address into the pay form (agent = registered agent,
  amount = `5000`), **Send payment**.
- The receipt shows the payment + the stealth announcement.
- Narration: "This is the second half: a payout to a fixed address would
  build a public history of how much this operator is paid. A stealth
  address has never appeared on-chain, and only its recipient can link it
  to themselves. The gateway derives the key once, hands it to you, and
  never stores it."

### 9 · APIs — the payment-gated catalogue (4:10–4:30)
- Click **APIs**. The list shows the live catalogue with real per-call
  prices (e.g. 1500 wei / call — wei, not ETH) and methods.
- Open **Sample — Market data**. Detail page: price, input schema, and the
  curl example against `POST /s/sample-market-data`.
- **Invoke** → the gateway answers 402 with an x402 quote (price, network,
  nonce) — the "pay first" handshake. **[needs gateway redeploy]** — until
  then, show the quote page only; the Pay & Run step needs the new route.
- Narration: "Every API is metered in wei and gated by x402: you ask the
  price, get a quote, pay in the same transaction, and the response comes
  back. An agent can navigate this catalogue without ever seeing a wallet."

### 10 · MCP Servers + Workflows — the agent surface (4:30–4:50)
- Click **MCP Servers**: the live servers and their connect URL on the
  gateway (`…/mcp`), the same endpoint agents connect to.
- Click **Workflows**: the flow graphs (trigger → condition → http /
  transform / on-chain nodes), step counts, and past runs.
- Narration: "The same catalogue speaks Model Context Protocol — agents
  connect over the gateway's MCP endpoint — and reusable workflows chain
  steps with real branch conditions, not mockups."

### 11 · Analytics + Marketplace + Create (4:50–5:15)
- Click **Analytics**: request volume over time, earnings, success surface.
- Click **Marketplace**: the sample catalogue — *say it out loud*: "These
  are samples the gateway seeds for you to try — not real business."
- Click **Create** (or **Create API**): the publish form (name, price,
  target URL, method) — show the fields, do not submit.
- Narration: "Publishing a new metered API is a form: name, per-call price,
  upstream target. The marketplace is seeded samples so you can try the
  flow immediately."

### 12 · The Etherscan receipt — it all landed (5:15–5:40)
- Open a settle transaction on Sepolia Etherscan (from the vault card or
  stealth receipt; vault `0x1b5919e3ec31daaa88a69ca4bf27aa83dbed57f8`).
- Show: `KairosSettlementRouter` → `SwapRouter02` (Uniswap's own
  deployment), and the `Settled` event carrying only the epoch.
- Narration: "Here's the receipt: the swap ran through Uniswap's deployed
  router over its existing ABI, and the event carries one field — the
  epoch. Not who, not how much."

### 13 · Close
- Back to the landing hero.
- Narration: "A budget your agent cannot exceed — and cannot reveal.
  Private budgets, public settlement. Live on Sepolia today."

---

## Production notes
- 1920×1080; slow deliberate scrolls; sidebar visible in all dashboard
  shots; no idle cursor hovering.
- **Never** present Marketplace samples as real revenue. The sample
  catalogue is labeled — keep the label in the frame.
- **[needs gateway redeploy]** shots: API Invoke paid flow, Workflow Run,
  and the "Batch not ready" flush message. Record them after the VPS
  gateway redeploy, or cut past them.
- Etherscan loads slowly — pre-open the tx in a tab, cut the gap in
  Recordly.
- Numbers shift constantly (settles land, epochs flush) — narrate what is
  on screen.

## Setup checklist before recording
- [ ] Server running: `cd /home/arch/kzs/apps/frontend && NEXT_PUBLIC_GATEWAY_URL=https://kairos-api.187.127.137.136.sslip.io bun run start -p 5173`
- [ ] `/chain/status` reports `demoMode:false`
- [ ] Vault funded; agent registered with a cap; batch has 3+ payments if
      the Publish shot is included (settle shots feed it)
- [ ] Stealth keys generated once before recording so the pay shot is one
      paste away
- [ ] Sepolia Etherscan settle tx pre-loaded in a tab
- [ ] wf-recorder window sized to the browser only
