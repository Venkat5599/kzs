"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { RainbowKitProvider, darkTheme, getDefaultConfig, useConnectModal } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, useAccount, useChainId, useDisconnect, useSwitchChain } from "wagmi";
import { sepolia } from "wagmi/chains";

import "@rainbow-me/rainbowkit/styles.css";

/**
 * Wallet adapter — RainbowKit over wagmi.
 *
 * Replaces an adapter left over from the Casper era, which probed globals named
 * `SepoliaWalletProvider`/`SepoliaWallet` (Casper names that had been
 * find-replaced and so existed nowhere) and otherwise fabricated a `01…`
 * ed25519 key in Casper's format as the owner identity. Connecting a real
 * wallet was impossible; the prompt asked for a "Sepolia public key (01… hex)".
 *
 * RainbowKit brings the connector set (MetaMask, Rabby, Rainbow, Coinbase,
 * WalletConnect), the account/chain modals, and reconnection — none of which is
 * worth hand-rolling.
 *
 * The `useWallet()` shape is deliberately preserved so the five components that
 * consume it did not have to change. It is now a thin projection of wagmi
 * state rather than its own source of truth.
 */

/**
 * WalletConnect Cloud project id. Only the WalletConnect/mobile-QR path needs
 * it — injected wallets (MetaMask, Rabby, Brave) work without one, which is the
 * path the demo uses. Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID to enable the
 * rest. The placeholder keeps `getDefaultConfig` from throwing at import time,
 * which would take the whole dashboard down.
 */
const WALLETCONNECT_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "kairos_injected_only";

const wagmiConfig = getDefaultConfig({
  appName: "Kairos",
  projectId: WALLETCONNECT_PROJECT_ID,
  chains: [sepolia],
  ssr: true, // Next.js App Router renders this on the server first.
});

const queryClient = new QueryClient();

type WalletCtx = {
  address: string | null;
  /** Always null — kept for compatibility. The old adapter stored a fake key. */
  secret: string | null;
  /** True when a real wallet is connected. */
  real: boolean;
  connecting: boolean;
  chainId: number | null;
  /** Connected, but not on Sepolia. */
  wrongNetwork: boolean;
  connect: () => Promise<void>;
  /** Retained for compatibility; opens the same connect modal. */
  generate: () => Promise<void>;
  switchToSepolia: () => Promise<void>;
  disconnect: () => void;
};

const Ctx = createContext<WalletCtx>({
  address: null,
  secret: null,
  real: false,
  connecting: false,
  chainId: null,
  wrongNetwork: false,
  connect: async () => {},
  generate: async () => {},
  switchToSepolia: async () => {},
  disconnect: () => {},
});

/**
 * Projects wagmi + RainbowKit state onto the context the app already consumes.
 * Must sit inside the wagmi and RainbowKit providers, hence the split from
 * `WalletProvider`.
 */
function WalletBridge({ children }: { children: ReactNode }) {
  const { address, isConnected, isConnecting, isReconnecting } = useAccount();
  const chainId = useChainId();
  const { openConnectModal } = useConnectModal();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const connect = useCallback(async () => {
    openConnectModal?.();
  }, [openConnectModal]);

  const switchToSepolia = useCallback(async () => {
    switchChain({ chainId: sepolia.id });
  }, [switchChain]);

  const disconnect = useCallback(() => {
    wagmiDisconnect();
    // Retired keys from the pre-RainbowKit adapter. Left behind they would
    // resurrect a stale identity on the next load.
    localStorage.removeItem("kairos_owner");
    localStorage.removeItem("kairos_owner_real");
    localStorage.removeItem("kairos_owner_secret");
    localStorage.removeItem("kairos_session_token");
    localStorage.removeItem("kairos_session_id");
  }, [wagmiDisconnect]);

  const value = useMemo<WalletCtx>(
    () => ({
      address: address ?? null,
      secret: null,
      real: isConnected,
      connecting: isConnecting || isReconnecting,
      chainId: isConnected ? chainId : null,
      wrongNetwork: isConnected && chainId !== sepolia.id,
      connect,
      generate: connect,
      switchToSepolia,
      disconnect,
    }),
    [
      address,
      isConnected,
      isConnecting,
      isReconnecting,
      chainId,
      connect,
      switchToSepolia,
      disconnect,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            // Match the dashboard rather than shipping RainbowKit's default
            // blue, which belongs to no part of this brand.
            accentColor: "#a3e635",
            accentColorForeground: "#0b0c0e",
            borderRadius: "medium",
          })}
          initialChain={sepolia}
        >
          <WalletBridge>{children}</WalletBridge>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export const useWallet = () => useContext(Ctx);

/** RainbowKit's own button, for places that want the full account UI. */
export { ConnectButton } from "@rainbow-me/rainbowkit";
