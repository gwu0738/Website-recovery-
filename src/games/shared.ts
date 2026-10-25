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
