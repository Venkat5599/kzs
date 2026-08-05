import { Hono } from "hono";
import { cors } from "hono/cors";
import { ConfidentialClient } from "@kairos/confidential";
import {
  KairosError,
  mayServeResource,
  toKairosError,
  generateStealthKeys,
  parseMetaAddress,
  deriveStealthAddress,
  checkStealthPayment,
} from "@kairos/shared";
import type { Address } from "viem";
import { loadConfig } from "./config.js";
import { store } from "./store.js";
import { handleMcp } from "./mcp.js";
import { announceStealthPayout, resolveStealthPayout } from "./stealth.js";
import { createExecutionService } from "@kairos/execution";
import { resolveValue, type WorkflowGraph } from "@kairos/workflow";
import {
  claimQuote,
  decodePaymentHeader,
  quoteEnvelope,
  quoteFor,
  rememberQuote,
  receiptHeader,
  verifyAgainstQuote,
} from "./x402.js";

/**
 * The Kairos gateway.
 *
 * The only process that holds keys. Everything above it — the dashboard, an
 * agent — receives plain values and never a secret.
 *
 * Two rules govern this file:
 *
 *   1. Routes are thin. They parse input, call into a package, and map the
 *      result to a response. Logic that lives here cannot be tested without
 *      HTTP, which means it will not be tested.
 *   2. Refusal is the default. The fail-closed decision is made by
 *      `mayServeResource` and nowhere else, and every error path lands on a
 *      refusal rather than a pass-through.
 */

const config = loadConfig();

const confidential = new ConfidentialClient({
  rpcUrl: config.chainRpcUrl,
  vaultAddress: config.vaultAddress,
  ...(config.capPolicyAddress ? { capPolicyAddress: config.capPolicyAddress } : {}),
  ...(config.relayerPrivateKey ? { relayerPrivateKey: config.relayerPrivateKey } : {}),
  ...(config.stealthAnnouncerAddress
    ? { stealthAnnouncerAddress: config.stealthAnnouncerAddress }
    : {}),
  ...(config.settlementRouterAddress
    ? { settlementRouterAddress: config.settlementRouterAddress }
    : {}),
});

const app = new Hono();

// `credentials: true` is invalid alongside a wildcard origin — the browser
// rejects the response outright and every request fails CORS, which looks
// exactly like the gateway being down. Send credentials only when the origins
// are explicit.
const wildcard = config.corsOrigins.includes("*");
app.use(
  "*",
  cors(
    wildcard
      ? { origin: "*" }
      : { origin: config.corsOrigins, credentials: true },
  ),
);

/** Map a typed error to a status once, at the edge. Packages never see HTTP. */
const STATUS: Record<string, number> = {
  invalid_input: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payment_required: 402,
  verdict_unreadable: 402,
  upstream_failure: 502,
  rate_limited: 429,
  misconfigured: 500,
  internal: 500,
};

app.onError((cause, c) => {
  const err: KairosError = toKairosError(cause);
  // The message is safe by construction (see @kairos/shared errors); the cause
  // is deliberately not serialised, because a driver or RPC error can carry a
  // connection string or a key fragment.
  console.error(`[${err.code}] ${err.message}`, err.details);
  return c.json({ error: err.code, message: err.message, ...err.details }, (STATUS[err.code] ?? 500) as 500);
});

// ============ health + chain ============

app.get("/", (c) => c.json({ name: "kairos-gateway", ok: true }));
app.get("/health", (c) => c.json({ ok: true, uptime: process.uptime() }));

app.get("/chain/status", async (c) => c.json(await confidential.chainStatus()));

// ============ confidential vault ============

app.get("/nox/status", async (c) => c.json(await confidential.status()));
app.get("/nox/budget", async (c) => c.json(await confidential.budget()));

app.get("/nox/epoch", async (c) => {
  const { epoch } = await confidential.status();
  return c.json(await confidential.epoch(epoch));
});

app.get("/nox/epoch/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id < 0) throw new KairosError("invalid_input", "epoch must be a non-negative integer");
  return c.json(await confidential.epoch(id));
});

app.get("/nox/agents/:agent", async (c) => {
  const agent = c.req.param("agent") as Address;
  return c.json(await confidential.agent(agent));
});

