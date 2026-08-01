"use client";

import { useEffect, useState } from "react";
import {
  Plus,
  ArrowLeft,
  Loader2,
  Search,
  Trash2,
  Globe,
  Play,
  CheckCircle2,
  XCircle,
  MinusCircle,
} from "lucide-react";
import { Panel, Field, Input, Textarea, Button, Toggle, Chip, Empty, CopyBtn, short } from "./ui";
import { useWallet } from "@/lib/wallet";
import {
  createFabricWorkflow,
  listFabricWorkflows,
  runFabricWorkflow,
  seedFabricWorkflows,
  type FabricWorkflow,
} from "@/lib/api";
import { type RunState } from "./workflow-canvas";
import { GraphEditor } from "./workflow-graph-editor";

type WfStep =
  | { id: string; kind: "http"; url?: string; method?: string; body?: string; api?: string }
  | { id: string; kind: "onchain"; action?: "vault_settle"; recipient: string; amount: string }
  | { id: string; kind: "condition"; left: string; op: string; right: string };

type Variable = { name: string; type: string; description: string; required: boolean };
type Output = { name: string; from: string };
type BStep = {
  id: string;
  kind: "http" | "onchain" | "condition";
  url: string;
  method: string;
  body: string;
  recipient: string;
  amount: string;
  left: string;
  op: string;
  right: string;
};

const OPS = [">=", ">", "<=", "<", "==", "!="];

type RunStep = { id: string; kind: string; status: "ok" | "skipped" | "error"; detail?: string; output?: unknown };
type RunResp = {
  ok: boolean;
  error?: string;
  run?: { workflow: string; completed: boolean; steps: RunStep[]; output?: Record<string, unknown> };
};

