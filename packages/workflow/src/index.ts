import { invalidInput, type Result, err, ok } from "@kairos/shared";

/**
 * @kairos/workflow — the graph engine behind reusable agent flows.
 *
 * A workflow is a directed graph: one trigger, then http / condition / onchain /
 * transform / delay nodes joined by edges. Condition edges carry a `branch`
 * label ("true"/"false"); all other edges are unconditional.
 *
 * Execution is deterministic and pure — external work (http calls, on-chain
 * operations) is injected through handlers, so the engine itself is fully
 * testable without network or chain access.
 */

export type WorkflowNodeKind = "trigger" | "http" | "condition" | "onchain" | "transform" | "delay";

export interface WorkflowNode {
  id: string;
  kind: WorkflowNodeKind;
  /** Kind-specific fields: url/method for http, left/op/right for condition, … */
  config?: Record<string, unknown>;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  /** Only on edges leaving a condition: "true" or "false". */
  branch?: "true" | "false";
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

/** The flat steps form some editors produce. */
export interface WorkflowStep {
  id?: string;
  kind: WorkflowNodeKind;
  [key: string]: unknown;
}

/** Default execution budget, mirrored from the gateway env defaults. */
export const DEFAULT_MAX_NODE_EXECUTIONS = 500;
export const DEFAULT_MAX_LOOP_ITEMS = 100;

export type GraphValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** Structural checks: unique ids, one trigger, edges reference real nodes. */
export function validateGraph(graph: WorkflowGraph): GraphValidation {
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    return { ok: false, reason: "graph must contain at least one node" };
  }
  if (!Array.isArray(graph.edges)) return { ok: false, reason: "graph.edges must be an array" };

  const ids = new Set<string>();
  for (const n of graph.nodes) {
    if (typeof n.id !== "string" || n.id.length === 0) return { ok: false, reason: "every node needs an id" };
    if (ids.has(n.id)) return { ok: false, reason: `duplicate node id: ${n.id}` };
    ids.add(n.id);
    if (typeof n.kind !== "string" || !["trigger", "http", "condition", "onchain", "transform", "delay"].includes(n.kind)) {
      return { ok: false, reason: `node ${n.id} has unknown kind ${String(n.kind)}` };
    }
  }

  const triggers = graph.nodes.filter((n) => n.kind === "trigger");
  if (triggers.length !== 1) return { ok: false, reason: "exactly one trigger node is required" };

  for (const e of graph.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) return { ok: false, reason: `edge ${e.from} -> ${e.to} references an unknown node` };
    if (e.from === e.to) return { ok: false, reason: `edge ${e.from} -> ${e.to} is a self-loop` };
    const from = graph.nodes.find((n) => n.id === e.from)!;
    if (from.kind === "condition" && e.branch !== "true" && e.branch !== "false") {
      return { ok: false, reason: `condition ${e.from} edges must carry a branch` };
    }
    if (from.kind !== "condition" && e.branch !== undefined) {
      return { ok: false, reason: `edge ${e.from} -> ${e.to} carries a branch but leaves a non-condition` };
    }
  }

  return { ok: true };
}

/** Build a linear graph from flat steps, giving each a stable id. */
export function graphFromSteps(steps: WorkflowStep[]): WorkflowGraph {
  const nodes: WorkflowNode[] = steps.map((s, i) => {
    const { id, kind, ...rest } = s;
    return { id: id || `step_${i + 1}`, kind, config: rest };
  });
  const edges = nodes.slice(0, -1).map((n, i) => ({ from: n.id, to: nodes[i + 1]!.id }));
  return { nodes, edges };
}

// ─── execution ───────────────────────────────────────────────────────────────

/** Values flowing between nodes. */
export interface RunContext {
  input: Record<string, unknown>;
  vars: Record<string, unknown>;
}

/** The work a node needs done. Injected, so the engine stays pure. */
export interface StepHandlers {
  http?: (node: WorkflowNode, ctx: RunContext) => Promise<Record<string, unknown>>;
  onchain?: (node: WorkflowNode, ctx: RunContext) => Promise<Record<string, unknown>>;
  transform?: (node: WorkflowNode, ctx: RunContext) => Promise<Record<string, unknown>>;
}

export type NodeRunStatus = "ok" | "error" | "skipped";

export interface NodeRun {
  nodeId: string;
  kind: WorkflowNodeKind;
  status: NodeRunStatus;
  /** Set on success. */
  output?: Record<string, unknown>;
  /** Set on failure. */
  error?: string;
}

export interface RunResult {
  /** One entry per executed node, in visit order. */
  trace: NodeRun[];
  /** Set when the run was cut short by a budget. */
  truncated?: string;
}

export interface ExecuteOptions {
  maxNodeExecutions?: number;
  maxLoopItems?: number;
}

/**
 * Execute a graph against an input.
 *
 * Semantics:
 * - begins at the trigger; unconditional edges fan out breadth-first;
 * - a condition evaluates `left op right` from `ctx.vars` and takes only the
 *   matching branch;
 * - a node visited more than `maxLoopItems` times aborts the run (loop guard);
 * - a missing handler marks the node `skipped` and continues, so a graph with
 *   an unbacked operation still produces an honest trace.
 */