app.post("/nox/fund", async (c) => {
  const body = await c.req.json<{ amountWei?: string }>();
  const amount = BigInt(body.amountWei ?? "0");
  if (amount <= 0n) throw new KairosError("invalid_input", "amountWei must be positive");
  return c.json({ hash: await confidential.fund(amount) });
});

app.post("/nox/agents", async (c) => {
  const body = await c.req.json<{ agent?: string; capWei?: string }>();
  if (!body.agent) throw new KairosError("invalid_input", "agent is required");
  const cap = BigInt(body.capWei ?? "0");
  if (cap <= 0n) throw new KairosError("invalid_input", "capWei must be positive");
  return c.json(await confidential.registerAgent(body.agent as Address, cap));
});

/**
 * Settle, and refuse unless the verdict says otherwise.
 *
 * The response is a 402 both when the settlement was refused and when the
 * verdict could not be read. Those are different facts internally — the second
 * is an operational alarm — but they are the same answer to the caller, and
 * distinguishing them here would leak the outcome to whoever asked.
 *
 * `payTo` closes the payee half. Given a stealth meta-address — or with one
 * configured for the operator — the payout lands on an address that has never
 * appeared on-chain, and the announcement that makes it findable is published
 * only after the payment is authorized. Announcing a refusal would write a false
 * entry to a public log and betray that an attempt happened at all.
 */
app.post("/nox/settle", async (c) => {
  const body = await c.req.json<{ agent?: string; amountWei?: string; payTo?: string }>();
  if (!body.agent) throw new KairosError("invalid_input", "agent is required");
  const amount = BigInt(body.amountWei ?? "0");
  if (amount <= 0n) throw new KairosError("invalid_input", "amountWei must be positive");

  // Derived before settling so a malformed meta-address is a 400 rather than a
  // successful payment nobody can collect.
  const payout = resolveStealthPayout(config, body.payTo);

  const { hash, verdict, spentWei } = await confidential.settle(body.agent as Address, amount);

  if (!mayServeResource(verdict)) {
    if (verdict.outcome === "unreadable") {
      // Operationally this is an incident, not routine traffic. It must be
      // visible in logs even though the caller is told nothing extra.
      console.warn(`[fail-closed] refused ${hash}: ${verdict.reason}`);
    }
    // No `stealth` key here, deliberately: a refusal and an authorization must
    // not be distinguishable by the shape of the response.
    return c.json(
      { authorized: false, hash, reason: "budget or cap exceeded", spentWei },
      402,
    );
  }

  const stealth = payout ? await announceStealthPayout(confidential, payout) : null;

  return c.json({ authorized: true, hash, spentWei, ...(stealth ? { stealth } : {}) });
});

app.post("/nox/epoch/flush", async (c) => c.json({ hash: await confidential.flushEpoch() }));

// ============ catalog + fabric ============
//
// Backed by an in-process store. The confidential path is the product; these
// endpoints exist so the dashboard has a catalogue to render, and they are
// honest about being ephemeral rather than pretending to be a database.

// The dashboard's client expects specific envelope keys, not a generic
// `items`. Matching its contract exactly is cheaper than changing both sides.
app.get("/skills", (c) => c.json({ skills: store.skills() }));
app.post("/skills", async (c) => c.json(store.publishSkill(await c.req.json()), 201));
app.get("/skills/:slug", (c) => {
  const skill = store.skill(c.req.param("slug"));
  if (!skill) throw new KairosError("not_found", "Skill not found.");
  return c.json(skill);
});

app.get("/fabric/apis", (c) => c.json({ apis: store.skills() }));
app.get("/fabric/workflows", (c) => c.json({ workflows: store.workflows() }));
app.get("/fabric/mcp-servers", (c) => c.json({ servers: store.mcpServers() }));
app.get("/fabric/runs", (c) => {
  const workflow = c.req.query("workflow");
  const limitRaw = Number(c.req.query("limit") ?? "20");
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20;
  let runs = store.runs();
  if (workflow) runs = runs.filter((r) => (r as { workflow?: string }).workflow === workflow);
  return c.json({ runs: runs.slice(0, limit) });
});
app.get("/fabric/runs/:id", (c) => {
  const run = store.runs().find((r) => (r as { id?: string }).id === c.req.param("id"));
  if (!run) return c.json({ error: "run not found" }, 404);
  return c.json(run);
});
app.get("/fabric/activity", (c) => c.json({ activity: store.activity() }));

