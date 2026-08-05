"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Loader2, ShieldCheck, ShieldX } from "lucide-react";
import { Panel, Field, Input, Button, Chip, Empty, short, CopyBtn, formatAmount } from "./ui";
import { CapPolicyBoard } from "./cap-policy-board";
import {
  getNoxAgent,
  getNoxBudget,
  getNoxClosedEpoch,
  getNoxStatus,
  noxFlushEpoch,
  noxFund,
  noxRegisterAgent,
  noxSettle,
  withExplorerTx,
  type NoxAgent,
  type NoxBudget,
  type NoxClosedEpoch,
  type NoxSettlement,
  type NoxStatus,
} from "@/lib/api";

const DEAD = "0x000000000000000000000000000000000000dEaD";

/** Amounts render via the shared formatter so units read consistently. */
function wei(v: string | undefined): string {
  return formatAmount(v);
}

function TxLink({ url, hash }: { url?: string | undefined; hash?: string | undefined }) {
  if (!url || !hash) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-xs text-accent hover:underline"
    >
      {short(hash, 10, 8)}
      <ArrowUpRight className="h-3 w-3" />
    </a>
  );
}

/**
 * Encrypted value readout. The number is visible only because the gateway holds
 * the owner key and decrypted it through the Nox ACL.
 *
 * That decryption is not instant — the TEE computes the handle after the
 * transaction lands, and the client retries with backoff, so a value can take
 * tens of seconds to arrive. Showing a bare dash for that whole window reads as
 * broken data. Name the wait instead: it is the one moment the interface can
 * show that the number was never sitting in plaintext.
 */
function Encrypted({
  label,
  value,
  note,
  pending = false,
}: {
  label: string;
  value: string;
  note?: string;
  pending?: boolean;
}) {
  return (
    <div className="rounded-[1.25rem] bg-white/[0.02] p-[4px]">
      <div className="rounded-[calc(1.25rem-4px)] bg-[#0d0e11] px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
        <div className="text-xs text-neutral-500">{label}</div>
        {pending ? (
          <div className="mt-1.5 flex items-center gap-2">
            {/* Motion on an element already on screen, never a gate on content. */}
            <span className="h-1 w-16 overflow-hidden rounded-full bg-white/[0.06]">
              <span className="block h-full w-1/2 animate-[shimmer_1.4s_ease-in-out_infinite] rounded-full bg-accent/50" />
            </span>
            <span className="text-xs text-neutral-500">decrypting…</span>
          </div>
        ) : (
          <div className="mt-1 font-mono text-lg text-white">{value}</div>
        )}
        {note && <div className="mt-0.5 text-[11px] text-neutral-600">{note}</div>}
      </div>
    </div>
  );
}

