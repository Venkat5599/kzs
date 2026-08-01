import { siteConfig, verifyConfig } from "@/lib/config";
import type { ReactNode } from "react";

/**
 * Verify it yourself.
 *
 * The strongest trust move available: real commands against the live gateway,
 * with the real response shapes, rather than a claim that it works.
 *
 * Monospace is used heavily here and only here, because the content genuinely
 * is data — commands, JSON, an address. That is what a mono is for. It is not
 * used for the headings, the labels or the footnote.
 *
 * This is not a fake code window: no traffic-light dots, no filename tab, no
 * invented SDK. It is a plain transcript of things that actually return.
 */
export function VerifySection(): ReactNode {
  return (
    <section id="verify" className="scroll-mt-24 bg-surface">
      <div className="mx-auto max-w-[96rem] px-6 py-20 sm:px-10 lg:py-28">
        {/* Opens with the heading set against the live endpoint it refers to —
            a third distinct way of starting a section on this page. */}
        <div className="flex flex-col gap-5 border-t border-ink/[0.12] pt-8 md:flex-row md:items-baseline md:justify-between md:gap-10">
          <h2
            className="display text-ink"
            style={{ fontSize: "clamp(1.875rem, 3.4vw, 3rem)" }}
          >
            {verifyConfig.title}
          </h2>
          <p className="data min-w-0 text-[0.875rem] break-all text-ink-3">
            GATEWAY={siteConfig.gateway}
          </p>
        </div>

        <p className="mt-6 max-w-[52ch] text-[1.0625rem] leading-[1.6] text-ink-2">
          {verifyConfig.lede}
        </p>

        <div className="mt-14 grid grid-cols-1 items-stretch gap-4 lg:grid-cols-3 lg:gap-5">
          {verifyConfig.checks.map((check) => (
            <div
              key={check.label}
              className="grid grid-rows-[auto_auto_1fr] gap-4 slab-deep rounded-2xl bg-sea-deep p-6 sm:p-7"
            >
              <p className="text-[0.9375rem] leading-snug font-medium text-surface">
                {check.label}
              </p>

              <p className="data overflow-x-auto text-[0.8125rem] whitespace-pre text-[#e8b070]">
                {check.command}
              </p>

              <pre className="data overflow-x-auto text-[0.8125rem] leading-[1.65] text-[#a8c2c5]">
                {check.output}
              </pre>
            </div>
          ))}
        </div>

        <p className="mt-8 max-w-[68ch] text-[0.9375rem] leading-[1.6] text-ink-3">
          <span className="data text-ink-2">count</span> is how many settlements the batch
          absorbed. <span className="data text-ink-2">totalWei</span> covers all of them, and
          cannot be decomposed back into the payments that produced it.
        </p>
      </div>
    </section>
  );
}
