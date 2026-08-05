"use client";

import { useState } from "react";
import { apiBase } from "@/lib/api";
import { Panel, Field, Input, Button, Chip, CopyBtn, Amount, short } from "./ui";

/**
 * Paying to a stealth address, without an agent.
 *
 * The MCP tools already do this, but they need Claude Code and a connector.
 * This is the same path for a person: paste who is paying, how much, and the
 * recipient's meta-address.
 *
 * Built around one demonstration rather than a feature list. Every payment to
 * the *same* recipient produces a different address, and the only way to make
 * that land is to let someone pay twice and watch the list grow with two
 * unrelated addresses. So the derived addresses accumulate on screen. That list
 * is the argument.
 */

interface Settlement {
  authorized: boolean;
  hash: string;
  spentWei: string | null;
  stealth?: {
    address: string;
    ephemeralPublicKey: string;
    viewTag: number;
    announcement: string | null;
    warning?: string;
  };
}

interface Paid {
  address: string;
  amountWei: string;
  hash: string;
  announcement: string | null;
  /** Who it was for. Kept so the page never claims one recipient wrongly. */
  payTo: string;
  warning?: string;
}

interface Keys {
  metaAddress: string;
  spendingPrivateKey: string;
  viewingPrivateKey: string;
  warning: string;
}

const EXPLORER = "https://sepolia.etherscan.io/tx";

/** A value that must be readable and copyable, but never wraps into a mess. */
function Secret({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-black/40 px-3.5 py-2.5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.6),inset_0_0_0_1px_rgba(255,255,255,0.06)]">
      <span className="min-w-0 flex-1 truncate font-mono text-sm text-white" title={value}>
        {value}
      </span>
      <CopyBtn text={value} />
    </div>
  );
}

