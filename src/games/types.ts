/**
 * Common types shared by every game.
 *
 * A game is a pure function of the fairness inputs plus the player's chosen bet
 * parameters. Nothing random happens outside the engine, which is what makes
 * every outcome reproducible and verifiable.
 */

/** The fairness inputs that identify a single bet. */
export interface BetContext {
  serverSeed: string;
  clientSeed: string;
  nonce: number;
}

/** The outcome of a single bet. */
export interface GameResult<TOutcome = unknown> {
  game: string;
  /** Game-specific outcome detail (the roll, the grid, the crash point, ...). */
  outcome: TOutcome;
  /** True if the player's bet won. */
  win: boolean;
  /** Payout multiplier applied to the stake (0 on a loss). */
  multiplier: number;
  /** House edge used, as a fraction. */
  houseEdge: number;
}
