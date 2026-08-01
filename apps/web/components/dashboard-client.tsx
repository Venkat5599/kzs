"use client";

import { KairosDashboard, type SectionKey } from "@/components/kairos-dashboard";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

const TAB_ALIASES: Record<string, SectionKey> = {
  dashboard: "dashboard",
  vault: "vault",
  nox: "vault",
  apis: "apis",
  mcp: "mcp",
  workflows: "workflows",
  analytics: "analytics",
  marketplace: "marketplace",
  "session-keys": "session-keys",
  create: "apis",
};

export function DashboardClient(): ReactNode {
  const searchParams = useSearchParams();
  const tabKey = searchParams.get("tab") ?? "";
  const initialTab = TAB_ALIASES[tabKey];

  return (
    <main id="main-content" className="relative min-h-[100dvh]">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          backgroundImage:
            "radial-gradient(60rem 32rem at 78% -8%, color-mix(in srgb, var(--accent) 20%, transparent), transparent 70%), radial-gradient(48rem 28rem at 4% 4%, color-mix(in srgb, var(--accent) 8%, transparent), transparent 65%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-[0.16] [mask-image:linear-gradient(to_bottom,black,transparent_75%)]"
        style={{
          backgroundImage:
            "linear-gradient(to right, color-mix(in srgb, var(--foreground) 14%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--foreground) 14%, transparent) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
      />
      <KairosDashboard {...(initialTab ? { initialTab } : {})} />
    </main>
  );
}
