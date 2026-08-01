"use client";

import { useEffect, useState } from "react";
import { Loader2, Search, Server, Store, Workflow, Wrench, Globe, Sparkles } from "lucide-react";
import { Panel, Input, Empty, Chip, CopyBtn, short, Button } from "./ui";
import {
  fabricMcpUrl,
  listFabricApisPublic,
  listFabricMcpServers,
  listFabricWorkflows,
  listSkills,
  seedFabricMarketplace,
  type FabricApi,
  type FabricMcpServer,
  type FabricWorkflow,
  type SkillSummary,
} from "@/lib/api";

export function MarketplaceSection() {
  const [mcps, setMcps] = useState<FabricMcpServer[] | null>(null);
  const [fabricApis, setFabricApis] = useState<FabricApi[] | null>(null);
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);
  const [wfs, setWfs] = useState<FabricWorkflow[] | null>(null);
  const [q, setQ] = useState("");
  const [seeding, setSeeding] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const load = () => {
    listFabricMcpServers("public").then(setMcps).catch(() => setMcps([]));
    listFabricApisPublic().then(setFabricApis).catch(() => setFabricApis([]));
    listSkills().then(setSkills).catch(() => setSkills([]));
    listFabricWorkflows("public").then(setWfs).catch(() => setWfs([]));
  };

  useEffect(() => {
    setToken(localStorage.getItem("kairos_session_token"));
    load();
  }, []);

  const seed = async () => {
    setSeeding(true);
    try {
      await seedFabricMarketplace();
      load();
    } finally {
      setSeeding(false);
    }
  };

  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());
  const fMcps = (mcps ?? []).filter((m) => match(m.display_name + (m.description ?? "")));
  const fApis = [
    ...(fabricApis ?? []).map((a) => ({ kind: "api" as const, row: a })),
    ...(skills ?? []).map((s) => ({ kind: "skill" as const, row: s })),
  ].filter((x) =>
    match(
      x.kind === "api"
        ? x.row.name + (x.row.description ?? "")
        : x.row.name + x.row.description,
    ),
  );
  const fWfs = (wfs ?? []).filter((w) => match(w.name + (w.description ?? "")));

  const empty = mcps !== null && fMcps.length === 0 && fApis.length === 0 && fWfs.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight text-white">Marketplace</h1>
          <p className="mt-1 text-neutral-400">
            Public MCP servers, APIs, and workflows — discover templates and connect agents.
          </p>
        </div>
        <Button variant="outline" onClick={seed} disabled={seeding}>
          {seeding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Seed templates
        </Button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-neutral-500" />
        <Input placeholder="Search the marketplace…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
      </div>

      {empty && (
        <Panel className="text-center">
          <p className="text-sm text-neutral-400">No public listings yet.</p>
          <p className="mt-2 text-xs text-neutral-500">
            Click <strong className="text-white">Seed templates</strong> to load starter APIs, MCP server, and workflows (kage-style demo catalog).
          </p>
        </Panel>
      )}

      <div>
        <div className="mb-3 flex items-center gap-2">
          <Server className="h-4 w-4 text-accent" />
          <p className="text-sm font-semibold uppercase tracking-wider text-neutral-500">MCP Servers</p>
        </div>
        {mcps === null ? (
          <Empty>
            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
          </Empty>
        ) : fMcps.length === 0 ? (
          <Empty>No public MCP servers yet.</Empty>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {fMcps.map((m) => {
              const url = `${fabricMcpUrl}/mcp/${m.slug}${token ? `?token=${token}` : ""}`;
              const cmd = `claude mcp add ${m.slug} --transport http ${fabricMcpUrl}/mcp/${m.slug}${token ? ` --header "Authorization: Bearer ${token}"` : ""}`;
              return (
                <Panel key={m.id}>
                  <div className="flex items-center gap-2">
                    <Server className="h-4 w-4 text-accent" />
                    <p className="font-semibold text-white">{m.display_name}</p>
                    <Globe className="h-3 w-3 text-neutral-500" />
                    <Chip>template</Chip>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-neutral-500">{m.description}</p>
                  <div className="mt-3 flex gap-4 text-xs text-neutral-500">
                    <span className="inline-flex items-center gap-1">
                      <Wrench className="h-3.5 w-3.5" /> {(m.tools ?? []).length} tools
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Workflow className="h-3.5 w-3.5" /> {(m.workflows ?? []).length} workflows
                    </span>
                    <span className="font-mono">{short(m.owner_address, 5, 4)}</span>
                  </div>
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-white/[0.08] px-3 py-2">
                    <span className="flex-1 truncate font-mono text-[11px] text-neutral-400">{url}</span>
                    <CopyBtn text={cmd} />
                  </div>
                  {!token && (
                    <p className="mt-2 text-[11px] text-neutral-600">
                      Provision a session key on the Dashboard for a connect-ready Bearer token.
                    </p>
                  )}
                </Panel>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div className="mb-3 flex items-center gap-2">
          <Store className="h-4 w-4 text-accent" />
          <p className="text-sm font-semibold uppercase tracking-wider text-neutral-500">APIs</p>
        </div>
        {fabricApis === null && skills === null ? (
          <Empty>
            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
          </Empty>
        ) : fApis.length === 0 ? (
          <Empty>No public APIs yet.</Empty>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {fApis.map((item) =>
              item.kind === "api" ? (
                <Panel key={item.row.id}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-white">{item.row.name}</p>
                    <Chip accent>{Number(item.row.price).toLocaleString()} wei / call</Chip>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-neutral-500">{item.row.description}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.row.category && <Chip>{item.row.category}</Chip>}
                    {(item.row.tags ?? []).slice(0, 3).map((t) => (
                      <Chip key={t}>{t}</Chip>
                    ))}
                  </div>
                  <p className="mt-2 font-mono text-[11px] text-neutral-600">api__{item.row.slug}</p>
                </Panel>
              ) : (
                <Panel key={item.row.id}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-white">{item.row.name}</p>
                    <Chip accent>
                      {item.row.pricePerCall === "0" ? "Free" : `${item.row.pricePerCall} ${item.row.asset}`}
                    </Chip>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-neutral-500">{item.row.description}</p>
                  <p className="mt-2 font-mono text-[11px] text-neutral-600">api__{item.row.slug}</p>
                </Panel>
              ),
            )}
          </div>
        )}
      </div>

      <div>
        <div className="mb-3 flex items-center gap-2">
          <Workflow className="h-4 w-4 text-accent" />
          <p className="text-sm font-semibold uppercase tracking-wider text-neutral-500">Workflows</p>
        </div>
        {wfs === null ? (
          <Empty>
            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
          </Empty>
        ) : fWfs.length === 0 ? (
          <Empty>No public workflows yet.</Empty>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {fWfs.map((w) => (
              <Panel key={w.id}>
                <p className="font-semibold text-white">{w.name}</p>
                <p className="mt-0.5 font-mono text-xs text-neutral-500">wf__{w.slug}</p>
                <p className="mt-2 line-clamp-2 text-sm text-neutral-500">{w.description}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(w.tags ?? []).map((t) => (
                    <Chip key={t} accent={t === "onchain"}>
                      {t}
                    </Chip>
                  ))}
                </div>
              </Panel>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
