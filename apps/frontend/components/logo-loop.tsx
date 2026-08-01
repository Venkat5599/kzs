"use client";

import { techStackConfig } from "@/lib/config";
import type { ReactNode } from "react";

/**
 * The tech strip: bare wordmarks on a continuous loop.
 *
 * No chips, no containers — four names do not need four boxes, they need type.
 * The row repeats enough times to exceed any viewport, so the marquee has real
 * content to scroll instead of a short cluster and a gap, and both horizontal
 * edges are masked so a name enters and leaves rather than being sliced by the
 * container rim.
 */

/** Repeats per row — enough that one row overruns a wide viewport. */
const PER_ROW = 4;

const ink = "color-mix(in srgb, var(--foreground) 58%, transparent)";
const mark = "color-mix(in srgb, var(--accent) 70%, transparent)";

/** A single tessera between names — the page's own unit, not a borrowed bullet. */
function Divider(): ReactNode {
  return (
    <span aria-hidden className="shrink-0 px-6 sm:px-9">
      <svg width="6" height="6" viewBox="0 0 6 6">
        <rect x="0" y="0" width="6" height="6" fill={mark} />
      </svg>
    </span>
  );
}

function Wordmark({ name }: { name: string }): ReactNode {
  return (
    <span
      className="shrink-0 text-lg font-medium tracking-tight whitespace-nowrap sm:text-xl"
      style={{ color: ink }}
    >
      {name}
    </span>
  );
}

/** One full row: every item, repeated until it comfortably exceeds the screen. */
function Row({ copy }: { copy: number }): ReactNode {
  const items = Array.from({ length: PER_ROW }, () => techStackConfig.items).flat();
  return (
    <div className="flex shrink-0 items-center" aria-hidden={copy > 0}>
      {items.map((item, i) => (
        <span key={`${copy}-${i}-${item.name}`} className="flex shrink-0 items-center">
          <Wordmark name={item.name} />
          <Divider />
        </span>
      ))}
    </div>
  );
}

export function LogoLoop({ className = "" }: { className?: string }): ReactNode {
  // Feather both ends so names fade in and out instead of hitting a hard edge.
  const fade =
    "linear-gradient(to right, transparent 0%, black 9%, black 91%, transparent 100%)";

  return (
    <div
      className={`relative w-full overflow-hidden ${className}`.trim()}
      style={{ maskImage: fade, WebkitMaskImage: fade }}
    >
      {/* Reduced motion: the full set, static and centred. Content is never
          gated on the animation running. */}
      <div className="hidden flex-wrap items-center justify-center gap-x-2 gap-y-3 motion-reduce:flex">
        {techStackConfig.items.map((item, i) => (
          <span key={item.name} className="flex items-center">
            <Wordmark name={item.name} />
            {i < techStackConfig.items.length - 1 && <Divider />}
          </span>
        ))}
      </div>

      {/* Two identical rows translated by -50% give a seamless wrap. */}
      <div className="flex w-max animate-logo-marquee motion-reduce:hidden">
        <Row copy={0} />
        <Row copy={1} />
      </div>
    </div>
  );
}
