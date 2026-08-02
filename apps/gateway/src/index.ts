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
app.get("/fabric/runs", (c) => c.json({ runs: store.runs() }));
app.get("/fabric/activity", (c) => c.json({ activity: store.activity() }));

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
app.post("/fabric/workflows/seed", (c) => c.json({ workflows: store.seedWorkflows() }));
app.post("/fabric/marketplace/seed", (c) => c.json({ apis: store.seedSkills() }));
app.post("/fabric/provision", async (c) => {
  const status = await confidential.status();
  return c.json({ ok: true, relayer: status.relayer, live: status.canWrite });
});

app.get("/payments/usage", (c) => c.json({ items: store.activity() }));

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
