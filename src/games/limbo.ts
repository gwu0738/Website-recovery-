/**
 * Limbo — a random multiplier is generated; the player picks a target multiplier
 * and wins (at that target) if the random one lands at or above it.
 *
 * The result multiplier m is derived from one uniform float u in [0, 1):
 *
 *   m = (1 - houseEdge) / (1 - u)
 *
 * With u uniform, P(m >= x) = (1 - houseEdge) / x, so a bet cashing out at x has
 * expected return exactly (1 - houseEdge). This same formula powers Crash.
 */
import { HOUSE_EDGE } from "../config.ts";
import { floats } from "../fairness/engine.ts";
import { floor2 } from "./shared.ts";
import type { BetContext, GameResult } from "./types.ts";

export const MAX_MULTIPLIER = 1_000_000;

/** Shared result-multiplier formula for Limbo and Crash. */
export function resultMultiplier(u: number, houseEdge: number): number {
  if (u >= 1) return MAX_MULTIPLIER;
  const raw = (1 - houseEdge) / (1 - u);
  return Math.min(MAX_MULTIPLIER, Math.max(1, floor2(raw)));
}

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
