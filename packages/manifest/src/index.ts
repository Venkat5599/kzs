import { invalidInput, type Result, err, ok } from "@kairos/shared";

/**
 * @kairos/manifest — what a skill says about itself.
 *
 * The gateway stores skills flat (`slug`, `priceWei`, `egress`); a manifest is
 * the machine-readable envelope agents consume — schema, pricing, scope. This
 * package owns the manifest shape, its validation, and the normalization from
 * the flat row so every consumer derives the same manifest from the same row.
 */

/** How a skill executes on the gateway. */
export type SkillRuntime = "llm" | "code" | "hybrid";

/** The flat catalogue row the gateway serves. */
export interface FlatSkill {
  slug: string;
  name: string;
  description: string;
  priceWei: string;
  vendor: string;
  egress: string[];
  createdAt: string;
}

/** The enriched shape a manifest carries. */
export interface SkillManifest {
  name: string;
  /** Semantic version; defaults to "1.0.0" when the row carries none. */
  version: string;
  description: string;
  runtime: SkillRuntime;
  pricing: {
    /** Price per call in wei, as a decimal string — never a number. */
    pricePerCall: string;
    /** The asset the price is denominated in. */
    asset: string;
  };
  /** Loose JSON-schema for the input a caller must supply. */
  inputSchema: Record<string, unknown>;
  /** Loose JSON-schema for what the skill returns. */
  outputSchema: Record<string, unknown>;
  /** What the skill may reach and spend. */
  scope: {
    /** Hosts the skill may call out to. */
    egress: string[];
    /** Optional per-call spend ceiling, wei as a decimal string. */
    maxSpendPerCall?: string;
  };
}

const WEI_RE = /^(0|[1-9][0-9]*)$/;

/**
 * Build a manifest from a flat gateway row.
 *
 * Unknown fields are defaulted, never invented: no runtime information exists
 * on a flat row, so the runtime is "code" — the honest default for a proxy
 * that calls out to a URL. Callers wanting "llm" must supply it explicitly.
 */
export function manifestFromSkill(skill: FlatSkill, overrides: Partial<SkillManifest> = {}): SkillManifest {
  const price = WEI_RE.test(skill.priceWei) ? skill.priceWei : "0";
  return {
    name: skill.name,
    version: "1.0.0",
    description: skill.description,
    runtime: "code",
    pricing: { pricePerCall: price, asset: "ETH" },
    inputSchema: { type: "object", additionalProperties: true },
    outputSchema: { type: "object", additionalProperties: true },
    scope: { egress: [...skill.egress] },
    ...overrides,
  };
}

/**
 * Validate an untrusted manifest.
 *
 * Returns a structured result rather than throwing, so a boundary can collect
 * the failure into a 400 without try/catch noise. A malformed pricing field is
 * the one case worth calling out: wei exceeds 2^53, so a number here is a bug
 * waiting to silently truncate.
 */
export function validateManifest(input: unknown): Result<SkillManifest, ReturnType<typeof invalidInput>> {
  if (typeof input !== "object" || input === null) {
    return err(invalidInput("manifest must be an object"));
  }
  const m = input as Record<string, unknown>;

  if (typeof m.name !== "string" || m.name.length === 0) return err(invalidInput("manifest.name must be a non-empty string"));
  if (typeof m.description !== "string") return err(invalidInput("manifest.description must be a string"));
  if (m.version !== undefined && typeof m.version !== "string") return err(invalidInput("manifest.version must be a string"));
  if (m.runtime !== undefined && m.runtime !== "llm" && m.runtime !== "code" && m.runtime !== "hybrid") {
    return err(invalidInput("manifest.runtime must be 'llm', 'code' or 'hybrid'"));
  }

  const pricing = m.pricing as Record<string, unknown> | undefined;
  if (typeof pricing !== "object" || pricing === null) return err(invalidInput("manifest.pricing is required"));
  const pricePerCall = pricing.pricePerCall;
  if (typeof pricePerCall !== "string" || !WEI_RE.test(pricePerCall)) {
    return err(invalidInput("manifest.pricing.pricePerCall must be a wei decimal string"));
  }
  if (pricing.asset !== undefined && typeof pricing.asset !== "string") {
    return err(invalidInput("manifest.pricing.asset must be a string"));
  }

  const scope = m.scope as Record<string, unknown> | undefined;
  if (typeof scope !== "object" || scope === null) return err(invalidInput("manifest.scope is required"));
  if (!Array.isArray(scope.egress) || !scope.egress.every((e) => typeof e === "string")) {
    return err(invalidInput("manifest.scope.egress must be an array of strings"));
  }

  return ok(m as unknown as SkillManifest);
}
