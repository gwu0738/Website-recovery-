// =============================================================================
// Backend API client. Talks to the Vanta server (server/) for wallet sign-in,
// faucet, balance, and real (server-tracked) bets.
//
// The site runs in one of two modes, decided by API_BASE in config.js:
//   - "" (empty)  -> DEMO mode: bets run in-browser, no accounts (the preview).
//   - a URL       -> BACKEND mode: real sign-in, balances, faucet, server bets.
// =============================================================================
import { API_BASE } from "./config.js";

// Where the backend is. With API_BASE empty, the site looks for it at startup:
// same origin (nginx proxying /api/), then port 8787 on the same host.
let base = API_BASE || "";
let backend = false;
export const isBackend = () => backend;
export const backendBase = () => base;

export async function detectBackend() {
  if (typeof location === "undefined" || location.protocol === "file:") return false;
  const candidates = API_BASE ? [API_BASE] : [location.origin, `${location.protocol}//${location.hostname}:8787`];
  for (const c of candidates) {
    try {
      const res = await fetch(c + "/api/health", { signal: AbortSignal.timeout(2500) });
      if (res.ok && (await res.json()).ok) {
        base = c;
        backend = true;
        return true;
      }
    } catch { /* try the next one */ }
  }
  return false;
}

let token = null;
try {
  token = localStorage.getItem("vanta_token");
} catch {
  /* storage may be unavailable */
}

function setToken(t) {
  token = t;
  try {
    if (t) localStorage.setItem("vanta_token", t);
    else localStorage.removeItem("vanta_token");
  } catch {
    /* ignore */
  }
}

async function req(path, { method = "GET", body, auth = false } = {}) {
  const headers = {};
  if (body) headers["content-type"] = "application/json";
  if (auth && token) headers["authorization"] = `Bearer ${token}`;
  const res = await fetch(base + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status; // callers tell "signed out" (401) from "server unreachable"
    throw err;
  }
  return data;
}

// ---- base58 (for encoding the wallet signature) -----------------------------
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58Encode(bytes) {
  if (!bytes.length) return "";
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (let k = 0; k < bytes.length && bytes[k] === 0; k++) out += "1";
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

// ---- API surface ------------------------------------------------------------
export const api = {
  hasToken: () => !!token,
  clearToken: () => setToken(null),
  config: () => req("/api/config"),
  me: () => req("/api/me", { auth: true }),
  faucet: (proof) => req("/api/faucet", { method: "POST", auth: true, body: proof ?? {} }),
  faucetChallenge: () => req("/api/faucet/challenge", { auth: true }),
  betsRecent: () => req("/api/bets/recent"),
  betsMine: () => req("/api/bets/mine", { auth: true }),
  /** Unfinished Tower/Chicken games whose stake is still locked. */
  sessionsActive: () => req("/api/sessions/active", { auth: true }),
  /** Revoke this token server-side; the balance stays with the wallet. */
  logout: () => req("/api/auth/logout", { method: "POST", auth: true }),
  rotateSeed: () => req("/api/rotate-seed", { method: "POST", auth: true }),
  setClientSeed: (clientSeed) =>
    req("/api/client-seed", { method: "POST", auth: true, body: { clientSeed } }),
  wallet: () => req("/api/wallet", { auth: true }),
  depositConfirm: (signature) =>
    req("/api/deposit/confirm", { method: "POST", auth: true, body: { signature } }),
  withdraw: (lamports) => req("/api/withdraw", { method: "POST", auth: true, body: { lamports } }),
  bet: (game, bet, stake) =>
    req("/api/bet", { method: "POST", auth: true, body: { game, bet, stake } }),
  tower: {
    start: (difficulty, stake) =>
      req("/api/tower/start", { method: "POST", auth: true, body: { difficulty, stake } }),
    reveal: (sessionId, pick) =>
      req("/api/tower/reveal", { method: "POST", auth: true, body: { sessionId, pick } }),
    cashout: (sessionId) =>
      req("/api/tower/cashout", { method: "POST", auth: true, body: { sessionId } }),
  },
  mines: {
    start: (mines, stake) =>
      req("/api/mines/start", { method: "POST", auth: true, body: { mines, stake } }),
    reveal: (sessionId, tile) =>
      req("/api/mines/reveal", { method: "POST", auth: true, body: { sessionId, tile } }),
    cashout: (sessionId) =>
      req("/api/mines/cashout", { method: "POST", auth: true, body: { sessionId } }),
  },
  hilo: {
    start: (stake) => req("/api/hilo/start", { method: "POST", auth: true, body: { stake } }),
    guess: (sessionId, guess) =>
      req("/api/hilo/guess", { method: "POST", auth: true, body: { sessionId, guess } }),
    cashout: (sessionId) =>
      req("/api/hilo/cashout", { method: "POST", auth: true, body: { sessionId } }),
  },
  chicken: {
    start: (difficulty, stake) =>
      req("/api/chicken/start", { method: "POST", auth: true, body: { difficulty, stake } }),
    step: (sessionId) =>
      req("/api/chicken/step", { method: "POST", auth: true, body: { sessionId } }),
    cashout: (sessionId) =>
      req("/api/chicken/cashout", { method: "POST", auth: true, body: { sessionId } }),
  },

  /** Full wallet sign-in using the provider's signMessage. Returns account. */
  async signIn(provider, pubkey) {
    const { message } = await req(
      `/api/auth/challenge?pubkey=${encodeURIComponent(pubkey)}`,
    );
    const encoded = new TextEncoder().encode(message);
    const signed = await provider.signMessage(encoded, "utf8");
    const sigBytes = signed.signature ?? signed; // Phantom returns { signature }
    const signature = base58Encode(
      sigBytes instanceof Uint8Array ? sigBytes : new Uint8Array(sigBytes),
    );
    const out = await req("/api/auth/verify", {
      method: "POST",
      body: { pubkey, signature },
    });
    setToken(out.token);
    return out.account;
  },
};
