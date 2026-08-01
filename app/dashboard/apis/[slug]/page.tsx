"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Coins, ExternalLink, Loader2, Play } from "lucide-react";
import { autoPayInvoke, gatewayUrl, getChainStatus, getSkill, invokeSkill, type SkillDetail, type X402Quote } from "@/lib/api";

export default function InvokePage() {
  const params = useParams();
  const slug = String(params.slug ?? "");
  const [skill, setSkill] = useState<SkillDetail | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);
  const [input, setInput] = useState('{\n  "city": "Oslo"\n}');
  const [result, setResult] = useState<string | null>(null);
  const [quote, setQuote] = useState<X402Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    getSkill(slug).then(setSkill).catch((e) => setError(String(e)));
    getChainStatus().then((c) => setUnconfigured(!c.configured)).catch(() => null);
  }, [slug]);

  async function run(autoPay = false) {
    setBusy(true);
    setError(null);
    try {
      const parsed = JSON.parse(input);
      if (autoPay && quote) {
        const res = await autoPayInvoke(slug, parsed, quote.nonce);
        setResult(JSON.stringify(res, null, 2));
        setQuote(null);
      } else {
        const { status, body } = await invokeSkill(slug, parsed);
        if (status === 402) {
          setQuote(body as X402Quote);
        }
        setResult(JSON.stringify(body, null, 2));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!skill) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin" /></div>;
  }

  const payment = (() => {
    if (!result) return undefined;
    try {
      return (JSON.parse(result) as { payment?: { explorerUrl?: string } }).payment;
    } catch {
      return undefined;
    }
  })();

  return (
    <div className="p-8">
      <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Catalog
      </Link>
      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{skill.manifest.name}</h1>
          <p className="mt-1 font-mono text-sm text-muted-foreground">POST /s/{slug} · {unconfigured ? "chain unconfigured" : "Sepolia testnet"}</p>
        </div>
        <span className="rounded-full bg-accent/20 px-3 py-1 text-sm font-medium">
          {skill.manifest.pricing.pricePerCall === "0" ? "Free" : `${skill.manifest.pricing.pricePerCall} wei`}
        </span>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-frame p-5">
          <label className="text-xs font-medium uppercase text-muted-foreground">Input JSON</label>
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={10} className="mt-2 w-full rounded-xl border border-border bg-background p-3 font-mono text-sm" />
          <div className="mt-4 flex gap-2">
            <button onClick={() => run(false)} disabled={busy} className="flex items-center gap-2 rounded-xl bg-foreground px-4 py-2 text-sm text-background">
              <Play className="h-4 w-4" /> Invoke
            </button>
            {quote && (
              <button onClick={() => run(true)} disabled={busy} className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-black">
                <Coins className="h-4 w-4" /> Pay & Run
              </button>
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-frame p-5">
          <label className="text-xs font-medium uppercase text-muted-foreground">Response</label>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <pre className="mt-2 max-h-96 overflow-auto rounded-xl bg-background p-3 font-mono text-xs">{result ?? "—"}</pre>
          {payment?.explorerUrl && (
            <a href={payment.explorerUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm text-accent hover:underline">
              View deploy <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>
      <pre className="mt-6 rounded-2xl border border-border bg-muted p-4 font-mono text-xs overflow-x-auto">
        {`curl -X POST ${gatewayUrl}/s/${slug} -H "Content-Type: application/json" -d '${input.replace(/\n/g, " ").trim()}'`}
      </pre>
    </div>
  );
}
