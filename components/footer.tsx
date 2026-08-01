import { Action } from "@/components/action";
import { KairosMark } from "@/components/kairos-logo";
import { footerConfig, siteConfig } from "@/lib/config";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The footer opens on an inset island: the artwork again, cropped low so the
 * panel shows the near water where the tesserae carry hex. The hero shows the
 * horizon, this shows the ciphertext — one asset, two framings, so the page
 * closes on the same picture it opened with, read closer.
 *
 * The island is a real image, never a gradient slab. A wide rounded box flooded
 * with colour and a centred headline is the stock pre-footer banner; a crafted
 * plate with a scrim only where the type sits is the version worth shipping.
 *
 * The fourth column carries live contract facts rather than an email capture.
 * Kairos has no mailing list, so a signup field here would be a control that
 * looks interactive and does nothing — broken, not decorative.
 */

/** GitHub's real mark, bare on the surface. No circle, no tile behind it. */
function GitHubMark({ className = "h-5 w-5" }: { className?: string }): ReactNode {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function Footer(): ReactNode {
  return (
    <footer className="relative overflow-hidden bg-grout text-surface">
      <div className="mx-auto max-w-[96rem] px-6 pt-16 sm:px-10 lg:pt-20">
        {/* The island. Margin on all four sides so it reads as a detached
            object sitting on the floor, not a band welded to it. */}
        <div className="relative overflow-hidden rounded-[1.75rem]">
          {/* eslint-disable-next-line @next/next/no-img-element -- the same
              static art plate as the fold, framed lower. */}
          <img
            src="/fold-mosaic.png"
            alt=""
            aria-hidden="true"
            width={2560}
            height={880}
            loading="lazy"
            decoding="async"
            className="h-[19rem] w-full object-cover sm:h-[21rem]"
            style={{ objectPosition: "50% 92%" }}
          />

          {/* Legibility scrim. Sits only behind the type and resolves to
              transparent well before every edge, so it can never become its own
              hard band at the panel rim. */}
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(120% 90% at 50% 52%, rgba(8,26,32,0.86) 0%, rgba(8,26,32,0.74) 38%, rgba(8,26,32,0.34) 68%, rgba(8,26,32,0) 88%)",
            }}
          />

          <div className="absolute inset-0 flex flex-col items-center justify-center gap-7 px-6 text-center">
            <h2
              className="display max-w-[17ch] text-balance text-surface"
              style={{ fontSize: "clamp(1.75rem, 3.6vw, 3rem)" }}
            >
              Every tile is a payment. None of them are readable.
            </h2>
            <Action href={siteConfig.nav.cta.href} icon>
              {siteConfig.nav.cta.text}
            </Action>
          </div>
        </div>

        {/* Four columns on one grid — brand, two link sets, and live facts. */}
        <div className="mt-16 grid grid-cols-1 gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-12">
          <div className="col-span-1 lg:col-span-3">
            <Link
              href="/"
              aria-label={`${siteConfig.name} home`}
              className="focus-ring inline-flex text-surface"
            >
              <KairosMark className="h-6 w-auto" />
            </Link>
            <p className="mt-5 max-w-[32ch] text-[0.9375rem] leading-[1.6] text-[#9db2b4]">
              {siteConfig.tagline}. Built for the WTF Hackathon, Summer Edition — iExec Nox
              track.
            </p>
            <a
              href={siteConfig.repo}
              target="_blank"
              rel="noreferrer"
              aria-label="Kairos on GitHub"
              className="focus-ring mt-6 inline-flex text-[#9db2b4] transition-colors duration-200 hover:text-surface"
            >
              <GitHubMark />
            </a>
          </div>

          {footerConfig.columns.slice(0, 2).map((col) => (
            <nav key={col.heading} aria-label={col.heading} className="col-span-1 lg:col-span-2">
              {/* Sentence case, not tracked caps. When every small string wears
                  the same spaced-caps costume it reads as a template. */}
              <h2 className="text-[0.9375rem] font-medium text-surface">{col.heading}</h2>
              <ul className="mt-4 flex flex-col gap-2.5">
                {col.links.map((link) => {
                  const external = link.href.startsWith("http");
                  return (
                    <li key={link.label}>
                      {external ? (
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noreferrer"
                          className="focus-ring text-[0.9375rem] text-[#9db2b4] transition-colors duration-200 hover:text-surface"
                        >
                          {link.label}
                        </a>
                      ) : (
                        <Link
                          href={link.href}
                          className="focus-ring text-[0.9375rem] text-[#9db2b4] transition-colors duration-200 hover:text-surface"
                        >
                          {link.label}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </nav>
          ))}

          {/* Where a newsletter box would sit. Real, checkable facts instead —
              the same visual weight, without a control that does nothing. */}
          <div className="col-span-1 sm:col-span-2 lg:col-span-5">
            <h2 className="text-[0.9375rem] font-medium text-surface">Live on Sepolia</h2>
            <p className="mt-3 max-w-[46ch] text-[0.9375rem] leading-[1.6] text-[#9db2b4]">
              The vault below is deployed and settling. Every number on this page can be read
              straight off the chain.
            </p>
            <dl className="mt-5 flex flex-col gap-2.5">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <dt className="w-20 shrink-0 text-[0.8125rem] text-[#6d8386]">Vault</dt>
                <dd className="min-w-0">
                  <a
                    href={siteConfig.vaultExplorer}
                    target="_blank"
                    rel="noreferrer"
                    className="focus-ring data text-[0.8125rem] break-all text-[#a8c2c5] transition-colors duration-200 hover:text-surface"
                  >
                    {siteConfig.vault}
                  </a>
                </dd>
              </div>
              <div className="flex flex-wrap items-baseline gap-x-3">
                <dt className="w-20 shrink-0 text-[0.8125rem] text-[#6d8386]">Gateway</dt>
                <dd className="min-w-0">
                  <a
                    href={`${siteConfig.gateway}/nox/status`}
                    target="_blank"
                    rel="noreferrer"
                    className="focus-ring data text-[0.8125rem] break-all text-[#a8c2c5] transition-colors duration-200 hover:text-surface"
                  >
                    /nox/status
                  </a>
                </dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Closing row, on a hairline. */}
        <div className="mt-14 flex flex-col gap-4 border-t border-white/[0.09] py-7 sm:flex-row sm:items-center sm:justify-between">
          <p className="data text-[0.8125rem] text-[#6d8386]">{footerConfig.colophon}</p>
          <nav aria-label="Source links" className="flex flex-wrap gap-x-7 gap-y-2">
            {footerConfig.columns[2]?.links.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="focus-ring text-[0.8125rem] text-[#6d8386] transition-colors duration-200 hover:text-surface"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>
      </div>

      {/* The signature, holding the floor. Tight leading pulls the cap bottoms
          onto the page edge; `overflow-hidden` trims only the empty leading
          below them. KAIROS has no descenders, so no glyph is shaved. */}
      <div aria-hidden="true" className="select-none px-6 sm:px-10">
        <span
          className="display block text-[#1a2b33]"
          style={{
            fontSize: "clamp(4.5rem, 29vw, 26rem)",
            lineHeight: 0.76,
            letterSpacing: "0.055em",
          }}
        >
          KAIROS
        </span>
      </div>
    </footer>
  );
}
