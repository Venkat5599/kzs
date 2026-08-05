import { MAINNET_CHAIN } from "@kairos/chain";
import { manifestFromSkill, type FlatSkill, type SkillManifest } from "@kairos/manifest";
import { KairosError, attemptAsync, type KairosErrorCode, type Result } from "@kairos/shared";

/**
 * @kairos/sdk — the typed public client for a Kairos gateway.
 *
 * One object, one base URL. Every method maps to a gateway route; errors are
 * translated to the shared taxonomy (`payment_required`, `not_found`, …) so a
 * caller can branch on codes rather than string-matching messages.
 */

export interface KairosClientOptions {
  /** Gateway base URL, e.g. "https://kairos-api.example.com". */
  baseUrl: string;
  /** Injectable fetch — lets tests stub the network without a server. */
  fetch?: typeof fetch;
}

export interface ChainStatus {
  configured: boolean;
  demoMode: boolean;
  network: string;
  chainId: number;
  blockNumber: number;
  rpcUrl: string;
  explorer: string;
}

export interface QuoteEnvelope {
  x402Version: number;
  error: string;
  accepts: {
    scheme: string;
    network: string;
    maxAmountRequired: string;
    resource: string;
    description: string;
    mimeType: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra: { nonce: string };
  }[];
}

export interface InvokeOutcome {
  status: number;
  body: unknown;
}

export interface StealthKeys {
  metaAddress: string;
  spendingKey: string;
  viewingKey: string;
}

export interface StealthPayment {
  address: string;
  amountWei: string;
  hash: string;
  announcement: string;
}

export interface VaultStatus {
  [key: string]: unknown;
}

export interface KairosClient {
  readonly baseUrl: string;
  health(): Promise<{ ok: boolean }>;
  chainStatus(): Promise<ChainStatus>;
  /** The chain the gateway is configured for. */
  chain(): Promise<ChainStatus>;

  // ── catalogue ─────────────────────────────────────────────────────────────
  listSkills(): Promise<FlatSkill[]>;
  getSkill(slug: string): Promise<FlatSkill>;
  /** Enriched manifest for a skill. */
  manifest(slug: string): Promise<SkillManifest>;

  // ── x402 payments ─────────────────────────────────────────────────────────
  /** Ask the price; answers 402 with the terms for an unpaid call. */
  quote(slug: string): Promise<QuoteEnvelope>;
  /** Call a skill. A 402 comes back as a normal value, not an exception. */
  invoke(slug: string, input: unknown): Promise<InvokeOutcome>;
  /** Pay-and-run through the gateway relayer. */
  autoPay(slug: string, input: unknown, nonce: string): Promise<unknown>;

  // ── confidential vault ────────────────────────────────────────────────────
  vaultStatus(): Promise<VaultStatus>;
  settle(agent: string, amountWei: string, payTo?: string): Promise<unknown>;
  fund(amountWei: string): Promise<unknown>;
  registerAgent(agent: string, capWei: string): Promise<unknown>;
  flushEpoch(): Promise<{ hash: string }>;

  // ── stealth payouts ───────────────────────────────────────────────────────
  generateStealthKeys(): Promise<StealthKeys>;
  deriveStealthAddress(metaAddress: string): Promise<unknown>;
  checkStealthPayment(metaAddress: string, txHash: string): Promise<unknown>;
}

interface ErrorBody {
  error?: string;
  message?: string;
}

/** Map an HTTP status to the shared error taxonomy. */
function errorForStatus(status: number, body: ErrorBody, fallback: string): KairosError {
  const message = body.error ?? body.message ?? fallback;
  const code: KairosErrorCode =
    status === 400 ? "invalid_input" :
    status === 401 ? "unauthenticated" :
    status === 402 ? "payment_required" :
    status === 403 ? "forbidden" :
    status === 404 ? "not_found" :
    status === 409 ? "conflict" :
    status === 429 ? "rate_limited" :
    "upstream_failure";
  return new KairosError(code, message);
}

async function request(fetcher: typeof fetch, baseUrl: string, path: string, init: RequestInit = {}): Promise<unknown> {
  const url = `${baseUrl.replace(/\/+$/, "")}${path}`;
  const res = await fetcher(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw errorForStatus(res.status, (body as ErrorBody) ?? {}, `gateway answered ${res.status}`);
  }
  return body;
}

export function createKairosClient(options: KairosClientOptions): KairosClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetcher = options.fetch ?? globalThis.fetch;

  const get = (path: string) => request(fetcher, baseUrl, path);
  const post = (path: string, body?: unknown) =>
    request(fetcher, baseUrl, path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

  return {
    baseUrl,
    health: async () => (await get("/health")) as { ok: boolean },
    chainStatus: async () => (await get("/chain/status")) as ChainStatus,
    chain: async () => (await get("/chain/status")) as ChainStatus,

    listSkills: async () => {
      const r = (await get("/skills")) as { skills: FlatSkill[] };
      return r.skills;
    },
    getSkill: async (slug) => (await get(`/skills/${encodeURIComponent(slug)}`)) as FlatSkill,
    manifest: async (slug) => manifestFromSkill(await get(`/skills/${encodeURIComponent(slug)}`) as FlatSkill),

    quote: async (slug) => (await post(`/x402/skills/${encodeURIComponent(slug)}`, {})) as QuoteEnvelope,
    invoke: async (slug, input) => {
      try {
        const body = await post(`/s/${encodeURIComponent(slug)}`, input);
        return { status: 200, body };
      } catch (e) {
        if (e instanceof KairosError && e.code === "payment_required") {
          return { status: 402, body: await get(`/x402/skills/${encodeURIComponent(slug)}`) };
        }
        throw e;
      }
    },
    autoPay: async (slug, input, nonce) => post(`/s/${encodeURIComponent(slug)}/auto-pay`, { nonce, input }),

    vaultStatus: async () => (await get("/nox/status")) as VaultStatus,
    settle: async (agent, amountWei, payTo) => post("/nox/settle", { agent, amountWei, ...(payTo ? { payTo } : {}) }),
    fund: async (amountWei) => post("/nox/fund", { amountWei }),
    registerAgent: async (agent, capWei) => post("/nox/agents", { agent, capWei }),
    flushEpoch: async () => (await post("/nox/epoch/flush")) as { hash: string },

    generateStealthKeys: async () => (await post("/stealth/keys", {})) as StealthKeys,
    deriveStealthAddress: async (metaAddress) => post("/stealth/derive", { metaAddress }),
    checkStealthPayment: async (metaAddress, txHash) => post("/stealth/check", { metaAddress, txHash }),
  };
}

/** Create a client and confirm it reaches a gateway. */
export async function connect(options: KairosClientOptions): Promise<Result<KairosClient, KairosError>> {
  return attemptAsync(async () => {
    const client = createKairosClient(options);
    const health = await client.health();
    if (!health.ok) throw new Error(`gateway at ${options.baseUrl} did not answer ok`);
    return client;
  });
}

/** The chain the public deployment lives on. */
export { MAINNET_CHAIN };