export function WorkflowsSection() {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<FabricWorkflow | null>(null);
  const [wfs, setWfs] = useState<FabricWorkflow[] | null>(null);
  const [q, setQ] = useState("");
  const { address } = useWallet();

  const load = () => listFabricWorkflows(address ?? undefined).then(setWfs).catch(() => setWfs([]));
  useEffect(() => {
    load();
  }, [address]);

  if (creating) return <CreateWorkflowForm onDone={() => { setCreating(false); load(); }} onCancel={() => setCreating(false)} />;
  if (selected) return <WorkflowDetail wf={selected} onBack={() => setSelected(null)} />;

  const filtered = (wfs ?? []).filter((w) => !q || (w.name + w.description).toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight text-white">Workflows</h1>
          <p className="mt-1 text-neutral-400">Reusable, composable flows agents run — HTTP calls + on-chain Sepolia operations.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => seedFabricWorkflows().then(load)}>
            Seed demo
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Create Workflow
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-neutral-500" />
        <Input placeholder="Search workflows…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
      </div>

      {wfs === null ? (
        <Empty>
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty>No workflows yet. Seed the pay-if-budget demo or create one.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {filtered.map((w) => (
            <button key={w.id} type="button" onClick={() => setSelected(w)} className="text-left">
              <Panel className="h-full cursor-pointer transition hover:border-accent/40">
                <div className="flex items-center gap-2">
                  <p className="text-lg font-semibold text-white">{w.name}</p>
                  {w.is_public && <Globe className="h-3.5 w-3.5 text-neutral-500" />}
                </div>
                <p className="mt-0.5 font-mono text-xs text-neutral-500">wf__{w.slug}</p>
                <p className="mt-3 line-clamp-2 text-sm text-neutral-500">{w.description}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {(w.tags ?? []).map((t) => (
                    <Chip key={t} accent={t === "onchain"}>
                      {t}
                    </Chip>
                  ))}
                </div>
                <p className="mt-3 text-xs text-neutral-600">
                  {(w.steps ?? []).length} steps · {(w.input_variables ?? []).length} inputs
                </p>
              </Panel>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkflowDetail({ wf, onBack }: { wf: FabricWorkflow; onBack: () => void }) {
  const [runState, setRunState] = useState<RunState>({});
  const inputs = wf.input_variables ?? [];
  const allowed = (wf as { allowed_contracts?: string[] }).allowed_contracts ?? [];
  const outputs = (wf as { output_mapping?: Output[] }).output_mapping ?? [];
  const runExample = JSON.stringify(
    { tool: `wf__${wf.slug ?? wf.name}`, arguments: Object.fromEntries(inputs.map((v) => [v.name, `<${v.name}>`])) },
    null,
    2,
  );

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Back to Workflows
      </button>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold text-white">{wf.name}</h1>
          {wf.is_public && <Globe className="h-4 w-4 text-neutral-500" />}
        </div>
        <p className="mt-1 font-mono text-sm text-neutral-500">/{wf.slug}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(wf.tags ?? []).map((t) => (
            <Chip key={t} accent={t === "onchain"}>
              {t}
            </Chip>
          ))}
        </div>
        <p className="mt-3 text-sm text-neutral-400">{wf.description}</p>
      </div>

      <GraphEditor wf={wf} onRunState={setRunState} runState={runState} />

      {inputs.length > 0 && (
        <Panel>
          <p className="font-semibold text-white">Inputs</p>
          <div className="mt-4 space-y-2">
            {inputs.map((v) => (
              <div key={v.name} className="flex items-center justify-between rounded-xl border border-white/[0.08] px-4 py-2.5">
                <span className="font-mono text-sm text-white">{v.name}</span>
                <span className="text-xs text-neutral-500">{(v as Variable).type ?? "string"}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {allowed.length > 0 && (
        <Panel>
          <p className="font-semibold text-white">Scope (allowed recipients)</p>
          <p className="text-sm text-neutral-500">On-chain step may transfer only to these Sepolia accounts.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {allowed.map((c) => (
              <Chip key={c}>
                {short(c, 6, 5)}
              </Chip>
            ))}
          </div>
        </Panel>
      )}

      {outputs.length > 0 && (
        <Panel>
          <p className="font-semibold text-white">Output mapping</p>
          <div className="mt-4 space-y-2">
            {outputs.map((o) => (
              <div key={o.name} className="flex items-center gap-2 font-mono text-xs text-neutral-400">
                <span className="text-white">{o.name}</span>
                <span>=</span>
                <span>{o.from}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel>
        <p className="font-semibold text-white">How to run</p>
        <p className="text-sm text-neutral-500">An agent runs the whole flow with one MCP call on the fabric server:</p>
        <div className="relative mt-4">
          <pre className="overflow-x-auto rounded-xl border border-white/[0.08] bg-black/40 p-4 font-mono text-xs text-neutral-300">{runExample}</pre>
          <div className="absolute top-3 right-3">
            <CopyBtn text={runExample} />
          </div>
        </div>
      </Panel>

      <RunWorkflow wf={wf} onRunState={setRunState} />
    </div>
  );
}

function RunWorkflow({ wf, onRunState }: { wf: FabricWorkflow; onRunState?: (s: RunState) => void }) {
  const inputs = wf.input_variables ?? [];
  const [vals, setVals] = useState<Record<string, string>>({});
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<RunResp | null>(null);

  const run = async () => {
    setBusy(true);
    setRes(null);
    try {
      const body = (await runFabricWorkflow(wf.slug ?? wf.name, vals, token || undefined)) as RunResp;
      setRes(body);
      const next: RunState = {};
      for (const st of body.run?.steps ?? []) next[st.id] = st.status;
      onRunState?.(next);
    } catch (e) {
      setRes({ ok: false, error: String((e as Error).message) });
    } finally {
      setBusy(false);
    }
  };

  const icon = (s: string) =>
    s === "ok" ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : s === "error" ? <XCircle className="h-4 w-4 text-red-400" /> : <MinusCircle className="h-4 w-4 text-neutral-500" />;
  const deployHash = res?.run?.output?.deployHash as string | undefined;

  return (
    <Panel>
      <p className="font-semibold text-white">Run it live</p>
      <p className="text-sm text-neutral-500">Executes on the fabric engine. On-chain steps settle via Sepolia transfer.</p>
      <div className="mt-4 space-y-3">
        {inputs.map((v) => (
          <Field key={v.name} label={v.name}>
            <Input value={vals[v.name] ?? ""} onChange={(e) => setVals((s) => ({ ...s, [v.name]: e.target.value }))} className="font-mono" />
          </Field>
        ))}
        <Field label="Agent token (optional)" hint="Bearer from session keys">
          <Input value={token} onChange={(e) => setToken(e.target.value)} className="font-mono" placeholder="sk_live_…" />
        </Field>
        <Button onClick={run} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run workflow
        </Button>
      </div>

      {res && (
        <div className="mt-4 space-y-3">
          {!res.ok && <p className="text-sm text-red-400">{res.error}</p>}
          {res.run && (
            <>
              <p className="text-sm text-neutral-400">
                {res.run.completed ? "completed" : "halted"} · {res.run.workflow}
              </p>
              <div className="space-y-2">
                {res.run.steps.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 rounded-lg border border-white/[0.08] px-3 py-2 text-xs">
                    {icon(s.status)}
                    <span className="font-mono text-white">{s.id}</span>
                    <span className="flex-1 truncate text-neutral-500">{s.detail}</span>
                    <span className="text-neutral-600">{s.kind}</span>
                  </div>
                ))}
              </div>
              {deployHash && (
                <p className="text-xs text-accent">
                  deployHash: {short(deployHash, 8, 6)}
                </p>
              )}
              {res.run.output && (
                <pre className="overflow-auto rounded-xl border border-white/[0.08] bg-black/40 p-4 font-mono text-xs">
                  {JSON.stringify(res.run.output, null, 2)}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </Panel>
  );
}

function CreateWorkflowForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [meta, setMeta] = useState({ name: "", slug: "", description: "", is_public: false });
  const [vars, setVars] = useState<Variable[]>([]);
  const [steps, setSteps] = useState<BStep[]>([]);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { address } = useWallet();

  const newStep = (): BStep => ({
    id: `step_${steps.length + 1}`,
    kind: "condition",
    url: "",
    method: "GET",
    body: "",
    recipient: "{{input.recipient}}",
    amount: "{{input.amount}}",
    left: "{{input.amount}}",
    op: "<=",
    right: "5000000000",
  });

  const patchStep = (i: number, p: Partial<BStep>) => setSteps((a) => a.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const toEngine = (s: BStep): WfStep => {
    if (s.kind === "http") return { id: s.id, kind: "http", url: s.url, method: s.method, ...(s.body ? { body: s.body } : {}) };
    if (s.kind === "onchain")
      return { id: s.id, kind: "onchain", action: "vault_settle", recipient: s.recipient, amount: s.amount };
    return { id: s.id, kind: "condition", left: s.left, op: s.op, right: s.right };
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await createFabricWorkflow({
        ...meta,
        input_variables: vars.map((v) => ({ name: v.name, type: v.type, description: v.description, required: v.required })),
        steps: steps.map(toEngine),
        output_mapping: outputs.filter((o) => o.name && o.from),
        allowed_contracts: recipients.filter(Boolean),
        tags: steps.some((s) => s.kind === "onchain") ? ["http", "onchain", "x402"] : ["http"],
        owner_address: address,
      });
      onDone();
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setMeta({ name: "", slug: "", description: "", is_public: false });
    setVars([]);
    setSteps([]);
    setOutputs([]);
    setRecipients([]);
    setErr(null);
  };

  return (
    <div className="space-y-6">
      <button onClick={onCancel} className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Back to Workflows
      </button>

      <div>
        <h1 className="text-4xl font-semibold tracking-tight text-white">Create Workflow</h1>
        <p className="mt-1 text-neutral-400">Combine HTTP calls, budget conditions, and Sepolia on-chain settlement into a reusable flow.</p>
      </div>

      <Panel className="space-y-4">
        <Field label="Name">
          <Input value={meta.name} onChange={(e) => setMeta((s) => ({ ...s, name: e.target.value }))} placeholder="Pay if under budget" />
        </Field>
        <Field label="Slug">
          <Input value={meta.slug} onChange={(e) => setMeta((s) => ({ ...s, slug: e.target.value }))} placeholder="pay-if-budget" className="font-mono" />
        </Field>
        <Field label="Description">
          <Textarea rows={2} value={meta.description} onChange={(e) => setMeta((s) => ({ ...s, description: e.target.value }))} />
        </Field>
        <Toggle on={meta.is_public} onChange={(v) => setMeta((s) => ({ ...s, is_public: v }))} label="Make Workflow Public" desc="List it as a wf__ tool other agents can discover" />
      </Panel>

      <Panel>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-white">Input Variables</p>
            <p className="text-sm text-neutral-500">Inputs agents provide when calling this workflow.</p>
          </div>
          <Button variant="outline" onClick={() => setVars((v) => [...v, { name: "", type: "string", description: "", required: true }])}>
            Add Variable
          </Button>
        </div>
        {vars.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-500">
            No variables. Reference them in steps via {"{{input.name}}"}
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {vars.map((v, i) => (
              <div key={i} className="grid gap-2 rounded-xl border border-white/[0.08] p-3 sm:grid-cols-[1fr_110px_1fr_auto_auto]">
                <Input value={v.name} onChange={(e) => setVars((a) => a.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="font-mono" placeholder="name" />
                <select
                  value={v.type}
                  onChange={(e) => setVars((a) => a.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}
                  className="rounded-xl border border-white/[0.1] bg-white/[0.03] px-3 py-2.5 text-sm text-white"
                >
                  {["string", "number", "boolean"].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <Input value={v.description} onChange={(e) => setVars((a) => a.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} placeholder="description" />
                <button
                  type="button"
                  onClick={() => setVars((a) => a.map((x, j) => (j === i ? { ...x, required: !x.required } : x)))}
                  className={`rounded-lg border px-2.5 py-2 text-xs ${v.required ? "border-accent/50 bg-accent/15 text-accent" : "border-white/[0.12] text-neutral-500"}`}
                >
                  {v.required ? "required" : "optional"}
                </button>
                <button type="button" onClick={() => setVars((a) => a.filter((_, j) => j !== i))} className="text-neutral-500 hover:text-red-400">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-white">Workflow Steps</p>
            <p className="text-sm text-neutral-500">Run in order. A failed condition halts the flow; the on-chain step settles on Sepolia.</p>
          </div>
          <Button variant="outline" onClick={() => setSteps((s) => [...s, newStep()])}>
            Add Step
          </Button>
        </div>
        {steps.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-500">No steps yet.</p>
        ) : (
          <div className="mt-4 space-y-4">
            {steps.map((st, i) => (
              <div key={i} className="rounded-xl border border-white/[0.08] p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.06] text-xs font-semibold">{i + 1}</span>
                  <Input value={st.id} onChange={(e) => patchStep(i, { id: e.target.value })} className="font-mono" />
                  <button type="button" onClick={() => setSteps((a) => a.filter((_, j) => j !== i))} className="text-neutral-500 hover:text-red-400">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <select
                  value={st.kind}
                  onChange={(e) => patchStep(i, { kind: e.target.value as BStep["kind"] })}
                  className="mb-3 w-full rounded-xl border border-white/[0.1] bg-white/[0.03] px-3.5 py-2.5 text-sm text-white"
                >
                  <option value="condition">Condition (budget gate)</option>
                  <option value="http">HTTP Request</option>
                  <option value="onchain">On-chain (Sepolia transfer)</option>
                </select>

                {st.kind === "condition" && (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Input value={st.left} onChange={(e) => patchStep(i, { left: e.target.value })} className="font-mono" placeholder="left" />
                    <select
                      value={st.op}
                      onChange={(e) => patchStep(i, { op: e.target.value })}
                      className="rounded-xl border border-white/[0.1] bg-white/[0.03] px-3 py-2.5 text-sm text-white"
                    >
                      {OPS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                    <Input value={st.right} onChange={(e) => patchStep(i, { right: e.target.value })} className="font-mono" placeholder="right" />
                  </div>
                )}

                {st.kind === "http" && (
                  <div className="space-y-2">
                    <div className="grid gap-2 sm:grid-cols-[120px_1fr]">
                      <select
                        value={st.method}
                        onChange={(e) => patchStep(i, { method: e.target.value })}
                        className="rounded-xl border border-white/[0.1] bg-white/[0.03] px-3 py-2.5 text-sm text-white"
                      >
                        {["GET", "POST", "PUT", "DELETE"].map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                      <Input value={st.url} onChange={(e) => patchStep(i, { url: e.target.value })} className="font-mono" placeholder="https://…" />
                    </div>
                    <Textarea rows={2} value={st.body} onChange={(e) => patchStep(i, { body: e.target.value })} className="font-mono" placeholder='{"key":"value"}' />
                  </div>
                )}

                {st.kind === "onchain" && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Recipient">
                      <Input value={st.recipient} onChange={(e) => patchStep(i, { recipient: e.target.value })} className="font-mono" />
                    </Field>
                    <Field label="Amount (wei)">
                      <Input value={st.amount} onChange={(e) => patchStep(i, { amount: e.target.value })} className="font-mono" />
                    </Field>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-white">Output Mapping</p>
            <p className="text-sm text-neutral-500">What the workflow returns on completion.</p>
          </div>
          <Button variant="outline" onClick={() => setOutputs((o) => [...o, { name: "", from: "" }])}>
            Add
          </Button>
        </div>
        {outputs.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-500">
            No outputs. e.g. deployHash = {"{{steps.settle.output.deployHash}}"}
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {outputs.map((o, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto]">
                <Input value={o.name} onChange={(e) => setOutputs((a) => a.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="name" />
                <span className="self-center text-neutral-500">=</span>
                <Input value={o.from} onChange={(e) => setOutputs((a) => a.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} className="font-mono" placeholder="{{steps.id.output…}}" />
                <button type="button" onClick={() => setOutputs((a) => a.filter((_, j) => j !== i))} className="text-neutral-500 hover:text-red-400">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel>
        <p className="font-semibold text-white">Scope Configuration</p>
        <p className="text-sm text-neutral-500">Sepolia accounts the on-chain step is allowed to pay. Session keys still cap spend on-chain.</p>
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-white">Allowed recipient addresses</p>
          <Button variant="outline" onClick={() => setRecipients((c) => [...c, ""])}>
            Add Address
          </Button>
        </div>
        {recipients.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">No allowed addresses configured.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {recipients.map((c, i) => (
              <div key={i} className="flex gap-2">
                <Input value={c} onChange={(e) => setRecipients((a) => a.map((x, j) => (j === i ? e.target.value : x)))} className="font-mono" placeholder="01…" />
                <button type="button" onClick={() => setRecipients((a) => a.filter((_, j) => j !== i))} className="text-neutral-500 hover:text-red-400">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {err && <p className="text-sm text-red-400">{err}</p>}
      <div className="flex gap-3">
        <Button variant="ghost" onClick={reset}>
          Reset
        </Button>
        <Button onClick={submit} disabled={busy || !meta.name}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create Workflow
        </Button>
      </div>
    </div>
  );
}