export function NoxVaultSection() {
  const [status, setStatus] = useState<NoxStatus | null>(null);
  const [budget, setBudget] = useState<NoxBudget | null>(null);
  const [agent, setAgent] = useState<NoxAgent | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [fundAmt, setFundAmt] = useState("1000000");
  const [agentAddr, setAgentAddr] = useState("");
  const [capAmt, setCapAmt] = useState("10000");
  const [settleAmt, setSettleAmt] = useState("5000");
  const [recipient, setRecipient] = useState(DEAD);
  const [lastTx, setLastTx] = useState<
    { url?: string | undefined; hash?: string | undefined; label: string } | null
  >(null);
  const [settlement, setSettlement] = useState<NoxSettlement | null>(null);

  const [closed, setClosed] = useState<NoxClosedEpoch | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await getNoxStatus();
      setStatus(s);
      if (!s.configured) return;
      setBudget(await getNoxBudget().catch(() => null));
      if (s.relayer) {
        setAgentAddr((prev) => prev || s.relayer!);
        setAgent(await getNoxAgent(s.relayer).catch(() => null));
      }

      // The most recently closed epoch is the one before the open epoch; it is
      // the only one whose aggregate has been released for public decryption.
      const previous = (s.epoch ?? 0) - 1;
      setClosed(previous >= 0 ? await getNoxClosedEpoch(previous).catch(() => null) : null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // Deferred through a microtask so `refresh`'s first state write is not a
    // synchronous one inside the effect pass.
    Promise.resolve()
      .then(() => refresh())
      .catch(() => null);
  }, [refresh]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (status && !status.configured) {
    return (
      <Empty>
        Confidential vault not configured. Set <span className="font-mono">VAULT_CONTRACT_ADDRESS</span> and{" "}
        <span className="font-mono">CHAIN_WORKER_SECRET_KEY</span>, then deploy with{" "}
        <span className="font-mono">bun run deploy:sepolia</span>.
        {status.reason && <div className="mt-2 text-xs text-neutral-600">{status.reason}</div>}
      </Empty>
    );
  }

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Confidential vault</h2>
            <p className="mt-1 max-w-xl text-sm text-neutral-400">
              Give an AI agent a spending limit it cannot go over — and that
              nobody else can read. Balances, limits and every payment amount
              stay scrambled on the blockchain.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Chip accent>Sepolia</Chip>
            {status?.epoch != null && <Chip>batch {status.epoch}</Chip>}
          </div>
        </div>

        {status?.vaultAddress && (
          <div className="mt-4 grid gap-2 text-xs text-neutral-500 sm:grid-cols-2">
            <div className="flex items-center gap-2">
              <span>contract</span>
              <a
                href={status.explorer}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-neutral-300 hover:text-accent"
              >
                {short(status.vaultAddress, 10, 8)}
              </a>
              <CopyBtn text={status.vaultAddress} />
            </div>
            <div className="flex items-center gap-2">
              <span>sends from</span>
              <span className="font-mono text-neutral-300">{short(status.relayer, 10, 8)}</span>
              <span className="text-neutral-600">
                — every agent pays through this one address, so nobody can tell
                them apart
              </span>
            </div>
          </div>
        )}
      </Panel>

      <div className="grid gap-4 sm:grid-cols-3">
        <Encrypted
          label="Money available"
          pending={budget == null}
          value={wei(budget?.budgetWei)}
          note="Only you can read this. Everyone else sees scrambled data."
        />
        <Encrypted
          label="Spent in this batch"
          pending={budget == null}
          value={wei(budget?.epochTotalWei)}
          note={`${budget?.epochCount ?? 0} payment${budget?.epochCount === 1 ? "" : "s"} grouped together so far`}
        />
        <Encrypted
          label="This agent has spent"
          pending={agent == null && status?.configured === true}
          value={wei(agent?.spentWei)}
          note={
            agent?.capWei
              ? `Its limit is ${formatAmount(agent.capWei)} per payment`
              : "Add an agent below to give it a spending limit"
          }
        />
      </div>

      {err && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm text-red-300">
          {err}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-white">You (the owner)</h3>
            <p className="mt-1 text-xs leading-relaxed text-neutral-500">
              Put money in, decide what each agent may spend, and publish batches.
            </p>
          </div>

          <Field
            label="Add money"
            hint="The amount is scrambled in your browser before it is sent. Nobody — not even the blockchain — sees the number."
          >
            <div className="flex gap-2">
              <Input value={fundAmt} onChange={(e) => setFundAmt(e.target.value)} inputMode="numeric" />
              <Button
                disabled={busy !== null}
                onClick={() =>
                  run("fund", async () => {
                    const tx = withExplorerTx(await noxFund(fundAmt));
                    setLastTx({ url: tx.explorerUrl, hash: tx.txHash, label: "funded" });
                  })
                }
              >
                {busy === "fund" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fund"}
              </Button>
            </div>
          </Field>

          <Field
            label="Give an agent a spending limit"
            hint="Paste the agent's wallet address, then set the most it may spend on any single payment. The limit stays private."
          >
            <div className="space-y-2">
              <Input
                value={agentAddr}
                onChange={(e) => setAgentAddr(e.target.value)}
                placeholder="0x…"
                className="font-mono"
              />
              <div className="flex gap-2">
                <Input value={capAmt} onChange={(e) => setCapAmt(e.target.value)} inputMode="numeric" />
                <Button
                  disabled={busy !== null || !agentAddr}
                  onClick={() =>
                    run("register", async () => {
                      const tx = withExplorerTx(await noxRegisterAgent(agentAddr, capAmt));
                      setLastTx({ url: tx.explorerUrl, hash: tx.txHash, label: "agent registered" });
                    })
                  }
                >
                  {busy === "register" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Register"}
                </Button>
              </div>
            </div>
          </Field>

          <Field
            label="Publish this batch"
            hint="Releases one combined total for every payment in the batch. The individual payments stay hidden — nobody can work out who paid what."
          >
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                run("flush", async () => {
                  const tx = withExplorerTx(await noxFlushEpoch());
                  setLastTx({ url: tx.explorerUrl, hash: tx.txHash, label: `epoch ${tx.epoch}` });
                })
              }
            >
              {busy === "flush" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Publish batch"}
            </Button>
          </Field>
        </Panel>

        <Panel className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Make a payment</h3>
            <p className="mt-1 text-xs leading-relaxed text-neutral-500">
              Try an amount over the limit. It will be refused — and from the
              outside nobody can tell it was refused.
            </p>
          </div>

          <Field label="Which agent is paying" hint="Its wallet address.">
            <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} className="font-mono" />
          </Field>

          <Field
            label="How much"
            hint="Checked against this agent's limit inside secure hardware. Over the limit and nothing moves, but the transaction still succeeds — so an onlooker cannot tell."
          >
            <div className="flex gap-2">
              <Input value={settleAmt} onChange={(e) => setSettleAmt(e.target.value)} inputMode="numeric" />
              <Button
                disabled={busy !== null}
                onClick={() =>
                  run("settle", async () => {
                    const result = withExplorerTx(await noxSettle(recipient, settleAmt));
                    setSettlement(result);
                    setLastTx({
                      url: result.explorerUrl,
                      hash: result.txHash,
                      label: result.authorized ? "authorized" : "rejected",
                    });
                  })
                }
              >
                {busy === "settle" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Settle"}
              </Button>
            </div>
          </Field>

          {settlement && (
            <div
              className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
                settlement.authorized
                  ? "border-accent/30 bg-accent/[0.06]"
                  : "border-amber-500/30 bg-amber-500/[0.06]"
              }`}
            >
              {settlement.authorized ? (
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              ) : (
                <ShieldX className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              )}
              <div className="space-y-1 text-sm">
                <div className={settlement.authorized ? "text-accent" : "text-amber-300"}>
                  {settlement.authorized ? "Authorized" : "Rejected — over cap or budget"}
                </div>
                <div className="text-xs text-neutral-500">
                  An observer cannot tell the two outcomes apart on-chain.
                </div>
                <TxLink url={settlement.explorerUrl} hash={settlement.txHash} />
              </div>
            </div>
          )}

          {lastTx && !settlement && (
            <div className="text-xs text-neutral-500">
              {lastTx.label} · <TxLink url={lastTx.url} hash={lastTx.hash} />
            </div>
          )}
        </Panel>
      </div>

      <CapPolicyBoard />

      <Panel className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Batch settlement</h3>
          <p className="mt-1 max-w-xl text-sm text-neutral-400">
            A closed epoch releases one aggregate. Many private payments leave as a
            single public transfer, so no individual payment can be picked out of
            what the chain shows.
          </p>
        </div>

        <Field
          label="The published aggregate"
          hint="One number, readable by anyone, standing in for every payment in the batch."
        >
          {closed?.closed ? (
            <div className="space-y-2">
              <div className="text-sm text-neutral-400">
                Batch {closed.epoch} total:{" "}
                <span className="font-mono text-white">{wei(closed.totalWei)}</span>
                <div className="mt-0.5 text-[11px] text-neutral-600">
                  {closed.count
                    ? `Anyone can read this one number. It covers ${closed.count} payment${
                        closed.count === 1 ? "" : "s"
                      }, and cannot be split back into them.`
                    : "No payments went into this batch."}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-neutral-500">
              No batch published yet. Use “Publish this batch” above to release
              one combined total.
            </div>
          )}
        </Field>
      </Panel>

      <Panel>
        <h3 className="text-sm font-semibold text-white">
          What a stranger can see, and what they cannot
        </h3>
        <div className="mt-3 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-500">Public</div>
            <ul className="mt-2 space-y-1 text-neutral-400">
              <li>That a payment happened, and in which batch</li>
              <li>How many payments a batch contained</li>
              <li>One sending address, shared by every agent</li>
            </ul>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-accent">Private</div>
            <ul className="mt-2 space-y-1 text-neutral-400">
              <li>How much money you have, and how much is left</li>
              <li>Each agent&apos;s limit and what it has spent</li>
              <li>The amount of any single payment</li>
              <li>Whether a payment was allowed or refused</li>
            </ul>
          </div>
        </div>
      </Panel>
    </div>
  );
}
