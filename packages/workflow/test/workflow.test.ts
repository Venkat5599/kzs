import { describe, expect, it } from "bun:test";
import {
  executeGraph,
  graphFromSteps,
  resolveValue,
  validateGraph,
  type WorkflowGraph,
} from "../src/index.js";

/** The branch-demo graph from the gateway's seed data. */
const BRANCH_DEMO: WorkflowGraph = {
  nodes: [
    { id: "start", kind: "trigger" },
    { id: "gate", kind: "condition", config: { left: "{{input.amount}}", op: "<=", right: "1000" } },
    { id: "cheap", kind: "http", config: { method: "GET", url: "https://api.example.dev/cheap" } },
    { id: "pricey", kind: "onchain", config: { action: "vault_settle" } },
    { id: "receipt", kind: "transform", config: { value: "{{input.amount}}" } },
  ],
  edges: [
    { from: "start", to: "gate" },
    { from: "gate", to: "cheap", branch: "true" },
    { from: "gate", to: "pricey", branch: "false" },
    { from: "cheap", to: "receipt" },
    { from: "pricey", to: "receipt" },
  ],
};

describe("validateGraph", () => {
  it("accepts the seed branch graph", () => {
    expect(validateGraph(BRANCH_DEMO)).toEqual({ ok: true });
  });

  it("rejects duplicate ids and unknown kinds", () => {
    expect(validateGraph({ nodes: [{ id: "a", kind: "trigger" }, { id: "a", kind: "http" }], edges: [] }).ok).toBe(false);
    expect(validateGraph({ nodes: [{ id: "a", kind: "magic" as never }], edges: [] }).ok).toBe(false);
  });

  it("requires exactly one trigger", () => {
    expect(validateGraph({ nodes: [{ id: "a", kind: "http" }], edges: [] }).ok).toBe(false);
  });

  it("rejects edges to unknown nodes and branch labels on non-conditions", () => {
    expect(validateGraph({ nodes: [{ id: "a", kind: "trigger" }], edges: [{ from: "a", to: "ghost" }] }).ok).toBe(false);
    expect(validateGraph({ nodes: [{ id: "a", kind: "trigger" }], edges: [{ from: "a", to: "b", branch: "true" }] }).ok).toBe(false);
  });
});

describe("graphFromSteps", () => {
  it("builds a linear graph with stable ids", () => {
    const g = graphFromSteps([{ kind: "trigger" }, { kind: "http", url: "x" }, { kind: "transform" }]);
    expect(g.nodes.map((n) => n.id)).toEqual(["step_1", "step_2", "step_3"]);
    expect(g.edges).toEqual([{ from: "step_1", to: "step_2" }, { from: "step_2", to: "step_3" }]);
  });
});

describe("executeGraph", () => {
  it("runs the cheap branch when the condition passes", async () => {
    const result = await executeGraph(BRANCH_DEMO, { amount: "500" }, {
      http: async (n) => ({ status: 200, url: n.config?.url }),
      onchain: async () => ({ hash: "0x" }),
      transform: async (n) => ({ value: n.config?.value }),
    });
    expect(result.truncated).toBeUndefined();
    const kinds = result.trace.map((t) => `${t.nodeId}:${t.kind}:${t.status}`).join(",");
    expect(kinds).toContain("gate:condition:ok");
    expect(kinds).toContain("cheap:http:ok");
    expect(kinds).toContain("receipt:transform:ok");
    expect(kinds).not.toContain("pricey");
  });

  it("runs the pricey branch when the condition fails", async () => {
    const result = await executeGraph(BRANCH_DEMO, { amount: "5000" }, {
      http: async () => ({ status: 200 }),
      onchain: async () => ({ hash: "0xabc" }),
      transform: async () => ({}),
    });
    expect(result.trace.some((t) => t.nodeId === "pricey" && t.status === "ok")).toBe(true);
    expect(result.trace.some((t) => t.nodeId === "cheap")).toBe(false);
  });

  it("records errors and continues down unconditional edges", async () => {
    const result = await executeGraph(BRANCH_DEMO, { amount: "500" }, {
      http: async () => {
        throw new Error("upstream 500");
      },
      transform: async () => ({}),
    });
    const cheap = result.trace.find((t) => t.nodeId === "cheap")!;
    expect(cheap.status).toBe("error");
    expect(cheap.error).toBe("upstream 500");
    expect(result.trace.some((t) => t.nodeId === "receipt")).toBe(true);
  });

  it("skips nodes whose handler is missing, honestly", async () => {
    const result = await executeGraph(BRANCH_DEMO, { amount: "5000" }, {});
    const pricey = result.trace.find((t) => t.nodeId === "pricey")!;
    expect(pricey.status).toBe("skipped");
    expect(pricey.error).toMatch(/no handler/);
  });

  it("guards against loops", async () => {
    const loop: WorkflowGraph = {
      nodes: [
        { id: "start", kind: "trigger" },
        { id: "a", kind: "transform" },
        { id: "b", kind: "transform" },
      ],
      edges: [
        { from: "start", to: "a" },
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    };
    const result = await executeGraph(loop, {}, { transform: async () => ({}) }, { maxLoopItems: 5 });
    expect(result.trace.filter((t) => t.status === "skipped" && /loop guard/.test(t.error ?? ""))).toBeTruthy();
    expect(result.trace.length).toBeLessThan(20);
  });

  it("returns an invalid-graph result without executing", async () => {
    const result = await executeGraph({ nodes: [], edges: [] }, {});
    expect(result.trace).toEqual([]);
    expect(result.truncated).toMatch(/invalid graph/);
  });

  it("resolves templates from earlier node outputs", async () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: "start", kind: "trigger" },
        { id: "fetch", kind: "http" },
        { id: "use", kind: "transform", config: { value: "{{fetch.temperature}}" } },
      ],
      edges: [
        { from: "start", to: "fetch" },
        { from: "fetch", to: "use" },
      ],
    };
    const result = await executeGraph(g, {}, {
      http: async () => ({ temperature: 21 }),
      transform: async (n, ctx) => ({ value: resolveValue(n.config?.value, ctx) }),
    });
    const use = result.trace.find((t) => t.nodeId === "use")!;
    expect(use.output).toEqual({ value: 21 });
  });

  it("honors the node execution budget", async () => {
    const chain: WorkflowGraph = {
      nodes: Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, kind: ("transform" as const) })),
      edges: Array.from({ length: 29 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` })),
    };
    chain.nodes[0] = { id: "n0", kind: "trigger" };
    const result = await executeGraph(chain, {}, { transform: async () => ({}) }, { maxNodeExecutions: 10 });
    expect(result.truncated).toMatch(/exceeded 10/);
    expect(result.trace.length).toBeLessThan(30);
  });
});
