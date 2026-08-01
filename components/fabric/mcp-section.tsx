"use client";

import { useEffect, useState } from "react";
import { Plus, ArrowLeft, Server, Loader2, Search, Wrench, Workflow, Check, X } from "lucide-react";
import { Panel, Field, Input, Textarea, Button, Empty, short, Chip, CopyBtn } from "./ui";
import { useWallet } from "@/lib/wallet";
import {
  createFabricMcpServer,
  fabricMcpUrl,
  gatewayUrl,
  listFabricApis,
  listFabricMcpServers,
  listFabricWorkflows,
  patchFabricMcpServer,
  type FabricApi,
  type FabricMcpServer,
  type FabricWorkflow,
} from "@/lib/api";

const BUILTIN_TOOLS = ["kairos_chain_status", "kairos_budget", "list_skills", "get_skill", "fabric_reload"];

export function McpSection() {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<FabricMcpServer | null>(null);
  const [servers, setServers] = useState<FabricMcpServer[] | null>(null);
  const [q, setQ] = useState("");
  const { address } = useWallet();

  const load = () =>
    listFabricMcpServers(address ?? undefined)
      .then(setServers)
      .catch(() => setServers([]));
  useEffect(() => {
    load();
  }, [address]);

  if (creating) return <CreateMcpForm onDone={() => { setCreating(false); load(); }} onCancel={() => setCreating(false)} />;
  if (selected) return <McpDetail mcp={selected} onBack={() => setSelected(null)} />;

  const filtered = (servers ?? []).filter(
    (s) => !q || (s.display_name + s.description).toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight text-white">MCP Servers</h1>
          <p className="mt-1 text-neutral-400">Discover AI-ready MCP servers with tools and workflows for your agents.</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Create MCP Server
        </Button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-neutral-500" />
        <Input placeholder="Search MCP servers…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
      </div>

      {servers === null ? (
        <Empty>
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty>No MCP servers yet.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => (
            <button key={s.id} type="button" onClick={() => setSelected(s)} className="text-left">
              <Panel className="h-full cursor-pointer transition hover:border-accent/40">
                <Server className="h-5 w-5 text-accent" />
                <p className="mt-1 font-mono text-[10px] text-neutral-500">{short(s.owner_address, 6, 4)}</p>
                <p className="mt-2 text-lg font-semibold text-white">{s.display_name}</p>
                <p className="mt-1 line-clamp-2 text-sm text-neutral-500">{s.description}</p>
                <div className="mt-4 flex gap-4 text-xs text-neutral-500">
                  <span className="inline-flex items-center gap-1">
                    <Wrench className="h-3.5 w-3.5" /> {(s.tools ?? []).length} tools
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Workflow className="h-3.5 w-3.5" /> {(s.workflows ?? []).length} workflows
                  </span>
                </div>
                <p className="mt-2 text-[10px] text-neutral-600">Created {new Date(s.created_at).toLocaleDateString()}</p>
              </Panel>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function McpDetail({ mcp, onBack }: { mcp: FabricMcpServer; onBack: () => void }) {
  const url = `${fabricMcpUrl}/mcp`;
  const config = JSON.stringify({ mcpServers: { [mcp.slug ?? "server"]: { type: "http", url } } }, null, 2);
  const [tools, setTools] = useState<string[]>((mcp.tools ?? []).map(String));
  const [workflows, setWorkflows] = useState<string[]>((mcp.workflows ?? []).map(String));
  const [apis, setApis] = useState<FabricApi[]>([]);
  const [wfs, setWfs] = useState<FabricWorkflow[]>([]);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listFabricApis().then(setApis).catch(() => {});
    listFabricWorkflows().then(setWfs).catch(() => {});
  }, []);

  const persist = async (nextTools: string[], nextWf: string[]) => {
    if (!mcp.slug) return;
    setSaving(true);
    try {
      await patchFabricMcpServer(mcp.slug, { tools: nextTools, workflows: nextWf });
    } finally {
      setSaving(false);
    }
  };

  const toggleTool = (name: string) => {
    const next = tools.includes(name) ? tools.filter((t) => t !== name) : [...tools, name];
    setTools(next);
    persist(next, workflows);
  };

  const toggleWf = (slug: string) => {
    const next = workflows.includes(slug) ? workflows.filter((w) => w !== slug) : [...workflows, slug];
    setWorkflows(next);
    persist(tools, next);
  };

  const filteredApis = apis.filter(
    (a) => !q || (a.name + a.description + (a.tags ?? []).join(" ")).toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Back to MCP Servers
      </button>

      <div>
        <h1 className="text-3xl font-semibold text-white">{mcp.display_name}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          /mcp/{mcp.slug} · {mcp.is_public ? "public" : "private"} · owner {short(mcp.owner_address, 6, 4)}
          {saving && " · saving…"}
        </p>
        <p className="mt-2 text-sm text-neutral-400">{mcp.description}</p>
      </div>

      <Panel>
        <p className="font-semibold text-white">Available Tools ({tools.length})</p>
        <p className="text-sm text-neutral-500">Select which APIs to expose as tools in this MCP server.</p>
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-neutral-500" />
          <Input placeholder="Search APIs…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
        </div>
        <div className="mt-4 space-y-2">
          {filteredApis.length === 0 ? (
            <p className="text-sm text-neutral-500">No APIs published yet.</p>
          ) : (
            filteredApis.map((a) => {
              const name = `api__${a.slug}`;
              const on = tools.includes(name);
              return (
                <div key={a.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] p-3">
                  <div className="min-w-0">
                    <p className="font-medium text-white">{a.name}</p>
                    <p className="text-xs text-neutral-500">{a.description}</p>
                    <p className="text-xs text-neutral-600">
                      {a.price} wei / call {a.category && <Chip>{a.category}</Chip>}
                    </p>
                  </div>
                  <Button variant={on ? "outline" : "primary"} onClick={() => toggleTool(name)}>
                    {on ? (
                      <>
                        <X className="h-3.5 w-3.5" /> Remove
                      </>
                    ) : (
                      <>
                        <Check className="h-3.5 w-3.5" /> Add
                      </>
                    )}
                  </Button>
                </div>
              );
            })
          )}
        </div>
        <p className="mt-6 text-sm font-medium text-white">Built-in tools</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {BUILTIN_TOOLS.map((t) => {
            const on = tools.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleTool(t)}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 font-mono text-xs transition ${on ? "border-accent/50 bg-accent/15 text-accent" : "border-white/[0.12] text-neutral-400 hover:border-white/25"}`}
              >
                {on ? <Check className="h-3 w-3" /> : null}
                {t}
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel>
        <p className="font-semibold text-white">Workflow Tools</p>
        <p className="text-sm text-neutral-500">Workflows that AI agents can execute through this MCP server.</p>
        <p className="mt-4 text-xs text-neutral-500">Enabled ({workflows.length})</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {workflows.length === 0 ? (
            <span className="text-sm text-neutral-500">None enabled yet.</span>
          ) : (
            workflows.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => toggleWf(w)}
                className="inline-flex items-center gap-1 rounded-full border border-accent/50 bg-accent/15 px-3 py-1 font-mono text-xs text-accent"
              >
                {w} <X className="h-3 w-3" />
              </button>
            ))
          )}
        </div>
        <p className="mt-4 text-xs text-neutral-500">Available workflows</p>
        <div className="mt-2 space-y-2">
          {wfs
            .filter((w) => w.slug && !workflows.includes(w.slug))
            .map((w) => (
              <div key={w.id} className="flex items-center justify-between rounded-xl border border-white/[0.08] p-3">
                <div>
                  <p className="text-white">{w.name}</p>
                  <p className="text-xs text-neutral-500">{w.description}</p>
                </div>
                <Button onClick={() => toggleWf(w.slug!)}>Add</Button>
              </div>
            ))}
        </div>
      </Panel>

      <Panel>
        <p className="font-semibold text-white">Connect from any agent</p>
        <p className="text-sm text-neutral-500">Live MCP endpoint — Claude Code, Codex, or any MCP client.</p>
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/[0.08] px-3 py-2">
          <span className="flex-1 truncate font-mono text-xs">{url}</span>
          <CopyBtn text={url} />
        </div>
        <p className="mt-4 text-sm text-white">Claude Code — one command</p>
        <pre className="mt-2 overflow-x-auto rounded-xl border border-white/[0.08] bg-black/40 p-3 font-mono text-xs">
          {`claude mcp add ${mcp.slug ?? "server"} --transport http ${url}`}
        </pre>
        <p className="mt-4 text-sm text-white">Config file (.mcp.json)</p>
        <pre className="mt-2 overflow-x-auto rounded-xl border border-white/[0.08] bg-black/40 p-3 font-mono text-xs">{config}</pre>
        <p className="mt-4 text-sm text-neutral-500">
          Fabric gateway: {gatewayUrl}/fabric/run — scope calls with Bearer token from session keys.
        </p>
      </Panel>
    </div>
  );
}

function CreateMcpForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ slug: "", display_name: "", description: "", is_public: false });
  const [tools, setTools] = useState<string[]>([...BUILTIN_TOOLS]);
  const [workflows, setWorkflows] = useState<string[]>([]);
  const [apiTools, setApiTools] = useState<string[]>([]);
  const [wfOptions, setWfOptions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { address } = useWallet();

  useEffect(() => {
    listFabricApis()
      .then((rows) => setApiTools(rows.map((a) => `api__${a.slug}`)))
      .catch(() => {});
    listFabricWorkflows()
      .then((rows) => setWfOptions(rows.map((w) => w.slug).filter(Boolean) as string[]))
      .catch(() => {});
  }, []);

  const toggle = (arr: string[], set: (v: string[]) => void, v: string) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const Pick = ({ label, options, sel, set }: { label: string; options: string[]; sel: string[]; set: (v: string[]) => void }) => (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-white">{label}</p>
      {options.length === 0 ? (
        <p className="text-xs text-neutral-500">none published yet</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((o) => {
            const on = sel.includes(o);
            return (
              <button
                key={o}
                type="button"
                onClick={() => toggle(sel, set, o)}
                className={`rounded-full border px-3 py-1 font-mono text-xs transition ${on ? "border-accent/50 bg-accent/15 text-accent" : "border-white/[0.12] text-neutral-400 hover:border-white/25"}`}
              >
                {on ? "selected " : ""}
                {o}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await createFabricMcpServer({ ...f, tools, workflows, owner_address: address });
      onDone();
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <button onClick={onCancel} className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Back to MCP Servers
      </button>

      <div className="flex items-center gap-2">
        <Server className="h-6 w-6 text-accent" />
        <div>
          <h1 className="text-3xl font-semibold text-white">MCP Server</h1>
          <p className="text-sm text-neutral-500">Configure a Model Context Protocol server for AI agent integration.</p>
        </div>
      </div>

      <Panel>
        <p className="text-lg font-semibold text-white">Server Configuration</p>
        <p className="text-sm text-neutral-500">Set up your MCP server endpoint and settings.</p>

        <div className="mt-6 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Slug" hint="lowercase, hyphens">
              <div className="flex items-center gap-2">
                <span className="text-sm text-neutral-500">/mcp/</span>
                <Input value={f.slug} onChange={(e) => setF((s) => ({ ...s, slug: e.target.value }))} placeholder="my-server" />
              </div>
            </Field>
            <Field label="Display Name">
              <Input value={f.display_name} onChange={(e) => setF((s) => ({ ...s, display_name: e.target.value }))} placeholder="My MCP Server" />
            </Field>
          </div>
          <Field label="Description">
            <Textarea rows={3} value={f.description} onChange={(e) => setF((s) => ({ ...s, description: e.target.value }))} placeholder="Describe what your MCP server provides…" />
          </Field>
          <div className="flex items-center justify-between rounded-xl border border-white/[0.08] p-4">
            <div>
              <p className="text-sm font-medium text-white">Public Server</p>
              <p className="text-xs text-neutral-500">Allow anyone with an account to connect.</p>
            </div>
            <Button variant="outline" onClick={() => setF((s) => ({ ...s, is_public: !s.is_public }))}>
              {f.is_public ? "Public" : "Private"}
            </Button>
          </div>

          <p className="text-sm text-neutral-500">Choose which tools and workflows this server exposes to agents.</p>
          <Pick
            label="Built-in tools"
            options={BUILTIN_TOOLS}
            sel={tools.filter((t) => BUILTIN_TOOLS.includes(t))}
            set={(v) => setTools([...v, ...tools.filter((t) => !BUILTIN_TOOLS.includes(t) && apiTools.includes(t))])}
          />
          <Pick
            label="API proxy tools"
            options={apiTools}
            sel={tools.filter((t) => apiTools.includes(t))}
            set={(v) => setTools([...tools.filter((t) => BUILTIN_TOOLS.includes(t)), ...v])}
          />
          <Pick label="Workflows" options={wfOptions} sel={workflows} set={setWorkflows} />

          {err && <p className="text-sm text-red-400">{err}</p>}
          <Button onClick={submit} disabled={busy || !f.display_name}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create Server
          </Button>
        </div>
      </Panel>
    </div>
  );
}
