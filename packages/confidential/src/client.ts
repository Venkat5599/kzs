import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { createViemHandleClient } from "@iexec-nox/handle";
import {
  type Verdict,
  verdictFromDecryption,
  unreadable,
  upstreamFailure,
} from "@kairos/shared";

/**
 * The Nox-facing half of the gateway.
 *
 * Everything that touches an encrypted handle lives here. The rest of the
 * gateway deals in plain values and never sees a key.
 *
 * The one rule this module exists to enforce: a verdict that cannot be read is
 * a refusal. {@link settle} returns a {@link Verdict}, never a boolean, so a
 * caller cannot accidentally treat "could not tell" as "no".
 */

export const vaultAbi = parseAbi([
  "function fund(bytes32 encryptedAmount, bytes proof)",
  "function registerAgent(address agent)",
  "function settle(address agent, bytes32 encryptedAmount, bytes proof) returns (bytes32)",
  "function flushEpoch() returns (uint64)",
  "function proveEpochAggregate(uint64 epochId, bytes decryptionProof) returns (uint256)",
  "function treasuryHandle() view returns (bytes32)",
  "function agentSpentHandle(address agent) view returns (bytes32)",
  "function epochTotalHandle(uint64 epochId) view returns (bytes32)",
  "function isRegistered(address agent) view returns (bool)",
  "function currentEpoch() view returns (uint64)",
  "function flushThreshold() view returns (uint32)",
  "function relayer() view returns (address)",
  "function owner() view returns (address)",
  "function policy() view returns (address)",
  "function epochInfo(uint64 epochId) view returns (uint32,bool,bool,uint256)",
  "event Settled(uint64 indexed epoch)",
]);

export const capPolicyAbi = parseAbi([
  "function registerSubject(address subject, bytes32 encryptedCap, bytes proof)",
  "function removeSubject(address subject)",
  "function capHandle(address subject) view returns (bytes32)",
  "function isRegistered(address subject) view returns (bool)",
]);

/** Eligibility is a plaintext flag — a subject is either allowed or not. */
export const allowlistPolicyAbi = parseAbi([
  "function setEligible(address subject, bool eligible)",
  "function hasEntry(address subject) view returns (bool)",
]);

/** A cumulative allowance, encrypted like the per-call cap. */
export const velocityPolicyAbi = parseAbi([
  "function registerSubject(address subject, bytes32 encryptedAllowance, bytes proof)",
  "function resetConsumed(address subject)",
  "function isRegistered(address subject) view returns (bool)",
]);

export const stealthAnnouncerAbi = parseAbi([
  "function registerKeys(uint256 schemeId, bytes metaAddress)",
  "function announce(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey, bytes metadata)",
  "function hasKeys(address registrant, uint256 schemeId) view returns (bool)",
  "function stealthMetaAddressOf(address registrant, uint256 schemeId) view returns (bytes)",
]);

export const settlementRouterAbi = parseAbi([
  "function routeEpochToStealth(uint64 epochId, address tokenIn, address tokenOut, uint24 poolFee, uint256 amountOutMinimum, uint256 deadline, address stealthRecipient) returns (uint256)",
  "function routed(uint64 epochId) view returns (bool)",
]);

/** ERC-5564 scheme 1: secp256k1 with view tags. The only scheme Kairos uses. */
export const STEALTH_SCHEME_ID = 1n;

export interface ConfidentialConfig {
  rpcUrl: string;
  vaultAddress: Address;
  capPolicyAddress?: Address;
  /** Allowlist policy — subjects are either eligible or not (plaintext flag). */
  allowlistPolicyAddress?: Address;
  /** Velocity policy — cumulative allowance, encrypted like the cap. */
  velocityPolicyAddress?: Address;
  /** Cumulative allowance for newly registered agents; defaults to 3x the cap. */
  velocityAllowanceWei?: bigint;
  /** ERC-5564 bulletin board. Without it, stealth payments cannot be found. */
  stealthAnnouncerAddress?: Address;
  /** Where a proven epoch aggregate is swapped and paid out. */
  settlementRouterAddress?: Address;
  /** Relayer key. The only secret this package touches. */
  relayerPrivateKey?: Hex;
}

export interface EpochSnapshot {
  epoch: number;
  settlementCount: number;
  flushed: boolean;
  settled: boolean;
  aggregate: string;
}

export class ConfidentialClient {
  private readonly publicClient;
  private readonly walletClient;
  private handleClient: Awaited<ReturnType<typeof createViemHandleClient>> | undefined;

