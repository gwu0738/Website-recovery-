// =============================================================================
// Phantom wallet + Solana in the browser.
//
// - connect/disconnect the player's own wallet (non-custodial)
// - read a wallet's SOL balance
// - send a deposit: a plain SOL transfer to the house address, signed and sent
//   by Phantom; the server then verifies it on-chain before crediting anything
//
// @solana/web3.js is loaded on demand as its prebuilt browser bundle from
// jsdelivr (version pinned to match the server). The RPC URL comes from the
// server's reported cluster, so the browser always talks to the same network.
// =============================================================================
import { getActiveCluster, rpcUrl } from "./config.js";

export const WEB3_BUNDLE_URL =
  "https://cdn.jsdelivr.net/npm/@solana/web3.js@1.95.3/lib/index.iife.min.js";

// web3.js's browser bundle encodes amounts with a global `Buffer`, which
// browsers don't have — without this, building any transfer throws
// "Buffer is not defined" (in Phantom too, since it serializes our tx).
export const BUFFER_POLYFILL_URL = "https://cdn.jsdelivr.net/npm/buffer@6.0.3/+esm";

let web3Promise = null;
export function loadWeb3() {
  if (window.solanaWeb3 && window.Buffer) return Promise.resolve(window.solanaWeb3);
  web3Promise ??= (async () => {
    if (!window.Buffer) window.Buffer = (await import(BUFFER_POLYFILL_URL)).Buffer;
    if (window.solanaWeb3) return window.solanaWeb3;
    return injectWeb3Bundle();
  })().catch((e) => {
    web3Promise = null;
    throw e;
  });
  return web3Promise;
}

function injectWeb3Bundle() {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = WEB3_BUNDLE_URL;
    s.onload = () => (window.solanaWeb3 ? resolve(window.solanaWeb3) : reject(new Error("Solana library failed to load")));
    s.onerror = () => reject(new Error("Couldn't load the Solana library"));
    document.head.appendChild(s);
  });
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

export async function getBalanceSol(address, rpc = rpcUrl()) {
  const { Connection, PublicKey, LAMPORTS_PER_SOL } = await loadWeb3();
  const conn = new Connection(rpc, "confirmed");
  const lamports = await conn.getBalance(new PublicKey(address));
  return lamports / LAMPORTS_PER_SOL;
}

/**
 * Deposit: transfer `lamports` from the player's wallet to the house address.
 * Phantom signs and sends; we wait for confirmation and return the signature
 * for the server to verify and credit.
 */
export async function sendDeposit(provider, fromAddress, houseAddress, lamports, rpc = rpcUrl()) {
  const { Connection, PublicKey, SystemProgram, Transaction } = await loadWeb3();
  const conn = new Connection(rpc, "confirmed");
  const from = new PublicKey(fromAddress);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: from, blockhash, lastValidBlockHeight }).add(
    SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(houseAddress), lamports }),
  );
  const { signature } = await provider.signAndSendTransaction(tx);
  const res = await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  if (res.value.err) throw new Error("Deposit transaction failed on-chain");
  return signature;
}

/** Block-explorer link for a transaction on the given cluster. */
export function explorerTxUrl(signature, cluster = getActiveCluster(), rpc = rpcUrl()) {
  const q =
    cluster === "mainnet"
      ? ""
      : cluster === "devnet"
        ? "?cluster=devnet"
        : `?cluster=custom&customUrl=${encodeURIComponent(rpc)}`;
  return `https://explorer.solana.com/tx/${signature}${q}`;
}

export function clusterLabel() {
  return getActiveCluster();
}
