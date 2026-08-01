import type { ConfidentialClient } from "@kairos/confidential";
import type { Address } from "viem";

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
      "on-chain, so an observer cannot tell whether it was allowed. Use this " +
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
      },
      required: ["amountWei", "agent"],
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
      const { hash, verdict, spentWei } = await confidential.settle(
        args.agent as Address,
        BigInt(args.amountWei ?? "0"),
      );
      const paid = verdict.outcome === "authorized";
      return text({
        paid,
        summary: paid
          ? `Paid ${args.amountWei} wei. The amount stays encrypted on-chain.`
          : "Refused — over the limit, or not enough left. Nothing moved.",
        transaction: hash,
        explorer: `https://sepolia.etherscan.io/tx/${hash}`,
        spentSoFar: spentWei,
        note:
          "Both outcomes produce a successful transaction. Nobody watching the " +
          "chain can tell which this was.",
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
