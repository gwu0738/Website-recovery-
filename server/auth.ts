/**
 * Wallet sign-in (no passwords).
 *
 * Flow:
 *   1. Client asks for a challenge for its public key -> we return a one-time
 *      nonce and remember it.
 *   2. Client signs the nonce message with the wallet (Phantom `signMessage`)
 *      and sends back { pubkey, signature }.
 *   3. We verify the ed25519 signature against the pubkey. Valid => we know the
 *      client controls that wallet, so we issue a session token.
 *
 * ed25519 verification uses Node's built-in crypto (no tweetnacl needed).
 */
import { createPublicKey, verify, randomBytes } from "node:crypto";
import { base58Decode } from "./lib/base58.ts";
import { deleteAuthSession, getAuthSession, insertAuthSession } from "./store.ts";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Challenges are short-lived and only matter on the server that issued them,
// so memory is fine. Sessions are persisted (store.ts): a restart must never
// sign players out of their balance.
const challenges = new Map<string, { nonce: string; expires: number }>();

/** The exact message the wallet is asked to sign. */
export function challengeMessage(nonce: string): string {
  return `Sign in to Vanta\n\nThis signature proves you own this wallet.\nIt costs no SOL and authorizes nothing on-chain.\n\nNonce: ${nonce}`;
}

export function createChallenge(pubkey: string): string {
  const nonce = randomBytes(16).toString("hex");
  challenges.set(pubkey, { nonce, expires: Date.now() + CHALLENGE_TTL_MS });
  return challengeMessage(nonce);
}

/** Convert a 32-byte ed25519 public key into a Node KeyObject via JWK. */
function ed25519PublicKey(raw: Uint8Array) {
  if (raw.length !== 32) throw new Error("ed25519 public key must be 32 bytes");
  const x = Buffer.from(raw).toString("base64url");
  return createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x },
    format: "jwk",
  });
}

/**
 * Verify a signed challenge. `signatureB58` is base58 (Phantom's format);
 * returns a session token on success, or null on failure.
 */
export function verifySignature(pubkey: string, signatureB58: string): string | null {
  const challenge = challenges.get(pubkey);
  if (!challenge || challenge.expires < Date.now()) return null;

  let ok = false;
  try {
    const message = Buffer.from(challengeMessage(challenge.nonce), "utf8");
    const pubRaw = base58Decode(pubkey);
    const sig = base58Decode(signatureB58);
    ok = verify(null, message, ed25519PublicKey(pubRaw), Buffer.from(sig));
  } catch {
    ok = false;
  }
  if (!ok) return null;

  challenges.delete(pubkey); // one-time use
  const token = randomBytes(24).toString("hex");
  insertAuthSession(token, pubkey, Date.now() + SESSION_TTL_MS);
  return token;
}

/** Resolve a session token to its pubkey, or null if invalid/expired. */
export function pubkeyForToken(token: string | undefined): string | null {
  if (!token || typeof token !== "string" || token.length > 128) return null;
  const s = getAuthSession(token);
  if (!s || s.expiresAt < Date.now()) {
    if (s) deleteAuthSession(token);
    return null;
  }
  return s.pubkey;
}

/** Sign out: the token stops resolving everywhere, not just in this process. */
export function revokeToken(token: string | undefined) {
  if (token) deleteAuthSession(token);
}
