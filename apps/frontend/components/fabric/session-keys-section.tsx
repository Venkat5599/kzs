"use client";

import { useEffect, useState } from "react";
import { gatewayUrl } from "@/lib/api";
import { Panel, Field, Input, Button } from "./ui";

export function SessionKeysSection() {
  const [keys, setKeys] = useState<{ agentPublicKeyHex: string; deployHash: string }[]>([]);
  const [agentKey, setAgentKey] = useState("");
  const [maxSpend, setMaxSpend] = useState("5000000000");
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch(`${gatewayUrl}/auth/session-keys`);
    const body = await res.json();
    setKeys(body.keys ?? []);
  }

  useEffect(() => {
    load().catch(() => null);
  }, []);

  async function mint() {
    setBusy(true);
    try {
      await fetch(`${gatewayUrl}/auth/session-keys`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentPublicKeyHex: agentKey,
          scope: { maxSpendPerCall: maxSpend, expiresAt: new Date(Date.now() + 86400000).toISOString() },
        }),
      });
      setAgentKey("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-semibold tracking-tight text-white">Session keys</h1>
        <p className="mt-1 text-neutral-400">Scoped Sepolia agent keys — bound spend per call without custody of your owner key.</p>
      </div>

      <Panel>
        <p className="text-sm text-neutral-300">
          Mint a session key to bound an agent: it registers an encrypted per-call cap in the vault, and sets when the key
          expires. Use the agent key you connect in Claude Code or your wallet during scoped invoke tests.
        </p>
        <div className="mt-5 space-y-3">
          <Field label="Agent address (0x… hex)">
            <Input
              placeholder="01…"
              value={agentKey}
              onChange={(e) => setAgentKey(e.target.value)}
              className="font-mono"
            />
          </Field>
          <Field label="Max spend (wei per call)">
            <Input value={maxSpend} onChange={(e) => setMaxSpend(e.target.value)} className="font-mono" />
          </Field>
          <Button onClick={mint} disabled={busy || !agentKey.trim()}>
            {busy ? "Minting…" : "Mint session key"}
          </Button>
        </div>
      </Panel>

      <Panel>
        <p className="font-semibold text-white">Active keys</p>
        <div className="mt-4 space-y-2">
          {keys.length === 0 ? (
            <p className="text-sm text-neutral-500">No session keys minted yet.</p>
          ) : (
            keys.map((k, i) => (
              <div
                key={i}
                className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 font-mono text-xs text-neutral-300"
              >
                {k.agentPublicKeyHex?.slice(0, 32)}… · deploy {k.deployHash?.slice(0, 16)}…
              </div>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}
