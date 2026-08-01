/**
 * Kairos — landing page copy.
 *
 * Rule for everything in this file: no claim that is not already true and
 * checkable. The addresses and endpoints below are the live ones, and the
 * limitations are stated in the same voice as the features.
 */

export const siteConfig = {
  name: "Kairos",
  tagline: "Confidential spending limits for AI agents",
  description:
    "Give an AI agent a budget it cannot exceed, without publishing the budget. Caps, balances and settlement amounts stay encrypted inside iExec Nox and are compared in a TEE. x402 and MCP are left exactly as they are.",
  url: "https://kairos.dev",
  twitter: "@kairos",
  repo: "https://github.com/Venkat5599/kairos",
  gateway: "https://agentfabric-api.187.127.137.136.sslip.io",
  vault: "0xe417e9e36291a2d74121db0d3ce013854f5123cc",
  vaultExplorer:
    "https://sepolia.etherscan.io/address/0xe417e9e36291a2d74121db0d3ce013854f5123cc",
  nav: {
    cta: { text: "Open dashboard", href: "/dashboard" },
  },
};

export const heroConfig = {
  /* Two lines. A display line that wraps to three or four is a staircase, not
     a composition. */
  headline: ["A budget your agent", "cannot exceed or reveal"],
  subheadline:
    "Enforce an agent's spending cap on-chain while the cap, the balance and every settlement amount stay encrypted. The comparison happens inside the TEE; the chain only ever stores handles.",
  primary: { text: "Open dashboard", href: "/dashboard" },
  secondary: { text: "Verify it yourself", href: "#verify" },
};

export const techStackConfig = {
  /* "Built on", never "used by" — these are dependencies, not customers. */
  title: "Built on",
  items: [
    { name: "iExec Nox", description: "Confidential compute in a TEE" },
    { name: "Ethereum Sepolia", description: "Settlement and session keys" },
    { name: "x402", description: "HTTP 402 metering per call" },
    { name: "MCP", description: "Agent tool discovery" },
    { name: "Safe", description: "Spends from an unmodified Safe" },
  ],
};

/** One row of a settlement ledger: field, value, and what it gives away. */
export type LedgerRow = readonly [field: string, value: string, note: string];

/** The problem, shown rather than asserted. Both columns are real log shapes. */
export const leakConfig: {
  statement: string;
  body: string;
  plain: { label: string; caption: string; rows: LedgerRow[] };
  sealed: { label: string; caption: string; rows: LedgerRow[] };
} = {
  /* Two lines at display size. A headline that wraps to four is a staircase
     of short rows, not a composition. */
  statement: "Every metered call leaves an operational diary.",
  body: "Run a fleet of agents against metered APIs over x402 and the chain records it all in the open. Which agent is active, how often, against which vendor, for how much, and how much of its allowance is left. Anyone can read it. For a company that is a competitive leak before it is a privacy problem. The naive fix — don't enforce the budget on-chain — is worse: then the cap is a suggestion, and one compromised prompt drains the treasury.",
  plain: {
    label: "Plain x402 settlement",
    caption: "Every field is public, and permanently linkable.",
    rows: [
      ["from", "0x91c4…7a20", "which agent"],
      ["to", "0x5ef0…13bb", "which vendor"],
      ["value", "1500 wei", "what it cost"],
      ["block", "8421907", "exactly when"],
    ],
  },
  sealed: {
    label: "The same settlement on Kairos",
    caption: "One event. No addresses, no amount, only the epoch.",
    rows: [
      ["event", "PrivateSettlement", "that one occurred"],
      ["epoch", "4", "which batch it joined"],
      ["amount", "sealed", "never emitted"],
      ["agent", "sealed", "never emitted"],
    ],
  },
};

/**
 * Source: README, "What is hidden, and what is not". Being precise about this
 * matters more than the feature list, so it is reproduced rather than softened.
 */
