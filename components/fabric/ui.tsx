"use client";

import { useState, type ReactNode, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Copy, Check } from "lucide-react";

/**
 * Render a wei amount in whichever unit actually reads.
 *
 * Converting everything to ETH is the obvious move and the wrong one: this
 * works in small denominations, so a 1,000,000 wei budget becomes
 * "0.000000000001 ETH" — strictly accurate and completely unreadable. Pick the
 * unit by magnitude instead, and abbreviate thousands so the eye can size a
 * number at a glance.
 *
 * The exact figure is never lost — `Amount` keeps it in the title attribute,
 * because on a treasury screen an approximation must always be checkable.
 */
export function formatAmount(value: string | number | bigint | null | undefined): string {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0 wei";

  // 1e15 wei = 0.001 ETH: the point where ETH stops being all leading zeros.
  if (n >= 1e15) {
    const eth = n / 1e18;
    return `${eth < 1 ? eth.toFixed(4) : eth.toFixed(3)} ETH`;
  }
  // 1e7 wei = 0.01 gwei — below this, gwei reads worse than plain wei.
  if (n >= 1e7) return `${(n / 1e9).toFixed(n >= 1e10 ? 2 : 4)} gwei`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M wei`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(n % 1e3 === 0 ? 0 : 1)}K wei`;
  return `${n.toLocaleString()} wei`;
}

/** An amount, abbreviated for reading, exact on hover. */
export function Amount({
  value,
  className = "",
}: {
  value: string | number | bigint | null | undefined;
  className?: string;
}) {
  const n = value == null || value === "" ? null : Number(value);
  const exact = n != null && Number.isFinite(n) ? `${Math.trunc(n).toLocaleString()} wei` : undefined;
  return (
    <span className={className} title={exact}>
      {formatAmount(value)}
    </span>
  );
}

export function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1200);
      }}
      className="shrink-0 text-neutral-500 hover:text-accent"
    >
      {ok ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export const short = (s: string | null | undefined, head = 8, tail = 6) =>
  !s ? "—" : s.length > head + tail ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;

export const ETH = (raw: string | number | null | undefined) =>
  raw == null ? "—" : `${Number(raw).toLocaleString()} ETH`;

/**
 * Nested enclosure: an outer tray holding an inner plate.
 *
 * A single bordered box is the default dashboard card, and a hard hairline on
 * every panel is what makes a page read as a wireframe. Two concentric shells
 * instead — the outer barely lighter than the page, the inner carrying its own
 * surface and a one-pixel top highlight — give an edge you sense as a lip
 * catching light rather than a line someone drew. Radii are concentric
 * (outer 1.5rem, inner 1.5rem − 5px padding) so the curves stay parallel.
 */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className="rounded-[1.5rem] bg-white/[0.025] p-[5px]">
      <div
        className={`rounded-[calc(1.5rem-5px)] bg-[#0d0e11] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ${className}`}
      >
        {children}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-semibold text-white">
        {label}
        {hint && <span className="ml-1.5 font-normal text-neutral-500">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl bg-black/40 px-3.5 py-2.5 text-sm text-white placeholder:text-neutral-600 outline-none shadow-[inset_0_1px_2px_rgba(0,0,0,0.6),inset_0_0_0_1px_rgba(255,255,255,0.06)] transition-shadow duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] focus:shadow-[inset_0_1px_2px_rgba(0,0,0,0.6),inset_0_0_0_1px_rgba(163,230,53,0.35)] ${props.className ?? ""}`}
    />
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-xl bg-black/40 px-3.5 py-2.5 font-mono text-sm text-white placeholder:text-neutral-600 outline-none shadow-[inset_0_1px_2px_rgba(0,0,0,0.6),inset_0_0_0_1px_rgba(255,255,255,0.06)] transition-shadow duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] focus:shadow-[inset_0_1px_2px_rgba(0,0,0,0.6),inset_0_0_0_1px_rgba(163,230,53,0.35)] ${props.className ?? ""}`}
    />
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "outline";
  type?: "button" | "submit";
}) {
  // Motion carries mass: a tuned curve, and only transform/opacity so nothing
  // triggers layout. No lift on hover — a button that jumps is a template tic.
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium " +
    "transition-[background-color,color,box-shadow,transform] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] " +
    "active:scale-[0.985] disabled:opacity-40 disabled:pointer-events-none";

  // The accent is tonal, never a flood. Primary reads as a raised plate — a
  // lifted surface with a lit top edge and a faint accent wash — so it leads
  // by elevation rather than by being the brightest thing on screen. That also
  // dissolves the filled-vs-outlined button duo: these differ in altitude, not
  // in fill.
  const styles =
    variant === "primary"
      ? "bg-white/[0.09] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(0,0,0,0.5)] " +
        "hover:bg-accent/[0.16] hover:text-accent hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_1px_2px_rgba(0,0,0,0.5)]"
      : variant === "outline"
        ? "bg-white/[0.03] text-neutral-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:bg-white/[0.06] hover:text-white"
        : "text-neutral-500 hover:text-white";
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${styles}`}>
      {children}
    </button>
  );
}

export function Toggle({
  on,
  onChange,
  label,
  desc,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  desc?: string;
}) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="flex items-start gap-3 text-left">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${on ? "border-accent bg-accent" : "border-white/20 bg-white/[0.03]"}`}
      >
        {on && <span className="h-2 w-2 rounded-sm bg-black" />}
      </span>
      <span>
        <span className="block text-sm font-medium text-white">{label}</span>
        {desc && <span className="block text-xs text-neutral-500">{desc}</span>}
      </span>
    </button>
  );
}

export function Chip({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
  return (
    <span
      // Tonal, not a coloured pill. An accent chip earns its colour by being
      // rare; when every label wears one the page reads as a component kit.
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${
        accent
          ? "bg-accent/[0.08] text-accent/90 shadow-[inset_0_0_0_1px_rgba(163,230,53,0.15)]"
          : "bg-white/[0.04] text-neutral-400 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]"
      }`}
    >
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[1.25rem] bg-black/25 px-6 py-12 text-center text-sm text-neutral-500 shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]">
      {children}
    </div>
  );
}
