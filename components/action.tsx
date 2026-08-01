import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The page has exactly two action weights, and both are filled.
 *
 * A solid primary beside an outlined ghost is a preset, so the pair is
 * differentiated by hue instead — and by the artwork's own relationship: the
 * deep sea carries the primary, the horizon's warm light carries the
 * secondary. Complementary, and both drawn from the picture above them, so the
 * buttons belong to this page rather than to a component kit.
 *
 * Fully rounded, flat fills. This is not the glowy-pill tell: there is no
 * gradient, no blurred bloom beneath, and no trailing arrow. Depth is a lit
 * edge — a bright inset hairline along the top lip where light would catch,
 * plus one tight shadow offset downward and tinted to the button's own fill
 * rather than to black.
 *
 * Nothing lifts, scales or glows on hover. A button that hops when the pointer
 * arrives is a template reflex; the state change here is tonal.
 */
export type ActionWeight = "solid" | "raised";

const WEIGHTS: Record<ActionWeight, string> = {
  solid: [
    "bg-teal text-surface hover:bg-teal-lift active:bg-[#0c3f47]",
    "shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_1px_2px_rgba(12,52,58,0.30)]",
  ].join(" "),
  raised: [
    "bg-sand text-ink hover:bg-sand-lift active:bg-[#d3c7b0]",
    "shadow-[inset_0_1px_0_rgba(255,255,255,0.62),0_1px_2px_rgba(60,48,28,0.16)]",
  ].join(" "),
};

/**
 * The button glyph: four tesserae in a square. It reads as a dashboard grid and
 * as the unit the fold artwork is cut from at the same time — drawn for this
 * brand rather than lifted from an icon pack, where it would have arrived as
 * the same thin-stroke outline every other product ships.
 */
export function TesseraGlyph({ className = "h-3 w-3" }: { className?: string }): ReactNode {
  return (
    <svg viewBox="0 0 11 11" fill="currentColor" aria-hidden="true" className={className}>
      <rect x="0" y="0" width="4.6" height="4.6" />
      <rect x="6.4" y="0" width="4.6" height="4.6" />
      <rect x="0" y="6.4" width="4.6" height="4.6" />
      <rect x="6.4" y="6.4" width="4.6" height="4.6" opacity="0.55" />
    </svg>
  );
}

export function Action({
  href,
  weight = "solid",
  icon = false,
  children,
  className = "",
}: {
  href: string;
  weight?: ActionWeight;
  /** Leading glyph. Reserved for the primary action, so it stays a signal. */
  icon?: boolean;
  children: ReactNode;
  className?: string;
}): ReactNode {
  const external = href.startsWith("http");

  // A pill needs more horizontal room than a rounded rect to look evenly
  // weighted — the curve eats optical space at both ends.
  const shared =
    "focus-ring inline-flex items-center justify-center gap-2 rounded-full " +
    "px-[1.5rem] py-[0.8125rem] text-[0.9375rem] font-medium leading-none " +
    "tracking-[-0.005em] transition-colors duration-200 " +
    `${WEIGHTS[weight]} ${className}`;

  const body = (
    <>
      {icon && <TesseraGlyph className="h-[0.6875rem] w-[0.6875rem] shrink-0" />}
      {children}
    </>
  );

  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={shared}>
        {body}
      </a>
    );
  }
  return (
    <Link href={href} className={shared}>
      {body}
    </Link>
  );
}
