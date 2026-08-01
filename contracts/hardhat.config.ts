import type { HardhatUserConfig } from "hardhat/config";
import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";

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
    sources: "./src",
    tests: "./test",
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