/**
 * Run a workflow and record the trace.
 *
 * The executor is `@kairos/execution` over `@kairos/workflow` — validation and
 * traversal live in the packages; this route only supplies the step handlers.
 * HTTP nodes call out (bounded, 8s); transform nodes resolve `{{…}}` templates;
 * onchain nodes have no handler here, so they are honestly reported as skipped
 * rather than silently "succeeding".
 */
const executor = createExecutionService({
  maxNodeExecutions: Number(process.env.WORKFLOW_MAX_NODE_EXECUTIONS ?? 500),
  maxLoopItems: Number(process.env.WORKFLOW_MAX_LOOP_ITEMS ?? 100),
  record: (run) => store.recordRun(run),
});

app.post("/fabric/run/workflow", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { slug?: string; input?: Record<string, unknown> } | null;
  const slug = body?.slug;
  if (!slug) return c.json({ ok: false, error: "slug is required" }, 400);
  const wf = store.workflows().find((w) => w.slug === slug);
  if (!wf) return c.json({ ok: false, error: "workflow not found" }, 404);

  const result = await executor.run(
    { slug: wf.slug, name: wf.name, graph: wf.graph as WorkflowGraph },
    body.input ?? {},
    {
      http: async (node) => {
        const cfg = node.config ?? {};
        const url = String(cfg.url ?? "");
        if (!/^https?:\/\//.test(url)) throw new Error(`http node has no usable url (${url || "empty"})`);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
          const res = await fetch(url, {
            method: String(cfg.method ?? "GET"),
            headers: { "content-type": "application/json" },
            signal: controller.signal,
          });
          const text = await res.text();
          let data: unknown = text;
          try {
            data = text ? JSON.parse(text) : null;
          } catch {
            // keep the raw text as the body
          }
          return { status: res.status, body: data };
        } finally {
          clearTimeout(timer);
        }
      },
      transform: async (node, ctx) => ({ value: resolveValue(node.config?.value, ctx) }),
    },
  );

  if (!result.ok) {
    return c.json({ ok: false, error: result.error.message }, (STATUS[result.error.code] ?? 500) as 500);
  }
  return c.json({ ok: true, run: result.value });
});

app.get("/fabric/logs", (c) => {
  const logs = store.activity();
  return c.json({
    logs,
    stats: { total: logs.length, ok: logs.length, paid: 0, revenue: 0 },
  });
});

app.get("/fabric/stats", async (c) => {
  const [status, budget] = await Promise.all([confidential.status(), confidential.budget()]);
  const requests = budget.epochCount;
  return c.json({
    totals: {
      apis: store.skills().length,
      requests,
      // Null, not a number. The gateway records that settlements happened but
      // not whether each one was authorized — it cannot, because the verdict is
      // encrypted and only a permitted account may read it. Reporting
      // `success: requests` and a flat 100% would be inventing telemetry this
      // system is deliberately unable to collect, on a dashboard whose whole
      // claim is that it does not know what it should not know.
      success: null,
      successRate: null,
      earnings: Number(budget.epochTotalWei ?? 0),
      mcpServers: store.mcpServers().length,
      workflows: store.workflows().length,
    },
    session: {
      // The treasury is the operator's budget, decrypted for them alone. It is
      // surfaced here so the dashboard header can show real numbers rather than
      // placeholders; `live` reflects whether this gateway can actually sign.
      cap: budget.budgetWei,
      spent: budget.epochTotalWei,
      remaining: budget.budgetWei,
      expiry: null,
      live: status.canWrite,
    },
  });
});

app.get("/fabric/wallet-status", async (c) => {
  const status = await confidential.status();
  return c.json({
    connected: status.canWrite,
    relayer: status.relayer,
    address: status.relayer,
    network: "sepolia",
    chainId: status.network,
  });
});

app.post("/fabric/apis", async (c) => c.json(store.publishSkill(await c.req.json()), 201));
app.post("/fabric/workflows", async (c) => c.json(store.saveWorkflow(await c.req.json()), 201));
app.post("/fabric/mcp-servers", async (c) => c.json(store.saveMcpServer(await c.req.json()), 201));