export async function executeGraph(
  graph: WorkflowGraph,
  input: Record<string, unknown>,
  handlers: StepHandlers = {},
  options: ExecuteOptions = {},
): Promise<RunResult> {
  const validation = validateGraph(graph);
  if (!validation.ok) return { trace: [], truncated: `invalid graph: ${validation.reason}` };

  const maxNodes = options.maxNodeExecutions ?? DEFAULT_MAX_NODE_EXECUTIONS;
  const maxLoops = options.maxLoopItems ?? DEFAULT_MAX_LOOP_ITEMS;
  const ctx: RunContext = { input, vars: { input } };
  const visits = new Map<string, number>();
  const trace: NodeRun[] = [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, WorkflowEdge[]>();
  for (const e of graph.edges) {
    const list = outgoing.get(e.from) ?? [];
    list.push(e);
    outgoing.set(e.from, list);
  }

  const trigger = graph.nodes.find((n) => n.kind === "trigger")!;
  const queue: string[] = [trigger.id];
  let executions = 0;

  while (queue.length > 0 && executions < maxNodes) {
    const id = queue.shift()!;
    const node = byId.get(id);
    if (!node) continue;

    const visited = visits.get(id) ?? 0;
    if (visited >= maxLoops) {
      trace.push({ nodeId: id, kind: node.kind, status: "skipped", error: `loop guard: visited ${visited} times` });
      continue;
    }
    visits.set(id, visited + 1);
    executions += 1;

    const base: NodeRun = { nodeId: id, kind: node.kind, status: "ok" };

    if (node.kind === "trigger") {
      base.output = { trigger: true };
    } else if (node.kind === "condition") {
      const okBranch = evaluateCondition(node, ctx);
      base.output = { branch: okBranch ? "true" : "false" };
    } else if (node.kind === "delay") {
      base.output = { ms: node.config?.ms ?? 0 };
    } else {
      const handler =
        node.kind === "http" ? handlers.http : node.kind === "onchain" ? handlers.onchain : node.kind === "transform" ? handlers.transform : undefined;
      if (!handler) {
        base.status = "skipped";
        base.error = `no handler for ${node.kind} nodes`;
      } else {
        try {
          const out = await handler(node, ctx);
          base.output = out;
          ctx.vars[id] = out;
        } catch (e) {
          base.status = "error";
          base.error = e instanceof Error ? e.message : String(e);
        }
      }
    }

    // Successors are queued regardless of this node's outcome, so a failed node
    // is observable without stranding its dependents. Conditions still take
    // only their matching branch.
    const condBranch = (base.output as { branch?: string } | undefined)?.branch;
    const next =
      node.kind === "condition"
        ? (outgoing.get(id) ?? []).filter((e) => e.branch === condBranch).map((e) => e.to)
        : (outgoing.get(id) ?? []).map((e) => e.to);

    trace.push(base);
    queue.push(...next);
  }

  const truncated = executions >= maxNodes ? `exceeded ${maxNodes} node executions` : undefined;
  return { trace, ...(truncated ? { truncated } : {}) };
}

/** Coerce a resolved value to something comparable. */
function toComparable(v: unknown): number | bigint | string {
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "string") return v;
  return String(v);
}

/** Evaluate a condition node's `left op right` against the run context. */
export function evaluateCondition(node: WorkflowNode, ctx: RunContext): boolean {
  const cfg = node.config ?? {};
  const l = toComparable(resolveValue(cfg.left, ctx));
  const r = toComparable(resolveValue(cfg.right, ctx));
  const op = String(cfg.op ?? "==");
  // Numeric-looking strings compare numerically, so a condition on an amount
  // works whether the value arrived as a string or a number.
  const ln = typeof l === "string" && /^-?\d+$/.test(l) ? BigInt(l) : l;
  const rn = typeof r === "string" && /^-?\d+$/.test(r) ? BigInt(r) : r;
  switch (op) {
    case ">":
      return ln > rn;
    case ">=":
      return ln >= rn;
    case "<":
      return ln < rn;
    case "<=":
      return ln <= rn;
    case "!=":
      return ln !== rn;
    default:
      return ln === rn;
  }
}

/** Resolve `{{path}}` templates against the run context. */
export function resolveValue(value: unknown, ctx: RunContext): unknown {
  if (typeof value !== "string") return value;
  const m = /^\{\{\s*([\w.]+)\s*\}\}$/.exec(value);
  if (!m) return value;
  const path = m[1]!.split(".");
  let cur: unknown = ctx.vars;
  for (const part of path) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Validate a graph, returning a shared-style result for boundary use. */
export function validateGraphResult(graph: WorkflowGraph): Result<WorkflowGraph, ReturnType<typeof invalidInput>> {
  const v = validateGraph(graph);
  return v.ok ? ok(graph) : err(invalidInput(v.reason));
}
