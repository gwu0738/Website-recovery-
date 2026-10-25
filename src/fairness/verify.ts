/**
 * Standalone verifier — this is the code you publish so players can check any
 * bet themselves. It does two independent things:
 *
 *   1. Confirms the revealed serverSeed matches the commitment the house showed
 *      BEFORE betting (sha256(serverSeed) === serverSeedHash). This proves the
 *      house didn't swap seeds after seeing the wager.
 *
 *   2. Replays the exact game with the revealed seeds and nonce, so the player
 *      can confirm the outcome they got is the one the math produces.
 *
 * Because every game is a pure function of (serverSeed, clientSeed, nonce) plus
 * the player's own bet parameters, step 2 reproduces the result bit-for-bit.
 */
import { hashServerSeed } from "./engine.ts";
import { playCoinflip, type CoinflipBet } from "../games/coinflip.ts";
import { playCrash, type CrashBet } from "../games/crash.ts";
import { playDice, type DiceBet } from "../games/dice.ts";
import { playLimbo, type LimboBet } from "../games/limbo.ts";
import { playMines, type MinesBet } from "../games/mines.ts";
import { playPlinko, type PlinkoBet } from "../games/plinko.ts";
import { playRoulette, type RouletteBet } from "../games/roulette.ts";
import { playWheel, type WheelBet } from "../games/wheel.ts";
import { playTower, type TowerBet } from "../games/tower.ts";
import { playHiLo, type HiLoBet } from "../games/hilo.ts";
import { playChicken, type ChickenBet } from "../games/chicken.ts";
import { playDarts, type DartsBet } from "../games/darts.ts";
import { playSnakes } from "../games/snakes.ts";
import { playKeno, type KenoBet } from "../games/keno.ts";
import type { BetContext, GameResult } from "../games/types.ts";

/** Check a revealed server seed against the commitment shown before play. */
export function verifyCommitment(
  serverSeed: string,
  serverSeedHash: string,
): boolean {
  return hashServerSeed(serverSeed) === serverSeedHash;
}

export type AnyBet =
  | { game: "dice"; bet: DiceBet }
  | { game: "limbo"; bet: LimboBet }
  | { game: "crash"; bet: CrashBet }
  | { game: "mines"; bet: MinesBet }
  | { game: "plinko"; bet: PlinkoBet }
  | { game: "roulette"; bet: RouletteBet }
  | { game: "wheel"; bet: WheelBet }
  | { game: "coinflip"; bet: CoinflipBet }
  | { game: "tower"; bet: TowerBet }
  | { game: "hilo"; bet: HiLoBet }
  | { game: "chicken"; bet: ChickenBet }
  | { game: "darts"; bet: DartsBet }
  | { game: "snakes"; bet: Record<string, never> }
  | { game: "keno"; bet: KenoBet };

/** Replay a bet from its fairness inputs. Returns the recomputed result. */
export function replay(ctx: BetContext, spec: AnyBet): GameResult {
  switch (spec.game) {
    case "dice":
      return playDice(ctx, spec.bet);
    case "limbo":
      return playLimbo(ctx, spec.bet);
    case "crash":
      return playCrash(ctx, spec.bet);
    case "mines":
      return playMines(ctx, spec.bet);
    case "plinko":
      return playPlinko(ctx, spec.bet);
    case "roulette":
      return playRoulette(ctx, spec.bet);
    case "wheel":
      return playWheel(ctx, spec.bet);
    case "coinflip":
      return playCoinflip(ctx, spec.bet);
    case "tower":
      return playTower(ctx, spec.bet);
    case "hilo":
      return playHiLo(ctx, spec.bet);
    case "chicken":
      return playChicken(ctx, spec.bet);
    case "darts":
      return playDarts(ctx, spec.bet);
    case "snakes":
      return playSnakes(ctx);
    case "keno":
      return playKeno(ctx, spec.bet);
  }
}

export interface VerificationReport {
  commitmentValid: boolean;
  result: GameResult;
}

/** Full verification: commitment check + replay in one call. */
export function verify(
  ctx: BetContext,
  serverSeedHash: string,
  spec: AnyBet,
): VerificationReport {
  return {
    commitmentValid: verifyCommitment(ctx.serverSeed, serverSeedHash),
    result: replay(ctx, spec),
  };
}
