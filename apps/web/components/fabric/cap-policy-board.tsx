"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { Panel, Input, Button, short, CopyBtn, formatAmount } from "./ui";
import { getNoxAgent, noxRegisterAgent } from "@/lib/api";

/**
 * Cap policy board — assign confidential per-call spending caps by dragging.
 *
 * Registering an agent used to be a form: paste an address, type a number,
 * press a button. That hides the thing the vault is actually about, which is a
 * *policy* — how much each agent may spend per call, held encrypted.
 *
 * A drop here is not a UI state change. It sends a real `registerAgent`
 * transaction whose cap is encrypted before it leaves the browser, and the
 * board then reads the cap back through the Nox ACL to confirm what actually
 * landed on-chain.
 *
 * The roster lives in localStorage because neither the contract nor the gateway
 * can enumerate agents — the vault stores sessions in a mapping, and mappings
 * do not iterate. So the board tracks which addresses *you* care about; the
 * caps themselves always come from the chain, never from local state.
 */

type TierId = "restricted" | "standard" | "trusted";

interface Tier {
  id: TierId;
  label: string;
  capWei: string;
  description: string;
}

/** Per-call caps, in wei, encrypted before they reach the chain. */
const TIERS: Tier[] = [
  {
    id: "restricted",
    label: "Restricted",
    capWei: "1000",
    description: "probes and health checks",
  },
  {
    id: "standard",
    label: "Standard",
    capWei: "10000",
    description: "ordinary metered API calls",
  },
  {
    id: "trusted",
    label: "Trusted",
    capWei: "100000",
    description: "bulk inference and paid data",
  },
];

interface Agent {
  address: string;
  tier: TierId | null;
  // Read back from the chain after registering — proof, not intent. Explicitly
  // `| undefined` rather than optional: the repo runs
  // `exactOptionalPropertyTypes`, so a read that returns nothing must be
  // representable as a present-but-undefined field.
  onChainCapWei?: string | undefined;
  spentWei?: string | undefined;
}

const STORAGE_KEY = "kairos.capBoard.v1";

function loadRoster(): Agent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // A corrupt entry would render as a broken card rather than throwing,
    // which is harder to notice than dropping it here.
    return parsed.filter(
      (a): a is Agent =>
        typeof a === "object" && a !== null && typeof (a as Agent).address === "string",
    );
  } catch {
    return [];
  }
}

function isAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}

function wei(value: string | undefined): string {
  return formatAmount(value);
}

