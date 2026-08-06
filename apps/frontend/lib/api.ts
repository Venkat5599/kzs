/**
 * Where the dashboard calls the gateway.
 *
 * An explicit `NEXT_PUBLIC_GATEWAY_URL` always wins. Without one the fallback is
 * chosen by build rather than hardcoded to localhost: a production deploy that
 * quietly pointed at `localhost:8080` would serve a dashboard where every panel
 * is dead for everyone except the person who built it, and it would read as the
 * gateway being down rather than misconfigured.
 */
const FALLBACK =
  process.env.NODE_ENV === "production"
    ? // kairos-api, not agentfabric-api. The latter is a different project on a
      // different vault; pointing here at it returns plausible-looking data for
      // the wrong system and has no stealth routes at all.
      "https://kairos-api.187.127.137.136.sslip.io"
    : "http://localhost:8080";

const ABSOLUTE = (process.env.NEXT_PUBLIC_GATEWAY_URL ?? FALLBACK).replace(/\/+$/, "");

import { txUrl } from "./config";

/**
 * In the browser, go through the same-origin `/gw` proxy declared in
 * `next.config.ts`; on the server, call the gateway directly.
 *
 * The gateway allowlists origins, and Vercel serves this app on several
 * hostnames (the alias, an auto-assigned one, and one per deployment). Calling
 * it cross-origin therefore worked from exactly one hostname and failed with
 * "Failed to fetch" everywhere else. A same-origin request has no such problem.
 * Server-side there is no origin and no CORS, so the direct URL is right there.
 */
const BASE = typeof window === "undefined" ? ABSOLUTE : "/gw";

/**
 * The absolute gateway URL, for display and for commands a user copies out
 * (curl lines, MCP connection strings, endpoints). It is a build-time constant
 * — identical in the server and client bundles — so rendering it during SSR
 * cannot cause the hydration mismatch that rendering the `/gw` proxy path did.
 *
 * Browser fetches must NOT use this (cross-origin → the CORS failure the proxy
 * exists to avoid); they go through `apiBase` below.
 */
export const gatewayUrl = ABSOLUTE;

/** Browser-safe base for fetches: the same-origin `/gw` proxy in the browser, the direct URL on the server. */
export const apiBase = BASE;

export interface SkillSummary {
  /** Absent on catalogue samples — they are slug-keyed. */
  id?: string;
  slug: string;
  version: string;
  name: string;
  description: string;
  pricePerCall: string;
  asset: string;
  createdAt: string;
}

/** A skill as the gateway serves it — no nested manifest; the flat fields are the whole shape. */
export interface SkillDetail {
  slug: string;
  name: string;
  description: string;
  priceWei: string;
  vendor: string;
  egress: string[];
  createdAt: string;
}

export interface ChainStatus {
  configured: boolean;
  network: string;
  publicKeyHex: string | null;
  explorerBase: string;
}

export interface InvokeResult {
  paid?: boolean;
  skill?: { slug: string; name: string };
  amountWei?: string;
  hash?: string;
  stealth?: unknown;
  result?: unknown;
  usage?: unknown;
  runtimeMs?: number;
}

/**
 * The x402 quote envelope the gateway answers 402 with — the spec shape,
 * `accepts` carrying the terms. The old shape (`x402: true`, flat `price`)
 * matched nothing the gateway actually sends.
 */
export interface X402Quote {
  x402Version: number;
  error: string;
  accepts: Array<{
    scheme: string;
    network: string;
    maxAmountRequired: string;
    resource: string;
    description: string;
    mimeType: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra: { nonce: string };
  }>;
}

export interface PublishError {
  error: string;
  code?: string;
  details?: string[];
}

export async function listSkills(): Promise<SkillSummary[]> {
  const res = await fetch(`${BASE}/skills`);
  if (!res.ok) throw new Error(`list failed: ${res.status}`);
  const body = (await res.json()) as { skills: SkillSummary[] };
  return body.skills;
}

export async function getSkill(slug: string, version?: string): Promise<SkillDetail> {
  const q = version ? `?version=${encodeURIComponent(version)}` : "";
  const res = await fetch(`${BASE}/skills/${encodeURIComponent(slug)}${q}`);
  if (!res.ok) throw new Error(`get failed: ${res.status}`);
  return (await res.json()) as SkillDetail;
}

