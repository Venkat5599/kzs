import { pathConfig } from "@/lib/config";
import type { ReactNode } from "react";

/**
 * How a payment moves.
 *
 * Composed as four movements across the width, on the grout surface, so it
 * reads as the same material as the fold. Explicitly not numbered items beside
 * a vertical rule: the sequence is carried by a run of tesserae that fills as
 * the eye moves right, which is the page's own language rather than a stock
 * process list.
 *
 * The section opens on the heading alone — no kicker — because the previous
 * section already opened with a two-column head and repeating it would make a
 * template of both.
 */

/**
 * The progress mark for a movement: a short run of tesserae, filled up to this
 * step. Squares with hard edges, matching the artwork; nothing rounded, nothing
 * animated on hover.
 */
function Run({ index, total }: { index: number; total: number }): ReactNode {
  return (
    <svg
      viewBox={`0 0 ${total * 11 - 3} 8`}
      aria-hidden="true"
      className="h-2 w-auto"
      preserveAspectRatio="xMinYMid meet"
    >
      {Array.from({ length: total }, (_, i) => (
        <rect
          key={i}
          x={i * 11}
          y="0"
          width="8"
          height="8"
          fill="currentColor"
          opacity={i <= index ? 1 : 0.22}
        />
      ))}
    </svg>
  );
}

export function PathSection(): ReactNode {
  const steps = pathConfig.steps;

  return (
    <section id="path" className="scroll-mt-24 bg-grout text-surface">
      <div className="mx-auto max-w-[96rem] px-6 py-20 sm:px-10 lg:py-28">
        <h2
          className="display text-balance text-surface"
          style={{ fontSize: "clamp(1.875rem, 3.4vw, 3rem)" }}
        >
          {pathConfig.title}
        </h2>
        <p className="mt-6 max-w-[52ch] text-[1.0625rem] leading-[1.6] text-[#9db2b4]">
          {pathConfig.lede}
        </p>

        {/* Equal columns on one grid: every title, body and detail line sits on
            the same baseline across all four regardless of copy length. */}
        <ol className="mt-16 grid grid-cols-1 gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, i) => (
            <li key={step.key} className="grid grid-rows-[auto_auto_1fr_auto] gap-4">
              <span className="text-[#c98f4e]">
                <Run index={i} total={steps.length} />
              </span>
              <h3 className="text-[1.25rem] font-medium tracking-tight text-surface">
                {step.title}
              </h3>
              <p className="text-[0.9375rem] leading-[1.6] text-[#9db2b4]">{step.body}</p>
              <p className="data border-t border-white/[0.1] pt-4 text-[0.875rem] text-[#7c9497]">
                {step.detail}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
