"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Panel, Empty, formatAmount } from "./ui";
import {
  getFabricLogs,
  getFabricStats,
  getNoxClosedEpoch,
  getNoxStatus,
  listWorkflowRuns,
  type FabricLog,
  type FabricStats,
  type WorkflowRunRecord,
} from "@/lib/api";

/**
 * Payment analytics over confidential settlements.
 *
 * The design problem worth naming: analytics normally work by reading every
 * transaction. Here individual amounts are encrypted and decryptable only by
 * the owner and the paying agent, so per-payment charts are not merely
 * withheld — they are not computable.
 *
 * What *is* public is each closed batch: an aggregate released by `flushEpoch`
 * plus the number of settlements it covered. Every figure below derives from
 * those two numbers, so the dashboard stays useful without weakening the
 * privacy model. Nothing is estimated or interpolated; an epoch with no data
 * shows as having no data.
 */

interface EpochPoint {
  epoch: number;
  totalWei: number;
  count: number;
}

/** How many recent epochs to walk. Each is a separate round trip. */
const EPOCH_WINDOW = 12;

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 font-mono text-2xl text-white">{value}</div>
      {note && <div className="mt-0.5 text-[11px] text-neutral-600">{note}</div>}
    </div>
  );
}

/**
 * Settlement volume per closed batch.
 *
 * Deliberately one bar per *batch*, never per payment — the batch is the finest
 * grain that exists publicly, and drawing anything finer would imply a
 * resolution the protocol does not expose.
 */
function VolumeChart({ points }: { points: EpochPoint[] }) {
  const peak = Math.max(...points.map((p) => p.totalWei), 1);

  // Columns must stretch to the full height, not sit at content height:
  // `items-end` here would leave the bar track with an indefinite height, so
  // each bar's percentage would resolve against nothing and collapse.
  return (
    <div className="flex h-40 items-stretch gap-2">
      {points.map((p) => {
        // Floor the height so a small-but-real batch stays visible instead of
        // collapsing into an invisible sliver.
        const pct = p.totalWei === 0 ? 0 : Math.max(6, (p.totalWei / peak) * 100);
        return (
          <div key={p.epoch} className="group flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <div className="relative flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t bg-accent/70 transition-colors group-hover:bg-accent"
                style={{ height: `${pct}%` }}
              />
              <div className="pointer-events-none absolute -top-1 left-1/2 hidden -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-white/10 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-200 group-hover:block">
                {formatAmount(p.totalWei)} · {p.count} settlement
                {p.count === 1 ? "" : "s"}
              </div>
            </div>
            <div className="font-mono text-[10px] text-neutral-600">{p.epoch}</div>
          </div>
        );
      })}
    </div>
  );
}

/** Per-endpoint rollup, built from the gateway's own call log. */
interface EndpointRow {
  slug: string;
  name: string;
  calls: number;
  paid: number;
  revenueWei: number;
  okRate: number;
  medianMs: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function rollUpEndpoints(logs: FabricLog[]): EndpointRow[] {
  const byslug = new Map<string, FabricLog[]>();
  for (const log of logs) {
    const key = log.api_slug || "(unknown)";
    const bucket = byslug.get(key);
    if (bucket) bucket.push(log);
    else byslug.set(key, [log]);
  }

  return [...byslug.entries()]
    .map(([slug, entries]) => ({
      slug,
      name: entries[0]?.api_name ?? slug,
      calls: entries.length,
      paid: entries.filter((e) => e.paid).length,
      // Only settled calls produced revenue. Counting the price of a failed or
      // unpaid call would inflate earnings that never existed.
      revenueWei: entries.reduce((sum, e) => sum + (e.paid ? (e.price ?? 0) : 0), 0),
      okRate: Math.round((entries.filter((e) => e.ok).length / entries.length) * 100),
      medianMs: median(entries.map((e) => e.duration_ms ?? 0).filter((d) => d > 0)),
    }))
    .sort((a, b) => b.revenueWei - a.revenueWei || b.calls - a.calls);
}

/** Calls per day, oldest first, over the window the log covers. */
function dailyUsage(logs: FabricLog[]): { day: string; calls: number; paid: number }[] {
  const byDay = new Map<string, { calls: number; paid: number }>();
  for (const log of logs) {
    const day = log.created_at?.slice(0, 10);
    if (!day) continue;
    const bucket = byDay.get(day) ?? { calls: 0, paid: 0 };
    bucket.calls += 1;
    if (log.paid) bucket.paid += 1;
    byDay.set(day, bucket);
  }
  return [...byDay.entries()]
    .map(([day, v]) => ({ day, ...v }))
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-14);
}

