import { describe, expect, it } from "bun:test";
import { CHAINS, MAINNET_CHAIN, chainByCaip2, chainById, requireChain } from "../src/index.js";

describe("chain registry", () => {
  it("knows the chain the vault is live on", () => {
    expect(MAINNET_CHAIN.id).toBe(11155111);
    expect(MAINNET_CHAIN.noxCompute).toBe("0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF");
  });

  it("resolves by id and caip2 consistently", () => {
    const sepolia = chainById(11155111);
    expect(sepolia).not.toBeNull();
    expect(sepolia!.caip2).toBe("eip155:11155111");
    expect(chainByCaip2("eip155:11155111")).toEqual(sepolia);
    expect(chainById(421614)?.name).toBe("Arbitrum Sepolia");
  });

  it("returns null for unsupported chains", () => {
    expect(chainById(1)).toBeNull();
    expect(chainByCaip2("eip155:1")).toBeNull();
  });

  it("requireChain throws a descriptive error", () => {
    expect(() => requireChain(1)).toThrow(/Unsupported chain id 1/);
  });

  it("every entry is complete and unique", () => {
    const ids = new Set(CHAINS.map((c) => c.id));
    expect(ids.size).toBe(CHAINS.length);
    for (const c of CHAINS) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.rpcUrl).toMatch(/^https:\/\//);
      expect(c.explorer).toMatch(/^https:\/\//);
      expect(c.noxCompute).toMatch(/^0x[a-fA-F0-9]{40}$/);
    }
  });
});
