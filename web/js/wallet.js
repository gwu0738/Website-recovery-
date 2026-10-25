// =============================================================================
// Phantom wallet connect — reads YOUR OWN wallet + balance on the configured
// cluster. Connecting a wallet and reading a balance is non-custodial and safe
// on any cluster, including mainnet.
//
// @solana/web3.js is loaded from a CDN at runtime (in the visitor's browser),
// so there's no build step. Swap the cluster/RPC in config.js.
//
// NOTE: sending real SOL (deposits/bets) is intentionally NOT wired here yet.
// Build and test that flow on localnet/devnet first — see js/README notes.
// =============================================================================
import { CLUSTER, rpcUrl } from "./config.js";

let web3 = null;
async function web3js() {
  if (!web3) {
    web3 = await import("https://esm.sh/@solana/web3.js@1.95.3");
  }
  return web3;
}

export function getProvider() {
  const p = window?.solana;
  if (p?.isPhantom) return p;
  return null;
}

export async function connect() {
  const provider = getProvider();
  if (!provider) {
    throw new Error("Phantom not found. Install it from phantom.app");
  }
  const resp = await provider.connect();
  return resp.publicKey.toString();
}

export async function disconnect() {
  const provider = getProvider();
  if (provider) await provider.disconnect();
}

export async function getBalanceSol(address) {
  const { Connection, PublicKey, LAMPORTS_PER_SOL } = await web3js();
  const conn = new Connection(rpcUrl(), "confirmed");
  const lamports = await conn.getBalance(new PublicKey(address));
  return lamports / LAMPORTS_PER_SOL;
}

export function clusterLabel() {
  return CLUSTER;
}