export async function publishSkill(source: string) {
  const res = await fetch(`${BASE}/skills`, {
    method: "POST",
    headers: { "content-type": "text/markdown" },
    body: source,
  });
  const body = await res.json();
  if (!res.ok) throw body;
  return body as { id: string; slug: string; version: string };
}

export async function getChainStatus(): Promise<ChainStatus> {
  const res = await fetch(`${BASE}/chain/status`);
  if (!res.ok) throw new Error("chain status failed");
  return (await res.json()) as ChainStatus;
}

export async function invokeSkill(slug: string, input: unknown) {
  const res = await fetch(`${BASE}/s/${encodeURIComponent(slug)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  // A non-JSON error body (a proxy 404, a plain-text refusal) must surface as
  // text, not as a SyntaxError from the parse.
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // keep the raw text
  }
  return { status: res.status, body };
}

export async function autoPayInvoke(slug: string, input: unknown, nonce: string): Promise<InvokeResult> {
  const res = await fetch(`${BASE}/s/${encodeURIComponent(slug)}/auto-pay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nonce, input }),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // keep the raw text
  }
  if (!res.ok) {
    const err = body as { error?: string; message?: string } | null;
    throw new Error(err?.message ?? err?.error ?? `invoke failed: ${res.status}`);
  }
  return body as InvokeResult;
}

// --- Fabric (kage-parity) ---

export interface FabricApi {
  /** Set on rows created through the gateway; catalogue samples are slug-keyed and carry no id. */
  id?: string;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  tags: string[];
  payment_address: string | null;
  target_url: string;
  http_method: string;
  content_type?: string;
  query_params?: string | null;
  example_response?: string | null;
  price: string;
  is_public: boolean;
  variables?: { name: string; type: string; in: string; description: string; required: boolean }[];
  auth_headers?: { name: string; value: string }[];
  owner_address: string | null;
  request_count: number;
  success_count?: number;
  earnings?: string;
  created_at?: string;
}

/**
 * The gateway's catalogue is a skill store — rows carry `priceWei` and `egress`
 * where the dashboard UI expects `price` and `target_url`. Rows created through
 * the gateway already carry the full shape, so this only fills the gaps; a
 * sample with no price or egress degrades to `0` / `""` rather than rendering
 * "undefined" in the UI.
 */
function toFabricApi(a: FabricApi): FabricApi {
  const skill = a as FabricApi & { priceWei?: string; egress?: string[] };
  return {
    ...a,
    price: a.price ?? skill.priceWei ?? "0",
    target_url: a.target_url ?? skill.egress?.[0] ?? "",
    http_method: a.http_method ?? "GET",
    is_public: a.is_public ?? false,
    tags: a.tags ?? [],
    owner_address: a.owner_address ?? null,
    request_count: a.request_count ?? 0,
  };
}

export async function listFabricApis(owner?: string): Promise<FabricApi[]> {
  const q = owner ? `?owner=${encodeURIComponent(owner)}` : "";
  const res = await fetch(`${BASE}/fabric/apis${q}`);
  if (!res.ok) throw new Error(`apis failed: ${res.status}`);
  return ((await res.json()) as { apis: FabricApi[] }).apis.map(toFabricApi);
}

export async function listFabricApisPublic(): Promise<FabricApi[]> {
  const res = await fetch(`${BASE}/fabric/apis?scope=public`);
  if (!res.ok) throw new Error(`apis failed: ${res.status}`);
  return ((await res.json()) as { apis: FabricApi[] }).apis.map(toFabricApi);
}

