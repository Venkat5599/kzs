import { DashboardClient } from "@/components/dashboard-client";
import { createMetadata } from "@/lib/metadata";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

export const metadata: Metadata = createMetadata({
  title: "Kairos — Dashboard",
  description:
    "Live dashboard for Kairos on Sepolia: skills catalog, MCP servers, workflows, marketplace, and scoped session keys.",
  path: "/dashboard",
});

export default function DashboardPage(): ReactNode {
  return (
    <Suspense fallback={<div className="min-h-[100dvh] bg-[#080808]" />}>
      <DashboardClient />
    </Suspense>
  );
}
