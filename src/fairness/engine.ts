/**
 * Provably-fair randomness engine (industry-standard "Stake-style" commit-reveal).
 *
 * The whole fairness guarantee rests on three inputs and one rule:
 *
 *   serverSeed  — a secret the house generates and commits to BEFORE any bet,
 *                 by publishing sha256(serverSeed). It is revealed later so the
 *                 player can confirm it was never changed.
 *   clientSeed  — chosen by the player, so the house cannot pick a serverSeed
 *                 that is "rigged" against this specific player.
 *   nonce       — a per-bet counter. Same seeds + different nonce = fresh result.
 *
 * Every random byte for a bet is:
 *
 *   HMAC_SHA256( key = serverSeed, msg = `${clientSeed}:${nonce}:${cursor}` )
 *
 * Each HMAC gives 32 bytes. We turn every 4 bytes into one float in [0, 1).
 * When a game needs more than 8 floats, `cursor` increments and we hash again.
 *
 * Because the output is a pure function of (serverSeed, clientSeed, nonce),
 * anyone can replay a bet and get the identical result — that is "provably fair".
 */
import { createHash, createHmac, randomBytes } from "node:crypto";

/** A committed seed pair, as the player sees it before betting. */
export interface SeedCommitment {
  /** sha256(serverSeed) — shown to the player up front. */
  serverSeedHash: string;
  /** The player-supplied seed. */
  clientSeed: string;
}

/** Generate a fresh random server seed (32 bytes, hex). */
export function generateServerSeed(): string {
  return randomBytes(32).toString("hex");
}

/** Generate a random client seed (used as a default until the player sets one). */
export function generateClientSeed(): string {
  return randomBytes(8).toString("hex");
}

/** The commitment hash the house publishes before play. */
export function hashServerSeed(serverSeed: string): string {
  return createHash("sha256").update(serverSeed).digest("hex");
}

/**
 * Infinite byte stream for a single bet, spanning HMAC blocks via `cursor`.
 * Yields one byte (0–255) at a time.
 */
function* byteStream(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): Generator<number, never, unknown> {
  let cursor = 0;
  while (true) {
    const digest = createHmac("sha256", serverSeed)
      .update(`${clientSeed}:${nonce}:${cursor}`)
      .digest();
    for (const b of digest) yield b;
    cursor++;
  }
}

/**
 * Turn the byte stream into floats in [0, 1).
 * Each float consumes 4 bytes: b0/256 + b1/256^2 + b2/256^3 + b3/256^4.
 * This is the canonical conversion and gives a uniform distribution.
 */
function* floatStream(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): Generator<number, never, unknown> {
  const bytes = byteStream(serverSeed, clientSeed, nonce);
  while (true) {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      value += (bytes.next().value as number) / Math.pow(256, i + 1);
    }
    yield value;
  }
}

/**
 * Draw `count` uniform floats in [0, 1) for a bet.
 * This is the single primitive every game is built on.
 */
export function floats(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  count: number,
): number[] {
  const stream = floatStream(serverSeed, clientSeed, nonce);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(stream.next().value as number);
  return out;
}

/**
 * Draw `count` raw bytes (0–255) for a bet — used by games that want integers
 * directly (e.g. shuffles) rather than floats.
 */
export function bytes(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  count: number,
): number[] {
  const stream = byteStream(serverSeed, clientSeed, nonce);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(stream.next().value as number);
  return out;
}