  constructor(private readonly config: ConfidentialConfig) {
    const transport = http(config.rpcUrl);
    this.publicClient = createPublicClient({ chain: sepolia, transport });
    this.walletClient = config.relayerPrivateKey
      ? createWalletClient({
          account: privateKeyToAccount(config.relayerPrivateKey),
          chain: sepolia,
          transport,
        })
      : undefined;
  }

  /** True when the gateway can sign. Read-only deployments are legitimate. */
  get canWrite(): boolean {
    return this.walletClient !== undefined;
  }

  get relayerAddress(): Address | undefined {
    return this.walletClient?.account.address;
  }

  private async handles() {
    if (!this.walletClient) {
      throw upstreamFailure("nox", { reason: "no relayer key configured" });
    }
    this.handleClient ??= await createViemHandleClient(this.walletClient);
    return this.handleClient;
  }

  private read<T>(fn: string, args: readonly unknown[] = []): Promise<T> {
    return this.publicClient.readContract({
      address: this.config.vaultAddress,
      abi: vaultAbi,
      functionName: fn as never,
      args: args as never,
    }) as Promise<T>;
  }

  // ---- status ------------------------------------------------------------

  async status() {
    const [epoch, threshold, relayer, owner, policy] = await Promise.all([
      this.read<bigint>("currentEpoch"),
      this.read<number>("flushThreshold"),
      this.read<Address>("relayer"),
      this.read<Address>("owner"),
      this.read<Address>("policy"),
    ]);
    return {
      configured: true,
      vaultAddress: this.config.vaultAddress,
      capPolicyAddress: this.config.capPolicyAddress ?? null,
      policy,
      relayer,
      owner,
      network: sepolia.id,
      epoch: Number(epoch),
      flushThreshold: Number(threshold),
      canWrite: this.canWrite,
    };
  }

  async chainStatus() {
    const [chainId, block] = await Promise.all([
      this.publicClient.getChainId(),
      this.publicClient.getBlockNumber(),
    ]);
    return {
      configured: true,
      // Load-bearing: the dashboard reads this to decide whether it may claim a
      // real settlement. There is exactly one source for it, and it is here.
      demoMode: false,
      network: "testnet" as const,
      chainId,
      blockNumber: Number(block),
      rpcUrl: this.config.rpcUrl,
      explorer: "https://sepolia.etherscan.io",
    };
  }

  // ---- reads that decrypt -------------------------------------------------

  /**
   * Decrypt a handle for the configured account.
   *
   * Returns `null` rather than throwing when the ACL does not permit it: "you
   * may not read this" is an ordinary answer, not an error, and the dashboard
   * renders it as such.
   */
  private async tryDecrypt(handle: Hex): Promise<string | null> {
    try {
      const client = await this.handles();
      const { value } = await client.decrypt(handle);
      return String(value);
    } catch {
      // The iExec TEE session behind the handle client can go stale (session
      // TTL / invalidation). Recreate it once and retry: a fresh session is
      // re-authentication, not a verdict retry, so fail-closed still holds —
      // a genuinely unreadable handle stays unreadable through the new
      // session too, and returns null below.
      try {
        if (!this.walletClient) return null;
        this.handleClient = await createViemHandleClient(this.walletClient);
        const { value } = await this.handleClient.decrypt(handle);
        return String(value);
      } catch {
        return null;
      }
    }
  }

  async budget() {
    const [treasuryHandle, epoch] = await Promise.all([
      this.read<Hex>("treasuryHandle"),
      this.read<bigint>("currentEpoch"),
    ]);
    const epochHandle = await this.read<Hex>("epochTotalHandle", [epoch]);
    const [budgetWei, epochTotalWei, info] = await Promise.all([
      this.tryDecrypt(treasuryHandle),
      this.tryDecrypt(epochHandle),
      this.read<[number, boolean, boolean, bigint]>("epochInfo", [epoch]),
    ]);

    return {
      budgetWei,
      epochTotalWei,
      epoch: Number(epoch),
      epochCount: Number(info[0]),
      treasuryHandle,
      epochHandle,
      // Stated explicitly so the UI never has to infer it from a null value.
      readable: budgetWei !== null,
    };
  }

