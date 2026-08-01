import { DisclosureSection } from "@/components/disclosure-section";
import { Footer } from "@/components/footer";
import { HeadlineBand } from "@/components/headline-band";
import { LeakSection } from "@/components/leak-section";
import { MosaicFold } from "@/components/mosaic-fold";
import { PathSection } from "@/components/path-section";
import { TechStrip } from "@/components/tech-strip";
import { VerifySection } from "@/components/verify-section";
import { createMetadata, siteConfig } from "@/lib/metadata";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = createMetadata({
  title: "Kairos — a budget your agent cannot exceed or reveal",
  description: siteConfig.description,
  path: "/",
});

/**
 * Section order is composed from the brief, not assembled from blocks: the
 * artwork states the idea, the headline names it, the leak shows why it
 * matters, the disclosure is honest about the boundary, the path explains the
 * mechanism, and the verification proves all of it.
 */
export default function HomePage(): ReactNode {
  return (
    <main id="main-content" className="flex-1">
      <MosaicFold />
      <HeadlineBand />
      <TechStrip />
      <LeakSection />
      <DisclosureSection />
      <PathSection />
      <VerifySection />
      <Footer />
    </main>
  );
}
