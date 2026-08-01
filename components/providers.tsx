"use client";

import { ReducedMotionProvider } from "@/lib/motion";
import { SmoothScroll } from "@/components/smooth-scroll";
import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }): ReactNode {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {/*
        `reducedMotion="user"` is what actually makes Motion honour the OS
        setting. The global `prefers-reduced-motion` block in globals.css only
        zeroes CSS animations and transitions — Motion drives its animations in
        JavaScript, so without this every motion component on the page
        (the nav's travelling tessera, the hamburger, the mobile menu height)
        kept animating for a visitor who had asked it not to.

        "user" disables transform and layout animation while leaving opacity
        alone, which is the right trade: nothing that carries meaning is hidden,
        and nothing moves.

        ReducedMotionProvider stays because it exposes the same preference to
        components that need to branch on it in their own logic rather than
        hand it to Motion.
      */}
      <MotionConfig reducedMotion="user">
        <ReducedMotionProvider>
          <SmoothScroll>{children}</SmoothScroll>
        </ReducedMotionProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}
