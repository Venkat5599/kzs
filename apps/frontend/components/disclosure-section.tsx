import { disclosureConfig } from "@/lib/config";
import type { ReactNode } from "react";

/**
 * What is encrypted, and what is not.
 *
 * This is the most useful honest content the project has, so it is reproduced
 * at full strength rather than softened into benefits. The known limitation
 * gets the same typographic weight as the guarantees — a privacy claim that
 * hides its own caveat is worth nothing.
 *
 * The two lists sit on one grid with a shared top baseline and equal column
 * widths. Items are ranked by type and tone, never wrapped in tinted chips.
 */

/**
 * A tessera, marking each item. Filled for what stays sealed, open for what
 * the chain publishes — the same unit the fold artwork is cut from, used here
 * to carry meaning rather than decorate.
 */
function Tessera({ filled }: { filled: boolean }): ReactNode {
  return (
    <svg
      viewBox="0 0 10 10"
      aria-hidden="true"
      className="mt-[0.5em] h-[7px] w-[7px] shrink-0"
    >
      <rect
        x="0.75"
        y="0.75"
        width="8.5"
        height="8.5"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function Column({
  label,
  note,
  items,
  filled,
  accent,
}: {
  label: string;
  note: string;
  items: string[];
  filled: boolean;
  accent: string;
}): ReactNode {
  return (
    <div className="col-span-1 lg:col-span-6">
      <div className="flex items-baseline gap-3">
        <h3 className="text-[1.0625rem] font-medium text-ink">{label}</h3>
        <span className={accent}>
          <Tessera filled={filled} />
        </span>
      </div>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-3">{note}</p>

      <ul className="mt-7 flex flex-col">
        {items.map((item) => (
          <li
            key={item}
            className="flex items-start gap-3.5 border-t border-ink/[0.09] py-3.5 first:border-t-0 first:pt-0"
          >
            <span className={accent}>
              <Tessera filled={filled} />
            </span>
            <span className="text-[1rem] leading-[1.5] text-ink-2">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DisclosureSection(): ReactNode {
  return (
    <section id="disclosure" className="scroll-mt-24 bg-surface">
      <div className="mx-auto max-w-[96rem] px-6 pb-20 sm:px-10 lg:pb-28">
        {/* Section head composed as two columns rather than a small label
            stacked over a big heading. */}
        <div className="grid grid-cols-1 items-end gap-x-10 gap-y-4 border-t border-ink/[0.12] pt-8 lg:grid-cols-12">
          <h2
            className="display col-span-1 text-ink lg:col-span-6"
            style={{ fontSize: "clamp(1.75rem, 3vw, 2.625rem)" }}
          >
            {disclosureConfig.title}
          </h2>
          <p className="col-span-1 max-w-[42ch] text-[1.0625rem] leading-[1.6] text-ink-2 lg:col-span-6">
            {disclosureConfig.lede}
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-x-10 gap-y-12 lg:grid-cols-12">
          <Column
            label={disclosureConfig.sealed.label}
            note={disclosureConfig.sealed.note}
            items={disclosureConfig.sealed.items}
            filled
            accent="text-amber-deep"
          />
          <Column
            label={disclosureConfig.open.label}
            note={disclosureConfig.open.note}
            items={disclosureConfig.open.items}
            filled={false}
            accent="text-ink-3"
          />
        </div>

        <div className="mt-14 grid grid-cols-1 gap-x-10 gap-y-3 slab rounded-2xl bg-daylight p-6 sm:p-8 lg:grid-cols-12">
          <p className="col-span-1 text-[0.9375rem] font-medium text-ink lg:col-span-4">
            {disclosureConfig.limitation.label}
          </p>
          <p className="col-span-1 text-[1rem] leading-[1.6] text-ink-2 lg:col-span-8">
            <span className="data text-[0.9375rem] text-ink">msg.sender</span>
            {disclosureConfig.limitation.body.replace("msg.sender", "")}
          </p>
        </div>
      </div>
    </section>
  );
}
