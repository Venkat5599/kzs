import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Monorepo root — keeps standalone output at apps/web/.next/standalone/apps/web */
const monorepoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const isVercel = !!process.env.VERCEL;

const nextConfig: NextConfig = {
  // VPS uses standalone Docker image; Vercel manages its own output layout.
  ...(isVercel ? {} : { output: "standalone" as const }),
  outputFileTracingRoot: monorepoRoot,
  productionBrowserSourceMaps: false,
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },
};

export default nextConfig;
