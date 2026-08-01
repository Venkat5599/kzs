"use client";

import { useEffect, useState } from "react";
import { Plus, ArrowLeft, Store, Loader2, Terminal, Search, Zap, Play, Trash2 } from "lucide-react";
import { Panel, Field, Input, Textarea, Button, Toggle, Chip, Empty, short, CopyBtn } from "./ui";
import { useWallet } from "@/lib/wallet";
import { createFabricApi, gatewayUrl, listFabricApis, runFabricApi, type FabricApi } from "@/lib/api";

export function ApisSection() {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<FabricApi | null>(null);
  const [apis, setApis] = useState<FabricApi[] | null>(null);
  const [q, setQ] = useState("");
  const { address } = useWallet();

  const load = () =>
    listFabricApis(address ?? undefined)
      .then(setApis)
      .catch(() => setApis([]));
  useEffect(() => {
    load();
  }, [address]);

  if (creating) return <CreateApiForm onDone={() => { setCreating(false); load(); }} onCancel={() => setCreating(false)} />;
  if (selected) return <ApiDetail api={selected} onBack={() => setSelected(null)} />;

  const filtered = (apis ?? []).filter(
    (a) => !q || (a.name + a.description + (a.tags ?? []).join(" ")).toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight text-white">APIs</h1>
          <p className="mt-1 text-neutral-400">Payment-gated API proxies — pay per call over x402, settled on Sepolia.</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Create API
        </Button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-neutral-500" />
        <Input placeholder="Search APIs…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
      </div>

      {apis === null ? (
        <Empty>
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty>No APIs yet. Create the first payment-gated proxy.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {filtered.map((a) => (
            <button key={a.id} type="button" onClick={() => setSelected(a)} className="text-left">
              <Panel className="h-full cursor-pointer transition hover:border-accent/40">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10">
                    <Store className="h-5 w-5 text-accent" />
                  </div>
                  <span className="font-mono text-[10px] text-neutral-500">{short(a.payment_address, 6, 4)}</span>
                </div>
                <p className="mt-3 text-lg font-semibold text-white">{a.name}</p>
                <p className="mt-1 line-clamp-2 text-sm text-neutral-500">{a.description}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Chip accent>
                    {a.price} ETH / call
                  </Chip>
                  <Chip>{a.http_method}</Chip>
                  {(a.tags ?? []).slice(0, 2).map((t) => (
                    <Chip key={t}>{t}</Chip>
                  ))}
                </div>
              </Panel>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ApiDetail({ api, onBack }: { api: FabricApi; onBack: () => void }) {
  const endpoint = `${gatewayUrl}/s/${api.slug ?? api.id}`;
  const curl = [
    `# 1. call it — unpaid requests get an x402 quote (HTTP 402)`,
    `curl -i -X POST ${endpoint} -H 'content-type: application/json' -d '{}'`,
    ``,
    `# 2. pay ${api.price} ETH to the payment address, then retry with proof headers`,
    `curl -X POST ${endpoint} \\`,
    `  -H 'content-type: application/json' \\`,
    `  -H 'X-PAYMENT-NONCE: <nonce>' \\`,
    `  -H 'X-PAYMENT-PROOF: eth:tx:<hash>' \\`,
    `  -d '{}'`,
    `# -> proxied to ${api.target_url}`,
  ].join("\n");

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Back to APIs
      </button>

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10">
          <Store className="h-6 w-6 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-semibold tracking-tight text-white">{api.name}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <Chip accent>
              <Zap className="h-3 w-3" /> {api.price} ETH / call
            </Chip>
            <Chip>{api.http_method}</Chip>
            <Chip>{api.is_public ? "public" : "private"}</Chip>
            {(api.tags ?? []).map((t) => (
              <Chip key={t}>{t}</Chip>
            ))}
          </div>
        </div>
      </div>

      <Panel>
        <p className="text-sm text-neutral-400">{api.description}</p>
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-2.5">
            <span className="text-xs text-neutral-500">Endpoint</span>
            <span className="flex-1 truncate font-mono text-xs text-white">{endpoint}</span>
            <CopyBtn text={endpoint} />
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-2.5">
            <span className="text-xs text-neutral-500">Pays to</span>
            <span className="flex-1 truncate font-mono text-xs text-white">{api.payment_address ?? "—"}</span>
            {api.payment_address && <CopyBtn text={api.payment_address} />}
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-2.5">
            <span className="text-xs text-neutral-500">Target</span>
            <span className="flex-1 truncate font-mono text-xs text-white">{api.target_url}</span>
            <CopyBtn text={api.target_url} />
          </div>
        </div>
      </Panel>

      <Panel>
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-accent" />
          <p className="font-semibold text-white">How to use (x402)</p>
        </div>
        <p className="mt-2 text-sm text-neutral-500">
          Agents pay per call. Unpaid requests get a 402 + quote; pay on Sepolia, then retry with proof. The gateway proxies to your target after payment.
        </p>
        <div className="relative mt-4">
          <pre className="overflow-x-auto rounded-xl border border-white/[0.08] bg-black/40 p-4 font-mono text-xs text-neutral-300">{curl}</pre>
          <div className="absolute top-3 right-3">
            <CopyBtn text={curl} />
          </div>
        </div>
      </Panel>

      {api.example_response && (
        <Panel>
          <p className="text-sm font-semibold text-white">Example response</p>
          <pre className="mt-3 overflow-x-auto rounded-xl border border-white/[0.08] bg-black/40 p-4 font-mono text-xs">{api.example_response}</pre>
        </Panel>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Panel>
          <p className="text-2xl font-semibold text-white">{api.request_count ?? 0}</p>
          <p className="text-xs text-neutral-500">Requests</p>
        </Panel>
        <Panel>
          <p className="text-2xl font-semibold text-white">{api.success_count ?? 0}</p>
          <p className="text-xs text-neutral-500">Success</p>
        </Panel>
        <Panel>
          <p className="text-2xl font-semibold text-white">{Number(api.earnings ?? 0).toLocaleString()}</p>
          <p className="text-xs text-neutral-500">Earnings (wei)</p>
        </Panel>
      </div>

      <TestApi api={api} />
    </div>
  );
}

function TestApi({ api }: { api: FabricApi }) {
  const [argsText, setArgsText] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; status?: number; body?: unknown; error?: string } | null>(null);

  const run = async () => {
    setBusy(true);
    setRes(null);
    let args: Record<string, unknown> = {};
    try {
      args = argsText.trim() ? (JSON.parse(argsText) as Record<string, unknown>) : {};
    } catch {
      setRes({ ok: false, error: "args is not valid JSON" });
      setBusy(false);
      return;
    }
    try {
      setRes(await runFabricApi(api.slug ?? api.id, args));
    } catch (e) {
      setRes({ ok: false, error: String((e as Error).message) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <div className="flex items-center gap-2">
        <Play className="h-4 w-4 text-accent" />
        <p className="font-semibold text-white">Test call</p>
        <Chip accent>live</Chip>
      </div>
      <p className="mt-2 text-sm text-neutral-500">
        Proxies to {api.target_url} with your args. Variables substitute {"{name}"} in the URL / query.
      </p>
      <Field label="Args (JSON)">
        <Textarea rows={4} value={argsText} onChange={(e) => setArgsText(e.target.value)} className="font-mono" />
      </Field>
      <div className="mt-3">
        <Button onClick={run} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Send request
        </Button>
      </div>
      {res && (
        <pre className="mt-4 max-h-72 overflow-auto rounded-xl border border-white/[0.08] bg-black/40 p-4 font-mono text-xs">
          {res.ok ? `HTTP ${res.status}\n` : res.error}
          {res.body != null && (typeof res.body === "string" ? res.body : JSON.stringify(res.body, null, 2))}
        </pre>
      )}
    </Panel>
  );
}

function CreateApiForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({
    name: "",
    slug: "",
    description: "",
    category: "",
    tags: "",
    payment_address: "",
    target_url: "",
    http_method: "GET",
    content_type: "application/json",
    query_params: "",
    example_response: '{\n  "data": [ ... ],\n  "success": true\n}',
    price: "1000",
    is_public: false,
  });
  const [vars, setVars] = useState<{ name: string; type: string; in: string; description: string; required: boolean }[]>([]);
  const [headers, setHeaders] = useState<{ name: string; value: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { address } = useWallet();
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await createFabricApi({
        ...f,
        price: Number(f.price),
        tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
        variables: vars.filter((v) => v.name),
        auth_headers: headers.filter((h) => h.name),
        owner_address: address,
      });
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
        <ArrowLeft className="h-4 w-4" /> Back to APIs
      </button>

      <div>
        <h1 className="text-4xl font-semibold tracking-tight text-white">Create API</h1>
        <p className="mt-1 text-neutral-400">Set up a payment-gated API proxy using the x402 protocol.</p>
      </div>

      <Panel>
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-lg font-semibold text-white">Monetize your API</p>
            <p className="text-sm text-neutral-500">Create a payment-gated proxy for your existing endpoint.</p>
          </div>
          <Button variant="outline">Import curl</Button>
        </div>

        <div className="space-y-5">
          <Field label="API Name">
            <Input value={f.name} onChange={(e) => set("name")(e.target.value)} placeholder="My Awesome API" />
          </Field>
          <Field label="Custom URL Slug" hint="(optional)">
            <Input value={f.slug} onChange={(e) => set("slug")(e.target.value)} placeholder="my-awesome-api" />
          </Field>
          <Field label="Description" hint="(optional)">
            <Textarea rows={3} value={f.description} onChange={(e) => set("description")(e.target.value)} placeholder="Describe what your API does…" />
          </Field>
          <Field label="Category" hint="Choose a category to help users discover your API">
            <select
              value={f.category}
              onChange={(e) => set("category")(e.target.value)}
              className="w-full rounded-xl border border-white/[0.1] bg-white/[0.03] px-3.5 py-2.5 text-sm text-white outline-none focus:border-accent/60"
            >
              <option value="">Select a category</option>
              {["Payments", "Data", "AI", "Finance", "Social", "DeFi", "Other"].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tags" hint="Add tags to help users find your API (max 10)">
            <Input value={f.tags} onChange={(e) => set("tags")(e.target.value)} placeholder="Sepolia, x402, agents" />
          </Field>
          <Field label="Payment Address" hint="Ethereum address (0x…) that receives payments">
            <Input value={f.payment_address} onChange={(e) => set("payment_address")(e.target.value)} className="font-mono" placeholder="01…" />
          </Field>
          <Field label="Target API URL" hint="the endpoint called after payment">
            <Input value={f.target_url} onChange={(e) => set("target_url")(e.target.value)} placeholder="https://api.example.com/v1/endpoint" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="HTTP Method">
              <select
                value={f.http_method}
                onChange={(e) => set("http_method")(e.target.value)}
                className="w-full rounded-xl border border-white/[0.1] bg-white/[0.03] px-3.5 py-2.5 text-sm text-white outline-none focus:border-accent/60"
              >
                {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Content Type">
              <Input value={f.content_type} onChange={(e) => set("content_type")(e.target.value)} />
            </Field>
          </div>
          <Field label="Query Parameters Template" hint="(optional) use {name}">
            <Textarea rows={2} value={f.query_params} onChange={(e) => set("query_params")(e.target.value)} placeholder="param1={name1}&param2={name2}" />
          </Field>

          <div className="rounded-xl border border-white/[0.08] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="font-semibold text-white">Variables</p>
                <p className="text-xs text-neutral-500">Typed inputs the agent passes; substitute {"{name}"} in URL/query/body.</p>
              </div>
              <Button
                variant="outline"
                onClick={() => setVars((v) => [...v, { name: "", type: "string", in: "query", description: "", required: true }])}
              >
                Add
              </Button>
            </div>
            {vars.map((v, i) => (
              <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[1fr_110px_100px_1fr_auto]">
                <Input value={v.name} onChange={(e) => setVars((a) => a.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="font-mono" placeholder="name" />
                <select
                  value={v.type}
                  onChange={(e) => setVars((a) => a.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}
                  className="rounded-xl border border-white/[0.1] bg-white/[0.03] px-2 py-2.5 text-sm text-white"
                >
                  {["string", "number", "boolean"].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <select
                  value={v.in}
                  onChange={(e) => setVars((a) => a.map((x, j) => (j === i ? { ...x, in: e.target.value } : x)))}
                  className="rounded-xl border border-white/[0.1] bg-white/[0.03] px-2 py-2.5 text-sm text-white"
                >
                  {["query", "path", "body"].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <Input value={v.description} onChange={(e) => setVars((a) => a.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                <button type="button" onClick={() => setVars((a) => a.filter((_, j) => j !== i))} className="text-neutral-500 hover:text-red-400">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-white/[0.08] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="font-semibold text-white">Auth Headers</p>
                <p className="text-xs text-neutral-500">Sent upstream after payment. Use env:NAME to read a server secret.</p>
              </div>
              <Button variant="outline" onClick={() => setHeaders((h) => [...h, { name: "", value: "" }])}>
                Add
              </Button>
            </div>
            {headers.map((h, i) => (
              <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input value={h.name} onChange={(e) => setHeaders((a) => a.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="font-mono" placeholder="Authorization" />
                <Input value={h.value} onChange={(e) => setHeaders((a) => a.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} className="font-mono" placeholder="Bearer env:OPENAI_KEY" />
                <button type="button" onClick={() => setHeaders((a) => a.filter((_, j) => j !== i))} className="text-neutral-500 hover:text-red-400">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <Field label="Example Response" hint="(optional)">
            <Textarea rows={4} value={f.example_response} onChange={(e) => set("example_response")(e.target.value)} />
          </Field>
          <Field label="Price per Request (ETH wei)" hint="charged per API call">
            <Input type="number" step="1" value={f.price} onChange={(e) => set("price")(e.target.value)} />
          </Field>
          <Toggle on={f.is_public} onChange={(v) => setF((s) => ({ ...s, is_public: v }))} label="Make API Public" desc="List this API in the public marketplace" />

          {err && <p className="text-sm text-red-400">{err}</p>}
          <div className="flex gap-3 pt-2">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy || !f.name || !f.target_url}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create Proxy
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
