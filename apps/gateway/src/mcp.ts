import type { ConfidentialClient } from "@kairos/confidential";
import { checkStealthPayment, generateStealthKeys } from "@kairos/shared";
import type { Address } from "viem";
import type { GatewayConfig } from "./config.js";
import { announceStealthPayout, resolveStealthPayout } from "./stealth.js";

/**
 * Remote MCP over HTTP — the transport Claude's custom connectors speak.
 *
 * This is deliberately not the stdio server in apps/mcp-server. A connector is
 * a URL a user pastes into Claude's settings; it must answer JSON-RPC over
 * plain POST with no local install, which is what makes the demo one paste
 * instead of a terminal session.
 *
 * Implemented directly rather than through the SDK's transport because the
 * surface needed here is three methods, and hand-rolling them keeps the
 * gateway free of a stdio-shaped dependency.
 */

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
  {
    name: "kairos_pay",
    description:
      "Pay from a confidential budget on Kairos. The amount is encrypted and " +
      "compared against this agent's spending limit inside a secure enclave. " +
      "Over the limit and nothing moves — but the transaction still succeeds " +
      "on-chain, so an observer cannot tell whether it was allowed. The payout " +
      "lands on a one-time stealth address that has never appeared on-chain, so " +
      "the recipient accumulates no public payment history either. Use this " +
      "whenever the user asks to pay, send, or spend from their Kairos budget.",
    inputSchema: {
      type: "object",
      properties: {
        amountWei: {
          type: "string",
          description: 'Amount in wei as a decimal string, e.g. "40000".',
        },
        agent: {
          type: "string",
          description: "Agent wallet address (0x…) paying. Required.",
        },
        payTo: {
          type: "string",
          description:
            "Recipient stealth meta-address (st:eth:0x…) from kairos_stealth_keys. " +
            "Omit to use the operator's configured payee. Every payment derives a " +
            "fresh address, so paying the same recipient twice is unlinkable.",
        },
      },
      required: ["amountWei", "agent"],
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
      "Vault status: network, contract, current batch, whether the gateway can " +
      "sign. Reveals no balances or limits.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "kairos_spend",
    description:
      "What an agent has spent and its limit — only if the caller may decrypt " +
      "them. Otherwise both are null, which is the system working, not an error.",
    inputSchema: {
      type: "object",
      properties: { agent: { type: "string", description: "Agent address (0x…)." } },
      required: ["agent"],
    },
  },
  {
    name: "kairos_list_apis",
    description: "List the paid APIs available through this Kairos gateway.",
    inputSchema: { type: "object", properties: {} },
  },
];

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

async function callTool(
  confidential: ConfidentialClient,
  config: GatewayConfig,
  listApis: () => unknown,
  name: string,
  args: Record<string, string>,
): Promise<ToolResult> {
  const text = (v: unknown): ToolResult => ({
    content: [{ type: "text", text: JSON.stringify(v, null, 2) }],
  });

  switch (name) {
    case "kairos_pay": {
      if (!args.agent) throw new Error("agent address is required");

      // Derived before settling, so a malformed meta-address fails the call
      // rather than producing a payment nobody can collect.
      const payout = resolveStealthPayout(config, args.payTo);

      const { hash, verdict, spentWei } = await confidential.settle(
        args.agent as Address,
        BigInt(args.amountWei ?? "0"),
      );
      const paid = verdict.outcome === "authorized";

      // Announced only on an authorized payment. Publishing a refusal would
      // write a false entry to a public log and reveal that an attempt happened.
      const stealth = paid && payout ? await announceStealthPayout(confidential, payout) : null;

      return text({
        paid,
        summary: paid
          ? `Paid ${args.amountWei} wei. The amount stays encrypted on-chain.`
          : "Refused — over the limit, or not enough left. Nothing moved.",
        transaction: hash,
        explorer: `https://sepolia.etherscan.io/tx/${hash}`,
        spentSoFar: spentWei,
        ...(stealth
          ? {
              stealth,
              stealthNote:
                "This payout is destined for an address that has never appeared " +
                "on-chain. Funds reach it when the epoch is routed, not at this " +
                "call — a per-payment transfer would republish the timing the " +
                "batch exists to hide.",
            }
          : {}),
        note:
          "Both outcomes produce a successful transaction. Nobody watching the " +
          "chain can tell which this was.",
      });
    }

    case "kairos_stealth_keys": {
      const keys = generateStealthKeys();
      return text({
        metaAddress: keys.metaAddress,
        spendingPublicKey: keys.spendingPublicKey,
        viewingPublicKey: keys.viewingPublicKey,
        spendingPrivateKey: keys.spendingPrivateKey,
        viewingPrivateKey: keys.viewingPrivateKey,
        warning:
          "Save both private keys now. They are not stored here and cannot be " +
          "recovered. Losing them loses every payment made to this meta-address.",
      });
    }

    case "kairos_stealth_check": {
      if (!args.viewingPrivateKey || !args.spendingPublicKey) {
        throw new Error("viewingPrivateKey and spendingPublicKey are required");
      }
      const mine = checkStealthPayment(
        {
          viewingPrivateKey: args.viewingPrivateKey as `0x${string}`,
          spendingPublicKey: args.spendingPublicKey as `0x${string}`,
        },
        {
          ephemeralPublicKey: (args.ephemeralPublicKey ?? "0x") as `0x${string}`,
          stealthAddress: (args.stealthAddress ?? "0x") as `0x${string}`,
          viewTag: Number(args.viewTag ?? 0),
        },
      );
      return text({
        mine,
        summary: mine
          ? "This payment is yours. Derive its private key from your spending and viewing keys to move the funds."
          : "Not yours — or not derivable with these keys.",
      });
    }
    case "kairos_status":
      return text(await confidential.status());
    case "kairos_spend": {
      if (!args.agent) throw new Error("agent address is required");
      return text(await confidential.agent(args.agent as Address));
    }
    case "kairos_list_apis":
      return text(listApis());
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/** Handle one JSON-RPC message. Returns null for notifications. */
export async function handleMcp(
  confidential: ConfidentialClient,
  config: GatewayConfig,
  listApis: () => unknown,
  body: JsonRpcRequest,
): Promise<object | null> {
  const { id, method, params } = body;
  const ok = (result: unknown) => ({ jsonrpc: "2.0" as const, id, result });

  switch (method) {
    case "initialize":
      return ok({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "kairos", version: "0.1.0" },
      });

    // Notifications carry no id and must not be answered.
    case "notifications/initialized":
      return null;

    case "tools/list":
      return ok({ tools: TOOLS });

    case "tools/call": {
      const p = (params ?? {}) as { name?: string; arguments?: Record<string, string> };
      try {
        const result = await callTool(
          confidential,
          config,
          listApis,
          p.name ?? "",
          p.arguments ?? {},
        );
        return ok(result);
      } catch (cause) {
        // A tool failure is reported inside the result, not as a protocol
        // error — otherwise the client shows a transport failure for what is
        // really a bad argument.
        return ok({
          isError: true,
          content: [
            { type: "text", text: cause instanceof Error ? cause.message : String(cause) },
          ],
        });
      }
    }

    case "ping":
      return ok({});

    default:
      return {
        jsonrpc: "2.0" as const,
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}
