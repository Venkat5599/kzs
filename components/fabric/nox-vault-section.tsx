"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Loader2, ShieldCheck, ShieldX } from "lucide-react";
import { Panel, Field, Input, Button, Chip, Empty, short, CopyBtn, formatAmount } from "./ui";
import { CapPolicyBoard } from "./cap-policy-board";
import {
  getNoxAgent,
  getNoxBudget,
  getNoxClosedEpoch,
  getNoxSafe,
  getNoxStatus,
  noxExecuteBatch,
  noxFlushEpoch,
  noxFund,
  noxRegisterAgent,
  noxSetSafe,
  noxSettle,
  type NoxAgent,
  type NoxBudget,
  type NoxClosedEpoch,
  type NoxSafe,
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

  const [safe, setSafe] = useState<NoxSafe | null>(null);
  const [safeAddr, setSafeAddr] = useState("");
  const [closed, setClosed] = useState<NoxClosedEpoch | null>(null);
  const [batchTo, setBatchTo] = useState(DEAD);

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

      const safeState = await getNoxSafe().catch(() => null);
      setSafe(safeState);

      // The most recently closed epoch is the one before the open epoch; it is
      // the only one whose aggregate has been released for public decryption.
      const previous = (s.epoch ?? 0) - 1;
      setClosed(previous >= 0 ? await getNoxClosedEpoch(previous).catch(() => null) : null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
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
              Budgets, per-agent caps and settlement amounts are encrypted with iExec Nox. The chain
              stores handles, never values.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Chip accent>Sepolia</Chip>
            {status?.epoch != null && <Chip>epoch {status.epoch}</Chip>}
          </div>
        </div>

        {status?.vaultAddress && (
          <div className="mt-4 grid gap-2 text-xs text-neutral-500 sm:grid-cols-2">
            <div className="flex items-center gap-2">
              <span>vault</span>
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
              <span>relayer</span>
              <span className="font-mono text-neutral-300">{short(status.relayer, 10, 8)}</span>
              <span className="text-neutral-600">— every settlement shares this sender</span>
            </div>
          </div>
        )}
      </Panel>

      <div className="grid gap-4 sm:grid-cols-3">
        <Encrypted
          label="Treasury budget"
          pending={budget == null}
          value={wei(budget?.budgetWei)}
          note="encrypted on-chain · decrypted for the owner"
        />
        <Encrypted
          label="Current epoch total"
          pending={budget == null}
          value={wei(budget?.epochTotalWei)}
          note={`${budget?.epochCount ?? 0} settlements batched`}
        />
        <Encrypted
          label="Agent spend"
          pending={agent == null && status?.configured === true}
          value={wei(agent?.spentWei)}
          note={
            agent?.capWei
              ? `cap ${formatAmount(agent.capWei)} per call`
              : "no agent registered"
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
          <h3 className="text-sm font-semibold text-white">Owner</h3>

          <Field label="Fund budget" hint="wei, encrypted before it leaves the browser">
            <div className="flex gap-2">
              <Input value={fundAmt} onChange={(e) => setFundAmt(e.target.value)} inputMode="numeric" />
              <Button
                disabled={busy !== null}
                onClick={() =>
                  run("fund", async () => {
                    const tx = await noxFund(fundAmt);
                    setLastTx({ url: tx.explorerUrl, hash: tx.txHash, label: "funded" });
                  })
                }
              >
                {busy === "fund" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fund"}
              </Button>
            </div>
          </Field>

          <Field label="Register agent" hint="address + encrypted per-call cap">
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
                      const tx = await noxRegisterAgent(agentAddr, capAmt);
                      setLastTx({ url: tx.explorerUrl, hash: tx.txHash, label: "agent registered" });
                    })
                  }
                >
                  {busy === "register" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Register"}
                </Button>
              </div>
            </div>
          </Field>

          <Field label="Close epoch" hint="one aggregate event for the whole batch">
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                run("flush", async () => {
                  const tx = await noxFlushEpoch();
                  setLastTx({ url: tx.explorerUrl, hash: tx.txHash, label: `epoch ${tx.epoch}` });
                })
              }
            >
              {busy === "flush" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Flush epoch"}
            </Button>
          </Field>
        </Panel>

        <Panel className="space-y-4">
          <h3 className="text-sm font-semibold text-white">Agent settlement</h3>

          <Field label="Recipient">
            <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} className="font-mono" />
          </Field>

          <Field label="Amount" hint="encrypted; compared against the cap inside the TEE">
            <div className="flex gap-2">
              <Input value={settleAmt} onChange={(e) => setSettleAmt(e.target.value)} inputMode="numeric" />
              <Button
                disabled={busy !== null}
                onClick={() =>
                  run("settle", async () => {
                    const result = await noxSettle(recipient, settleAmt);
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
                  The cap was never decrypted. Both outcomes look identical on-chain.
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
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Safe module</h3>
            <p className="mt-1 max-w-xl text-sm text-neutral-400">
              Kairos spends from an unmodified Safe through{" "}
              <span className="font-mono text-neutral-300">execTransactionFromModule</span>. Safe is
              never forked and funds never migrate — the vault is installed with{" "}
              <span className="font-mono text-neutral-300">enableModule</span> and can be removed the
              same way.
            </p>
          </div>
          {safe?.standalone === false && (
            <Chip accent={safe.installed}>{safe.installed ? "module enabled" : "not enabled"}</Chip>
          )}
        </div>

        {safe?.standalone ? (
          <Field label="Attach a Safe" hint="the vault runs standalone until a Safe is set">
            <div className="flex gap-2">
              <Input
                value={safeAddr}
                onChange={(e) => setSafeAddr(e.target.value)}
                placeholder="0x… Safe address"
                className="font-mono"
              />
              <Button
                disabled={busy !== null || !safeAddr}
                onClick={() =>
                  run("safe", async () => {
                    const tx = await noxSetSafe(safeAddr);
                    setLastTx({ url: tx.explorerUrl, hash: tx.txHash, label: "safe attached" });
                  })
                }
              >
                {busy === "safe" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Attach"}
              </Button>
            </div>
          </Field>
        ) : (
          safe?.safe && (
            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <span>safe</span>
              <a
                href={safe.explorer ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-neutral-300 hover:text-accent"
              >
                {short(safe.safe, 10, 8)}
              </a>
              <CopyBtn text={safe.safe} />
            </div>
          )
        )}

        {!safe?.standalone && safe?.installed === false && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-300">
            This Safe has not enabled the module yet. Run{" "}
            <span className="font-mono">enableModule({status?.vaultAddress ?? "vault"})</span> from
            the Safe before executing a batch.
          </div>
        )}

        <Field
          label="Execute closed batch"
          hint="many private settlements leave as one public transfer"
        >
          {closed?.closed ? (
            <div className="space-y-2">
              <div className="text-sm text-neutral-400">
                Epoch {closed.epoch} aggregate:{" "}
                <span className="font-mono text-white">{wei(closed.totalWei)}</span>
                <div className="mt-0.5 text-[11px] text-neutral-600">
                  {closed.count
                    ? `publicly decryptable — one number covering ${closed.count} settlement${
                        closed.count === 1 ? "" : "s"
                      }, decomposing into none of them`
                    : "this epoch absorbed no settlements"}
                </div>
              </div>
              <div className="flex gap-2">
                <Input
                  value={batchTo}
                  onChange={(e) => setBatchTo(e.target.value)}
                  className="font-mono"
                />
                <Button
                  variant="outline"
                  disabled={busy !== null || !safe?.installed || !closed.totalWei}
                  onClick={() =>
                    run("batch", async () => {
                      const tx = await noxExecuteBatch(closed.epoch, batchTo, closed.totalWei!);
                      setLastTx({
                        url: tx.explorerUrl,
                        hash: tx.txHash,
                        label: `epoch ${closed.epoch} executed`,
                      });
                    })
                  }
                >
                  {busy === "batch" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Execute"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-sm text-neutral-500">
              No closed epoch yet. Flush the current epoch to release an aggregate.
            </div>
          )}
        </Field>
      </Panel>

      <Panel>
        <h3 className="text-sm font-semibold text-white">What an observer sees</h3>
        <div className="mt-3 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-500">Public</div>
            <ul className="mt-2 space-y-1 text-neutral-400">
              <li>a settlement occurred in some epoch</li>
              <li>how many settlements a batch contained</li>
              <li>the relayer address, shared by every agent</li>
            </ul>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-accent">Private</div>
            <ul className="mt-2 space-y-1 text-neutral-400">
              <li>the treasury budget and what remains</li>
              <li>each agent&apos;s cap and cumulative spend</li>
              <li>the amount of any individual payment</li>
              <li>whether a given settlement was authorized</li>
            </ul>
          </div>
        </div>
      </Panel>
    </div>
  );
}
