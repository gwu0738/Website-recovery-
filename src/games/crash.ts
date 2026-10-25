/**
 * Crash — a multiplier climbs from 1.00x and "busts" at a random point. The
 * player sets a cash-out target and wins it if the bust point reaches it.
 *
 * Mechanically this is Limbo with a timeline: the bust point uses the exact same
 * formula as Limbo's result multiplier. The rising-curve animation is pure UI;
 * the fairness and the math live entirely in the bust point computed here.
 */
import { HOUSE_EDGE } from "../config.ts";
import { floats } from "../fairness/engine.ts";
import { resultMultiplier } from "./limbo.ts";
import type { BetContext, GameResult } from "./types.ts";

export interface CrashBet {
  /** The multiplier at which the player has set an auto cash-out. */
  cashOut: number;
}

export interface CrashOutcome {
  bustAt: number;
  cashOut: number;
}

/** Compute just the bust point for a bet (useful for driving the UI curve). */
export function crashPoint(ctx: BetContext, houseEdge = HOUSE_EDGE): number {
  const [u] = floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, 1);
  return resultMultiplier(u, houseEdge);
}

export function playCrash(
  ctx: BetContext,
  bet: CrashBet,
  houseEdge = HOUSE_EDGE,
): GameResult<CrashOutcome> {
  if (bet.cashOut < 1.01) throw new Error("Crash cash-out must be at least 1.01");
  const bustAt = crashPoint(ctx, houseEdge);
  const win = bustAt >= bet.cashOut;
  return {
    game: "crash",
    outcome: { bustAt, cashOut: bet.cashOut },
    win,
    multiplier: win ? bet.cashOut : 0,
    houseEdge,
  };
}
