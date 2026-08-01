import { Action } from "@/components/action";
import { heroConfig } from "@/lib/config";
import type { ReactNode } from "react";

/**
 * The headline sits below the artwork, not over it.
 *
 * That single move is what breaks the default hero stack: there is no eyebrow,
 * no pill, no badge, and the supporting copy is not stacked underneath the
 * headline but set beside it. The two blocks share one grid and one top
 * baseline, so the asymmetry reads as a composition rather than as two
 * clusters shoved to opposite rims.
 */
export function HeadlineBand(): ReactNode {
  return (
    <section className="bg-surface">
      <div className="mx-auto grid max-w-[96rem] grid-cols-1 gap-x-10 gap-y-9 px-6 pt-14 pb-16 sm:px-10 lg:grid-cols-12 lg:pt-16 lg:pb-20">
        <h1
          className="display col-span-1 text-ink lg:col-span-7"
          style={{ fontSize: "clamp(2.375rem, 5.4vw, 4.75rem)" }}
        >
          {heroConfig.headline.map((line) => (
            <span key={line} className="block text-balance">
              {line}
            </span>
          ))}
        </h1>

        <div className="col-span-1 flex flex-col gap-7 lg:col-span-4 lg:col-start-9 lg:pt-2">
          <p className="max-w-[38ch] text-[1.0625rem] leading-[1.55] text-ink-2">
            {heroConfig.subheadline}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Action href={heroConfig.primary.href} icon>
              {heroConfig.primary.text}
            </Action>
            <Action href={heroConfig.secondary.href} weight="raised">
              {heroConfig.secondary.text}
            </Action>
          </div>
        </div>
      </div>
    </section>
  );
}