export function StealthSection() {
  const [agent, setAgent] = useState("");
  const [amount, setAmount] = useState("40000");
  const [payTo, setPayTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const [paid, setPaid] = useState<Paid[]>([]);

  const [keys, setKeys] = useState<Keys | null>(null);
  const [keysBusy, setKeysBusy] = useState(false);

  async function pay() {
    setBusy(true);
    setError(null);
    setRefused(false);
    try {
      const res = await fetch(`${apiBase}/nox/settle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent: agent.trim(), amountWei: amount.trim(), payTo: payTo.trim() }),
      });
      const body = (await res.json()) as Settlement & { message?: string };

      // A 402 is a refusal, not a failure — the budget did its job. Given its
      // own state so it never reads as a broken request.
      if (res.status === 402) {
        setRefused(true);
        return;
      }
      if (!res.ok) {
        setError(body.message ?? `The gateway returned ${res.status}.`);
        return;
      }
      if (!body.stealth) {
        setError("Paid, but no stealth address came back — this gateway has no announcer configured.");
        return;
      }
      setPaid((prev) => [
        {
          address: body.stealth!.address,
          amountWei: amount.trim(),
          hash: body.hash,
          announcement: body.stealth!.announcement,
          payTo: payTo.trim(),
          ...(body.stealth!.warning ? { warning: body.stealth!.warning } : {}),
        },
        ...prev,
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The gateway is unreachable.");
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setKeysBusy(true);
    try {
      const res = await fetch(`${apiBase}/stealth/keys`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      setKeys((await res.json()) as Keys);
    } catch {
      setKeys(null);
    } finally {
      setKeysBusy(false);
    }
  }

  const ready = agent.trim() !== "" && amount.trim() !== "" && payTo.trim() !== "";

  // The unlinkability claim only holds if these really did all go to one person.
  // Changing the recipient mid-session is allowed; overstating it is not.
  const oneRecipient = paid.length > 1 && paid.every((p) => p.payTo === paid[0]!.payTo);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-semibold tracking-tight text-white">Stealth payments</h1>
        <p className="mt-1 max-w-2xl text-neutral-400">
          Pay someone without building a public record of it. Every payment lands on an address that
          has never appeared on-chain, and only its recipient can tell it is theirs.
        </p>
      </div>

      <Panel>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="font-semibold text-white">Send a payment</p>
          <p className="text-xs text-neutral-500">No agent, no connector. This is the direct path.</p>
        </div>

        <div className="mt-5 space-y-3">
          <Field label="Paying as" hint="the registered agent wallet the budget belongs to">
            <Input
              placeholder="0x…"
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
              className="font-mono"
            />
          </Field>

          <Field label="Amount" hint="in wei">
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} className="font-mono" />
          </Field>

          <Field label="Recipient meta-address" hint="st:eth:0x… — not a wallet address">
            <Input
              placeholder="st:eth:0x…"
              value={payTo}
              onChange={(e) => setPayTo(e.target.value)}
              className="font-mono"
            />
          </Field>

          <p className="text-xs leading-relaxed text-neutral-500">
            The meta-address is what makes this private. Paying an ordinary wallet address would
            gather every payment to that person in one public place, which is the thing being
            avoided. The recipient generates one below and hands it over; publishing it is safe.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button onClick={pay} disabled={busy || !ready}>
              {busy ? "Paying…" : "Pay"}
            </Button>
            {paid.length > 0 && (
              <span className="text-xs text-neutral-500">
                Pay again to see a second, unrelated address.
              </span>
            )}
          </div>

          {refused && (
            <p className="text-sm text-neutral-300">
              Refused — over the cap, or not enough budget left. Nothing moved. The transaction still
              succeeded on-chain, so nobody watching can tell this was a refusal.
            </p>
          )}
          {error && <p className="text-sm text-neutral-300">{error}</p>}
        </div>
      </Panel>

      {paid.length > 0 && (
        <Panel>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="font-semibold text-white">Where the money went</p>
            {oneRecipient && <Chip accent>{paid.length} payments, one recipient</Chip>}
          </div>
          <p className="mt-1 max-w-2xl text-sm text-neutral-400">
            {oneRecipient
              ? "Every one of these went to the same person. No two addresses are related, and nothing on-chain connects them to each other or to whoever is receiving them."
              : "Each payment derives its own address. Nothing on-chain links an address back to the person it belongs to."}
          </p>

          <div className="mt-4 space-y-2">
            {paid.map((p) => (
              <div
                key={p.hash + p.address}
                className="rounded-xl bg-black/25 px-4 py-3 shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]"
              >
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-mono text-sm text-white" title={p.address}>
                      {short(p.address, 14, 10)}
                    </span>
                    <CopyBtn text={p.address} />
                  </div>
                  <Amount value={p.amountWei} className="text-sm text-neutral-300" />
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
                  <a
                    href={`${EXPLORER}/${p.hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="transition-colors duration-300 hover:text-accent"
                  >
                    settlement {short(p.hash, 8, 6)}
                  </a>
                  {p.announcement ? (
                    <a
                      href={`${EXPLORER}/${p.announcement}`}
                      target="_blank"
                      rel="noreferrer"
                      className="transition-colors duration-300 hover:text-accent"
                    >
                      announcement {short(p.announcement, 8, 6)}
                    </a>
                  ) : (
                    <span>not announced</span>
                  )}
                </div>

                {p.warning && <p className="mt-2 text-xs text-neutral-400">{p.warning}</p>}
              </div>
            ))}
          </div>

          <p className="mt-4 text-xs leading-relaxed text-neutral-500">
            Settling debits the encrypted budget and publishes the key that makes the payment
            findable. The funds themselves arrive when the epoch is routed — batching them is what
            keeps the timing of any single payment out of the public record.
          </p>
        </Panel>
      )}

      <Panel>
        <p className="font-semibold text-white">Receiving</p>
        <p className="mt-1 max-w-2xl text-sm text-neutral-400">
          Generate a meta-address to be paid at. Publish it anywhere: it says only that payments to
          you can be constructed, never that any particular one was.
        </p>

        <div className="mt-5">
          <Button onClick={generate} disabled={keysBusy} variant={keys ? "outline" : "primary"}>
            {keysBusy ? "Generating…" : keys ? "Generate another" : "Generate a meta-address"}
          </Button>
        </div>

        {keys && (
          <div className="mt-5 space-y-3">
            <Field label="Meta-address" hint="safe to share">
              <Secret value={keys.metaAddress} />
            </Field>

            <Field label="Spending private key" hint="moves the funds">
              <Secret value={keys.spendingPrivateKey} />
            </Field>

            <Field label="Viewing private key" hint="finds payments, cannot spend them">
              <Secret value={keys.viewingPrivateKey} />
            </Field>

            <p className="text-sm text-neutral-300">{keys.warning}</p>
            <p className="text-xs leading-relaxed text-neutral-500">
              The split is the useful part: hand someone the viewing key and they can audit every
              payment you receive without being able to touch any of it.
            </p>
          </div>
        )}
      </Panel>
    </div>
  );
}
