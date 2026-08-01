"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Layers,
  Activity,
  Check,
  CheckCircle2,
  DollarSign,
  KeyRound,
  Store,
  Server,
  Workflow,
  Clock,
  Wallet,
  Eye,
  EyeOff,
} from "lucide-react";
import { Panel, CopyBtn, ETH, short } from "./ui";
import {
  getFabricActivity,
  getFabricLogs,
  getFabricStats,
  getChainStatus,
  getFabricWalletStatus,
  listSkills,
  provisionFabricSession,
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
function FlowStep({
  n,
  state,
  title,
  detail,
}: {
  n: number;
  state: "done" | "active" | "waiting";
  title: string;
  detail: string;
}) {
  const done = state === "done";
  const active = state === "active";
  return (
    <li
      className={`flex items-start gap-3 rounded-xl p-4 transition-colors duration-300 ${
        active
          ? "bg-white/[0.05] shadow-[inset_0_1px_0_rgba(255,255,255,0.09)]"
          : "bg-white/[0.02] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
      }`}
    >
      <span
        aria-hidden
        className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
          done
            ? "bg-accent/[0.16] text-accent"
            : active
              ? "bg-white/[0.12] text-white"
              : "bg-white/[0.05] text-neutral-600"
        }`}
      >
        {done ? <Check className="h-3 w-3" strokeWidth={2.5} /> : n}
      </span>
      <div className="min-w-0">
        <p
          className={`text-sm font-semibold ${
            state === "waiting" ? "text-neutral-500" : "text-white"
          }`}
        >
          {title}
        </p>
        <p
          className={`mt-0.5 text-sm ${
            state === "waiting" ? "text-neutral-600" : "text-neutral-400"
          } ${done ? "font-mono text-xs" : ""}`}
        >
          {detail}
        </p>
      </div>
    </li>
  );
}

export function DashboardHome({
  go,
}: {
  go: (s: "apis" | "mcp" | "workflows" | "marketplace" | "session-keys") => void;
}) {
  const [s, setS] = useState<Awaited<ReturnType<typeof getFabricStats>> | null>(null);
  const [act, setAct] = useState<unknown[] | null>(null);
  const [period, setPeriod] = useState("all");
  const [chain, setChain] = useState("testnet");
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);
  const [wstat, setWstat] = useState<{ funded: boolean; ETH: string } | null>(null);
  const [showSec, setShowSec] = useState(false);
  const [prov, setProv] = useState<{ sessionId: string; token: string } | null>(null);
  const [provBusy, setProvBusy] = useState(false);
  const [capWei, setCapWei] = useState("5000000000");
  const [agentKey, setAgentKey] = useState("");
  const { address, secret, real, connecting, connect, generate, disconnect } = useWallet();

  useEffect(() => {
    getFabricStats(address ?? undefined)
      .then(setS)
      .catch(() => {});
    getFabricActivity().then(setAct).catch(() => setAct([]));
    getChainStatus().then((c) => setChain(c.configured ? c.network : "unconfigured")).catch(() => {});
    listSkills().then(setSkills).catch(() => setSkills([]));
    const t = localStorage.getItem("kairos_session_token");
    const sid = localStorage.getItem("kairos_session_id");
    if (t && sid) setProv({ token: t, sessionId: sid });
  }, [address]);

  useEffect(() => {
    if (!address) {
      setWstat(null);
      return;
    }
    setWstat(null);
    getFabricWalletStatus(address)
      .then((d) => setWstat(d.ok ? { funded: Boolean(d.funded), ETH: d.ETH ?? "0" } : null))
      .catch(() => setWstat(null));
  }, [address]);

  const TOGGLE = [
    { k: "all", label: "All Time" },
    { k: "30d", label: "Last 30 Days" },
    { k: "7d", label: "Last 7 Days" },
  ];
  const t = s?.totals;
  const sess = s?.session;
  const cap = sess?.cap ? Number(sess.cap) : null;
  const remaining = sess?.remaining ? Number(sess.remaining) : null;
  const pct = cap && remaining != null ? Math.max(0, Math.min(100, (remaining / cap) * 100)) : null;

  const provision = async () => {
    const pk = agentKey.trim() || address;
    if (!pk) return;
    setProvBusy(true);
    try {
      const d = await provisionFabricSession({
        agentPublicKeyHex: pk,
        scope: {
          maxSpendPerCall: String(Math.max(1, Math.round(Number(capWei || "0")))),
          expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        },
      });
      if (d.ok) {
        setProv({ sessionId: d.sessionId, token: d.token });
        localStorage.setItem("kairos_session_token", d.token);
        localStorage.setItem("kairos_session_id", d.sessionId);
        getFabricStats().then(setS).catch(() => {});
      } else {
        alert(`Provision failed: ${d.error}`);
      }
    } catch (e) {
      alert(`Provision failed: ${String((e as Error).message)}`);
    } finally {
      setProvBusy(false);
    }
  };

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
        <Stat icon={CheckCircle2} label="Success Rate" value={t ? `${t.successRate}%` : "—"} sub={`${t?.success ?? 0} successful`} />
        <Stat icon={DollarSign} label="Total Earnings" value={t?.earnings ?? "—"} sub="ETH wei earned" />
      </div>

      <Panel>
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-accent" />
          <p className="text-lg font-semibold text-white">x402 Payments</p>
          {sess?.live && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-md bg-accent/[0.08] px-2 py-0.5 text-[11px] font-medium text-accent/90 shadow-[inset_0_0_0_1px_rgba(163,230,53,0.15)]">
              live
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-neutral-500">Scoped session keys for automated, metered agent payments on Sepolia.</p>

        {/* Where you actually are, in order.
            This card used to open with an explainer panel repeating the line
            above it, then offer four buttons at once across two rows with
            nothing to say which came first. Getting an agent paying is a
            two-step sequence, so it is shown as one: each step reports its own
            state, and only the step you are on carries an action. */}
        <ol className="mt-5 flex flex-col gap-2">
          <FlowStep
            n={1}
            state={address ? "done" : "active"}
            title={address ? "Wallet connected" : "Connect a wallet"}
            detail={
              address
                ? `${short(address, 8, 6)} · ${
                    wstat === null
                      ? "checking balance…"
                      : wstat.funded
                        ? `${wstat.ETH} ETH`
                        : "unfunded — use the faucet"
                  }${real ? " · Sepolia" : ""}`
                : "Generate a scoped session wallet, or connect one you already control."
            }
          />
          <FlowStep
            n={2}
            state={prov ? "done" : address ? "active" : "waiting"}
            title={prov ? "Session key live" : "Provision a session key"}
            detail={
              prov
                ? "Capped per call and revocable on-chain."
                : "Your agent pays through a scoped, revocable key — your owner key is never handed over."
            }
          />
        </ol>

        {secret && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <p className="text-sm font-medium text-amber-200">Save your secret key — shown once</p>
            <p className="mt-1 text-xs text-neutral-500">Import into Sepolia Wallet, then fund via the testnet faucet.</p>
            <div className="mt-3 flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-lg bg-black/40 px-3 py-2 font-mono text-xs text-neutral-300">
                {showSec ? secret : "•".repeat(56)}
              </code>
              <button type="button" onClick={() => setShowSec((v) => !v)} className="text-neutral-400 hover:text-white">
                {showSec ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              <CopyBtn text={secret} />
            </div>
            <a
              href="https://www.alchemy.com/faucets/ethereum-sepolia"
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-xs text-accent underline underline-offset-2"
            >
              Fund on testnet faucet →
            </a>
          </div>
        )}

        {!address ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => generate()}
              disabled={connecting}
              className="inline-flex items-center gap-2 rounded-xl bg-white/[0.09] px-4 py-3 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(0,0,0,0.5)] transition-[background-color,color] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-accent/[0.16] hover:text-accent disabled:opacity-40"
            >
              <Wallet className="h-4 w-4" />
              {connecting ? "Generating…" : "Generate Session Wallet"}
            </button>
            <button
              onClick={() => connect()}
              disabled={connecting}
              className="inline-flex items-center gap-2 rounded-xl bg-white/[0.03] px-4 py-3 text-sm font-medium text-neutral-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-colors duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white/[0.06] hover:text-white"
            >
              Connect Sepolia Wallet
            </button>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-white/[0.03] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <p className="text-xs text-neutral-500">Your wallet balance</p>
              <p className="mt-1 text-2xl font-semibold text-white">
                {wstat === null ? "—" : `${wstat.ETH} ETH`}
              </p>
              <p className="text-xs text-neutral-600">{wstat?.funded ? "funded on testnet" : "fund via faucet"}</p>
            </div>
            <div className="rounded-xl bg-white/[0.03] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <p className="text-xs text-neutral-500">
                Demo agent session {sess?.live && "· live"}
              </p>
              <p className="mt-1 text-2xl font-semibold text-white">{remaining != null ? ETH(remaining) : "—"}</p>
              <p className="text-xs text-neutral-600">
                of {cap != null ? ETH(cap) : "—"} cap · shared demo
              </p>
              {pct != null && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                  <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
          </div>
        )}

        {address && !secret && !prov && (
          <div className="mt-4 rounded-xl bg-white/[0.02] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] text-sm text-neutral-400">
            External wallet connected — provision a scoped session key for your agent below, or generate a session wallet to
            manage keys locally.
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => generate()}
                disabled={connecting}
                className="rounded-xl bg-white/[0.04] px-3 py-2 text-xs font-medium text-neutral-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-colors duration-300 hover:bg-white/[0.07] hover:text-white"
              >
                Generate session wallet
              </button>
              <button onClick={disconnect} className="rounded-xl px-3 py-2 text-xs text-neutral-500 underline">
                Disconnect
              </button>
            </div>
          </div>
        )}

        {address && (
          <div className="mt-4">
            {prov ? (
              <div className="rounded-xl bg-accent/[0.05] p-4 shadow-[inset_0_0_0_1px_rgba(163,230,53,0.14)]">
                <p className="font-semibold text-white">Your session key is live</p>
                <p className="mt-1 font-mono text-xs text-neutral-500">{prov.sessionId}</p>
                <p className="mt-3 text-sm text-neutral-400">Personal agent token — use as Bearer when settling through your session:</p>
                <div className="mt-2 flex items-center gap-2 rounded-lg bg-black/40 px-3 py-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
                  <span className="flex-1 truncate font-mono text-xs text-white">{prov.token}</span>
                  <CopyBtn text={prov.token} />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setProv(null);
                    localStorage.removeItem("kairos_session_token");
                    localStorage.removeItem("kairos_session_id");
                  }}
                  className="mt-3 text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-300"
                >
                  Provision a new session (different limits)
                </button>
              </div>
            ) : (
              <div className="rounded-xl bg-white/[0.02] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                <p className="text-sm text-neutral-400">
                  Mint a scoped session key for agent <span className="font-mono text-neutral-300">{short(address, 6, 4)}</span> — capped per call on Sepolia.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="text-neutral-500">Agent public key (optional)</span>
                    <input
                      value={agentKey}
                      onChange={(e) => setAgentKey(e.target.value)}
                      placeholder="defaults to your wallet"
                      className="mt-1 w-full rounded-lg bg-black/40 px-3 py-2 font-mono text-sm text-white outline-none shadow-[inset_0_1px_2px_rgba(0,0,0,0.6),inset_0_0_0_1px_rgba(255,255,255,0.06)] transition-shadow duration-300 focus:shadow-[inset_0_1px_2px_rgba(0,0,0,0.6),inset_0_0_0_1px_rgba(163,230,53,0.35)]"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-neutral-500">Spend cap (wei per call)</span>
                    <input
                      value={capWei}
                      onChange={(e) => setCapWei(e.target.value)}
                      className="mt-1 w-full rounded-lg bg-black/40 px-3 py-2 font-mono text-sm text-white outline-none shadow-[inset_0_1px_2px_rgba(0,0,0,0.6),inset_0_0_0_1px_rgba(255,255,255,0.06)] transition-shadow duration-300 focus:shadow-[inset_0_1px_2px_rgba(0,0,0,0.6),inset_0_0_0_1px_rgba(163,230,53,0.35)]"
                    />
                  </label>
                </div>
                <button
                  onClick={provision}
                  disabled={provBusy}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white/[0.09] px-4 py-3 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(0,0,0,0.5)] transition-[background-color,color] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-accent/[0.16] hover:text-accent disabled:opacity-40"
                >
                  <KeyRound className="h-4 w-4" />
                  {provBusy ? "Provisioning…" : "Provision Session Key"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Only once there is something to manage. Offering "Manage session
            keys" to someone with no session key sends them to an empty screen,
            and "Publish API" was a different job entirely — it already has its
            own card in Manage directly below, so it is not repeated here. */}
        {prov && (
          <div className="mt-4">
            <button
              onClick={() => go("session-keys")}
              className="inline-flex items-center gap-2 rounded-xl bg-white/[0.03] px-4 py-3 text-sm font-medium text-neutral-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-colors duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white/[0.06] hover:text-white"
            >
              <KeyRound className="h-4 w-4" /> Manage session keys
            </button>
          </div>
        )}
      </Panel>

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
    setData(null);
    getFabricLogs(period).then(setData).catch(() => setData({ logs: [], stats: null }));
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
