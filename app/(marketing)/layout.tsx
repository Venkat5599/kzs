import { Header } from "@/components/header";
import { SkipToContent } from "@/components/skip-to-content";
import type { ReactNode } from "react";

/**
 * The marketing surface is committed to light. The artwork is lit by a single
 * low sun and there is no honest dark counterpart to it, so there is no theme
 * control here — and a sliding sun-and-moon pill would be a stock component
 * either way. The dashboard keeps its own dark surface.
 *
 * The previous layout also painted a fixed white frame down all four edges
 * with cut corners. Dropped: a full-bleed art plate has to reach the edge of
 * the viewport to work at all, and a frame laid on top of it fought the one
 * thing on the page worth looking at.
 */
export default function MarketingLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <>
      <SkipToContent />
      <Header />
      {children}
    </>
  );
}
