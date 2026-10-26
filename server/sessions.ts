/**
 * Generic, persistent game sessions — for games played in steps with the stake
 * locked (Tower, Chicken, and later Mines, HiLo, Blackjack...).
 *
 * Real-balance guarantees:
 *   - Sessions live in SQLite (`game_sessions`), not memory, so a server
 *     restart never loses a locked stake: the game simply resumes.
 *   - Every balance change happens inside ONE transaction together with the
 *     session update and the bet-history record.
 *   - The account is re-read inside the transaction before any debit/credit,
 *     so two simultaneous requests can't both spend the same balance.
 *   - A finished session can't be acted on or cashed out again (no double pay).
 *
 * A game plugs in by describing its seed-fixed state and how one action moves
 * it forward; the framework handles stakes, payouts, and records.
 */
import { randomBytes } from "node:crypto";
import type { BetContext } from "../src/games/types.ts";
import { payoutLamports as lamportsPaid } from "../src/games/shared.ts";
import { BET } from "./config.ts";
import {
  getSession,
  insertSession,
  recordBet,
  reloadAccount,
  save,
  tx,
  updateSession,
  type Account,
  type SessionRow,
} from "./store.ts";

export class SessionError extends Error {}

export interface SessionGame<State, Opts, Input> {
  name: string;
  /** Validate start options; throw SessionError on bad input. */
  validate(opts: Opts): void;
  /** Build the seed-fixed state (hidden from the player until the end). */
  init(ctx: BetContext, opts: Opts): State;
  /** Apply one player action. Returns the new state and whether it busted. */
  act(state: State, input: Input): { state: State; bust: boolean };
  /** How far the player has progressed (0 = nothing to cash out yet). */
  progress(state: State): number;
  /** Payout multiplier at the current progress. */
  multiplier(state: State): number;
  /** True when there's nothing left to play (auto cash-out). */
  isComplete(state: State): boolean;
}

function settle(
  acct: Account,
  row: SessionRow,
  state: unknown,
  multiplier: number,
): number {
  const payout = lamportsPaid(row.stakeLamports, multiplier);
  acct.balanceLamports += payout;
  save(acct);
  updateSession(row.id, state, false);
  recordBet({
    pubkey: acct.pubkey,
    game: row.game,
    stakeLamports: row.stakeLamports,
    payoutLamports: payout,
    multiplier,
    nonce: row.nonceUsed,
    serverSeedHash: row.serverSeedHash,
    clientSeed: row.clientSeed,
    outcome: state, // full state is safe to store once the game is over
  });
  return payout;
}

export function sessionStart<S, O, I>(
  game: SessionGame<S, O, I>,
  acct: Account,
  opts: O,
  stakeLamports: number,
) {
  game.validate(opts);
  if (!Number.isFinite(stakeLamports) || stakeLamports <= 0) throw new SessionError("Invalid stake");
  if (stakeLamports < BET.minStakeLamports || stakeLamports > BET.maxStakeLamports) {
    throw new SessionError("Stake out of allowed range");
  }

  return tx(() => {
    reloadAccount(acct);
    if (stakeLamports > acct.balanceLamports) throw new SessionError("Insufficient balance");

    const ctx = { serverSeed: acct.serverSeed, clientSeed: acct.clientSeed, nonce: acct.nonce };
    const state = game.init(ctx, opts);
    const nonceUsed = acct.nonce;

    acct.balanceLamports -= stakeLamports;
    acct.wagered += stakeLamports;
    acct.wagerRemaining = Math.max(0, acct.wagerRemaining - stakeLamports);
    acct.nonce += 1; // the commitment is consumed by this game
    save(acct);

    const id = randomBytes(16).toString("hex");
    insertSession({
      id,
      pubkey: acct.pubkey,
      game: game.name,
      stakeLamports,
      state,
      nonceUsed,
      serverSeedHash: acct.serverSeedHash,
      clientSeed: acct.clientSeed,
    });

    return {
      sessionId: id,
      state,
      nonceUsed,
      serverSeedHash: acct.serverSeedHash,
      clientSeed: acct.clientSeed,
      balanceLamports: acct.balanceLamports,
    };
  });
}

function ownedActive(acct: Account, game: string, sessionId: string): SessionRow {
  const row = typeof sessionId === "string" ? getSession(sessionId) : undefined;
  if (!row || row.pubkey !== acct.pubkey || row.game !== game) {
    throw new SessionError("Session not found");
  }
  if (!row.active) throw new SessionError("Session already finished");
  return row;
}

export function sessionAct<S, O, I>(
  game: SessionGame<S, O, I>,
  acct: Account,
  sessionId: string,
  input: I,
) {
  return tx(() => {
    reloadAccount(acct);
    const row = ownedActive(acct, game.name, sessionId);
    const prev = row.state as S;
    const { state, bust } = game.act(prev, input);

    if (bust) {
      settle(acct, row, state, 0); // stake already taken at start; records the loss
      return { prev, state, bust: true, completed: false, multiplier: 0, payoutLamports: 0, balanceLamports: acct.balanceLamports };
    }

    const multiplier = game.multiplier(state);
    if (game.isComplete(state)) {
      const payoutLamports = settle(acct, row, state, multiplier);
      return { prev, state, bust: false, completed: true, multiplier, payoutLamports, balanceLamports: acct.balanceLamports };
    }

    updateSession(row.id, state, true);
    return { prev, state, bust: false, completed: false, multiplier, payoutLamports: 0, balanceLamports: acct.balanceLamports };
  });
}

export function sessionCashout<S, O, I>(
  game: SessionGame<S, O, I>,
  acct: Account,
  sessionId: string,
  minProgressMessage = "Make at least one move before cashing out",
) {
  return tx(() => {
    reloadAccount(acct);
    const row = ownedActive(acct, game.name, sessionId);
    const state = row.state as S;
    if (game.progress(state) <= 0) throw new SessionError(minProgressMessage);
    const multiplier = game.multiplier(state);
    const payoutLamports = settle(acct, row, state, multiplier);
    return { state, multiplier, payoutLamports, balanceLamports: acct.balanceLamports };
  });
}