export function AnalyticsSection() {
  const [stats, setStats] = useState<FabricStats | null>(null);
  const [points, setPoints] = useState<EpochPoint[]>([]);
  const [runs, setRuns] = useState<WorkflowRunRecord[]>([]);
  const [logs, setLogs] = useState<FabricLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [s, nox, r, l] = await Promise.all([
        getFabricStats().catch(() => null),
        getNoxStatus().catch(() => null),
        listWorkflowRuns(undefined, 50).catch(() => []),
        getFabricLogs("30d").catch(() => ({ logs: [], stats: null })),
      ]);
      setStats(s);
      setRuns(r);
      setLogs(l.logs ?? []);

      // Only epochs strictly before the open one are closed, and only closed
      // epochs have released an aggregate.
      const open = nox?.epoch ?? 0;
      const closed = Array.from(
        { length: Math.min(EPOCH_WINDOW, Math.max(0, open)) },
        (_, i) => open - 1 - i,
      )
        .filter((e) => e >= 0)
        .reverse();

      const results = await Promise.all(
        closed.map((e) =>
          getNoxClosedEpoch(e)
            .then((d) =>
              d.closed ? { epoch: e, totalWei: Number(d.totalWei ?? 0), count: d.count ?? 0 } : null,
            )
            .catch(() => null),
        ),
      );
      setPoints(results.filter((p): p is EpochPoint => p !== null));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const settled = points.reduce((sum, p) => sum + p.totalWei, 0);
  const payments = points.reduce((sum, p) => sum + p.count, 0);
  const batches = points.length;
  // The privacy dividend, quantified: one public movement stands in for N
  // payments, so this is how far the payment graph is compressed.
  const perBatch = batches > 0 ? payments / batches : 0;

  const endpoints = rollUpEndpoints(logs);
  const usage = dailyUsage(logs);

  const failed = runs.filter((r) => r.status === "failed").length;
  const durations = runs.map((r) => r.duration_ms ?? 0).filter((d) => d > 0);
  const medianMs =
    durations.length > 0
      ? [...durations].sort((a, b) => a - b)[Math.floor(durations.length / 2)]!
      : 0;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Reading settlement history from the chain…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Panel>
        <h2 className="text-lg font-semibold text-white">Analytics</h2>
        <p className="mt-1 max-w-2xl text-sm text-neutral-400">
          Every figure here comes from public batch aggregates. Individual payment amounts
          are encrypted and are not decryptable by this dashboard — so these are the numbers
          analytics can honestly report without weakening the privacy model.
        </p>
      </Panel>

      {err && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm text-red-300">
          {err}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Settled volume"
          value={formatAmount(settled)}
          note={`across ${batches} closed batch${batches === 1 ? "" : "es"}`}
        />
        <Metric
          label="Payments settled"
          value={payments.toLocaleString()}
          note="individual amounts stay encrypted"
        />
        <Metric
          label="Payments per batch"
          value={perBatch > 0 ? perBatch.toFixed(1) : "—"}
          note="how far the payment graph is compressed"
        />
        <Metric
          label="Metered requests"
          value={(stats?.totals?.requests ?? 0).toLocaleString()}
          note={`${stats?.totals?.successRate ?? 0}% success`}
        />
      </div>

      <Panel>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-white">Settlement volume by batch</h3>
          <span className="text-[11px] text-neutral-600">
            one bar per closed epoch — the finest public grain
          </span>
        </div>

        <div className="mt-4">
          {points.length === 0 ? (
            <Empty>
              No closed batches yet. Settle a payment, then flush the epoch to release an
              aggregate.
            </Empty>
          ) : (
            <VolumeChart points={points} />
          )}
        </div>
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-white">Revenue by endpoint</h3>
          <span className="text-[11px] text-neutral-600">last 30 days</span>
        </div>

        {endpoints.length === 0 ? (
          <div className="mt-3">
            <Empty>No metered calls recorded yet.</Empty>
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-white/[0.08] text-left text-xs text-neutral-500">
                  <th className="pb-2 font-normal">Endpoint</th>
                  <th className="pb-2 text-right font-normal">Calls</th>
                  <th className="pb-2 text-right font-normal">Paid</th>
                  <th className="pb-2 text-right font-normal">Revenue</th>
                  <th className="pb-2 text-right font-normal">Success</th>
                  <th className="pb-2 text-right font-normal">Median</th>
                </tr>
              </thead>
              <tbody>
                {endpoints.map((row) => (
                  <tr key={row.slug} className="border-b border-white/[0.04] last:border-0">
                    <td className="py-2 pr-4">
                      <div className="text-neutral-200">{row.name}</div>
                      <div className="font-mono text-[11px] text-neutral-600">{row.slug}</div>
                    </td>
                    <td className="py-2 text-right font-mono text-neutral-300">{row.calls}</td>
                    <td className="py-2 text-right font-mono text-neutral-300">{row.paid}</td>
                    <td className="py-2 text-right font-mono text-white">
                      {formatAmount(row.revenueWei)}
                    </td>
                    <td
                      className={`py-2 text-right font-mono ${
                        row.okRate < 100 ? "text-amber-400" : "text-neutral-300"
                      }`}
                    >
                      {row.okRate}%
                    </td>
                    <td className="py-2 text-right font-mono text-neutral-500">
                      {row.medianMs > 0 ? `${row.medianMs}ms` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-neutral-600">
          Revenue counts settled calls only — pricing an unpaid or failed call would report
          earnings that never happened.
        </p>
      </Panel>

      {usage.length > 0 && (
        <Panel>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">Usage trend</h3>
            <span className="text-[11px] text-neutral-600">
              calls per day · paid shown solid
            </span>
          </div>
          <div className="mt-4 flex h-28 items-end gap-1.5">
            {usage.map((d) => {
              const peak = Math.max(...usage.map((x) => x.calls), 1);
              const h = Math.max(6, (d.calls / peak) * 100);
              const paidPct = d.calls > 0 ? (d.paid / d.calls) * 100 : 0;
              return (
                <div key={d.day} className="group flex min-w-0 flex-1 flex-col items-center gap-1">
                  <div className="relative flex w-full flex-1 items-end">
                    <div
                      className="flex w-full flex-col justify-end rounded-t bg-neutral-700/60"
                      style={{ height: `${h}%` }}
                    >
                      <div className="w-full rounded-t bg-accent/70" style={{ height: `${paidPct}%` }} />
                    </div>
                    <div className="pointer-events-none absolute -top-1 left-1/2 hidden -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-white/10 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-200 group-hover:block">
                      {d.day} · {d.calls} call{d.calls === 1 ? "" : "s"}, {d.paid} paid
                    </div>
                  </div>
                  <div className="font-mono text-[9px] text-neutral-600">{d.day.slice(5)}</div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <h3 className="text-sm font-semibold text-white">Catalog</h3>
          <dl className="mt-3 space-y-2 text-sm">
            {[
              ["APIs published", stats?.totals?.apis ?? 0],
              ["MCP servers", stats?.totals?.mcpServers ?? 0],
              ["Workflows", stats?.totals?.workflows ?? 0],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex items-baseline justify-between gap-4">
                <dt className="text-neutral-400">{label}</dt>
                <dd className="font-mono text-white">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel>
          <h3 className="text-sm font-semibold text-white">Execution</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-neutral-400">Runs recorded</dt>
              <dd className="font-mono text-white">{runs.length}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-neutral-400">Failed</dt>
              <dd className={`font-mono ${failed > 0 ? "text-amber-400" : "text-white"}`}>
                {failed}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-neutral-400">Median duration</dt>
              <dd className="font-mono text-white">
                {medianMs > 0 ? `${medianMs.toLocaleString()} ms` : "—"}
              </dd>
            </div>
          </dl>
        </Panel>
      </div>

      <Panel>
        <h3 className="text-sm font-semibold text-white">What this dashboard cannot show</h3>
        <ul className="mt-2 space-y-1 text-sm text-neutral-400">
          <li>the amount of any individual payment</li>
          <li>which agent paid which recipient</li>
          <li>an agent&apos;s cap or running total, unless you hold its key</li>
        </ul>
        <p className="mt-2 text-[11px] text-neutral-600">
          Not omissions. Those values are encrypted on-chain, and no amount of dashboard
          access recovers them.
        </p>
      </Panel>
    </div>
  );
}
