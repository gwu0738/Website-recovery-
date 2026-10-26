/**
 * Mines sessions on the persistent session framework (server/sessions.ts):
 * start debits the stake and fixes the mine layout from the committed seed;
 * each reveal is safe (multiplier climbs) or a mine (stake lost); cashout pays
 * stake x multiplier. Stakes survive a server restart and every money movement
 * is transactional. The layout never leaves the server until the game ends.
 */
import { floats } from "../src/fairness/engine.ts";
import { GRID_SIZE, minesMultiplier } from "../src/games/mines.ts";
import { pickSequential } from "../src/games/shared.ts";
import {
  SessionError,
  sessionAct,
  sessionCashout,
  sessionStart,
  type SessionGame,
} from "./sessions.ts";
import type { Account, SessionRow } from "./store.ts";

export { SessionError as MinesError };

interface MinesState {
  mines: number;
  minePositions: number[]; // hidden until the game ends
  revealed: number[]; // safe tiles revealed, in order
  hit: number | null; // the mine that ended the game, if any
}

const MINES: SessionGame<MinesState, number, number> = {
  name: "mines",
  validate(mines) {
    if (!Number.isInteger(mines) || mines < 1 || mines > 24) throw new SessionError("Mines count must be 1-24");
  },
  init(ctx, mines) {
    const fs = floats(ctx.serverSeed, ctx.clientSeed, ctx.nonce, mines);
    const tiles = Array.from({ length: GRID_SIZE }, (_, i) => i);
    return { mines, minePositions: pickSequential(tiles, mines, fs).sort((a, b) => a - b), revealed: [], hit: null };
  },
  act(s, tile) {
    if (!Number.isInteger(tile) || tile < 0 || tile >= GRID_SIZE) throw new SessionError("Invalid tile");
    if (s.revealed.includes(tile)) throw new SessionError("Tile already revealed");
    if (s.minePositions.includes(tile)) return { state: { ...s, hit: tile }, bust: true };
    return { state: { ...s, revealed: [...s.revealed, tile] }, bust: false };
  },
  progress: (s) => s.revealed.length,
  multiplier: (s) => minesMultiplier(s.mines, s.revealed.length),
  isComplete: (s) => s.revealed.length >= GRID_SIZE - s.mines,
};

export function minesStart(acct: Account, mines: number, stakeLamports: number) {
  const s = sessionStart(MINES, acct, mines, stakeLamports);
  return {
    sessionId: s.sessionId,
    mines,
    gridSize: GRID_SIZE,
    maxMultiplier: minesMultiplier(mines, GRID_SIZE - mines),
    currentMultiplier: 1,
    balanceLamports: s.balanceLamports,
    nonceUsed: s.nonceUsed,
    serverSeedHash: s.serverSeedHash,
    clientSeed: s.clientSeed,
  };
}

export function minesReveal(acct: Account, sessionId: string, tile: number) {
  const r = sessionAct(MINES, acct, sessionId, tile);
  if (r.bust) {
    return {
      safe: false,
      bust: true,
      tile,
      minePositions: r.state.minePositions, // game over: the layout can be shown
      revealed: r.state.revealed,
      multiplier: 0,
      balanceLamports: r.balanceLamports,
    };
  }
  return {
    safe: true,
    bust: false,
    tile,
    revealed: r.state.revealed,
    multiplier: r.multiplier,
    nextMultiplier: r.completed ? null : minesMultiplier(r.state.mines, r.state.revealed.length + 1),
    completed: r.completed,
    minePositions: r.completed ? r.state.minePositions : undefined,
    payoutLamports: r.payoutLamports,
    balanceLamports: r.balanceLamports,
  };
}

export function minesCashout(acct: Account, sessionId: string) {
  const r = sessionCashout(MINES, acct, sessionId, "Reveal at least one tile before cashing out");
  return {
    multiplier: r.multiplier,
    revealed: r.state.revealed,
    minePositions: r.state.minePositions,
    payoutLamports: r.payoutLamports,
    balanceLamports: r.balanceLamports,
  };
}

/** What the player may see of an unfinished game (never the mine layout). */
export function minesResumeView(row: SessionRow) {
  const s = row.state as MinesState;
  return {
    mines: s.mines,
    revealed: s.revealed,
    multiplier: minesMultiplier(s.mines, s.revealed.length),
    nextMultiplier: minesMultiplier(s.mines, s.revealed.length + 1),
    maxMultiplier: minesMultiplier(s.mines, GRID_SIZE - s.mines),
  };
}
