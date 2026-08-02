"use client";

import { motion, AnimatePresence } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  Store,
  Server,
  Workflow,
  Eye,
  ExternalLink,
  ShoppingBag,
  Wallet,
  KeyRound,
  Lock,
  EyeOff,
  type LucideIcon, BarChart3 } from "lucide-react";
import { KairosMark } from "@/components/kairos-logo";
import { siteConfig } from "@/lib/config";
import { DashboardHome } from "@/components/fabric/dashboard-home";
import { ApisSection } from "@/components/fabric/apis-section";
import { McpSection } from "@/components/fabric/mcp-section";
import { WorkflowsSection } from "@/components/fabric/workflows-section";
import { MarketplaceSection } from "@/components/fabric/marketplace-section";
import { AnalyticsSection } from "@/components/fabric/analytics-section";
import { SessionKeysSection } from "@/components/fabric/session-keys-section";
import { NoxVaultSection } from "@/components/fabric/nox-vault-section";
import { StealthSection } from "@/components/fabric/stealth-section";
import { useWallet } from "@/lib/wallet";
import { getChainStatus } from "@/lib/api";

export type SectionKey =
  | "dashboard"
  | "vault"
  | "apis"
  | "mcp"
  | "workflows"
  | "analytics"
  | "marketplace"
  | "session-keys"
  | "stealth";

const SECTIONS: { key: SectionKey; label: string; icon: LucideIcon }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "vault", label: "Confidential vault", icon: Lock },
  { key: "stealth", label: "Stealth payments", icon: EyeOff },
  { key: "apis", label: "APIs", icon: Store },
  { key: "mcp", label: "MCP Servers", icon: Server },
  { key: "workflows", label: "Workflows", icon: Workflow },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "marketplace", label: "Marketplace", icon: ShoppingBag },
  { key: "session-keys", label: "Session keys", icon: KeyRound },
];

const short = (s: string, head = 7, tail = 5) => (s.length > head + tail ? `${s.slice(0, head)}…${s.slice(-tail)}` : s);

export function KairosDashboard({ initialTab }: { initialTab?: SectionKey }): ReactNode {
  const [active, setActive] = useState<SectionKey>(initialTab ?? "dashboard");
  const cur = SECTIONS.find((s) => s.key === active) ?? SECTIONS[0]!;
  const CurIcon = cur.icon;
  const { address, connecting, connect } = useWallet();
  const [network, setNetwork] = useState("testnet");
  const [explorer, setExplorer] = useState("https://sepolia.etherscan.io");

  useEffect(() => {
    if (initialTab) setActive(initialTab);
  }, [initialTab]);

  useEffect(() => {
    getChainStatus()
      .then((s) => {
        setNetwork(s.configured ? s.network : "unconfigured");
        if (s.explorerBase) setExplorer(s.explorerBase);
      })
      .catch(() => null);
  }, []);

  return (
    <div
      className="min-h-[100dvh] bg-[#080808] text-white [&_svg]:[stroke-width:1.6] lg:flex"
      style={{ colorScheme: "dark" }}
    >
      <aside className="border-b border-white/[0.06] bg-white/[0.015] lg:sticky lg:top-0 lg:h-[100dvh] lg:w-[17rem] lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex h-full flex-col gap-3 p-4">
          <div className="flex items-center gap-3 rounded-2xl bg-white/[0.03] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
              <KairosMark className="h-5 w-5 text-accent" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight tracking-tight">{siteConfig.name}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium text-accent">
                <span className="relative flex h-1.5 w-1.5">
                                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
                </span>
                live · {network}
              </p>
            </div>
          </div>

          <nav className="flex gap-1 overflow-x-auto lg:flex-1 lg:flex-col lg:overflow-x-visible">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const on = active === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setActive(s.key)}
                  className={`group flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-300 active:scale-[0.98] ${
                    on
                      ? "bg-white/[0.07] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
                      : "text-neutral-500 hover:bg-white/[0.03] hover:text-neutral-200"
                  }`}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.6} />
                  {s.label}
                </button>
              );
            })}
          </nav>

          <a
            href={explorer}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.03] px-3 py-2.5 text-xs text-neutral-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-colors duration-300 hover:bg-white/[0.06] hover:text-neutral-200 lg:mt-auto"
          >
            <span className="font-mono">Sepolia {network}</span>
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.6} />
          </a>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/[0.06] bg-[#080808]/70 px-6 py-3.5 backdrop-blur-xl">
          <div className="flex items-center gap-2.5">
            <CurIcon className="h-[18px] w-[18px] text-accent" strokeWidth={1.7} />
            <span className="text-sm font-semibold tracking-tight">{cur.label}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={connect}
              className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-neutral-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-colors duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white/[0.09] hover:text-white"
            >
              <Wallet className="h-3.5 w-3.5" />
              {address ? short(address, 6, 4) : connecting ? "Connecting…" : "Connect agent key"}
            </button>
            <span className="hidden items-center gap-1.5 rounded-md bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-neutral-300 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] sm:inline-flex">
              <Eye className="h-3.5 w-3.5" /> Sepolia {network}
            </span>
          </div>
        </div>

        <div className="mx-auto max-w-5xl px-6 py-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={{ y: 8 }}
              animate={{ y: 0 }}
              exit={{ y: -4 }}
              transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
            >
              {active === "dashboard" && <DashboardHome go={(k) => setActive(k)} />}
              {active === "vault" && <NoxVaultSection />}
              {active === "stealth" && <StealthSection />}
              {active === "apis" && <ApisSection />}
              {active === "mcp" && <McpSection />}
              {active === "workflows" && <WorkflowsSection />}
              {active === "analytics" && <AnalyticsSection />}
              {active === "marketplace" && <MarketplaceSection />}
              {active === "session-keys" && <SessionKeysSection />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
