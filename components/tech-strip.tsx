import { LogoLoop } from "@/components/logo-loop";
import { techStackConfig } from "@/lib/config";
import type { ReactNode } from "react";

/**
 * The dependency strip.
 *
 * Labelled "Built on", never "used by" or "trusted by": these are the
 * protocols this thing runs on, not customers, and a wall of borrowed marks
 * implying adoption that does not exist would be the dishonest version of a
 * logo wall.
 *
 * Set as bare wordmarks rather than brand SVGs. Faking a mark is worse than
 * omitting it, and only some of these have an official one that could be
 * reproduced faithfully — so none of them get a drawn approximation.
 */
export function TechStrip(): ReactNode {
  return (
    <section className="bg-surface" aria-label={techStackConfig.title}>
      <div className="mx-auto max-w-[96rem] border-t border-ink/[0.12] px-6 py-9 sm:px-10">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:gap-10">
          <p className="shrink-0 text-[0.9375rem] text-ink-3">{techStackConfig.title}</p>
          <LogoLoop className="min-w-0 flex-1" />
        </div>
      </div>
    </section>
  );
}
