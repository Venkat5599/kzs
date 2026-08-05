/**
 * Populate the catalogue so the dashboard has something to show.
 *
 * The gateway's catalogue is in-process (see `apps/gateway/src/store.ts`) and so
 * it empties on every restart. That is a deliberate trade — the confidential
 * settlement path is the product, the catalogue is scaffolding — but it means a
 * freshly restarted gateway shows zeroes everywhere. This puts the sample rows
 * back in one command.
 *
 * Every entry is named "Sample — …" and attributed to `sample-vendor`, matching
 * the convention already in `store.ts`. That labelling is not decoration: a
 * catalogue row that could be mistaken for a real integration would misrepresent
 * the product under a no-mock-data rule. The listings are examples; the
 * settlement path they describe is real.
 *
 *   bun run seed:demo
 *   GATEWAY=http://localhost:8080 bun run seed:demo
 */

const GATEWAY = (process.env.GATEWAY ?? "https://kairos-api.187.127.137.136.sslip.io").replace(
  /\/+$/,
  "",
);

async function post(path: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(`${GATEWAY}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.log(`   ✗ ${path} → ${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.log(`   ✗ ${path} → ${(e as Error).message}`);
    return false;
  }
}

/** Payment-gated API proxies. `priceWei` is what an agent is charged per call. */
const APIS = [
  {
    slug: "sample-market-data",
    name: "Sample — Market data",
    description: "Example listing. Spot prices and 24h volume, metered per call.",
    priceWei: "1500",
    vendor: "sample-vendor",
    egress: ["api.example.dev"],
  },
  {
    slug: "sample-sentiment",
    name: "Sample — Sentiment",
    description: "Example listing. Scores a block of text from -1 to 1.",
    priceWei: "800",
    vendor: "sample-vendor",
    egress: ["api.example.ai"],
  },
  {
    slug: "sample-geocoding",
    name: "Sample — Geocoding",
    description: "Example listing. Turns a street address into coordinates.",
    priceWei: "400",
    vendor: "sample-vendor",
    egress: ["api.example.io"],
  },
  {
    slug: "sample-news-digest",
    name: "Sample — News digest",
    description: "Example listing. Headlines for a ticker, summarised.",
    priceWei: "2200",
    vendor: "sample-vendor",
    egress: ["api.example.news"],
  },
  {
    slug: "sample-fx-rates",
    name: "Sample — FX rates",
    description: "Example listing. Mid-market rate between two currencies.",
    priceWei: "300",
    vendor: "sample-vendor",
    egress: ["api.example.fx"],
  },
];

/** MCP servers an agent can be pointed at. The first is this gateway, and real. */
const MCP_SERVERS = [
  {
    name: "Kairos (this gateway)",
    url: `${GATEWAY}/mcp`,
    status: "connected" as const,
  },
  {
    name: "Sample — Research tools",
    url: "https://mcp.example.dev/research",
    status: "disconnected" as const,
  },
  {
    name: "Sample — Trading desk",
    url: "https://mcp.example.dev/trading",
    status: "disconnected" as const,
  },
];

/**
 * Workflows, as node graphs.
 *
 * The branch demo is the interesting one: a condition splits a cheap path from
 * an expensive one, which is the shape a spending policy actually guards.
 */
const WORKFLOWS = [
  {
    slug: "sample-branch-demo",
    name: "Sample — Price check, then branch",
    graph: {
      nodes: [
        { id: "start", kind: "trigger", position: { x: 40, y: 120 } },
        { id: "quote", kind: "http", position: { x: 240, y: 120 } },
        { id: "gate", kind: "condition", position: { x: 440, y: 120 } },
        { id: "cheap", kind: "http", position: { x: 640, y: 40 } },
        { id: "pricey", kind: "onchain", position: { x: 640, y: 200 } },
        { id: "receipt", kind: "transform", position: { x: 840, y: 120 } },
      ],
      edges: [
        { from: "start", to: "quote" },
        { from: "quote", to: "gate" },
        { from: "gate", to: "cheap", branch: "true" },
        { from: "gate", to: "pricey", branch: "false" },
        { from: "cheap", to: "receipt" },
        { from: "pricey", to: "receipt" },
      ],
    },
  },
  {
    slug: "sample-settle-and-announce",
    name: "Sample — Settle, then announce",
    graph: {
      nodes: [
        { id: "start", kind: "trigger", position: { x: 40, y: 100 } },
        { id: "settle", kind: "onchain", position: { x: 260, y: 100 } },
        { id: "announce", kind: "onchain", position: { x: 480, y: 100 } },
        { id: "done", kind: "transform", position: { x: 700, y: 100 } },
      ],
      edges: [
        { from: "start", to: "settle" },
        { from: "settle", to: "announce" },
        { from: "announce", to: "done" },
      ],
    },
  },
  {
    slug: "sample-daily-digest",
    name: "Sample — Daily digest",
    graph: {
      nodes: [
        { id: "start", kind: "trigger", position: { x: 40, y: 100 } },
        { id: "fetch", kind: "http", position: { x: 260, y: 100 } },
        { id: "summarise", kind: "transform", position: { x: 480, y: 100 } },
      ],
      edges: [
        { from: "start", to: "fetch" },
        { from: "fetch", to: "summarise" },
      ],
    },
  },
];

async function main(): Promise<void> {
  console.log(`Seeding ${GATEWAY}\n`);

  let ok = 0;
  let failed = 0;
  const tally = (good: boolean) => (good ? (ok += 1) : (failed += 1));

  console.log("APIs");
  for (const api of APIS) {
    tally(await post("/fabric/apis", api));
    console.log(`   ${api.name}  ${api.priceWei} wei/call`);
  }

  console.log("\nMCP servers");
  for (const server of MCP_SERVERS) {
    tally(await post("/fabric/mcp-servers", server));
    console.log(`   ${server.name}`);
  }

  console.log("\nWorkflows");
  for (const wf of WORKFLOWS) {
    tally(await post("/fabric/workflows", wf));
    console.log(`   ${wf.name}  ${wf.graph.nodes.length} nodes`);
  }

  console.log(`\n${"─".repeat(56)}`);
  const counts = await fetch(`${GATEWAY}/fabric/stats`)
    .then(
      (r) =>
        r.json() as Promise<{
          totals?: { apis?: number; mcpServers?: number; workflows?: number };
        }>,
    )
    .catch(() => null);

  if (counts?.totals) {
    const { apis, mcpServers, workflows } = counts.totals;
    console.log(`gateway now reports  apis=${apis}  mcp=${mcpServers}  workflows=${workflows}`);
  }
  console.log(`${ok} created, ${failed} failed`);

  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
