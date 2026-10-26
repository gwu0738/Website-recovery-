/**
 * Limbo — a random multiplier is generated; the player picks a target multiplier
 * and wins (at that target) if the random one lands at or above it.
 *
 * The result comes from one float u in [0, 1): n = floor(u * 10^8) + 1, and
 * result = (10^8 / n) * (1 - houseEdge), at least 1, floored to 2dp. Then
 * P(result >= x) ~= (1 - houseEdge) / x, so a bet targeting x returns
 * (1 - houseEdge) on average. Crash uses the same formula for its bust point.
 */
import { HOUSE_EDGE } from "../config.ts";
import { floats } from "../fairness/engine.ts";
import { floor2Safe } from "./shared.ts";
import type { BetContext, GameResult } from "./types.ts";

/**
 * Shared result-multiplier formula for Limbo and Crash. One float u picks
 * n = floor(u * 10^8) + 1; result = (10^8 / n) * (1 - houseEdge), at least 1,
 * floored to 2dp. P(result >= x) ~= (1 - houseEdge) / x, so the edge is exact.
 */
const LIMBO_SPACE = 100_000_000;

export function resultMultiplier(u: number, houseEdge: number): number {
  const n = Math.floor(u * LIMBO_SPACE) + 1;
  return floor2Safe(Math.max((LIMBO_SPACE / n) * (1 - houseEdge), 1));
}

/** Largest possible result (n = 1). */
export const MAX_MULTIPLIER = resultMultiplier(0, HOUSE_EDGE);

export interface LimboBet {
  /** Target multiplier the player is aiming for (>= 1.01). */
  target: number;
}

export interface LimboOutcome {
  result: number;
  target: number;
}

export function playLimbo(
  ctx: BetContext,
  bet: LimboBet,
  houseEdge = HOUSE_EDGE,
): GameResult<LimboOutcome> {
  if (bet.target < 1.01) throw new Error("Limbo target must be at least 1.01");
  const [u] = floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, 1);
  const result = resultMultiplier(u, houseEdge);
  const win = result >= bet.target;
  return {
    game: "limbo",
    outcome: { result, target: bet.target },
    win,
    multiplier: win ? bet.target : 0,
    houseEdge,
  };
}
