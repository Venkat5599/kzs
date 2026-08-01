"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Panel, Field, Input, Button } from "./ui";
import { WorkflowCanvas, NODE_KINDS, type RunState , PALETTE_MIME } from "./workflow-canvas";
import {
  saveWorkflowGraph,
  listWorkflowRuns,
  type FabricWorkflow,
  type WorkflowGraph,
  type WorkflowRunRecord,
  type WfNode,
} from "@/lib/api";

const OPS = [">=", ">", "<=", "<", "==", "!="];

/**
 * Client-side twin of the server's stepsToGraph, so a legacy flat workflow
 * renders on the canvas without having to be migrated first.
 */
export function graphFromWorkflow(wf: FabricWorkflow): WorkflowGraph {
  const existing = (wf as { graph?: WorkflowGraph }).graph;
  if (existing?.nodes?.length) return existing;

  const steps = (wf.steps ?? []) as ({ id?: string; kind: WfNode["kind"] } & Record<string, unknown>)[];
  const nodes: WfNode[] = steps.map((s, i) => {
    const { id, kind, ...rest } = s;
    return {
      id: id || `step_${i + 1}`,
      kind,
      position: { x: i * 240, y: 60 },
      config: rest as Record<string, unknown>,
    };
  });
  const edges = nodes.slice(0, -1).map((n, i) => ({ from: n.id, to: nodes[i + 1]!.id }));
  return { nodes, edges };
}

const KIND_LIST = Object.keys(NODE_KINDS) as WfNode["kind"][];

/** Defaults per kind, so a freshly added node is already close to runnable. */
function blankConfig(kind: WfNode["kind"]): Record<string, unknown> {
  if (kind === "http") return { method: "GET", url: "https://" };
  if (kind === "condition") return { left: "{{input.amount}}", op: "<=", right: "1000" };
  if (kind === "onchain") return { recipient: "{{input.recipient}}", amount: "{{input.amount}}" };
  if (kind === "delay") return { ms: 1000 };
  if (kind === "transform") return { value: "{{input.value}}" };
  if (kind === "loop") return { over: "{{input.items}}", body: [] };
  return {};
}