/** Change which tools and workflows a server exposes. Addressed by slug or id. */
app.patch("/fabric/mcp-servers/:slug", async (c) => {
  const body = await c.req.json<{ tools?: string[]; workflows?: string[] }>();
  const updated = store.updateMcpServer(c.req.param("slug"), {
    ...(body.tools ? { tools: body.tools } : {}),
    ...(body.workflows ? { workflows: body.workflows } : {}),
  });
  if (!updated) throw new KairosError("not_found", "MCP server not found.");
  return c.json(updated);
});
app.post("/fabric/workflows/seed", (c) => c.json({ workflows: store.seedWorkflows() }));
app.post("/fabric/marketplace/seed", (c) => c.json({ apis: store.seedSkills() }));
app.post("/fabric/provision", async (c) => {
  const status = await confidential.status();
  return c.json({ ok: true, relayer: status.relayer, live: status.canWrite });
});

app.get("/payments/usage", (c) => c.json({ items: store.activity() }));

// ============ x402 ============
//
// Quote, then pay. `/nox/settle` already authorized payments; what was missing
// was a way for a caller to ask the price first, which is what makes the
// catalogue navigable by an agent that has never seen it.
//
// The privacy rule from `/nox/settle` carries over verbatim and is the reason
// this route is shaped the way it is: an unpaid request and a refused payment
// get byte-identical 402 responses. Distinguishing them would let a caller
// binary-search the encrypted cap by sending payments and watching which shape
// came back — defeating the branchless settle path entirely.

app.post("/x402/skills/:slug", async (c) => {
  const slug = c.req.param("slug");
  const skill = store.skill(slug);
  // A 404 before any payment consideration. Whether a skill exists is public —
  // it is in `GET /skills` — so this leaks nothing the catalogue does not.
  if (!skill) throw new KairosError("not_found", "Skill not found.");

  const body = await c.req
    .json<{ agent?: string; payTo?: string }>()
    .catch(() => ({}) as { agent?: string; payTo?: string });

  // Derived before anything else so a malformed meta-address is a 400 rather
  // than a payment nobody can collect — the same ordering as `/nox/settle`.
  const payout = resolveStealthPayout(config, body.payTo);
  const payTo = payout?.stealthAddress ?? confidential.relayerAddress;
  if (!payTo) {
    throw new KairosError("misconfigured", "No payee: gateway is read-only and no payTo was given.");
  }

  /** A fresh quote, remembered so the payment answering it can be checked. */
  const offer = () => {
    const requirements = quoteFor(skill, new URL(c.req.url).pathname, payTo);
    rememberQuote(requirements);
    return quoteEnvelope(requirements);
  };

  const header = c.req.header("X-PAYMENT");
  if (!header) return c.json(offer(), 402);

  // A malformed header is a broken client, not a declined payment, so it throws
  // `invalid_input` and lands on 400 rather than being answered with a quote.
  const payment = decodePaymentHeader(header);

  const agent = body.agent ?? payment.payload.authorization.from;
  if (!agent) throw new KairosError("invalid_input", "agent is required");

  // Checked against the quote that was issued, never a freshly derived one. With
  // stealth payouts the payee is a one-time address, so re-deriving here would
  // refuse every honest payment for being addressed to the wrong place.
  const requirements = claimQuote(payment.payload.authorization.nonce);
  if (!requirements) {
    console.warn(`[x402] unknown, expired or replayed quote for ${slug}`);
    return c.json(offer(), 402);
  }

  try {
    verifyAgainstQuote(payment, requirements);
  } catch (cause) {
    // Logged in full, answered with nothing. The operator needs to know why a
    // payment failed; the caller must not.
    if (KairosError.is(cause) && cause.code === "payment_required") {
      console.warn(`[x402] rejected payment for ${slug}: ${cause.message}`);
      return c.json(offer(), 402);
    }
    throw cause;
  }

  const { hash, verdict } = await confidential.settle(
    agent as Address,
    BigInt(requirements.maxAmountRequired),
  );

  if (!mayServeResource(verdict)) {
    if (verdict.outcome === "unreadable") {
      console.warn(`[fail-closed] refused ${hash}: ${verdict.reason}`);
    }
    // The same object the unpaid request got. No hash, no reason, no extra key.
    return c.json(offer(), 402);
  }

  // Announced only now, after authorization — announcing earlier would publish a
  // payment that may never have happened. See stealth.ts.
  const stealth = payout ? await announceStealthPayout(confidential, payout) : null;

  c.header("X-PAYMENT-RESPONSE", receiptHeader(hash, agent));
  return c.json({
    paid: true,
    skill: { slug: skill.slug, name: skill.name },
    amountWei: requirements.maxAmountRequired,
    hash,
    ...(stealth ? { stealth } : {}),
  });
});

