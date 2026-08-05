import { describe, expect, it } from "bun:test";
import { createExecutionService, summarizeTrace } from "../src/index.js";
import type { WorkflowGraph } from "@kairos/workflow";

const GRAPH = {
  nodes: [
    { id: "start", kind: "trigger" as const },
    { id: "gate", kind: "condition" as const, config: { left: "{{input.amount}}", op: "<=" as const, right: "1000" } },
    { id: "ok", kind: "transform" as const },
    { id: "fail", kind: "transform" as const },
  ],
  edges: [
    { from: "start", to: "gate" },
    { from: "gate", to: "ok", branch: "true" as const },
    { from: "gate", to: "fail", branch: "false" as const },
  ],
};

describe("execution service", () => {
  it("runs a workflow and records it", async () => {
    const svc = createExecutionService();
    const r = await svc.run({ name: "demo", graph: GRAPH }, { amount: "500" }, { transform: async () => ({ done: true }) });
    expect(r.ok).toBe(true);
    const run = r.ok ? r.value : null;
    expect(run!.workflow).toBe("demo");
    expect(run!.result.trace.some((t) => t.nodeId === "ok" && t.status === "ok")).toBe(true);
    expect(run!.result.trace.some((t) => t.nodeId === "fail")).toBe(false);
  });

  it("rejects a workflow without a graph", async () => {
    const svc = createExecutionService();
    const r = await svc.run({ name: "empty" }, {}, {});
    expect(r.ok).toBe(false);
  });

  it("honors execution limits", async () => {
    const svc = createExecutionService({ maxNodeExecutions: 3 });
    const longGraph: WorkflowGraph = {
      nodes: Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, kind: ("transform" as const) })),
      edges: Array.from({ length: 9 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` })),
    };
    longGraph.nodes[0] = { id: "n0", kind: "trigger" };
    const r = await svc.run({ name: "long", graph: longGraph }, {}, { transform: async () => ({}) });
    expect(r.ok).toBe(true);
    expect(r.ok ? r.value.result.truncated : null).toMatch(/exceeded 3/);
  });

  it("summarizes traces without payloads", () => {
    const s = summarizeTrace([
      { nodeId: "a", kind: "trigger", status: "ok" },
      { nodeId: "b", kind: "http", status: "error", error: "upstream 500" },
      { nodeId: "c", kind: "onchain", status: "skipped", error: "no handler" },
    ]);
    expect(s).toEqual({ nodes: 3, ok: 1, error: 1, skipped: 1, firstError: "upstream 500" });
  });
});
