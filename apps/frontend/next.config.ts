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

  /**
   * Proxy the gateway under our own origin.
   *
   * Vercel gives a project several hostnames — the alias, an auto-assigned
   * `<project>-<words>.vercel.app`, and a fresh one per deployment. The gateway
   * allowlists origins explicitly, so a browser landing on any hostname other
   * than the allowlisted one received no `Access-Control-Allow-Origin` header
   * and every panel died with "Failed to fetch". Telling people to use the right
   * URL is not a fix; the next preview deployment breaks it again.
   *
   * A rewrite is performed by the Next server, so the browser only ever talks to
   * the origin it loaded from and CORS never enters into it. Works on every
   * hostname, previews included, with no gateway change.
   */
  async rewrites() {
    const gateway = (
      process.env.NEXT_PUBLIC_GATEWAY_URL ?? "https://kairos-api.187.127.137.136.sslip.io"
    ).replace(/\/+$/, "");
    return [{ source: "/gw/:path*", destination: `${gateway}/:path*` }];
  },
};

export default nextConfig;