export function GraphEditor({
  wf,
  runState,
  onRunState,
}: {
  wf: FabricWorkflow;
  runState: RunState;
  onRunState: (s: RunState) => void;
}) {
  const [graph, setGraph] = useState<WorkflowGraph>(() => graphFromWorkflow(wf));
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [runs, setRuns] = useState<WorkflowRunRecord[]>([]);

  const slug = wf.slug ?? wf.name;
  const loadRuns = () => listWorkflowRuns(slug, 8).then(setRuns).catch(() => setRuns([]));
  useEffect(() => {
    listWorkflowRuns(slug, 8).then(setRuns).catch(() => setRuns([]));
  }, [slug]);

  const update = (next: WorkflowGraph) => {
    setGraph(next);
    setDirty(true);
  };

  /**
   * Add a node. With no `position` (clicking the palette) it is laid clear of
   * the last one; dragging from the palette supplies the drop point, already
   * converted to graph coordinates by the canvas.
   */
  const addNode = (kind: WfNode["kind"], position?: { x: number; y: number }) => {
    const n = graph.nodes.length;
    const base = `${kind}_${n + 1}`;
    const id = graph.nodes.some((x) => x.id === base) ? `${base}_${Date.now() % 1000}` : base;
    update({
      ...graph,
      nodes: [
        ...graph.nodes,
        {
          id,
          kind,
          position: position ?? { x: 40 + (n % 4) * 230, y: 40 + Math.floor(n / 4) * 130 },
          config: blankConfig(kind),
        },
      ],
    });
  };

  /**
   * Canvas drop handler. The kind crosses the drag boundary as a plain string,
   * so it is re-checked against the known kinds before it becomes a node.
   */
  const addNodeAt = (kind: string, position: { x: number; y: number }) => {
    if (!(KIND_LIST as readonly string[]).includes(kind)) return;
    addNode(kind as WfNode["kind"], position);
  };

  const patchNode = (id: string, patch: Partial<WfNode>) =>
    update({ ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) });

  /**
   * Clearing a timeout has to drop the key rather than set it to undefined —
   * the workspace runs with exactOptionalPropertyTypes.
   */
  const setTimeout_ = (id: string, ms: number) =>
    update({
      ...graph,
      nodes: graph.nodes.map((n) => {
        if (n.id !== id) return n;
        if (ms > 0) return { ...n, timeoutMs: ms };
        const { timeoutMs: _drop, ...rest } = n;
        return rest;
      }),
    });

  const patchConfig = (id: string, key: string, value: unknown) => {
    const node = graph.nodes.find((n) => n.id === id);
    if (!node) return;
    patchNode(id, { config: { ...(node.config ?? {}), [key]: value } });
  };

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      await saveWorkflowGraph(slug, graph);
      setDirty(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const node = graph.nodes.find((n) => n.id === selected) ?? null;
  const cfg = (node?.config ?? {}) as Record<string, unknown>;
  const str = (k: string) => String(cfg[k] ?? "");

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-white">Flow</p>
          <p className="text-sm text-neutral-500">
            Drag to arrange, pull a port to connect. A condition has two outputs — the upper fires on
            pass, the lower on fail.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {dirty && <span className="text-xs text-amber-400">unsaved</span>}
          <Button variant="outline" onClick={save} disabled={!dirty || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save flow
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {KIND_LIST.map((k) => (
          <button
            key={k}
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(PALETTE_MIME, k);
              e.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => addNode(k)}
            title="Drag onto the canvas, or click to append"
            className="cursor-grab rounded-lg border border-white/[0.12] px-2.5 py-1.5 text-xs text-neutral-300 transition-colors hover:border-white/25 hover:text-white active:cursor-grabbing"
          >
            + {NODE_KINDS[k].label}
          </button>
        ))}
      </div>

      {err && <p className="mt-3 text-sm text-red-400">{err}</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_270px]">
        <WorkflowCanvas
          graph={graph}
          onChange={update}
          onSelect={setSelected}
          onDropNode={addNodeAt}
          runState={runState}
        />

        <div className="rounded-2xl border border-white/[0.08] p-4">
          {!node ? (
            <p className="text-sm text-neutral-500">
              Select a node to configure it. Delete removes the selected node and its connections.
            </p>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-white">{NODE_KINDS[node.kind].label}</p>
                <p className="font-mono text-xs text-neutral-500">{node.id}</p>
              </div>

              <Field label="Label">
                <Input
                  value={node.label ?? ""}
                  onChange={(e) => patchNode(node.id, { label: e.target.value })}
                />
              </Field>

              {node.kind === "http" && (
                <>
                  <Field label="Method">
                    <select
                      value={str("method") || "GET"}
                      onChange={(e) => patchConfig(node.id, "method", e.target.value)}
                      className="w-full rounded-xl border border-white/[0.1] bg-white/[0.03] px-3 py-2.5 text-sm text-white"
                    >
                      {["GET", "POST", "PUT", "DELETE"].map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="URL">
                    <Input
                      className="font-mono"
                      value={str("url")}
                      onChange={(e) => patchConfig(node.id, "url", e.target.value)}
                    />
                  </Field>
                </>
              )}

              {node.kind === "condition" && (
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    className="font-mono"
                    value={str("left")}
                    onChange={(e) => patchConfig(node.id, "left", e.target.value)}
                  />
                  <select
                    value={str("op") || "<="}
                    onChange={(e) => patchConfig(node.id, "op", e.target.value)}
                    className="rounded-xl border border-white/[0.1] bg-white/[0.03] px-2 py-2.5 text-sm text-white"
                  >
                    {OPS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                  <Input
                    className="font-mono"
                    value={str("right")}
                    onChange={(e) => patchConfig(node.id, "right", e.target.value)}
                  />
                </div>
              )}

              {node.kind === "onchain" && (
                <>
                  <Field label="Recipient">
                    <Input
                      className="font-mono"
                      value={str("recipient")}
                      onChange={(e) => patchConfig(node.id, "recipient", e.target.value)}
                    />
                  </Field>
                  <Field label="Amount (wei)">
                    <Input
                      className="font-mono"
                      value={str("amount")}
                      onChange={(e) => patchConfig(node.id, "amount", e.target.value)}
                    />
                  </Field>
                </>
              )}

              {node.kind === "delay" && (
                <Field label="Wait (ms)">
                  <Input
                    className="font-mono"
                    value={str("ms")}
                    onChange={(e) => patchConfig(node.id, "ms", Number(e.target.value) || 0)}
                  />
                </Field>
              )}

              {node.kind === "transform" && (
                <Field label="Value" hint="templates allowed">
                  <Input
                    className="font-mono"
                    value={str("value")}
                    onChange={(e) => patchConfig(node.id, "value", e.target.value)}
                  />
                </Field>
              )}

              {node.kind === "loop" && (
                <Field label="Over" hint="must resolve to an array">
                  <Input
                    className="font-mono"
                    value={str("over")}
                    onChange={(e) => patchConfig(node.id, "over", e.target.value)}
                  />
                </Field>
              )}

              {node.kind !== "trigger" && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Retries">
                    <Input
                      className="font-mono"
                      value={String(node.retry?.max ?? 0)}
                      onChange={(e) =>
                        patchNode(node.id, {
                          retry: {
                            max: Number(e.target.value) || 0,
                            backoffMs: node.retry?.backoffMs ?? 250,
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="Timeout (ms)">
                    <Input
                      className="font-mono"
                      value={String(node.timeoutMs ?? "")}
                      onChange={(e) => setTimeout_(node.id, Number(e.target.value))}
                    />
                  </Field>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-white">Recent runs</p>
          <button
            type="button"
            onClick={loadRuns}
            className="text-xs text-neutral-500 transition-colors hover:text-white"
          >
            refresh
          </button>
        </div>
        {runs.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No runs recorded yet.</p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {runs.map((r) => (
              <button
                key={r.id}
                type="button"
                title="Show this run on the canvas"
                onClick={() => {
                  const next: RunState = {};
                  for (const n of r.nodes) next[n.id] = n.status as RunState[string];
                  onRunState(next);
                }}
                className="flex w-full items-center gap-3 rounded-lg border border-white/[0.08] px-3 py-2 text-left text-xs transition-colors hover:border-white/20"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    background:
                      r.status === "completed"
                        ? "#a8d946"
                        : r.status === "failed"
                          ? "#e5484d"
                          : "#8b8f96",
                  }}
                />
                <span className="font-mono text-neutral-400">{r.id.slice(0, 12)}</span>
                <span className="flex-1 truncate text-neutral-500">
                  {r.error ?? `${r.node_count} nodes`}
                </span>
                <span className="text-neutral-600">{r.duration_ms}ms</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
