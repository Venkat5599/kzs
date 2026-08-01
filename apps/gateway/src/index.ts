import { Hono } from "hono";
import { cors } from "hono/cors";
import { ConfidentialClient } from "@kairos/confidential";
import { KairosError, mayServeResource, toKairosError } from "@kairos/shared";
import type { Address } from "viem";
import { loadConfig } from "./config.js";
import { store } from "./store.js";

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
});

const app = new Hono();

app.use("*", cors({ origin: config.corsOrigins, credentials: true }));

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
 */
app.post("/nox/settle", async (c) => {
  const body = await c.req.json<{ agent?: string; amountWei?: string }>();
  if (!body.agent) throw new KairosError("invalid_input", "agent is required");
  const amount = BigInt(body.amountWei ?? "0");
  if (amount <= 0n) throw new KairosError("invalid_input", "amountWei must be positive");

  const { hash, verdict, spentWei } = await confidential.settle(body.agent as Address, amount);

  if (!mayServeResource(verdict)) {
    if (verdict.outcome === "unreadable") {
      // Operationally this is an incident, not routine traffic. It must be
      // visible in logs even though the caller is told nothing extra.
      console.warn(`[fail-closed] refused ${hash}: ${verdict.reason}`);
    }
    return c.json(
      { authorized: false, hash, reason: "budget or cap exceeded", spentWei },
      402,
    );
  }

  return c.json({ authorized: true, hash, spentWei });
});

app.post("/nox/epoch/flush", async (c) => c.json({ hash: await confidential.flushEpoch() }));

// ============ catalog + fabric ============
//
// Backed by an in-process store. The confidential path is the product; these
// endpoints exist so the dashboard has a catalogue to render, and they are
// honest about being ephemeral rather than pretending to be a database.

app.get("/skills", (c) => c.json(store.skills()));
app.post("/skills", async (c) => c.json(store.publishSkill(await c.req.json()), 201));
app.get("/skills/:slug", (c) => {
  const skill = store.skill(c.req.param("slug"));
  if (!skill) throw new KairosError("not_found", "Skill not found.");
  return c.json(skill);
});

app.get("/fabric/apis", (c) => c.json({ items: store.skills() }));
app.get("/fabric/workflows", (c) => c.json({ items: store.workflows() }));
app.get("/fabric/mcp-servers", (c) => c.json({ items: store.mcpServers() }));
app.get("/fabric/runs", (c) => c.json({ items: store.runs() }));

app.get("/fabric/stats", async (c) => {
  const [status, budget] = await Promise.all([confidential.status(), confidential.budget()]);
  return c.json({
    epoch: status.epoch,
    settlements: budget.epochCount,
    apis: store.skills().length,
    workflows: store.workflows().length,
    mcpServers: store.mcpServers().length,
    budgetWei: budget.budgetWei,
    epochTotalWei: budget.epochTotalWei,
  });
});

app.get("/fabric/activity", (c) => c.json({ items: store.activity() }));
app.get("/fabric/logs", (c) => c.json({ items: store.activity() }));

app.get("/fabric/wallet-status", async (c) => {
  const status = await confidential.status();
  return c.json({
    connected: status.canWrite,
    relayer: status.relayer,
    network: "sepolia",
    chainId: status.network,
  });
});

app.post("/fabric/apis", async (c) => c.json(store.publishSkill(await c.req.json()), 201));
app.post("/fabric/workflows", async (c) => c.json(store.saveWorkflow(await c.req.json()), 201));
app.post("/fabric/mcp-servers", async (c) => c.json(store.saveMcpServer(await c.req.json()), 201));
app.post("/fabric/workflows/seed", (c) => c.json({ items: store.seedWorkflows() }));
app.post("/fabric/marketplace/seed", (c) => c.json({ items: store.seedSkills() }));

app.get("/payments/usage", (c) => c.json({ items: store.activity() }));

// ============ boot ============

console.log(`kairos-gateway`);
console.log(`  vault    ${config.vaultAddress}`);
console.log(`  policy   ${config.capPolicyAddress ?? "(none)"}`);
console.log(`  relayer  ${confidential.relayerAddress ?? "(read-only)"}`);
console.log(`  cors     ${config.corsOrigins.join(", ")}`);
console.log(`  port     ${config.port}`);

export default { port: config.port, fetch: app.fetch };
