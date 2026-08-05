/**
 * Verify the deployed contracts on Etherscan.
 *
 * Verification is not cosmetic here. Every claim Kairos makes — that an
 * over-cap settlement debits zero without reverting, that no event carries an
 * address or an amount — is a claim about code a reader cannot check unless the
 * source behind the deployed bytecode is published. Unverified, the contracts
 * are a hash and a promise.
 *
 * Addresses come from the environment, the same ones recorded in `.env.example`.
 * A contract whose address is unset is skipped rather than guessed, so this is
 * safe to run against a partial deployment.
 *
 *   ETHERSCAN_API_KEY=… bun run --cwd contracts verify:sepolia
 */

import { spawn } from "node:child_process";

const NETWORK = process.env.VERIFY_NETWORK ?? "sepolia";

const API_KEY = process.env.ETHERSCAN_API_KEY?.trim();
if (!API_KEY) {
  // A clear sentence, not a stack trace from deep inside the verify task.
  console.error(
    "ETHERSCAN_API_KEY is required.\n" +
      "  Get one at https://etherscan.io/myapikey, then:\n" +
      "    ETHERSCAN_API_KEY=… bun run --cwd contracts verify:sepolia",
  );
  process.exit(1);
}

/** A deployed contract, and the arguments its constructor was given. */
interface Target {
  name: string;
  address: string | undefined;
  /** Must match the deploy script exactly — a wrong argument fails verification. */
  args: (string | number)[];
  /** Why this one might legitimately be unverifiable from the current env. */
  note?: string;
}

const vault = process.env.VAULT_ADDRESS;
const relayer = process.env.RELAYER_ADDRESS;
const swapRouter = process.env.UNISWAP_V3_ROUTER;
const flushThreshold = Number(process.env.FLUSH_THRESHOLD ?? 25);

// Constructor arguments are lifted from the deploy scripts, not inferred:
//   KairosVault             script/deploy.ts:73       [relayer, flushThreshold]
//   KairosSettlementRouter  script/deploy.ts:86       [vault, uniswapV3Router]
//   policies, registry,
//   announcer               script/deploy-ring.ts:62+ []
const TARGETS: Target[] = [
  {
    name: "KairosVault",
    address: vault,
    args: relayer ? [relayer, flushThreshold] : [],
    ...(relayer
      ? {}
      : { note: "RELAYER_ADDRESS unset — cannot reconstruct constructor args" }),
  },
  {
    name: "KairosSettlementRouter",
    address: process.env.SETTLEMENT_ROUTER_ADDRESS,
    args: vault && swapRouter ? [vault, swapRouter] : [],
    ...(vault && swapRouter
      ? {}
      : {
          note: "VAULT_ADDRESS or UNISWAP_V3_ROUTER unset — cannot reconstruct constructor args",
        }),
  },
  { name: "CapPolicy", address: process.env.CAP_POLICY_ADDRESS, args: [] },
  { name: "VelocityPolicy", address: process.env.VELOCITY_POLICY_ADDRESS, args: [] },
  { name: "AllowlistPolicy", address: process.env.ALLOWLIST_POLICY_ADDRESS, args: [] },
  { name: "CompositePolicy", address: process.env.COMPOSITE_POLICY_ADDRESS, args: [] },
  { name: "KairosRingRegistry", address: process.env.RING_REGISTRY_ADDRESS, args: [] },
  { name: "StealthAnnouncer", address: process.env.STEALTH_ANNOUNCER_ADDRESS, args: [] },
];

/**
 * Shell out to the `verify etherscan` task rather than calling it in-process.
 *
 * The CLI is the interface Hardhat documents and keeps stable; reaching into the
 * task registry would couple this script to internals that move between minors.
 */
function verify(address: string, args: (string | number)[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      "npx",
      ["hardhat", "verify", "etherscan", "--network", NETWORK, address, ...args.map(String)],
      { stdio: "inherit", shell: process.platform === "win32" },
    );
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

async function main(): Promise<void> {
  console.log(`Verifying on ${NETWORK}…\n`);

  const skipped: string[] = [];
  const verified: string[] = [];
  const failed: string[] = [];

  for (const target of TARGETS) {
    if (!target.address) {
      skipped.push(`${target.name} — address not set`);
      continue;
    }
    if (target.note) {
      skipped.push(`${target.name} — ${target.note}`);
      continue;
    }

    console.log(`── ${target.name}  ${target.address}`);
    // Sequential, not concurrent. Etherscan rate-limits by key, and a burst
    // comes back as a generic failure that reads exactly like a bad constructor
    // argument — the one error you least want to misdiagnose.
    const ok = await verify(target.address, target.args);
    (ok ? verified : failed).push(target.name);
    console.log("");
  }

  console.log("─".repeat(64));
  if (verified.length) console.log(`verified (${verified.length}): ${verified.join(", ")}`);
  if (skipped.length) console.log(`skipped  (${skipped.length}):\n  ${skipped.join("\n  ")}`);
  if (failed.length) {
    console.log(`FAILED   (${failed.length}): ${failed.join(", ")}`);
    console.log(
      "\nA failure is usually a constructor argument that does not match the\n" +
        "deployment. Check RELAYER_ADDRESS, FLUSH_THRESHOLD and UNISWAP_V3_ROUTER\n" +
        "against the values used when these addresses were deployed.",
    );
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