// ============ stealth addresses ============
//
// The relayer hides the payer — every agent shares one sender. These close the
// other half: a payout to a fixed address builds a public history of how often
// and how much this operator is paid. A stealth address has never appeared
// on-chain and only its recipient can link it to themselves.
//
// Private keys are generated and returned to the caller, never stored. The
// gateway must not be able to spend what it helps derive.

app.post("/stealth/keys", (c) => {
  const keys = generateStealthKeys();
  return c.json({
    metaAddress: keys.metaAddress,
    spendingPublicKey: keys.spendingPublicKey,
    viewingPublicKey: keys.viewingPublicKey,
    // Returned once. Losing them means losing every payment made to this
    // meta-address, so the client is told to keep them.
    spendingPrivateKey: keys.spendingPrivateKey,
    viewingPrivateKey: keys.viewingPrivateKey,
    warning:
      "Save both private keys now. They are not stored here and cannot be recovered.",
  });
});

app.post("/stealth/derive", async (c) => {
  const body = await c.req.json<{ metaAddress?: string }>();
  if (!body.metaAddress) throw new KairosError("invalid_input", "metaAddress is required");
  let payment;
  try {
    payment = deriveStealthAddress(parseMetaAddress(body.metaAddress));
  } catch (cause) {
    throw new KairosError("invalid_input", "metaAddress is malformed", {
      hint: "Expected st:eth:0x… carrying two 33-byte compressed keys.",
    });
  }
  return c.json({
    stealthAddress: payment.stealthAddress,
    ephemeralPublicKey: payment.ephemeralPublicKey,
    viewTag: payment.viewTag,
    note:
      "Pay this address. Announce the ephemeral key so the recipient can find it.",
  });
});

app.post("/stealth/check", async (c) => {
  const body = await c.req.json<{
    viewingPrivateKey?: string;
    spendingPublicKey?: string;
    ephemeralPublicKey?: string;
    stealthAddress?: string;
    viewTag?: number;
  }>();
  if (!body.viewingPrivateKey || !body.spendingPublicKey) {
    throw new KairosError("invalid_input", "viewingPrivateKey and spendingPublicKey are required");
  }
  const mine = checkStealthPayment(
    {
      viewingPrivateKey: body.viewingPrivateKey as `0x${string}`,
      spendingPublicKey: body.spendingPublicKey as `0x${string}`,
    },
    {
      ephemeralPublicKey: (body.ephemeralPublicKey ?? "0x") as `0x${string}`,
      stealthAddress: (body.stealthAddress ?? "0x") as `0x${string}`,
      viewTag: body.viewTag ?? 0,
    },
  );
  return c.json({ mine });
});

// ============ remote MCP connector ============
//
// The URL a user pastes into Claude's connector settings. Same confidential
// path as every other route — the agent asks to pay, the enclave decides.

app.post("/mcp", async (c) => {
  const body = await c.req.json();
  const reply = await handleMcp(confidential, config, () => ({ apis: store.skills() }), body);
  // A JSON-RPC notification gets no body, only 202.
  if (reply === null) return c.body(null, 202);
  return c.json(reply);
});

app.get("/mcp", (c) =>
  c.json({
    name: "kairos",
    transport: "streamable-http",
    hint: "Add this URL as a custom connector in Claude, then ask it to pay from your Kairos budget.",
  }),
);

// ============ boot ============

console.log(`kairos-gateway`);
console.log(`  vault    ${config.vaultAddress}`);
console.log(`  policy   ${config.capPolicyAddress ?? "(none)"}`);
console.log(`  relayer  ${confidential.relayerAddress ?? "(read-only)"}`);
console.log(`  cors     ${config.corsOrigins.join(", ")}`);
console.log(`  port     ${config.port}`);

export default { port: config.port, fetch: app.fetch };
