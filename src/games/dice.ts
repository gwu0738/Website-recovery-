/**
 * Dice — roll a number in [0.00, 100.00] and bet it lands under (or over) a target.
 *
 * One float decides everything. Win chance is just the size of the winning band,
 * so the payout follows directly from it.
 */
import { HOUSE_EDGE } from "../config.ts";
import { floats } from "../fairness/engine.ts";
import { payoutFor } from "./shared.ts";
import type { BetContext, GameResult } from "./types.ts";

export interface DiceBet {
  /** Target in (0, 100). */
  target: number;
  /** "under": win if roll < target. "over": win if roll > target. */
  direction: "under" | "over";
}

export interface DiceOutcome {
  roll: number;
  target: number;
  direction: "under" | "over";
}

export function playDice(
  ctx: BetContext,
  bet: DiceBet,
  houseEdge = HOUSE_EDGE,
): GameResult<DiceOutcome> {
  if (bet.target <= 0 || bet.target >= 100) {
    throw new Error("Dice target must be strictly between 0 and 100");
  }
  const [f] = floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, 1);
  const roll = Math.floor(f * 10001) / 100; // 0.00 .. 100.00

  const win = bet.direction === "under" ? roll < bet.target : roll > bet.target;
  const winChance =
    bet.direction === "under" ? bet.target / 100 : (100 - bet.target) / 100;
  const multiplier = win ? payoutFor(winChance, houseEdge) : 0;

  return {
    game: "dice",
    outcome: { roll, target: bet.target, direction: bet.direction },
    win,
    multiplier,
    houseEdge,
  };
}
