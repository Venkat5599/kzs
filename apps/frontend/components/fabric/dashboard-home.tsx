"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Layers,
  Activity,
  CheckCircle2,
  DollarSign,
  Store,
  Server,
  Workflow,
  Clock,
} from "lucide-react";
import { Panel } from "./ui";
import {
  getFabricActivity,
  getFabricLogs,
  getFabricStats,
  getChainStatus,
  listSkills,
  gatewayUrl,
  type SkillSummary,
} from "@/lib/api";
import { useWallet } from "@/lib/wallet";

function Stat({ icon: Icon, label, value, sub }: { icon: typeof Layers; label: string; value: ReactNode; sub: string }) {
  return (
    <Panel>
      <div className="flex items-center justify-between">
        <span className="text-sm text-neutral-400">{label}</span>
        <Icon className="h-4 w-4 text-neutral-500" strokeWidth={1.7} />
      </div>
      <p className="mt-4 text-4xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-1 text-xs text-neutral-500">{sub}</p>
    </Panel>
  );
}

/**
 * One step of the x402 setup sequence.
 *
 * `done` is filled and quiet, `active` is the one the eye should land on, and
 * `waiting` is dimmed so a step you cannot start yet does not read as an
 * option. The marker is a number until the step is finished, then a check —
 * so progress is legible without relying on colour alone.
 */
