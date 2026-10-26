// =============================================================================
// Wallets: one small interface over every Solana wallet.
//
//   - Wallet Standard wallets (Phantom, Solflare, Backpack, Coinbase, …)
//     announce themselves to the page; we collect them, no SDK needed.
//   - Legacy injected wallets (window.solana) are the fallback.
//
// A connected wallet is exposed as a provider:
//   { id, name, icon, address, signMessage(bytes) -> Uint8Array,
//     signAndSendTransaction(tx) -> { signature }, disconnect(),
//     onAccountChanged(fn) }
// =============================================================================
import { base58Encode } from "./api.js";
import { getActiveCluster } from "./config.js";

const LAST_KEY = "vanta_wallet";
const standard = new Map(); // name -> wallet (Wallet Standard)
let current = null;

// ---- discovery ---------------------------------------------------------------
function register(wallet) {
  if (wallet?.chains?.some((c) => String(c).startsWith("solana:")) && wallet.features?.["standard:connect"]) {
    standard.set(wallet.name, wallet);
  }
}
if (typeof window !== "undefined") {
  window.addEventListener("wallet-standard:register-wallet", (e) => {
    try { e.detail(register); } catch { /* ignore a misbehaving wallet */ }
  });
  try {
    window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: { register } }));
  } catch { /* no CustomEvent in odd environments */ }
  window.navigator?.wallets?.get?.().forEach?.(register);
}

const legacy = () => (window.solana && typeof window.solana.connect === "function" ? window.solana : null);

/** Wallets available on this page: Wallet Standard ones first, then the injected one. */
export function listWallets() {
  const out = [...standard.values()].map((w) => ({ id: "std:" + w.name, name: w.name, icon: w.icon ?? null }));
  const inj = legacy();
  if (inj) {
    const name = inj.isPhantom ? "Phantom" : inj.isSolflare ? "Solflare" : inj.isBackpack ? "Backpack" : "Browser wallet";
    if (!out.some((w) => w.name === name)) out.push({ id: "injected", name, icon: null });
  }
  return out;
}

// ---- providers ---------------------------------------------------------------
function chainId() {
  const c = getActiveCluster();
  return c === "mainnet" ? "solana:mainnet" : c === "devnet" ? "solana:devnet" : "solana:localnet";
}

function wrapStandard(wallet, account) {
  const listeners = new Set();
  wallet.features["standard:events"]?.on?.("change", (props) => {
    if (!props.accounts) return;
    const next = props.accounts[0]?.address ?? null;
    if (next !== provider.address) {
      provider.address = next;
      listeners.forEach((fn) => fn(next));
    }
  });
  const provider = {
    id: "std:" + wallet.name,
    name: wallet.name,
    icon: wallet.icon ?? null,
    address: account.address,
    async signMessage(bytes) {
      const [out] = await wallet.features["solana:signMessage"].signMessage({ account, message: bytes });
      return out.signature;
    },
    async signAndSendTransaction(tx) {
      const transaction = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
      const [out] = await wallet.features["solana:signAndSendTransaction"].signAndSendTransaction({
        account, transaction, chain: chainId(),
      });
      return { signature: base58Encode(out.signature) };
    },
    async disconnect() {
      try { await wallet.features["standard:disconnect"]?.disconnect?.(); } catch { /* ignore */ }
    },
    onAccountChanged(fn) { listeners.add(fn); },
  };
  return provider;
}

function wrapLegacy(inj) {
  const listeners = new Set();
  inj.on?.("accountChanged", (pk) => {
    const next = pk ? pk.toString() : null;
    provider.address = next;
    listeners.forEach((fn) => fn(next));
  });
  const provider = {
    id: "injected",
    name: inj.isPhantom ? "Phantom" : inj.isSolflare ? "Solflare" : inj.isBackpack ? "Backpack" : "Browser wallet",
    icon: null,
    address: inj.publicKey?.toString() ?? null,
    async signMessage(bytes) {
      const signed = await inj.signMessage(bytes, "utf8");
      const sig = signed.signature ?? signed;
      return sig instanceof Uint8Array ? sig : new Uint8Array(sig);
    },
    async signAndSendTransaction(tx) {
      const { signature } = await inj.signAndSendTransaction(tx);
      return { signature };
    },
    async disconnect() {
      try { await inj.disconnect(); } catch { /* ignore */ }
    },
    onAccountChanged(fn) { listeners.add(fn); },
  };
  return provider;
}

/** Connect a wallet by id (from listWallets). Returns the provider. */
export async function connectWallet(id, { silent = false } = {}) {
  let provider;
  if (id === "injected") {
    const inj = legacy();
    if (!inj) throw new Error("No wallet found. Install Phantom, Solflare or Backpack.");
    const resp = await inj.connect(silent ? { onlyIfTrusted: true } : undefined);
    provider = wrapLegacy(inj);
    provider.address = (resp?.publicKey ?? inj.publicKey).toString();
  } else {
    const wallet = standard.get(id.replace(/^std:/, ""));
    if (!wallet) throw new Error("That wallet isn't available on this page.");
    const { accounts } = await wallet.features["standard:connect"].connect(silent ? { silent: true } : undefined);
    if (!accounts?.length) throw new Error("The wallet returned no account.");
    provider = wrapStandard(wallet, accounts[0]);
  }
  current = provider;
  try { localStorage.setItem(LAST_KEY, id); } catch { /* ignore */ }
  return provider;
}

/** Quietly reconnect the wallet used last time, if it still trusts this site. */
export async function restoreWallet() {
  let id = null;
  try { id = localStorage.getItem(LAST_KEY); } catch { /* ignore */ }
  if (!id) return null;
  try { return await connectWallet(id, { silent: true }); } catch { return null; }
}

export async function disconnectWallet() {
  if (current) await current.disconnect();
  current = null;
  try { localStorage.removeItem(LAST_KEY); } catch { /* ignore */ }
}

export const getProvider = () => current;
/** The wallet account currently active (null when none connected). */
export const activeAddress = () => current?.address ?? null;
