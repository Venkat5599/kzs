"use client";

import { KairosMark } from "@/components/kairos-logo";
import { Action } from "@/components/action";
import { siteConfig } from "@/lib/config";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The nav is built from the page's own unit rather than laid out as the stock
 * bar — logo left, links centred, button right, which is the arrangement on
 * every product site.
 *
 * Instead the whole row is one baseline of type: the wordmark set in the
 * display face at the far left, then the sections as a numbered index, the way
 * a document lists its contents. That suits a page whose argument is a
 * sequence, and the numerals are honest — they say how far through you are.
 *
 * The active section is marked by a tessera that travels between items on a
 * shared layout animation. It is a real indicator with real state, not a stray
 * dot bolted under a link, and the type shifts tone underneath it so the state
 * still reads with motion disabled.
 */

const LINKS = [
  { label: "The leak", href: "#leak", id: "leak" },
  { label: "What's hidden", href: "#disclosure", id: "disclosure" },
  { label: "How it moves", href: "#path", id: "path" },
  { label: "Verify", href: "#verify", id: "verify" },
];

const ease = [0.23, 1, 0.32, 1] as const;

/** Which section is currently under the top of the viewport. */
function useActiveSection(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const onScroll = () => {
      // The section whose top has most recently passed the reading line.
      const line = window.innerHeight * 0.34;
      let current: string | null = null;
      for (const s of sections) {
        if (s.getBoundingClientRect().top <= line) current = s.id;
      }
      setActive(current);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [ids]);

  return active;
}

function Hamburger({ open }: { open: boolean }): ReactNode {
  return (
    <span className="relative flex h-3.5 w-6 flex-col justify-between">
      <motion.span
        className="block h-[1.5px] w-full origin-center bg-ink"
        animate={open ? { rotate: 45, y: 6 } : { rotate: 0, y: 0 }}
        transition={{ duration: 0.24, ease }}
      />
      <motion.span
        className="block h-[1.5px] w-full origin-center bg-ink"
        animate={open ? { rotate: -45, y: -6 } : { rotate: 0, y: 0 }}
        transition={{ duration: 0.24, ease }}
      />
    </span>
  );
}

export function Header(): ReactNode {
  const [open, setOpen] = useState(false);
  const ids = useRef(LINKS.map((l) => l.id)).current;
  const active = useActiveSection(ids);

  return (
    <header className="relative z-50 bg-surface">
      <div className="mx-auto flex h-[4.75rem] max-w-[96rem] items-center gap-8 px-6 sm:px-10">
        <Link
          href="/"
          aria-label={`${siteConfig.name} home`}
          className="focus-ring flex shrink-0 items-center gap-2.5 text-ink"
        >
          <KairosMark className="h-[1.05em] w-auto" />
          {/* The wordmark in the display face, so the brand speaks in the same
              voice as the headline rather than in the interface font. */}
          <span className="display text-[1.375rem] leading-none">{siteConfig.name}</span>
        </Link>

        <nav
          className="ml-auto hidden items-baseline gap-8 lg:flex"
          aria-label="Page sections"
        >
          {LINKS.map((l, i) => {
            const on = active === l.id;
            return (
              <a
                key={l.href}
                href={l.href}
                aria-current={on ? "true" : undefined}
                className="focus-ring group relative flex items-baseline gap-2 py-1"
              >
                <span
                  className={`data text-[0.6875rem] tabular-nums transition-colors duration-300 ${
                    on ? "text-amber-deep" : "text-ink-3"
                  }`}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  className={`text-[0.9375rem] transition-colors duration-300 ${
                    on ? "text-ink" : "text-ink-2 group-hover:text-ink"
                  }`}
                >
                  {l.label}
                </span>
                {on && (
                  <motion.span
                    layoutId="nav-tessera"
                    aria-hidden="true"
                    className="absolute -bottom-1 left-0 block h-[5px] w-[5px] bg-amber-deep"
                    transition={{ duration: 0.4, ease }}
                  />
                )}
              </a>
            );
          })}
        </nav>

        <div className="ml-auto hidden shrink-0 items-center gap-6 lg:ml-8 lg:flex">
          <a
            href={siteConfig.repo}
            target="_blank"
            rel="noreferrer"
            className="focus-ring text-[0.9375rem] text-ink-2 transition-colors duration-200 hover:text-ink"
          >
            GitHub
          </a>
          <Action href={siteConfig.nav.cta.href} icon>
            {siteConfig.nav.cta.text}
          </Action>
        </div>

        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          className="focus-ring ml-auto flex h-10 w-10 items-center justify-center lg:hidden"
        >
          <Hamburger open={open} />
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.28, ease }}
            className="overflow-hidden lg:hidden"
          >
            <div className="flex flex-col px-6 pb-6 sm:px-10">
              {LINKS.map((l, i) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="focus-ring flex items-baseline gap-3 border-t border-ink/[0.09] py-3 first:border-t-0"
                >
                  <span className="data text-[0.6875rem] text-ink-3">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-ink-2">{l.label}</span>
                </a>
              ))}
              <a
                href={siteConfig.repo}
                target="_blank"
                rel="noreferrer"
                className="focus-ring flex items-baseline gap-3 border-t border-ink/[0.09] py-3 text-ink-2"
              >
                <span className="data text-[0.6875rem] text-ink-3">05</span>
                <span>GitHub</span>
              </a>
              <Action href={siteConfig.nav.cta.href} icon className="mt-5 self-start">
                {siteConfig.nav.cta.text}
              </Action>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
