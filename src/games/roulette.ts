/**
 * Roulette — European single-zero wheel (pockets 0..36). One float selects the
 * pocket. A resolver handles the common bet types and their standard payouts.
 *
 * The single green 0 is the house edge: on a 37-pocket wheel paying "fair" odds
 * as if there were 36, the expected return works out to ~2.70% edge, the real
 * European-roulette number. No separate edge factor is applied here.
 */
import { floats } from "../fairness/engine.ts";
import type { BetContext, GameResult } from "./types.ts";

const RED = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export type RouletteBet =
  | { type: "straight"; number: number } // single number, pays 35:1
  | { type: "red" | "black" } // pays 1:1
  | { type: "odd" | "even" } // pays 1:1
  | { type: "low" | "high" } // 1-18 / 19-36, pays 1:1
  | { type: "dozen"; dozen: 1 | 2 | 3 } // pays 2:1
  | { type: "column"; column: 1 | 2 | 3 }; // pays 2:1

export interface RouletteOutcome {
  pocket: number;
  color: "red" | "black" | "green";
}

export function pocketColor(pocket: number): "red" | "black" | "green" {
  if (pocket === 0) return "green";
  return RED.has(pocket) ? "red" : "black";
}

/** Net payout multiplier (total returned per unit staked) if the bet wins. */
function payoutMultiplier(bet: RouletteBet): number {
  switch (bet.type) {
    case "straight":
      return 36; // 35:1 win + original stake
    case "dozen":
    case "column":
      return 3; // 2:1 + stake
    default:
      return 2; // 1:1 + stake
  }
}

function betWins(bet: RouletteBet, pocket: number): boolean {
  const color = pocketColor(pocket);
  switch (bet.type) {
    case "straight":
      return pocket === bet.number;
    case "red":
      return color === "red";
    case "black":
      return color === "black";
    case "odd":
      return pocket !== 0 && pocket % 2 === 1;
    case "even":
      return pocket !== 0 && pocket % 2 === 0;
    case "low":
      return pocket >= 1 && pocket <= 18;
    case "high":
      return pocket >= 19 && pocket <= 36;
    case "dozen":
      return pocket >= 1 && pocket <= 36 &&
        Math.ceil(pocket / 12) === bet.dozen;
    case "column":
      return pocket !== 0 && pocket % 3 === (bet.column % 3);
  }
}

export function playRoulette(
  ctx: BetContext,
  bet: RouletteBet,
): GameResult<RouletteOutcome> {
  const [u] = floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, 1);
  const pocket = Math.floor(u * 37); // 0..36
  const win = betWins(bet, pocket);
  return {
    game: "roulette",
    outcome: { pocket, color: pocketColor(pocket) },
    win,
    multiplier: win ? payoutMultiplier(bet) : 0,
    houseEdge: 1 / 37, // structural single-zero edge
  };
}