export async function createFabricApi(body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/fabric/apis`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || !(data as { ok?: boolean }).ok) throw new Error((data as { error?: string }).error ?? "create failed");
  return data;
}

export interface FabricWorkflow {
  /** Set on rows created through the gateway; catalogue samples are slug-keyed and carry no id. */
  id?: string;
  name: string;
  slug: string;
  description: string | null;
  is_public: boolean;
  input_variables: { name: string; type?: string; required?: boolean; description?: string }[];
  steps: unknown[];
  output_mapping?: { name: string; from: string }[];
  allowed_contracts?: string[];
  tags: string[];
}

export interface FabricMcpServer {
  id: string;
  /** Absent on rows seeded before the gateway assigned slugs; the UI falls back to the id. */
  slug: string | null;
  /** The gateway's native field; the UI prefers `display_name`. */
  name?: string;
  display_name: string;
  description: string | null;
  is_public: boolean;
  tools: string[];
  workflows: string[];
  owner_address: string | null;
  /** Absent on older gateway rows — the UI renders no date rather than "Invalid Date". */
  created_at?: string;
}

export interface FabricStats {
  totals: {
    apis: number;
    requests: number;
    earnings: number;
    mcpServers: number;
    workflows: number;
    /**
     * Null when unknowable, which is the normal case. Settlement outcomes are
     * encrypted, so the gateway cannot count successes without decrypting a
     * verdict it has no right to read.
     */
    success: number | null;
    successRate: number | null;
  };
  session: { cap: string | null; spent: string | null; remaining: string | null; expiry: string | null; live: boolean };
}

/**
 * The gateway stores workflows as `{ slug, name, graph, createdAt }`; the UI
 * also reads `steps`, `tags` and friends. Derive them from the graph so a
 * sample workflow shows its real step count and kind chips instead of zeros.
 */
function toFabricWorkflow(w: FabricWorkflow & { graph?: { nodes?: { kind?: string }[] } }): FabricWorkflow {
  const steps = (w.steps as { kind?: string }[] | undefined) ?? w.graph?.nodes ?? [];
  const kinds = [...new Set(steps.map((s) => s.kind).filter(Boolean))] as string[];
  return {
    ...w,
    description: w.description ?? "",
    is_public: w.is_public ?? false,
    input_variables: w.input_variables ?? [],
    steps,
    tags: w.tags ?? kinds,
  };
}

export async function listFabricWorkflows(scope?: string): Promise<FabricWorkflow[]> {
  const q = scope ? `?scope=${scope}` : "";
  const res = await fetch(`${BASE}/fabric/workflows${q}`);
  if (!res.ok) throw new Error(`workflows failed: ${res.status}`);
  return ((await res.json()) as { workflows: FabricWorkflow[] }).workflows.map(toFabricWorkflow);
}

export async function createFabricWorkflow(body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/fabric/workflows`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "create failed");
  return data;
}

export async function seedFabricWorkflows() {
  const res = await fetch(`${BASE}/fabric/workflows/seed`, { method: "POST" });
  return res.json();
}

export async function seedFabricMarketplace() {
  const res = await fetch(`${BASE}/fabric/marketplace/seed`, { method: "POST" });
  return res.json();
}