export function DashboardHome({
  go,
}: {
  go: (s: "apis" | "mcp" | "workflows" | "marketplace") => void;
}) {
  const [s, setS] = useState<Awaited<ReturnType<typeof getFabricStats>> | null>(null);
  const [act, setAct] = useState<unknown[] | null>(null);
  const [period, setPeriod] = useState("all");
  const [chain, setChain] = useState("testnet");
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);
  const { address } = useWallet();

  useEffect(() => {
    getFabricStats(address ?? undefined)
      .then(setS)
      .catch(() => {});
    getFabricActivity().then(setAct).catch(() => setAct([]));
    getChainStatus().then((c) => setChain(c.configured ? c.network : "unconfigured")).catch(() => {});
    listSkills().then(setSkills).catch(() => setSkills([]));
  }, [address]);

  const TOGGLE = [
    { k: "all", label: "All Time" },
    { k: "30d", label: "Last 30 Days" },
    { k: "7d", label: "Last 7 Days" },
  ];
  const t = s?.totals;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight text-white">Dashboard</h1>
          <p className="mt-1 text-neutral-400">Manage your creations and track performance — live on Sepolia {chain}.</p>
        </div>
        <div className="flex gap-1 rounded-xl bg-white/[0.03] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
          {TOGGLE.map((x) => (
            <button
              key={x.k}
              onClick={() => setPeriod(x.k)}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${period === x.k ? "bg-accent/15 text-accent" : "text-neutral-500 hover:text-neutral-300"}`}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Layers} label="Total APIs" value={skills?.length ?? t?.apis ?? "—"} sub="x402 payment-gated skills" />
        <Stat icon={Activity} label="Total Requests" value={t?.requests ?? "—"} sub="all-time API calls" />
        {/*
          Not a gap in the dashboard — a property of the system. Whether a
          settlement was authorized is encrypted, so this number is unknowable
          here by design. A dash plus the reason is more honest, and more
          on-message, than printing a rate nobody measured.
        */}
        <Stat
          icon={CheckCircle2}
          label="Success Rate"
          value={t?.successRate != null ? `${t.successRate}%` : "—"}
          sub={t?.success != null ? `${t.success} successful` : "encrypted — not knowable here"}
        />
        <Stat icon={DollarSign} label="Total Earnings" value={t?.earnings ?? "—"} sub="ETH wei earned" />
      </div>


      <div>
        <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">Manage</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { k: "apis" as const, icon: Store, label: "APIs", n: skills?.length ?? t?.apis, sub: "payment-gated proxies" },
            { k: "mcp" as const, icon: Server, label: "MCP Servers", n: t?.mcpServers, sub: "tools for agents" },
            { k: "workflows" as const, icon: Workflow, label: "Workflows", n: t?.workflows, sub: "reusable agent flows" },
          ].map((m) => (
            <button
              key={m.k}
              onClick={() => go(m.k)}
              className="group rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 text-left transition hover:border-accent/40 hover:bg-white/[0.04]"
            >
              <m.icon className="h-5 w-5 text-accent" strokeWidth={1.7} />
              <p className="mt-3 flex items-center gap-2 font-semibold text-white">
                {m.label} <span className="text-sm font-normal text-neutral-500">{m.n ?? 0}</span>
              </p>
              <p className="text-xs text-neutral-500">{m.sub}</p>
            </button>
          ))}
        </div>
      </div>

      <RequestLogs period={period} />

      <Panel>
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-accent" />
          <p className="font-semibold text-white">Recent activity</p>
        </div>
        <div className="mt-4 divide-y divide-white/[0.06]">
          {act === null ? (
            <p className="py-3 text-sm text-neutral-500">loading…</p>
          ) : act.length === 0 ? (
            <p className="py-3 text-sm text-neutral-500">Nothing published yet — create an API, workflow, or MCP server.</p>
          ) : (
            (act as { kind: string; name: string; slug: string | null; created_at: string }[]).map((a, i) => {
              const tint = a.kind === "workflow" ? "text-accent" : a.kind === "mcp" ? "text-sky-400" : "text-amber-400";
              return (
                <div key={i} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className={`w-20 shrink-0 font-mono text-[11px] uppercase ${tint}`}>{a.kind}</span>
                  <span className="flex-1 truncate text-neutral-200">{a.name}</span>
                  <span className="hidden font-mono text-xs text-neutral-600 sm:block">/{a.slug}</span>
                </div>
              );
            })
          )}
        </div>
      </Panel>

      <p className="text-xs text-neutral-600">
        Gateway: <span className="font-mono text-neutral-500">{gatewayUrl}</span>
      </p>
    </div>
  );
}

function RequestLogs({ period }: { period: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getFabricLogs>> | null>(null);
  useEffect(() => {
    // Clear then refetch, so the previous period's rows do not sit under the new
    // period's heading. Deferred for the same reason as the effects above.
    Promise.resolve()
      .then(() => {
        setData(null);
        return getFabricLogs(period).then(setData);
      })
      .catch(() => setData({ logs: [], stats: null }));
  }, [period]);

  return (
    <Panel>
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-accent" />
        <p className="font-semibold text-white">Recent Requests</p>
        <span className="text-xs text-neutral-500">· request activity for your APIs</span>
      </div>
      {data?.stats && (
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
            <p className="text-xs text-neutral-500">Calls</p>
            <p className="mt-0.5 text-xl font-semibold text-white">{data.stats.total}</p>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
            <p className="text-xs text-neutral-500">Paid</p>
            <p className="mt-0.5 text-xl font-semibold text-white">{data.stats.paid}</p>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
            <p className="text-xs text-neutral-500">Revenue</p>
            <p className="mt-0.5 text-xl font-semibold text-white">{data.stats.revenue}</p>
          </div>
        </div>
      )}
      <div className="mt-4 divide-y divide-white/[0.06]">
        {!data ? (
          <p className="py-3 text-sm text-neutral-500">loading…</p>
        ) : data.logs.length === 0 ? (
          <p className="py-3 text-sm text-neutral-500">
            No requests in this window yet. Calls to any <span className="font-mono">api__*</span> tool land here.
          </p>
        ) : (
          (data.logs as { id: string; api_name: string | null; ok: boolean; paid: boolean; status: number | null; created_at?: string }[]).map(
            (l) => (
              <div key={l.id} className="flex items-center gap-3 py-2 text-sm">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${l.ok ? "bg-accent" : "bg-red-400"}`} />
                <span className="flex-1 truncate text-neutral-200">{l.api_name ?? "—"}</span>
                {l.paid && (
                  <span className="rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent">paid</span>
                )}
                <span className={`w-10 text-right font-mono text-xs ${l.ok ? "text-neutral-500" : "text-red-400"}`}>
                  {l.status ?? "—"}
                </span>
              </div>
            ),
          )
        )}
      </div>
    </Panel>
  );
}
