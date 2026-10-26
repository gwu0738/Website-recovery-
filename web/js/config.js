// =============================================================================
// Vanta — front-end config. Everything you'd customize lives here.
// Change brand, socials, and the Solana cluster in ONE place.
// =============================================================================

export const BRAND = {
  name: "Vanta",
  tagline: "Provably fair. Verifiably yours.",
};

// Your social links. Put your real invite/handle URLs here.
// Leave a value empty ("") to hide that icon.
export const SOCIALS = {
  telegram: "https://t.me/your_channel",
  discord: "https://discord.gg/your_invite",
  twitter: "https://x.com/your_handle",
};

// House edge shown in the UI (must match the engine's edge, 0.01 = 1%).
export const HOUSE_EDGE = 0.01;

// -----------------------------------------------------------------------------
// Backend API base URL.
//   ""                         -> the site finds the server itself: same origin
//                                 (nginx proxying /api/), then port 8787 on the
//                                 same host. No server reachable -> balance is
//                                 kept in the browser and nothing is real.
//   "https://api.yoursite.com" -> always use this server.
// -----------------------------------------------------------------------------
export const API_BASE = "";

// Cloudflare Turnstile site key for the faucet captcha (optional). Leave empty
// to use the built-in proof-of-work gate instead. Pair with TURNSTILE_SECRET
// on the server.
export const TURNSTILE_SITE_KEY = "";

export const LAMPORTS_PER_SOL = 1_000_000_000;
export const toSol = (l) => (l / LAMPORTS_PER_SOL).toFixed(4);

// -----------------------------------------------------------------------------
// Solana cluster config.
//
//   "localnet" -> http://localhost:8899   (solana-test-validator, free SOL)
//   "devnet"   -> free devnet SOL
//   "mainnet"  -> REAL SOL. Only switch here once everything is tested.
//
// To use your own RPC node or a provider (Helius/QuickNode), paste its URL
// into the matching entry below instead of the public endpoint.
// -----------------------------------------------------------------------------
export const CLUSTER = "devnet"; // "localnet" | "devnet" | "mainnet"

export const RPC_ENDPOINTS = {
  localnet: "http://localhost:8899",
  devnet: "https://api.devnet.solana.com",
  // Public mainnet endpoint rate-limits hard (the 403 you hit). Replace with
  // your own node or a provider key before using mainnet for real.
  mainnet: "https://api.mainnet-beta.solana.com",
};

// In BACKEND mode the server reports which cluster it runs on; the browser
// follows it so deposits and balances always use the same network.
let activeCluster = CLUSTER;
export function setActiveCluster(cluster) {
  if (RPC_ENDPOINTS[cluster]) activeCluster = cluster;
}
export function getActiveCluster() {
  return activeCluster;
}

export function rpcUrl() {
  return RPC_ENDPOINTS[activeCluster] ?? RPC_ENDPOINTS.devnet;
}
