"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WfNode, WorkflowGraph, RunNode } from "@/lib/api";

/**
 * Node canvas: drag to place, drag a port to connect, click to inspect.
 *
 * Hand-built on SVG plus absolutely positioned elements. Pointer events run
 * through one handler on the surface so dragging a node, drawing an edge and
 * panning the viewport share the same coordinate maths and cannot fight.
 */

const NODE_W = 188;
const NODE_H = 62;
const PORT = 11;

/** Each kind carries its own mark, drawn for this app rather than taken from a pack. */
const KIND = {
  trigger: { label: "Trigger", tone: "#8b8f96" },
  http: { label: "HTTP", tone: "#5aa9e6" },
  condition: { label: "Condition", tone: "#d8a33c" },
  onchain: { label: "On-chain", tone: "#a8d946" },
  delay: { label: "Delay", tone: "#8b8f96" },
  transform: { label: "Transform", tone: "#9d7cd8" },
  loop: { label: "Loop", tone: "#4fb3a5" },
} as const;

type Kind = keyof typeof KIND;

function NodeGlyph({ kind, tone }: { kind: Kind; tone: string }) {
  const s = { stroke: tone, strokeWidth: 1.6, fill: "none", strokeLinecap: "round" as const };
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      {kind === "trigger" && <path d="M4 3.5v11l9-5.5z" {...s} strokeLinejoin="round" />}
      {kind === "http" && (
        <>
          <circle cx="9" cy="9" r="6" {...s} />
          <path d="M3 9h12M9 3a12 12 0 0 1 0 12A12 12 0 0 1 9 3" {...s} />
        </>
      )}
      {kind === "condition" && <path d="M9 2.5 15.5 9 9 15.5 2.5 9z" {...s} strokeLinejoin="round" />}
      {kind === "onchain" && (
        <>
          <path d="M9 2.5 15 6v6l-6 3.5L3 12V6z" {...s} strokeLinejoin="round" />
          <path d="M9 8.5v4" {...s} />
        </>
      )}
      {kind === "delay" && (
        <>
          <circle cx="9" cy="9" r="6" {...s} />
          <path d="M9 5.5V9l2.5 1.5" {...s} />
        </>
      )}
      {kind === "transform" && (
        <path d="M3.5 6h7a3 3 0 0 1 0 6h-7M11 3.5 14.5 6 11 8.5" {...s} strokeLinejoin="round" />
      )}
      {kind === "loop" && (
        <>
          <path d="M4 9a5 5 0 0 1 5-5 5 5 0 0 1 4.5 2.8" {...s} />
          <path d="M14 9a5 5 0 0 1-5 5 5 5 0 0 1-4.5-2.8" {...s} />
          <path d="M13 3.6v3.2h-3.2M5 14.4v-3.2h3.2" {...s} strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}

type Drag =
  | { mode: "node"; id: string; dx: number; dy: number }
  | { mode: "edge"; from: string; branch?: "true" | "false"; x: number; y: number }
  | { mode: "pan"; x: number; y: number; ox: number; oy: number }
  | null;

export type RunState = Record<string, RunNode["status"]>;

/**
 * Drag payload type for palette-to-canvas node creation. A custom MIME rather
 * than `text/plain` so the canvas can tell a palette drag from a stray text
 * selection or a file dragged in from the desktop.
 */
export const PALETTE_MIME = "application/x-kairos-node";

export function WorkflowCanvas({
  graph,
  onChange,
  onSelect,
  onDropNode,
  runState,
  readOnly = false,
}: {
  graph: WorkflowGraph;
  onChange?: (g: WorkflowGraph) => void;
  onSelect?: (id: string | null) => void;
  /**
   * A node kind dragged in from the palette, with the drop point already
   * converted to graph coordinates. The canvas owns the pan/zoom transform, so
   * only it can convert a screen position correctly.
   */
  onDropNode?: (kind: string, position: { x: number; y: number }) => void;
  runState?: RunState;
  readOnly?: boolean;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag>(null);
  /** A palette node is hovering over the canvas, awaiting a drop. */
  const [dropping, setDropping] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState({ x: 24, y: 24, scale: 1 });

  const pos = useCallback((n: WfNode) => n.position ?? { x: 0, y: 0 }, []);
  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);

  /**
   * Frame the whole graph on first paint. Without this a wide flow opens with
   * its right-hand nodes sliced off by the canvas edge, which reads as broken.
   * Runs once per mount so it never fights the user's own panning.
   */
  const framed = useRef(false);
  const fit = useCallback(() => {
    const box = surface.current?.getBoundingClientRect();
    if (!box || graph.nodes.length === 0) return;

    const xs = graph.nodes.map((n) => pos(n).x);
    const ys = graph.nodes.map((n) => pos(n).y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const w = Math.max(...xs) + NODE_W - minX;
    const h = Math.max(...ys) + NODE_H - minY;

    const pad = 28;
    const scale = Math.min(1, (box.width - pad * 2) / w, (box.height - pad * 2) / h);
    setView({
      scale,
      x: (box.width - w * scale) / 2 - minX * scale,
      y: (box.height - h * scale) / 2 - minY * scale,
    });
  }, [graph.nodes, pos]);

  useEffect(() => {
    if (framed.current || graph.nodes.length === 0) return;
    framed.current = true;
    fit();
  }, [fit, graph.nodes.length]);

  /** Pointer event -> canvas-space coordinates. */
  const toCanvas = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const rect = surface.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (e.clientX - rect.left - view.x) / view.scale,
        y: (e.clientY - rect.top - view.y) / view.scale,
      };
    },
    [view],
  );

  const commit = (next: WorkflowGraph) => onChange?.(next);

  const select = (id: string | null) => {
    setSelected(id);
    onSelect?.(id);
  };

  const connect = (from: string, to: string, branch?: "true" | "false") => {
    if (from === to) return;
    if (graph.edges.some((e) => e.from === from && e.to === to && e.branch === branch)) return;
    commit({ ...graph, edges: [...graph.edges, { from, to, ...(branch ? { branch } : {}) }] });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = toCanvas(e);
    if (drag.mode === "node") {
      const node = nodeById.get(drag.id);
      if (!node) return;
      const next = { x: Math.round(p.x - drag.dx), y: Math.round(p.y - drag.dy) };
      const now = pos(node);
      // A plain click still emits a sub-pixel move. Without this guard that
      // reports the graph as edited and the panel shows "unsaved" for nothing.
      if (next.x === now.x && next.y === now.y) return;
      commit({
        ...graph,
        nodes: graph.nodes.map((n) => (n.id === drag.id ? { ...n, position: next } : n)),
      });
    } else if (drag.mode === "edge") {
      setDrag({ ...drag, x: p.x, y: p.y });
    } else if (drag.mode === "pan") {
      setView((v) => ({ ...v, x: drag.ox + (e.clientX - drag.x), y: drag.oy + (e.clientY - drag.y) }));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (drag?.mode === "edge") {
      // Land the edge on whichever node sits under the pointer.
      const target = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest("[data-node-id]")
        ?.getAttribute("data-node-id");
      if (target) connect(drag.from, target, drag.branch);
    }
    setDrag(null);
  };

  // Delete removes the selected node and every edge touching it.
  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!selected) return;
      e.preventDefault();
      commit({
        nodes: graph.nodes.filter((n) => n.id !== selected),
        edges: graph.edges.filter((x) => x.from !== selected && x.to !== selected),
      });
      select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** Cubic path between two ports, flattening as the horizontal gap grows. */
  const edgePath = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
    return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
  };

  const outPort = (n: WfNode, branch?: "true" | "false") => {
    const p = pos(n);
    if (n.kind !== "condition") return { x: p.x + NODE_W, y: p.y + NODE_H / 2 };
    return { x: p.x + NODE_W, y: p.y + (branch === "false" ? NODE_H - 16 : 16) };
  };
  const inPort = (n: WfNode) => ({ x: pos(n).x, y: pos(n).y + NODE_H / 2 });

  const statusRing = (id: string) => {
    const s = runState?.[id];
    if (s === "ok") return "#a8d946";
    if (s === "error") return "#e5484d";
    if (s === "skipped") return "#6b7280";
    return null;
  };

  return (
    <div
      ref={surface}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setDrag(null)}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.surface) {
          select(null);
          setDrag({ mode: "pan", x: e.clientX, y: e.clientY, ox: view.x, oy: view.y });
        }
      }}
      onDragOver={(e) => {
        // Only claim the drop when a palette node is actually in flight, so
        // dragging anything else over the canvas keeps the browser default.
        if (!onDropNode || readOnly) return;
        if (!e.dataTransfer.types.includes(PALETTE_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={(e) => {
        // Fires when crossing onto a child too; ignore unless the pointer has
        // genuinely left the surface, otherwise the hint flickers.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDropping(false);
      }}
      onDrop={(e) => {
        if (!onDropNode || readOnly) return;
        const kind = e.dataTransfer.getData(PALETTE_MIME);
        setDropping(false);
        if (!kind) return;
        e.preventDefault();
        // Place the node centred under the cursor rather than with its corner
        // there — dropping should land where you were looking.
        const at = toCanvas(e);
        onDropNode(kind, { x: Math.round(at.x - NODE_W / 2), y: Math.round(at.y - NODE_H / 2) });
      }}
      className={`relative h-[460px] touch-none overflow-hidden rounded-2xl border bg-[#0b0c0e] select-none ${
        dropping ? "border-accent/50" : "border-white/[0.08]"
      }`}
      style={{ cursor: drag?.mode === "pan" ? "grabbing" : "default" }}
    >
      <div data-surface className="absolute inset-0" />

      <div
        className="absolute origin-top-left"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        <svg className="pointer-events-none absolute overflow-visible" width="1" height="1">
          {graph.edges.map((e, i) => {
            const a = nodeById.get(e.from);
            const b = nodeById.get(e.to);
            if (!a || !b) return null;
            const tone = e.branch === "false" ? "#7a7f87" : e.branch === "true" ? "#a8d946" : "#4a4f57";
            return (
              <path
                key={`${e.from}-${e.to}-${e.branch ?? ""}-${i}`}
                d={edgePath(outPort(a, e.branch), inPort(b))}
                stroke={tone}
                strokeWidth={1.75}
                fill="none"
                strokeLinecap="round"
              />
            );
          })}

          {drag?.mode === "edge" && nodeById.get(drag.from) && (
            <path
              d={edgePath(outPort(nodeById.get(drag.from)!, drag.branch), { x: drag.x, y: drag.y })}
              stroke="#a8d946"
              strokeWidth={1.75}
              strokeDasharray="5 4"
              fill="none"
              strokeLinecap="round"
            />
          )}
        </svg>

        {graph.nodes.map((n) => {
          const p = pos(n);
          const meta = KIND[n.kind as Kind] ?? KIND.http;
          const ring = statusRing(n.id);
          const isSelected = selected === n.id;
          return (
            <div
              key={n.id}
              data-node-id={n.id}
              onPointerDown={(e) => {
                e.stopPropagation();
                select(n.id);
                if (readOnly) return;
                const c = toCanvas(e);
                setDrag({ mode: "node", id: n.id, dx: c.x - p.x, dy: c.y - p.y });
              }}
              className="absolute rounded-xl border bg-[#131519] transition-colors"
              style={{
                left: p.x,
                top: p.y,
                width: NODE_W,
                height: NODE_H,
                cursor: readOnly ? "default" : "grab",
                borderColor: ring ?? (isSelected ? meta.tone : "rgba(255,255,255,0.10)"),
              }}
            >
              <div className="flex h-full items-center gap-2.5 px-3">
                <NodeGlyph kind={(n.kind as Kind) ?? "http"} tone={meta.tone} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-white">{n.label || n.id}</p>
                  <p className="truncate text-[11px] text-neutral-500">
                    {meta.label}
                    {n.retry?.max ? ` · retry ${n.retry.max}` : ""}
                  </p>
                </div>
              </div>

              <span
                className="absolute rounded-full border border-white/25 bg-[#0b0c0e]"
                style={{ left: -PORT / 2, top: NODE_H / 2 - PORT / 2, width: PORT, height: PORT }}
              />

              {n.kind === "condition" ? (
                (["true", "false"] as const).map((branch) => (
                  <span
                    key={branch}
                    title={branch}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if (readOnly) return;
                      const c = toCanvas(e);
                      setDrag({ mode: "edge", from: n.id, branch, x: c.x, y: c.y });
                    }}
                    className="absolute rounded-full"
                    style={{
                      left: NODE_W - PORT / 2,
                      top: (branch === "true" ? 16 : NODE_H - 16) - PORT / 2,
                      width: PORT,
                      height: PORT,
                      cursor: readOnly ? "default" : "crosshair",
                      background: branch === "true" ? "#a8d946" : "#0b0c0e",
                      border: `1px solid ${branch === "true" ? "#a8d946" : "rgba(255,255,255,0.35)"}`,
                    }}
                  />
                ))
              ) : (
                <span
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (readOnly) return;
                    const c = toCanvas(e);
                    setDrag({ mode: "edge", from: n.id, x: c.x, y: c.y });
                  }}
                  className="absolute rounded-full border border-white/25 bg-[#0b0c0e]"
                  style={{
                    left: NODE_W - PORT / 2,
                    top: NODE_H / 2 - PORT / 2,
                    width: PORT,
                    height: PORT,
                    cursor: readOnly ? "default" : "crosshair",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="absolute right-3 bottom-3 flex items-center gap-1 rounded-lg border border-white/[0.1] bg-black/50 px-1 py-1">
        {[
          { label: "−", fn: () => setView((v) => ({ ...v, scale: Math.max(0.4, v.scale - 0.15) })) },
          { label: "Fit", fn: fit },
          { label: "+", fn: () => setView((v) => ({ ...v, scale: Math.min(1.6, v.scale + 0.15) })) },
        ].map((b) => (
          <button
            key={b.label}
            type="button"
            onClick={b.fn}
            className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-white/[0.07] hover:text-white"
          >
            {b.label}
          </button>
        ))}
      </div>

      {graph.nodes.length === 0 && (
        <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-neutral-600">
          No nodes yet — add one to start the flow.
        </p>
      )}
    </div>
  );
}

export { KIND as NODE_KINDS };
export type { Kind as NodeKindName };
