/**
 * Kairos — landing page copy.
 *
 * Rule for everything in this file: no claim that is not already true and
 * checkable. The addresses below are the live Sepolia deployment, and the
 * limitations are stated in the same voice as the features.
 *
 * The framing leads with what was actually built — a confidentiality layer over
 * public DeFi infrastructure — rather than with the agent use case. Agents are
 * the first tenant of the vault, not the product.
 */

const VAULT = "0x1b5919e3ec31daaa88a69ca4bf27aa83dbed57f8";
const ROUTER = "0xec0ec50c8ebffb89aed3072d7c4a74671b2e8d7f";
const UNISWAP_ROUTER = "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E";
const EXPLORER = "https://sepolia.etherscan.io/address";

export const siteConfig = {
  name: "Kairos",
  tagline: "A confidentiality layer for public DeFi",
  description:
    "Enforce a spending budget on-chain without publishing the budget, the balance, or a single amount. Caps and settlements stay encrypted inside iExec Nox and are compared in a TEE. The batch then settles through an unmodified Uniswap V3 pool.",
  url: "https://kairos-nox.vercel.app",
  twitter: "@kairos",
  repo: "https://github.com/Venkat5599/kzs",
  gateway: "https://agentfabric-api.187.127.137.136.sslip.io",
  vault: VAULT,
  vaultExplorer: `${EXPLORER}/${VAULT}`,
  router: ROUTER,
  routerExplorer: `${EXPLORER}/${ROUTER}`,
  uniswapRouterExplorer: `${EXPLORER}/${UNISWAP_ROUTER}`,
  nav: {
    cta: { text: "Open dashboard", href: "/dashboard" },
  },
};

export const heroConfig = {
  /* Two lines. A display line that wraps to three or four is a staircase, not
     a composition. */
  headline: ["Private budgets.", "Public settlement."],
  subheadline:
    "A spending cap enforced on-chain while the cap, the balance and every amount stay encrypted. The comparison happens inside the TEE; the chain only ever stores handles. The batch then swaps through Uniswap V3 — unmodified, unaware, still composable.",
  primary: { text: "Open dashboard", href: "/dashboard" },
  secondary: { text: "Verify it yourself", href: "#verify" },
};

