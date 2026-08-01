import { leakConfig, type LedgerRow } from "@/lib/config";
import type { ReactNode } from "react";

/**
 * The problem, shown rather than asserted.
 *
 * Two readings of the same settlement, side by side. The columns are locked to
 * one grid: four rows in each, every row the same height, so `from` sits
 * opposite `event` and the eye can compare across instead of hunting. Nothing
 * here depends on how long a given string happens to be.
 *
 * The section opens on the statement itself — no label above a heading — so it
 * does not begin the way every other section on the internet begins.
 */

function Ledger({
  label,
  caption,
  rows,
  tone,
}: {
  label: string;
  caption: string;
  rows: LedgerRow[];
  tone: "exposed" | "sealed";
}): ReactNode {
  const sealed = tone === "sealed";

  return (
    <div
      className={`flex h-full flex-col rounded-2xl p-6 sm:p-8 ${
        sealed ? "slab-deep bg-sea-deep text-surface" : "slab bg-daylight text-ink"
      }`}
    >
      <p className={`text-[0.9375rem] font-medium ${sealed ? "text-surface" : "text-ink"}`}>
        {label}
      </p>
      <p
        className={`mt-1.5 text-[0.875rem] leading-relaxed ${
          sealed ? "text-[#93aeb2]" : "text-[#7d7466]"
        }`}
      >
        {caption}
      </p>

      <dl className="mt-7 flex flex-col">
        {rows.map(([key, value, note]) => (
          <div
            key={key}
            className={`grid grid-cols-[5.5rem_1fr] items-baseline gap-x-4 py-3.5 ${
              sealed ? "border-t border-white/[0.10]" : "border-t border-daylight-line"
            } first:border-t-0 first:pt-0`}
          >
            <dt
              className={`data text-[0.8125rem] ${sealed ? "text-[#87a2a6]" : "text-[#7d7466]"}`}
            >
              {key}
            </dt>
            <dd className="min-w-0">
              <span
                className={`data block truncate text-[0.9375rem] ${
                  value === "sealed"
                    ? sealed
                      ? "text-[#e0a45f]"
                      : "text-amber-deep"
                    : sealed
                      ? "text-surface"
                      : "text-ink"
                }`}
              >
                {value}
              </span>
              <span
                className={`mt-1 block text-[0.8125rem] ${
                  sealed ? "text-[#87a2a6]" : "text-[#7d7466]"
                }`}
              >
                {note}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function LeakSection(): ReactNode {
  return (
    <section id="leak" className="scroll-mt-24 bg-surface">
      <div className="mx-auto max-w-[96rem] px-6 py-20 sm:px-10 lg:py-28">
        <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-12">
          <h2
            className="display col-span-1 max-w-[24ch] text-balance text-ink lg:col-span-7"
            style={{ fontSize: "clamp(1.875rem, 3.4vw, 3rem)" }}
          >
            {leakConfig.statement}
          </h2>
          <p className="col-span-1 max-w-[46ch] self-end text-[1.0625rem] leading-[1.6] text-ink-2 lg:col-span-5">
            {leakConfig.body}
          </p>
        </div>

        {/* Equal-height columns on one grid, so both ledgers' rows line up
            across regardless of the copy in either. */}
        <div className="mt-14 grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 lg:mt-16 lg:gap-5">
          <Ledger
            label={leakConfig.plain.label}
            caption={leakConfig.plain.caption}
            rows={leakConfig.plain.rows}
            tone="exposed"
          />
          <Ledger
            label={leakConfig.sealed.label}
            caption={leakConfig.sealed.caption}
            rows={leakConfig.sealed.rows}
            tone="sealed"
          />
        </div>
      </div>
    </section>
  );
}
