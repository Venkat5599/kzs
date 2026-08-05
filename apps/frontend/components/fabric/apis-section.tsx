"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Plus, ArrowLeft, Store, Loader2, Terminal, Search, Zap, Trash2 } from "lucide-react";
import { Panel, Field, Input, Textarea, Button, Toggle, Chip, Empty, short, CopyBtn } from "./ui";
import { useWallet } from "@/lib/wallet";
import { createFabricApi, gatewayUrl, listFabricApis, type FabricApi } from "@/lib/api";

/**
 * One numbered group of related fields.
 *
 * The form was a flat run of fifteen inputs, which reads as a wall and gives no
 * sense of progress or of what is required. Three short steps plus a disclosure
 * for the optional half is the whole fix.
 */
function Step({
  n,
  title,
  desc,
  children,
}: {
  n: number;
  title: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-accent/40 bg-accent/10 text-xs font-semibold text-accent">
          {n}
        </span>
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <p className="text-xs text-neutral-500">{desc}</p>
        </div>
      </div>
      <div className="space-y-5 pl-9">{children}</div>
    </section>
  );
}

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

    </div>
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
        <p className="mt-1 max-w-lg text-neutral-400">
          Charge for an API you already have. We sit in front of it and only
          call it once the caller has paid.
        </p>
      </div>

      <Panel>
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-lg font-semibold text-white">Three quick steps</p>
            <p className="text-sm text-neutral-500">Takes about a minute. Everything else has a sensible default.</p>
          </div>
          <Button variant="outline">Paste a curl command</Button>
        </div>

        <div className="space-y-8">
          <Step n={1} title="What are you selling?" desc="The service people will pay to use.">
          <Field label="Name it" hint="What people will see in the marketplace.">
            <Input value={f.name} onChange={(e) => set("name")(e.target.value)} placeholder="Weather lookup" />
          </Field>
          <Field label="What does it do?" hint="Optional, but it is what convinces someone to use it.">
            <Textarea rows={3} value={f.description} onChange={(e) => set("description")(e.target.value)} placeholder="Returns the current temperature for any city." />
          </Field>
          <Field label="What we call when someone pays" hint="The web address of the service you are reselling. We only call it after payment clears.">
            <Input value={f.target_url} onChange={(e) => set("target_url")(e.target.value)} placeholder="https://api.example.com/v1/endpoint" />
          </Field>
          </Step>

          <Step n={2} title="What does it cost?" desc="Every payment goes straight to your wallet.">
          <Field label="Price per use" hint="In wei, the smallest unit of ETH. 1000 is a fraction of a cent — fine for testing.">
            <Input type="number" step="1" value={f.price} onChange={(e) => set("price")(e.target.value)} />
          </Field>
          <Field label="Where you get paid" hint="Your wallet address — the long code starting 0x. Every payment lands here.">
            <Input value={f.payment_address} onChange={(e) => set("payment_address")(e.target.value)} className="font-mono" placeholder="0x1234…" />
          </Field>
          </Step>

          <Step n={3} title="Where does it show up?" desc="How people find it in the marketplace.">
          <Field label="Category" hint="Helps people find it.">
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
          <Field label="Tags" hint="Words people might search for. Separate with commas, up to 10.">
            <Input value={f.tags} onChange={(e) => set("tags")(e.target.value)} placeholder="weather, forecast, cities" />
          </Field>
          <Toggle on={f.is_public} onChange={(v) => setF((s) => ({ ...s, is_public: v }))} label="Show in the marketplace" desc="Anyone can find and pay for it. Turn off to keep it private to you." />
          </Step>

          {/* Everything below is optional and has a sensible default. Hiding it
              behind a disclosure is the difference between a form someone can
              fill in and a wall of fields they abandon. */}
          <details className="group rounded-xl border border-white/[0.08] bg-white/[0.01]">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm text-neutral-300 hover:text-white">
              <span>
                <span className="font-semibold">Advanced options</span>
                <span className="ml-2 text-xs text-neutral-500">
                  Custom link, request type, auth headers — all optional
                </span>
              </span>
              <span className="text-neutral-500 transition-transform group-open:rotate-45">+</span>
            </summary>
            <div className="space-y-5 border-t border-white/[0.06] p-4">
          <Field label="Short web name" hint="Optional. Used in the link, like kairos.app/s/weather-lookup. Leave blank and we make one from the name.">
            <Input value={f.slug} onChange={(e) => set("slug")(e.target.value)} placeholder="weather-lookup" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Request type" hint="GET reads data. POST sends data. If unsure, GET.">
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
            <Field label="Data format" hint="JSON is right for almost everything.">
              <Input value={f.content_type} onChange={(e) => set("content_type")(e.target.value)} />
            </Field>
          </div>
          <Field label="Extra settings to pass along" hint="Optional. Put {curly braces} where a caller fills in a value — for example city={city}.">
            <Textarea rows={2} value={f.query_params} onChange={(e) => set("query_params")(e.target.value)} placeholder="city={city}&units=metric" />
          </Field>
          <div className="rounded-xl border border-white/[0.08] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="font-semibold text-white">Variables</p>
                <p className="text-xs text-neutral-500">Values the caller fills in. Use {"{name}"} in the address above to place them.</p>
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
                <p className="font-semibold text-white">Secret keys to send</p>
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
          <Field label="Example of what comes back" hint="Optional. Paste a sample so buyers know what they are getting.">
            <Textarea rows={4} value={f.example_response} onChange={(e) => set("example_response")(e.target.value)} />
          </Field>
            </div>
          </details>

          {err && <p className="text-sm text-red-400">{err}</p>}
          <div className="flex gap-3 pt-2">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy || !f.name || !f.target_url}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Publish it
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
