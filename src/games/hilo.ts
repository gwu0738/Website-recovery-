/**
 * HiLo — a base card (rank 0..12) is drawn; the player bets whether the next
 * card is "higher or same" or "lower or same". The payout follows directly from
 * the probability given the base card, so it is exact.
 *
 *   P(higher or same) = (13 - base) / 13
 *   P(lower or same)  = (base + 1) / 13
 *   multiplier        = (1 - houseEdge) / P(chosen side)
 *
 * (A single round. The streak version — keep going on the revealed card — is a
 * front-end layer on top of repeated rounds.)
 */
import { HOUSE_EDGE } from "../config.ts";
import { floats } from "../fairness/engine.ts";
import { floor2 } from "./shared.ts";
import type { BetContext, GameResult } from "./types.ts";

export const RANKS = 13; // 0 = 2, ... 12 = Ace (ranks only; suit is cosmetic)

export type HiLoGuess = "higherOrSame" | "lowerOrSame";

export interface HiLoBet {
  guess: HiLoGuess;
}

export interface HiLoOutcome {
  base: number;
  next: number;
  guess: HiLoGuess;
}

export function playHiLo(
  ctx: BetContext,
  bet: HiLoBet,
  houseEdge = HOUSE_EDGE,
): GameResult<HiLoOutcome> {
  const [f0, f1] = floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, 2);
  const base = Math.floor(f0 * RANKS);
  const next = Math.floor(f1 * RANKS);

  const pHigher = (RANKS - base) / RANKS;
  const pLower = (base + 1) / RANKS;
  const win = bet.guess === "higherOrSame" ? next >= base : next <= base;
  const p = bet.guess === "higherOrSame" ? pHigher : pLower;
  const multiplier = win ? floor2((1 / p) * (1 - houseEdge)) : 0;

  return {
    game: "hilo",
    outcome: { base, next, guess: bet.guess },
    win,
    multiplier,
    houseEdge,
  };
}
