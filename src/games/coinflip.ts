/**
 * Coinflip — the simplest game. One float: < 0.5 is heads, otherwise tails.
 * The player calls a side and wins a near-2x payout (2x minus the house edge).
 */
import { HOUSE_EDGE } from "../config.ts";
import { floats } from "../fairness/engine.ts";
import { payoutFor } from "./shared.ts";
import type { BetContext, GameResult } from "./types.ts";

export interface CoinflipBet {
  call: "heads" | "tails";
}

export interface CoinflipOutcome {
  flip: "heads" | "tails";
  call: "heads" | "tails";
}

export function playCoinflip(
  ctx: BetContext,
  bet: CoinflipBet,
  houseEdge = HOUSE_EDGE,
): GameResult<CoinflipOutcome> {
  const [u] = floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, 1);
  const flip: "heads" | "tails" = u < 0.5 ? "heads" : "tails";
  const win = flip === bet.call;
  return {
    game: "coinflip",
    outcome: { flip, call: bet.call },
    win,
    multiplier: win ? payoutFor(0.5, houseEdge) : 0,
    houseEdge,
  };
}
