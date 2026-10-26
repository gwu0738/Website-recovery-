/**
 * Faucet anti-bot gate. Two options, chosen by configuration:
 *
 *   - Proof of work (default, no third party, costs nothing): the server hands
 *     out a random challenge; the browser must find a nonce whose
 *     sha256(`${challenge}:${nonce}`) starts with FAUCET_POW_BITS zero bits
 *     (~1 s of hashing in a browser at 18 bits). Each challenge is one-time
 *     and expires. A bot farm can still grind, but every claim costs CPU.
 *   - Cloudflare Turnstile (free, stronger): set TURNSTILE_SECRET on the
 *     server and TURNSTILE_SITE_KEY in web/js/config.js; the browser sends the
 *     widget token and we verify it with Cloudflare.
 *
 * FAUCET_POW_BITS=0 disables the gate (tests, private use).
 */
import { createHash, randomBytes } from "node:crypto";

export const POW_BITS = Number(process.env.FAUCET_POW_BITS ?? 18);
export const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || "";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const challenges = new Map<string, { challenge: string; expires: number }>();

export function faucetChallenge(pubkey: string) {
  const challenge = randomBytes(16).toString("hex");
  challenges.set(pubkey, { challenge, expires: Date.now() + CHALLENGE_TTL_MS });
  return { challenge, difficulty: POW_BITS, expiresAt: Date.now() + CHALLENGE_TTL_MS, turnstile: !!TURNSTILE_SECRET };
}

/** Number of leading zero bits in a hash. */
export function leadingZeroBits(hash: Uint8Array): number {
  let bits = 0;
  for (const byte of hash) {
    if (byte === 0) { bits += 8; continue; }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

export function powValid(challenge: string, nonce: string, bits: number): boolean {
  const h = createHash("sha256").update(`${challenge}:${nonce}`).digest();
  return leadingZeroBits(h) >= bits;
}

/**
 * Check a faucet claim's proof. Throws with a player-facing message when it
 * isn't acceptable. `body` is the POST body ({ nonce } or { captcha }).
 */
export async function verifyFaucetProof(pubkey: string, body: { nonce?: unknown; captcha?: unknown }, remoteIp?: string) {
  if (TURNSTILE_SECRET) {
    if (typeof body.captcha !== "string" || !body.captcha) throw new Error("Complete the captcha to claim the faucet");
    const form = new URLSearchParams({ secret: TURNSTILE_SECRET, response: body.captcha });
    if (remoteIp) form.set("remoteip", remoteIp);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const out = (await res.json()) as { success?: boolean };
    if (!out.success) throw new Error("Captcha check failed — try again");
    return;
  }
  if (POW_BITS <= 0) return;
  const c = challenges.get(pubkey);
  if (!c || c.expires < Date.now()) throw new Error("Faucet challenge expired — request a new one");
  if (typeof body.nonce !== "string" || body.nonce.length > 64 || !powValid(c.challenge, body.nonce, POW_BITS)) {
    throw new Error("Faucet proof rejected");
  }
  challenges.delete(pubkey); // one claim per challenge
}