export async function runFabricWorkflow(slug: string, input: Record<string, unknown>, token?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}/fabric/run/workflow`, {
    method: "POST",
    headers,
    body: JSON.stringify({ slug, input }),
  });
  return res.json();
}

export async function runFabricApi(slug: string, args: Record<string, unknown>) {
  const res = await fetch(`${BASE}/fabric/run/api`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slug, args }),
  });
  return res.json();
}

/** Fill the gaps between the gateway's leaner row shape and what the UI renders. */
function toFabricMcpServer(m: FabricMcpServer & { name?: string }): FabricMcpServer {
  return {
    ...m,
    slug: m.slug ?? m.id,
    display_name: m.display_name ?? m.name ?? "Untitled server",
    description: m.description ?? "",
    is_public: m.is_public ?? false,
    tools: m.tools ?? [],
    workflows: m.workflows ?? [],
    owner_address: m.owner_address ?? null,
  };
}

export async function listFabricMcpServers(scope?: string): Promise<FabricMcpServer[]> {
  const q = scope ? `?scope=${scope}` : "";
  const res = await fetch(`${BASE}/fabric/mcp-servers${q}`);
  if (!res.ok) throw new Error(`mcp list failed: ${res.status}`);
  return ((await res.json()) as { servers: FabricMcpServer[] }).servers.map(toFabricMcpServer);
}

export async function createFabricMcpServer(body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/fabric/mcp-servers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "create failed");
  return data;
}

export async function patchFabricMcpServer(slug: string, body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/fabric/mcp-servers/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function getFabricStats(owner?: string): Promise<FabricStats> {
  const q = owner ? `?owner=${encodeURIComponent(owner)}` : "";
  const res = await fetch(`${BASE}/fabric/stats${q}`);
  if (!res.ok) throw new Error("stats failed");
  return (await res.json()) as FabricStats;
}

export async function getFabricActivity() {
  const res = await fetch(`${BASE}/fabric/activity`);
  if (!res.ok) return [];
  return ((await res.json()) as { activity: unknown[] }).activity ?? [];
}

/** One metered call, as recorded by the gateway. `price` is in wei. */
export interface FabricLog {
  id: string;
  api_slug: string;
  api_name: string;
  kind: string;
  status: number;
  ok: boolean;
  /** Settled, as opposed to served free or failing before payment. */
  paid: boolean;
  price: number;
  duration_ms: number;
  /** ISO-8601, e.g. "2026-07-23T10:14:12.766Z". */
  created_at: string;
}

export interface FabricLogsResponse {
  logs: FabricLog[];
  stats: { total: number; ok: number; paid: number; revenue: number } | null;
}

export async function getFabricLogs(period: string): Promise<FabricLogsResponse> {
  const res = await fetch(`${BASE}/fabric/logs?period=${period}`);
  if (!res.ok) return { logs: [], stats: null };
  return (await res.json()) as FabricLogsResponse;
}

export async function provisionFabricSession(body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/fabric/provision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function getFabricWalletStatus(address: string) {
  const res = await fetch(`${BASE}/fabric/wallet-status?address=${encodeURIComponent(address)}`);
  return res.json() as Promise<{ ok: boolean; funded?: boolean; ETH?: string; wei?: string; demo?: boolean; error?: string }>;
}

/**
 * Base for the MCP connect URL. The gateway serves the MCP endpoint at its own
 * origin (`/mcp`), so the default is the gateway URL — not localhost, which a
 * production build would otherwise ship to every visitor.
 */
export const fabricMcpUrl = process.env.NEXT_PUBLIC_FABRIC_MCP_URL ?? ABSOLUTE;

// --- Nox (confidential settlement) ---

export interface NoxStatus {
  configured: boolean;
  reason?: string;
  vaultAddress?: string;
  relayer?: string;
  network: number;
  explorer?: string;
  epoch?: number;
  epochCount?: number;
}

export interface NoxBudget {
  budgetWei: string;
  epochTotalWei: string;
  epoch: number;
  epochCount: number;
}

export interface NoxAgent {
  agent: string;
  active: boolean;
  capWei?: string;
  spentWei?: string;
  error?: string;
}

export interface NoxTx {
  ok: boolean;
  txHash?: string;
  explorerUrl?: string;
  blockNumber?: number | null;
  error?: string;
}

export interface NoxSettlement extends NoxTx {
  authorized: boolean;
  spentWei?: string;
}

async function noxJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let body: T & { error?: string; message?: string } | null = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  // 402 is a meaningful answer here (settlement not authorized), not a failure.
  if (!res.ok && res.status !== 402) {
    // The gateway answers `{ error: <code>, message: <human text> }`; surface
    // the message, falling back to the code when no message came back. An
    // empty body means the proxy cut the connection (the transaction may still
    // have landed) — say so instead of crashing on JSON.parse.
    const message = body?.message ?? body?.error ?? (text ? text.slice(0, 200) : "empty response — the gateway may still be processing the transaction");
    throw new Error(message);
  }
  return body as T;
}

export function getNoxStatus(): Promise<NoxStatus> {
  return noxJson<NoxStatus>("/nox/status");
}

export function getNoxBudget(): Promise<NoxBudget> {
  return noxJson<NoxBudget>("/nox/budget");
}

export function getNoxAgent(agent: string): Promise<NoxAgent> {
  return noxJson<NoxAgent>(`/nox/agents/${encodeURIComponent(agent)}`);
}

const postJson = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/**
 * Attach the explorer link a raw gateway tx response does not carry.
 *
 * The gateway answers `{ hash }`; the UI's `NoxTx` shape wants `txHash` +
 * `explorerUrl`. Derive both from the hash so every transaction card links to
 * Etherscan.
 */
export function withExplorerTx<T>(r: T & { hash?: string; txHash?: string; explorerUrl?: string }): T & { txHash?: string; explorerUrl?: string } {
  const h = r.txHash ?? r.hash;
  return {
    ...r,
    ...(h ? { txHash: h, ...(r.explorerUrl ? {} : { explorerUrl: txUrl(h) }) } : {}),
  };
}

export function noxFund(amountWei: string): Promise<NoxTx> {
  return noxJson<NoxTx>("/nox/fund", postJson({ amountWei }));
}

export function noxRegisterAgent(agent: string, capWei: string): Promise<NoxTx> {
  return noxJson<NoxTx>("/nox/agents", postJson({ agent, capWei }));
}

export function noxSettle(agent: string, amountWei: string): Promise<NoxSettlement> {
  return noxJson<NoxSettlement>("/nox/settle", postJson({ agent, amountWei }));
}

export function noxFlushEpoch(): Promise<NoxTx & { epoch?: number }> {
  return noxJson<NoxTx & { epoch?: number }>("/nox/epoch/flush", { method: "POST" });
}

// --- Safe module ----------------------------------------------------------
// Kairos spends from an unmodified Safe through `execTransactionFromModule`.
// `standalone` means no Safe is attached; `installed` means the Safe has run
// `enableModule` for this vault. Both must hold before a batch can execute.

export interface NoxSafe {
  safe: string | null;
  standalone: boolean;
  installed: boolean;
  explorer: string | null;
  error?: string;
}

export interface NoxClosedEpoch {
  epoch: number;
  closed: boolean;
  /** Absent until the epoch is closed; "0" when it absorbed no settlements. */
  totalWei?: string;
  /** How many settlements the batch covered. */
  count?: number;
  error?: string;
}

export function getNoxSafe(): Promise<NoxSafe> {
  return noxJson<NoxSafe>("/nox/safe");
}

export function noxSetSafe(safe: string): Promise<NoxTx & { safe?: string }> {
  return noxJson<NoxTx & { safe?: string }>("/nox/safe", postJson({ safe }));
}

/** Aggregate released by `flushEpoch` — one number covering the whole batch. */
export function getNoxClosedEpoch(epoch: number): Promise<NoxClosedEpoch> {
  return noxJson<NoxClosedEpoch>(`/nox/epoch/${epoch}`);
}

export function noxExecuteBatch(
  epoch: number,
  to: string,
  amountWei: string,
): Promise<NoxTx & { epoch?: number }> {
  return noxJson<NoxTx & { epoch?: number }>(
    `/nox/epoch/${epoch}/execute`,
    postJson({ to, amountWei }),
  );
}

// --- Workflow graphs and run history ---

export type WfNode = {
  id: string;
  kind: "trigger" | "http" | "condition" | "onchain" | "delay" | "transform" | "loop";
  label?: string;
  position?: { x: number; y: number };
  retry?: { max: number; backoffMs?: number };
  timeoutMs?: number;
  config?: Record<string, unknown>;
};

export type WfEdge = { from: string; to: string; branch?: "true" | "false" };

export type WorkflowGraph = { nodes: WfNode[]; edges: WfEdge[] };

export type RunNode = {
  id: string;
  kind: string;
  status: "ok" | "skipped" | "error";
  attempts: number;
  detail?: string;
};

export type WorkflowRunRecord = {
  id: string;
  workflow_slug: string;
  workflow_name: string;
  status: "completed" | "failed" | "halted";
  completed: boolean;
  created_at: string;
  duration_ms: number;
  node_count: number;
  error?: string;
  nodes: RunNode[];
  output?: Record<string, unknown>;
};

/** Save a canvas-authored graph onto an existing workflow. */
export async function saveWorkflowGraph(slug: string, graph: WorkflowGraph) {
  const res = await fetch(`${BASE}/fabric/workflows/${encodeURIComponent(slug)}/graph`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(graph),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "could not save graph");
  return data as { ok: true; workflow: FabricWorkflow };
}

export async function listWorkflowRuns(slug?: string, limit = 20): Promise<WorkflowRunRecord[]> {
  const q = new URLSearchParams();
  if (slug) q.set("workflow", slug);
  q.set("limit", String(limit));
  const res = await fetch(`${BASE}/fabric/runs?${q}`);
  if (!res.ok) return [];
  return ((await res.json()) as { runs: WorkflowRunRecord[] }).runs;
}

export async function getWorkflowRun(id: string): Promise<WorkflowRunRecord | null> {
  const res = await fetch(`${BASE}/fabric/runs/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  return (await res.json()) as WorkflowRunRecord;
}
