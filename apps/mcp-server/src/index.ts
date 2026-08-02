#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * Kairos MCP server.
 *
 * Turns the confidential vault into tools an AI agent can call. The agent asks
 * to pay; the gateway decides whether it may, inside the TEE, against a limit
 * the agent cannot read and cannot raise.
 *
 * The agent never holds a key, never sees the treasury balance, and never
 * learns its own cap. It learns exactly one thing per payment: allowed, or not.
 *
 * Payouts land on stealth addresses. The relayer already hid the payer — every
 * agent shares one sender. Paying a fixed address left the other half exposed: a
 * public record of how often this recipient is paid and how much. With a payee
 * meta-address set, every payment derives a fresh address that has never
 * appeared on-chain and that only its recipient can link to themselves.
 *
 * Configure with:
 *   KAIROS_GATEWAY_URL        default https://kairos-api.187.127.137.136.sslip.io
 *   KAIROS_AGENT_ADDRESS      the agent this server pays as
 *   KAIROS_PAYEE_META_ADDRESS st:eth:0x… — set once and every payment is stealth
 */

const GATEWAY =
  process.env.KAIROS_GATEWAY_URL ?? "https://kairos-api.187.127.137.136.sslip.io";
const AGENT = process.env.KAIROS_AGENT_ADDRESS ?? "";
const PAYEE = process.env.KAIROS_PAYEE_META_ADDRESS ?? "";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok && res.status !== 402) {
    throw new Error(body.message ?? `${path} failed with ${res.status}`);
  }
  return body;
}

const server = new Server(
  { name: "kairos", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "kairos_pay",
      description:
        "Pay for something from the confidential budget. The amount is encrypted " +
        "and checked against this agent's spending limit inside a secure enclave. " +
        "If it is over the limit the payment is refused and nothing moves — but " +
        "the transaction still succeeds on-chain, so an observer cannot tell " +
        "whether it was allowed. The payout lands on a one-time stealth address " +
        "that has never appeared on-chain, so the recipient builds no public " +
        "payment history either. Returns whether the payment went through.",
      inputSchema: {
        type: "object",
        properties: {
          amountWei: {
            type: "string",
            description: "Amount in wei, as a decimal string. e.g. \"40000\"",
          },
          agent: {
            type: "string",
            description:
              "Agent wallet address to pay as. Defaults to KAIROS_AGENT_ADDRESS.",
          },
          payTo: {
            type: "string",
            description:
              "Recipient stealth meta-address (st:eth:0x…) from kairos_stealth_keys. " +
              "Defaults to KAIROS_PAYEE_META_ADDRESS. Every payment derives a fresh " +
              "address, so paying the same recipient twice is unlinkable.",
          },
        },
        required: ["amountWei"],
      },
    },
    {
      name: "kairos_stealth_keys",
      description:
        "Generate a stealth key set for receiving payments. Returns a " +
        "meta-address to publish and two private keys returned exactly once and " +
        "never stored — the spending key moves the funds, the viewing key only " +
        "detects them, which is what lets an auditor see without custody.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "kairos_stealth_check",
      description:
        "Check whether an announced stealth payment belongs to you. Needs your " +
        "viewing private key and spending public key, plus the announcement's " +
        "ephemeral key, address and view tag. Answers only for its holder — " +
        "anyone else scanning the same announcement learns nothing.",
      inputSchema: {
        type: "object",
        properties: {
          viewingPrivateKey: { type: "string", description: "Your viewing private key (0x…)." },
          spendingPublicKey: { type: "string", description: "Your spending public key (0x…)." },
          ephemeralPublicKey: { type: "string", description: "From the announcement (0x…)." },
          stealthAddress: { type: "string", description: "The announced address (0x…)." },
          viewTag: { type: "number", description: "First metadata byte, 0–255." },
        },
        required: [
          "viewingPrivateKey",
          "spendingPublicKey",
          "ephemeralPublicKey",
          "stealthAddress",
        ],
      },
    },
    {
      name: "kairos_status",
      description:
        "Check the vault: which network, which contract, the current batch, and " +
        "whether the gateway can sign. Reveals no balances or limits.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "kairos_spend",
      description:
        "How much this agent has spent so far, and its limit — but only if the " +
        "caller is permitted to decrypt them. Otherwise both come back null, " +
        "which is the system working as intended rather than an error.",
      inputSchema: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Agent wallet address." },
        },
      },
    },
    {
      name: "kairos_list_apis",
      description: "List the paid APIs available through this Kairos gateway.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, string>;

  const text = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  });

  try {
    switch (name) {
      case "kairos_pay": {
        const agent = a.agent || AGENT;
        if (!agent) throw new Error("No agent address. Set KAIROS_AGENT_ADDRESS.");

        const payTo = a.payTo || PAYEE;

        const result = await api<{
          authorized: boolean;
          hash: string;
          reason?: string;
          spentWei: string | null;
          stealth?: {
            address: string;
            ephemeralPublicKey: string;
            viewTag: number;
            announcement: string | null;
            warning?: string;
          };
        }>("/nox/settle", {
          method: "POST",
          body: JSON.stringify({
            agent,
            amountWei: a.amountWei,
            ...(payTo ? { payTo } : {}),
          }),
        });

        return text({
          paid: result.authorized,
          // Both outcomes are reported plainly. A refusal is not an error — it
          // is the budget doing its job, and the agent is entitled to know it
          // was refused even though nobody else is.
          summary: result.authorized
            ? `Paid ${a.amountWei} wei. The amount stays encrypted on-chain.`
            : `Refused — over the limit, or not enough left. Nothing moved.`,
          transaction: result.hash,
          explorer: `https://sepolia.etherscan.io/tx/${result.hash}`,
          spentSoFar: result.spentWei,
          // Present only on an authorized payment — a refusal is never
          // announced, because publishing one would leak that it happened.
          ...(result.stealth
            ? {
                stealth: result.stealth,
                stealthNote:
                  "This payout is destined for an address that has never appeared " +
                  "on-chain. Funds reach it when the epoch is routed, not at this " +
                  "call — a per-payment transfer would republish the timing the " +
                  "batch exists to hide.",
              }
            : {}),
        });
      }

      case "kairos_stealth_keys":
        return text(await api("/stealth/keys", { method: "POST", body: "{}" }));

      case "kairos_stealth_check":
        return text(
          await api("/stealth/check", {
            method: "POST",
            body: JSON.stringify({
              viewingPrivateKey: a.viewingPrivateKey,
              spendingPublicKey: a.spendingPublicKey,
              ephemeralPublicKey: a.ephemeralPublicKey,
              stealthAddress: a.stealthAddress,
              viewTag: Number(a.viewTag ?? 0),
            }),
          }),
        );

      case "kairos_status":
        return text(await api("/nox/status"));

      case "kairos_spend": {
        const agent = a.agent || AGENT;
        if (!agent) throw new Error("No agent address. Set KAIROS_AGENT_ADDRESS.");
        return text(await api(`/nox/agents/${agent}`));
      }

      case "kairos_list_apis":
        return text(await api("/fabric/apis"));

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (cause) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: cause instanceof Error ? cause.message : String(cause),
        },
      ],
    };
  }
});

await server.connect(new StdioServerTransport());