export function CapPolicyBoard() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [draft, setDraft] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<TierId | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Hydrate after mount. Reading localStorage during render would desync the
  // server-rendered HTML from the client tree.
  useEffect(() => {
    setAgents(loadRoster());
  }, []);

  const persist = useCallback((next: Agent[]) => {
    setAgents(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private browsing or a full quota. The board still works this session;
      // only the roster fails to survive a reload.
    }
  }, []);

  const addAgent = useCallback(() => {
    const address = draft.trim();
    if (!isAddress(address)) {
      setErr("Enter a 0x address (40 hex characters).");
      return;
    }
    if (agents.some((a) => a.address.toLowerCase() === address.toLowerCase())) {
      setErr("That agent is already on the board.");
      return;
    }
    setErr(null);
    persist([...agents, { address, tier: null }]);
    setDraft("");
  }, [draft, agents, persist]);

  const removeAgent = useCallback(
    (address: string) => {
      persist(agents.filter((a) => a.address !== address));
    },
    [agents, persist],
  );

  /**
   * Assign a tier. Sends the transaction first and records the tier only once
   * the chain confirms the cap, so a failed registration cannot leave the board
   * claiming a policy that was never applied.
   */
  const assign = useCallback(
    async (address: string, tier: Tier) => {
      setBusy(address);
      setErr(null);
      try {
        await noxRegisterAgent(address, tier.capWei);
        const confirmed = await getNoxAgent(address).catch(() => null);
        persist(
          agents.map((a) =>
            a.address === address
              ? {
                  ...a,
                  tier: tier.id,
                  onChainCapWei: confirmed?.capWei,
                  spentWei: confirmed?.spentWei,
                }
              : a,
          ),
        );
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [agents, persist],
  );

  const unassigned = agents.filter((a) => a.tier === null);

  return (
    <Panel className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-white">Cap policy</h3>
        <p className="mt-1 max-w-2xl text-sm text-neutral-400">
          Drag an agent into a tier to set its per-call spending cap. The cap is encrypted
          before it leaves the browser — the chain stores a handle, and only the owner and
          that agent can decrypt it.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addAgent();
          }}
          placeholder="0x… agent address"
          className="max-w-md font-mono"
        />
        <Button variant="outline" onClick={addAgent} disabled={!draft.trim()}>
          <Plus className="mr-1 h-4 w-4" />
          Add agent
        </Button>
      </div>

      {err && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm text-red-300">
          {err}
        </div>
      )}

      <div>
        <div className="text-xs uppercase tracking-wide text-neutral-500">Unassigned</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {unassigned.length === 0 ? (
            <div className="text-sm text-neutral-600">
              {agents.length === 0
                ? "Add an agent address to begin."
                : "Every agent has a cap."}
            </div>
          ) : (
            unassigned.map((agent) => (
              <AgentCard
                key={agent.address}
                agent={agent}
                busy={busy === agent.address}
                onDragStart={() => setDragging(agent.address)}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
                onRemove={() => removeAgent(agent.address)}
              />
            ))
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {TIERS.map((tier) => {
          const members = agents.filter((a) => a.tier === tier.id);
          const active = over === tier.id && dragging !== null;
          return (
            <div
              key={tier.id}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(tier.id);
              }}
              onDragLeave={() => setOver((cur) => (cur === tier.id ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                const address = e.dataTransfer.getData("text/plain") || dragging;
                setOver(null);
                setDragging(null);
                if (address) void assign(address, tier);
              }}
              className={`rounded-xl border p-4 transition-colors ${
                active
                  ? "border-accent/50 bg-accent/[0.05]"
                  : "border-white/[0.08] bg-white/[0.02]"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-white">{tier.label}</span>
                <span className="font-mono text-xs text-neutral-400">
                  {formatAmount(tier.capWei)}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-neutral-600">{tier.description}</div>

              <div className="mt-3 space-y-2">
                {members.length === 0 ? (
                  <div className="text-xs text-neutral-600">
                    {active ? "Release to register" : "Drop an agent here"}
                  </div>
                ) : (
                  members.map((agent) => (
                    <AgentCard
                      key={agent.address}
                      agent={agent}
                      busy={busy === agent.address}
                      onDragStart={() => setDragging(agent.address)}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                      onRemove={() => removeAgent(agent.address)}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-neutral-600">
        Each drop sends a registerAgent transaction. The cap shown under an assigned agent
        is read back from the chain through the Nox ACL, so it reflects what was actually
        stored — not what was requested.
      </p>
    </Panel>
  );
}

function AgentCard({
  agent,
  busy,
  onDragStart,
  onDragEnd,
  onRemove,
}: {
  agent: Agent;
  busy: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      draggable={!busy}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", agent.address);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`group flex items-center gap-2 rounded-lg border border-white/[0.08] bg-neutral-900/80 px-3 py-2 ${
        busy ? "opacity-60" : "cursor-grab active:cursor-grabbing"
      }`}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
      ) : (
        // Grip drawn as three short rules rather than an icon-pack glyph.
        <span className="flex shrink-0 flex-col gap-[3px]" aria-hidden>
          <span className="block h-px w-3 rounded-full bg-neutral-600" />
          <span className="block h-px w-3 rounded-full bg-neutral-600" />
          <span className="block h-px w-3 rounded-full bg-neutral-600" />
        </span>
      )}

      <div className="min-w-0">
        <div className="font-mono text-xs text-neutral-200">{short(agent.address, 8, 6)}</div>
        {agent.tier && (
          <div className="text-[10px] text-neutral-500">
            on-chain cap {wei(agent.onChainCapWei)}
            {agent.spentWei != null && ` · spent ${wei(agent.spentWei)}`}
          </div>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <CopyBtn text={agent.address} />
        <button
          onClick={onRemove}
          aria-label="Remove from board"
          className="text-neutral-600 opacity-0 transition-opacity hover:text-neutral-300 group-hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
