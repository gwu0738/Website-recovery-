/**
 * Shared helpers used across games: payout math and a provably-fair shuffle.
 *
 * All payout formulas apply the house edge the same way:
 *   fairMultiplier = 1 / winProbability
 *   payout         = fairMultiplier * (1 - houseEdge)
 * so the expected return to the player is exactly (1 - houseEdge). This keeps
 * every game mathematically consistent and easy to verify.
 */

/** Round a multiplier down to 2 decimals (never pay more than earned). */
export function floor2(x: number): number {
  return Math.floor(x * 100) / 100;
}

/**
 * floor2 that first rounds away float noise in "hundredths" space, so an exact
 * value like 1.98 (stored as 197.99999… hundredths) isn't floored to 1.97.
 */
export function floor2Safe(x: number): number {
  return Math.floor(Math.round(x * 1e8) / 1e6) / 100;
}

/**
 * Pick `count` items one at a time from a pool: the i-th float chooses an index
 * among the items still remaining. Returns the picks in draw order. Needs
 * `count` floats. (Used for mine, tile and keno-number placement.)
 */
export function pickSequential<T>(pool: readonly T[], count: number, fs: number[]): T[] {
  const remaining = [...pool];
  const picks: T[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(fs[i] * remaining.length);
    picks.push(remaining.splice(idx, 1)[0]);
  }
  return picks;
}

/**
 * Fisher-Yates from the top where step i uses float i: swap position i with
 * floor(fs[i] * (i + 1)), for i = n-1 down to 1. Needs n floats (fs[0] unused).
 */
export function shuffleTopDown<T>(items: readonly T[], fs: number[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(fs[i] * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Payout multiplier for a given win probability and house edge. */
export function payoutFor(winProbability: number, houseEdge: number): number {
  if (winProbability <= 0) return 0;
  return floor2((1 / winProbability) * (1 - houseEdge));
}

/**
 * Fisher-Yates shuffle driven by a list of provably-fair floats.
 * Returns a permutation of [0, 1, ..., n-1]. Deterministic for the same floats.
 * Needs at least (n - 1) floats.
 */
export function shuffleIndices(n: number, fs: number[]): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const f = fs[n - 1 - i] ?? 0;
    const j = Math.floor(f * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Lamports paid for a stake at a multiplier: floored, but tolerant of float
 * noise so an exact product (e.g. 3 chips × 2.00) never loses a lamport to
 * 2.9999999…; the tolerance (one millionth of a lamport) can never overpay.
 */
export function payoutLamports(stakeLamports: number, multiplier: number): number {
  return Math.floor(stakeLamports * multiplier + 1e-6);
}
