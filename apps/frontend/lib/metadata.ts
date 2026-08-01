import type { Metadata } from "next";
import { siteConfig as brand } from "@/lib/config";

export const siteConfig = {
  name: brand.name,
  description: brand.description,
  url: brand.url,
  ogImage: "/icon.svg",
  creator: brand.twitter,
  authors: [{ name: "Kairos", url: brand.url }],
  keywords: [
    "Kairos",
    "Sepolia",
    "x402",
    "MCP",
    "SKILL.md",
    "session keys",
    "permissioned execution",
    "micropayments",
  ],
} as const;

export const baseMetadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: { default: siteConfig.name, template: `%s | ${siteConfig.name}` },
  description: siteConfig.description,
  keywords: [...siteConfig.keywords],
  authors: [...siteConfig.authors],
  creator: siteConfig.creator,
  publisher: siteConfig.name,
  robots: { index: true, follow: true },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteConfig.url,
    title: siteConfig.name,
    description: siteConfig.description,
    siteName: siteConfig.name,
    images: [{ url: siteConfig.ogImage, width: 1200, height: 630, alt: siteConfig.name }],
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.name,
    description: siteConfig.description,
    images: [siteConfig.ogImage],
    creator: siteConfig.creator,
  },
  // One SVG mark, and only a URL that actually resolves. Next's `apple-icon`
  // file convention accepts raster formats only, so an `apple-icon.svg` never
  // gets a route built for it — declaring one here emitted a <link> pointing
  // at a permanent 404.
  icons: { icon: "/icon.svg" },
  manifest: "/site.webmanifest",
};

export function createMetadata({
  title,
  description,
  path = "/",
  image,
  noIndex = false,
}: {
  title?: string;
  description?: string;
  path?: string;
  image?: string;
  noIndex?: boolean;
}): Metadata {
  const url = `${siteConfig.url}${path}`;
  const ogImage = image ?? siteConfig.ogImage;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: title ?? siteConfig.name,
      description: description ?? siteConfig.description,
      url,
      images: [{ url: ogImage, width: 1200, height: 630, alt: title ?? siteConfig.name }],
    },
    twitter: {
      title: title ?? siteConfig.name,
      description: description ?? siteConfig.description,
      images: [ogImage],
    },
    ...(noIndex && { robots: { index: false, follow: false } }),
  };
}