export const techStackConfig = {
  /* "Built on", never "used by" — these are dependencies, not customers. */
  title: "Built on",
  items: [
    { name: "iExec Nox", description: "Confidential compute in a TEE" },
    { name: "Uniswap V3", description: "Settlement, used unmodified" },
    { name: "Ethereum Sepolia", description: "Where both contracts live" },
    { name: "x402", description: "HTTP 402 metering per call" },
    { name: "MCP", description: "Agent tool discovery" },
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
  statement: "Public rails publish an operational diary.",
  body: "Transparency is the right default for a settlement standard. It is the wrong default for a budget. Meter spending through public infrastructure and the chain records who is spending, how often, against which counterparty, for how much, and how much allowance remains. Anyone can read it. For a business that is a competitive leak before it is a privacy problem. The naive fix — don't enforce the limit on-chain — is worse: then the cap is a suggestion, and one compromised caller drains the treasury.",
  plain: {
    label: "A settlement in the open",
    caption: "Every field is public, and permanently linkable.",
    rows: [
      ["from", "0x91c4…7a20", "who is spending"],
      ["to", "0x5ef0…13bb", "and with whom"],
      ["value", "1500 wei", "what it cost"],
      ["block", "8421907", "exactly when"],
    ],
  },
  sealed: {
    label: "The same settlement on Kairos",
    caption: "One event. No addresses, no amount, only the epoch.",
    rows: [
      ["event", "Settled", "that one occurred"],
      ["epoch", "4", "which batch it joined"],
      ["amount", "sealed", "never emitted"],
      ["counterparty", "sealed", "never emitted"],
    ],
  },
};

/**
 * Being precise about this matters more than the feature list, so it is stated
 * rather than softened. The limitation is not buried.
 */
export const disclosureConfig = {
  title: "What is hidden, and what is not",
  lede: "Being precise about this matters more than any feature list.",
  sealed: {
    label: "Encrypted",
    note: "Handles on-chain, decryptable only by permitted accounts.",
    items: [
      "The treasury budget and what remains of it",
      "Each caller's per-call spending cap",
      "Each caller's cumulative spend",
      "The amount of any individual settlement",
      "Whether a settlement was authorized or refused",
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
      "The swap that aggregate settles into",
    ],
  },
  limitation: {
    label: "Known limitation, stated plainly",
    body: "msg.sender is inherently public. Kairos routes every settlement through one gateway relayer, so on-chain all settlements share a sender and per-caller activity is not distinguishable — but the relayer itself is visible, and it learns what it relays.",
  },
};

/** The five movements of a payment. Deliberately not a numbered list on a rail. */
export const pathConfig = {
  title: "How a payment moves",
  lede: "No individual debit ever touches a public pool on its own. That is what breaks the one-transaction-per-call trail.",
  steps: [
    {
      key: "settle",
      title: "Settle",
      body: "An encrypted amount arrives. Two encrypted comparisons run inside the TEE: within cap, and within budget. Neither result is ever revealed.",
      detail: "Nox.le(amount, cap)",
    },
    {
      key: "authorize",
      title: "Authorize",
      body: "An encrypted boolean cannot gate a require — reverting would broadcast the comparison. So the contract debits the amount or debits zero, and the transaction succeeds either way.",
      detail: "Nox.select(ok, amount, 0)",
    },
    {
      key: "accumulate",
      title: "Accumulate",
      body: "The debit joins an encrypted epoch total through Nox's own atomic transfer, so no single transaction corresponds to a single call.",
      detail: "Nox.transfer(treasury, epoch)",
    },
    {
      key: "flush",
      title: "Flush",
      body: "The owner closes the epoch and releases one aggregate for public decryption, proven on-chain against the TEE. It covers every payment in the batch and cannot be decomposed back into them.",
      detail: "one number, N payments",
    },
    {
      key: "route",
      title: "Route",
      body: "That aggregate settles through Uniswap V3 over its existing ABI. No fork, no wrapper. The pool sees one counterparty and one batch total — strictly less than a public rail publishes per individual call.",
      detail: "exactInputSingle",
    },
  ],
};

/**
 * Real reads against the live Sepolia deployment.
 *
 * Keep this at exactly three: the section renders on a three-column grid.
 */
export const verifyConfig = {
  title: "Verify it yourself",
  lede: "Both contracts are live on Sepolia. Every claim on this page is checkable from a terminal right now.",
  checks: [
    {
      label: "The vault is real, and its handles are encrypted",
      command: `cast call ${VAULT.slice(0, 10)}… "treasuryHandle()"`,
      output: `0x0000aa36a723006d8c4928a0
2417aca1e1d96b6c5a87d991e
04607721059d189

# a Nox handle, not a value`,
    },
    {
      label: "Settlement events carry no address and no amount",
      command: `cast logs --address ${VAULT.slice(0, 10)}… "Settled(uint64)"`,
      output: `topics: [ Settled, epoch ]
data:   0x

# the epoch, and nothing else`,
    },
    {
      label: "The swap router is Uniswap's own",
      command: `cast call ${ROUTER.slice(0, 10)}… "swapRouter()"`,
      output: `0x3bFA4769FB09eefC5a80d6E
87c3B9C650f7Ae48E

# SwapRouter02, unmodified`,
    },
  ],
  footnote:
    "The aggregate released by a flushed epoch covers every settlement it absorbed, and cannot be decomposed back into the payments that produced it. What reaches Uniswap is that one number.",
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
      heading: "On-chain",
      links: [
        { label: "KairosVault", href: `${EXPLORER}/${VAULT}` },
        { label: "Settlement router", href: `${EXPLORER}/${ROUTER}` },
        { label: "Uniswap SwapRouter02", href: `${EXPLORER}/${UNISWAP_ROUTER}` },
      ],
    },
    {
      heading: "Source",
      links: [
        { label: "GitHub", href: "https://github.com/Venkat5599/kzs" },
        { label: "iExec Nox", href: "https://docs.noxprotocol.io" },
        { label: "Uniswap V3", href: "https://docs.uniswap.org" },
      ],
    },
  ],
  colophon: `Ethereum Sepolia · chain 11155111 · MIT · ${new Date().getFullYear()}`,
};

export const features = {
  smoothScroll: true,
};
