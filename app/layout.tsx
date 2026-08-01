import { Providers } from "@/components/providers";
import { baseMetadata } from "@/lib/metadata";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import "./globals.css";

/**
 * Gambarino carries the identity. Self-hosted, not served from a font CDN, and
 * deliberately not from the free-Google rotation that every generated page
 * reaches for.
 *
 * Chosen against Sentient, Zodiak and Erode with all four rendered at the real
 * headline size. Zodiak is a Didone, which is the reflexive move whenever
 * something needs to feel expensive; Erode reads as the warm-editorial
 * default; Sentient is clean but safe. Gambarino is narrow and old-style with
 * sharp wedge serifs and a cut-in-stone quality — the right face for a brand
 * named in Greek and built out of tesserae, rather than a face picked because
 * it is currently well regarded.
 *
 * One weight, used with conviction.
 */
const gambarino = localFont({
  variable: "--font-gambarino",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
  src: [{ path: "./fonts/Gambarino-Regular.woff2", weight: "400", style: "normal" }],
});

/**
 * Sentient runs everything else — body copy, labels, navigation, buttons.
 *
 * Setting the body in a text serif rather than a sans is the deliberate move
 * here: it makes the page read as a document about how the money actually
 * works, not as a product landing page. Sans candidates were rendered at the
 * real paragraph size first — Switzer, Supreme, Synonym and Ranade all read as
 * the competent neutral grotesque every other site ships, which is exactly the
 * problem. Bespoke Serif was the runner-up and lost on its old-style figures,
 * which would have undercut the wei and epoch numbers this page is full of.
 *
 * Two serifs only work when they are clearly different jobs. Gambarino is
 * narrow, sharp-wedged and inscriptional and carries the display line;
 * Sentient is open and text-optimised and never appears above 20px.
 */
const sentient = localFont({
  variable: "--font-sentient",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
  src: [
    { path: "./fonts/Sentient-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Sentient-Italic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/Sentient-Medium.woff2", weight: "500", style: "normal" },
  ],
});

export const metadata: Metadata = baseMetadata;

export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#edf0ee" }],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  // The font variable goes on <html>, not <body>, so `--font-gambarino` truly
  // resolves at :root — the display stack in globals.css is declared there and
  // would otherwise point at an undefined variable.
  return (
    <html lang="en" className={`${gambarino.variable} ${sentient.variable}`} suppressHydrationWarning>
      {/* suppressHydrationWarning on <body> too: browser extensions commonly
          inject attributes here before React hydrates, which is otherwise
          reported as a mismatch we cannot control. */}
      <body
        suppressHydrationWarning
        className="min-h-screen bg-background font-sans text-foreground antialiased"
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
