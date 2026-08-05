import { describe, expect, it } from "bun:test";
import { manifestFromSkill, validateManifest, type FlatSkill } from "../src/index.js";

const ROW: FlatSkill = {
  slug: "sample-market-data",
  name: "Sample — Market data",
  description: "Example listing. Metered price feed.",
  priceWei: "1500",
  vendor: "sample-vendor",
  egress: ["api.example.dev"],
  createdAt: "2026-08-05T00:00:00.000Z",
};

describe("manifestFromSkill", () => {
  it("normalizes a flat row into a complete manifest", () => {
    const m = manifestFromSkill(ROW);
    expect(m.name).toBe(ROW.name);
    expect(m.pricing.pricePerCall).toBe("1500");
    expect(m.pricing.asset).toBe("ETH");
    expect(m.scope.egress).toEqual(["api.example.dev"]);
    expect(m.runtime).toBe("code");
  });

  it("carries explicit overrides", () => {
    const m = manifestFromSkill(ROW, { runtime: "hybrid", version: "2.1.0" });
    expect(m.runtime).toBe("hybrid");
    expect(m.version).toBe("2.1.0");
  });

  it("never invents a price — a malformed row degrades to zero", () => {
    const m = manifestFromSkill({ ...ROW, priceWei: "not-a-number" });
    expect(m.pricing.pricePerCall).toBe("0");
  });
});

describe("validateManifest", () => {
  it("accepts a manifest built from a row", () => {
    const r = validateManifest(manifestFromSkill(ROW));
    expect(r.ok).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(validateManifest(null).ok).toBe(false);
    expect(validateManifest("x").ok).toBe(false);
  });

  it("rejects a numeric price — wei cannot be a JS number", () => {
    const bad = { ...manifestFromSkill(ROW), pricing: { pricePerCall: 1500, asset: "ETH" } };
    const r = validateManifest(bad);
    expect(r.ok).toBe(false);
  });

  it("rejects an unknown runtime", () => {
    const bad = { ...manifestFromSkill(ROW), runtime: "java" };
    expect(validateManifest(bad).ok).toBe(false);
  });
});