  async agent(address: Address) {
    const registered = await this.read<boolean>("isRegistered", [address]);
    if (!registered) return { agent: address, registered: false, spentWei: null, capWei: null };

    const spentHandle = await this.read<Hex>("agentSpentHandle", [address]);
    const spentWei = await this.tryDecrypt(spentHandle);

    let capWei: string | null = null;
    if (this.config.capPolicyAddress) {
      try {
        const capHandle = (await this.publicClient.readContract({
          address: this.config.capPolicyAddress,
          abi: capPolicyAbi,
          functionName: "capHandle",
          args: [address],
        })) as Hex;
        capWei = await this.tryDecrypt(capHandle);
      } catch {
        capWei = null;
      }
    }

    return { agent: address, registered: true, spentWei, capWei, spentHandle };
  }

  async epoch(id: number): Promise<EpochSnapshot> {
    const info = await this.read<[number, boolean, boolean, bigint]>("epochInfo", [BigInt(id)]);
    return {
      epoch: id,
      settlementCount: Number(info[0]),
      flushed: info[1],
      settled: info[2],
      aggregate: info[3].toString(),
    };
  }

  // ---- writes ------------------------------------------------------------

  private async send(fn: string, args: readonly unknown[]): Promise<Hex> {
    if (!this.walletClient) throw upstreamFailure("nox", { reason: "read-only gateway" });
    const hash = await this.walletClient.writeContract({
      address: this.config.vaultAddress,
      abi: vaultAbi,
      functionName: fn as never,
      args: args as never,
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw upstreamFailure(fn, { hash });
    return hash;
  }

  async fund(amountWei: bigint): Promise<Hex> {
    const client = await this.handles();
    const { handle, handleProof } = await client.encryptInput(
      amountWei,
      "uint256",
      this.config.vaultAddress,
    );
    return this.send("fund", [handle, handleProof]);
  }

  async registerAgent(agent: Address, capWei: bigint): Promise<{ vault: Hex; policy?: Hex; allowlist?: Hex; velocity?: Hex }> {
    const vault = await this.send("registerAgent", [agent]);

    if (!this.config.capPolicyAddress || !this.walletClient) return { vault };

    const client = await this.handles();
    const { handle, handleProof } = await client.encryptInput(
      capWei,
      "uint256",
      this.config.capPolicyAddress,
    );
    const policy = await this.walletClient.writeContract({
      address: this.config.capPolicyAddress,
      abi: capPolicyAbi,
      functionName: "registerSubject",
      args: [agent, handle, handleProof],
    });
    await this.publicClient.waitForTransactionReceipt({ hash: policy });

    // The vault's policy chain is composite(cap, velocity, allowlist) — every
    // policy must approve. The cap alone would leave a freshly registered agent
    // permanently refused by the other two, so wire those here too.
    const extra: { allowlist?: Hex; velocity?: Hex } = {};

    if (this.config.allowlistPolicyAddress) {
      const allowlist = await this.walletClient.writeContract({
        address: this.config.allowlistPolicyAddress,
        abi: allowlistPolicyAbi,
        functionName: "setEligible",
        args: [agent, true],
      });
      await this.publicClient.waitForTransactionReceipt({ hash: allowlist });
      extra.allowlist = allowlist;
    }

    if (this.config.velocityPolicyAddress) {
      const allowance = this.config.velocityAllowanceWei ?? capWei * 3n;
      const { handle: allowanceHandle, handleProof: allowanceProof } = await client.encryptInput(
        allowance,
        "uint256",
        this.config.velocityPolicyAddress,
      );
      const velocity = await this.walletClient.writeContract({
        address: this.config.velocityPolicyAddress,
        abi: velocityPolicyAbi,
        functionName: "registerSubject",
        args: [agent, allowanceHandle, allowanceProof],
      });
      await this.publicClient.waitForTransactionReceipt({ hash: velocity });
      extra.velocity = velocity;
    }

    return { vault, policy, ...extra };
  }

  /**
   * Settle, and report the verdict.
   *
   * **This is the fail-closed boundary.** The transaction succeeds whether or
   * not the payment was authorized — that is the branchless design — so the
   * only signal is an encrypted flag. Every path that cannot produce a definite
   * boolean returns `unreadable`, and the caller must refuse on it.
   *
   * There is deliberately no retry here. Retrying until a verdict appears is
   * how "fail closed" quietly becomes "fail open after enough attempts".
   */
  async settle(
    agent: Address,
    amountWei: bigint,
  ): Promise<{ hash: Hex; verdict: Verdict; spentWei: string | null }> {
    const client = await this.handles();
    const { handle, handleProof } = await client.encryptInput(
      amountWei,
      "uint256",
      this.config.vaultAddress,
    );

    // Capture the spend BEFORE settling. A write receipt carries no return
    // data, so the verdict has to be inferred from whether the agent's spend
    // moved — and spend accumulates, so an absolute test would report every
    // settlement as authorized.
    const before = (await this.agent(agent)).spentWei;

    const hash = await this.send("settle", [agent, handle, handleProof]);

    const after = (await this.agent(agent)).spentWei;

    let verdict: Verdict;
    if (before === null || after === null) {
      // Either read failing means we cannot tell. Refuse. The spend is only
      // decryptable by a permitted account, so an unreadable spend is an
      // unreadable verdict — and this is the fail-closed path.
      verdict = unreadable("agent spend is not decryptable by this gateway");
    } else {
      // Authorized settlements move the spend by exactly the amount. Refused
      // ones debit zero. Both transactions succeed and look identical on-chain,
      // which is the guarantee — the difference is only legible to an account
      // the ACL permits.
      verdict = verdictFromDecryption(BigInt(after) - BigInt(before) === amountWei);
    }

    return { hash, verdict, spentWei: after };
  }

  async flushEpoch(): Promise<Hex> {
    return this.send("flushEpoch", []);
  }

  // ---- stealth payouts -----------------------------------------------------
  //
  // The relayer hides the payer: every agent shares one sender. These close the
  // other half. A payout to a fixed address builds a public history of how often
  // and how much this operator is paid; a stealth address has never appeared
  // on-chain and only its recipient can link it to themselves.

  /** True when this gateway can publish a stealth payment. */
  get canAnnounceStealth(): boolean {
    return this.walletClient !== undefined && this.config.stealthAnnouncerAddress !== undefined;
  }

  /**
   * Publish a stealth payment so its recipient can find it.
   *
   * The recipient can only re-derive the address once they learn the sender's
   * ephemeral public key, and no private channel exists to hand it over — so it
   * goes in the open. That is safe: without the recipient's viewing private key
   * it identifies neither the payment nor who it was meant for.
   *
   * Announced by the shared relayer, so it leaks nothing about the payer either.
   */
  async announceStealthPayment(payment: {
    stealthAddress: Address;
    ephemeralPublicKey: Hex;
    viewTag: number;
  }): Promise<Hex> {
    const announcer = this.config.stealthAnnouncerAddress;
    if (!announcer) throw upstreamFailure("stealth", { reason: "no announcer configured" });
    if (!this.walletClient) throw upstreamFailure("stealth", { reason: "read-only gateway" });

    const hash = await this.walletClient.writeContract({
      address: announcer,
      abi: stealthAnnouncerAbi,
      functionName: "announce",
      args: [
        STEALTH_SCHEME_ID,
        payment.stealthAddress,
        payment.ephemeralPublicKey,
        // ERC-5564 metadata: the first byte is the view tag, which lets a
        // recipient reject ~255 of every 256 announcements with one hash rather
        // than an elliptic-curve operation.
        `0x${payment.viewTag.toString(16).padStart(2, "0")}` as Hex,
      ],
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw upstreamFailure("announce", { hash });
    return hash;
  }

  /**
   * Route a proven epoch aggregate to a stealth address.
   *
   * This is where money actually reaches the one-time address. {@link settle}
   * only debits the encrypted budget; the payout is per-epoch by design, because
   * a per-call transfer would republish exactly the timing the batch hides.
   *
   * Deliberately not exposed as an MCP tool. An agent able to drain the router
   * on demand would have a blast radius larger than the cap it was given.
   */
  async routeEpochToStealth(params: {
    epochId: number;
    tokenIn: Address;
    tokenOut: Address;
    poolFee: number;
    amountOutMinimum: bigint;
    deadline: bigint;
    stealthRecipient: Address;
  }): Promise<Hex> {
    const router = this.config.settlementRouterAddress;
    if (!router) throw upstreamFailure("stealth", { reason: "no settlement router configured" });
    if (!this.walletClient) throw upstreamFailure("stealth", { reason: "read-only gateway" });

    const hash = await this.walletClient.writeContract({
      address: router,
      abi: settlementRouterAbi,
      functionName: "routeEpochToStealth",
      args: [
        BigInt(params.epochId),
        params.tokenIn,
        params.tokenOut,
        params.poolFee,
        params.amountOutMinimum,
        params.deadline,
        params.stealthRecipient,
      ],
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw upstreamFailure("routeEpochToStealth", { hash });
    return hash;
  }
}
