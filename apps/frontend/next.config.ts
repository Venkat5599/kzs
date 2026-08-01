import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Monorepo root — keeps standalone output at apps/frontend/.next/standalone/apps/frontend */
const monorepoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const isVercel = !!process.env.VERCEL;

const nextConfig: NextConfig = {
  // VPS uses standalone Docker image; Vercel manages its own output layout.
  ...(isVercel ? {} : { output: "standalone" as const }),
  // Only meaningful for the standalone VPS build. On Vercel the app is deployed
  // with Root Directory = apps/frontend, so pointing the tracing root two levels
  // up escapes the deployment and Next resolves the manifest at a doubled path
  // (/vercel/path0/vercel/path0/.next/...), which then does not exist.
  ...(isVercel ? {} : { outputFileTracingRoot: monorepoRoot }),
  productionBrowserSourceMaps: false,
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },
};

export default nextConfig;