export const disclosureConfig = {
  title: "What is hidden, and what is not",
  lede: "Being precise about this matters more than any feature list.",
  sealed: {
    label: "Encrypted",
    note: "Handles on-chain, decryptable only by permitted accounts.",
    items: [
      "The treasury budget and what remains of it",
      "Each agent's per-call spending cap",
      "Each agent's cumulative spend",
      "The amount of any individual settlement",
      "Whether a settlement was authorized or rejected",
    ],
  },
  open: {
    label: "Public",
    note: "Visible to anyone reading the chain.",
    items: [
      "That a settlement occurred, and in which epoch",
      "How many settlements a batch contained",
      "The relayer address that submitted the transaction",
      "The aggregate total of a closed epoch, once flushed",
      "The vault's existence and its owner",
    ],
  },
  limitation: {
    label: "Known limitation, stated plainly",
    body: "msg.sender is inherently public. Kairos routes every settlement through one gateway relayer, so on-chain all settlements share a sender and per-agent activity is not distinguishable — but the relayer itself is visible, and it learns what it relays.",
  },
};

/** The four movements of a payment. Deliberately not a numbered list on a rail. */
export const pathConfig = {
  title: "How a payment moves",
  lede: "Individual debits never move funds on their own. That is what breaks the one-transaction-per-API-call trail.",
  steps: [
    {
      key: "settle",
      title: "Settle",
      body: "The agent submits an encrypted amount. Two encrypted comparisons run inside the TEE: within cap, and within budget.",
      detail: "amount ≤ cap · budget ≥ amount",
    },
    {
      key: "authorize",
      title: "Authorize",
      body: "An encrypted boolean cannot gate a require — reverting would leak the comparison. The contract debits the amount or debits zero, then publishes the outcome as an encrypted flag.",
      detail: "Nox.select(ok, amount, 0)",
    },
    {
      key: "accumulate",
      title: "Accumulate",
      body: "The debit joins an encrypted epoch total instead of moving money, so no single transaction corresponds to a single API call.",
      detail: "epochTotal += debited",
    },
    {
      key: "flush",
      title: "Flush",
      body: "The owner closes the epoch. One aggregate is released for public decryption and leaves the Safe as a single transfer covering every payment in the batch.",
      detail: "one number, N payments",
    },
  ],
};

/** Real commands against the live gateway, with their real response shapes. */
export const verifyConfig = {
  title: "Verify it yourself",
  lede: "Every claim on this page is checkable from a terminal right now. Nothing here is a mock.",
  checks: [
    {
      label: "The gateway is on the real chain",
      command: "curl -s $GATEWAY/chain/status",
      output: `{ "configured": true,
  "demoMode": false,
  "network": "testnet",
  "chainId": 11155111 }`,
    },
    {
      label: "The vault is live, with its relayer and epoch",
      command: "curl -s $GATEWAY/nox/status",
      output: `{ "configured": true,
  "vaultAddress": "0xe417e9e3…5123cc",
  "relayer": "0xEEfbC8d6…Ba4eBa",
  "network": 11155111,
  "epoch": 1 }`,
    },
    {
      label: "A closed epoch reveals one aggregate, never a payment",
      command: "curl -s $GATEWAY/nox/epoch/0",
      output: `{ "epoch": 0,
  "closed": true,
  "totalWei": "38500",
  "count": 7 }`,
    },
  ],
  footnote:
    "count is how many settlements the batch absorbed. totalWei covers all of them, and cannot be decomposed back into the payments that produced it.",
};

export const footerConfig = {
  columns: [
    {
      heading: "Product",
      links: [
        { label: "Dashboard", href: "/dashboard" },
        { label: "Confidential vault", href: "/dashboard" },
        { label: "Workflows", href: "/dashboard/workflows" },
        { label: "MCP servers", href: "/dashboard/mcp" },
      ],
    },
    {
      heading: "Build",
      links: [
        { label: "Publish a SKILL.md", href: "/dashboard/create" },
        { label: "Session keys", href: "/dashboard/session-keys" },
        { label: "Marketplace", href: "/dashboard/marketplace" },
      ],
    },
    {
      heading: "Source",
      links: [
        { label: "GitHub", href: "https://github.com/Venkat5599/kairos" },
        { label: "Vault contract", href: siteConfig.vaultExplorer },
        { label: "iExec Nox", href: "https://docs.iex.ec/nox-protocol" },
      ],
    },
  ],
  colophon: `Ethereum Sepolia · chain 11155111 · MIT · ${new Date().getFullYear()}`,
};

export const features = {
  smoothScroll: true,
};
