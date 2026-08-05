import type { HardhatUserConfig } from "hardhat/config";
import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";

/**
 * Etherscan verification is off unless a key is present.
 *
 * Declaring `apiKey: ""` would leave verification nominally enabled and fail at
 * the API with an opaque error. Absent key, absent feature.
 */
const etherscanApiKey = process.env.ETHERSCAN_API_KEY?.trim();

/**
 * Nox's SDK library requires ^0.8.35 and resolves the NoxCompute proxy per chain
 * (31337 local, 421614 Arbitrum Sepolia, 11155111 Ethereum Sepolia). Deploying
 * anywhere else reverts inside the library, so those are the only networks worth
 * configuring.
 */
const config: HardhatUserConfig = {
  plugins: [hardhatToolboxViem],

  solidity: {
    version: "0.8.35",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // The vault touches many encrypted handles in one frame; via-IR keeps
      // settle() from running out of stack slots.
      viaIR: true,
    },
  },

  paths: {
    // `test/mocks` is named as a source rather than left to be picked up
    // implicitly, because Hardhat only emits the `artifacts.d.ts` that augments
    // `ArtifactMap` for paths listed here. Without it the mocks still compile,
    // but they stay untyped and every `deployContract("MockERC20")` in the tests
    // reads as `possibly undefined`.
    sources: ["./src", "./test/mocks"],
    tests: "./test",
  },

  verify: {
    etherscan: etherscanApiKey ? { apiKey: etherscanApiKey } : { enabled: false },
  },

  networks: {
    hardhat: {
      type: "edr-simulated",
      chainId: 31337,
    },
    sepolia: {
      type: "http",
      chainId: 11155111,
      url: process.env.CHAIN_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
    arbitrumSepolia: {
      type: "http",
      chainId: 421614,
      url: process.env.ARBITRUM_RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc",
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
  },
};

export default config;
