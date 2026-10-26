/**
 * Tower game sessions — Tower (like Mines/Chicken) is played one reveal at a
 * time with the stake locked, so it needs server-side state, unlike the
 * single-shot bet API.
 *
 * Flow:
 *   start   -> debit stake, fix the trap layout from the account's committed
 *              seed (nonce consumed), open a session.
 *   reveal  -> check the picked tile against the current row's traps. Safe =
 *              climb + higher multiplier; trap = bust, session ends.
 *   cashout -> pay stake * current multiplier, session ends.
 *
 * Provably fair: the full layout is fixed at start by (serverSeed, clientSeed,
 * nonceUsed). After the game, the player replays `towerLayout` with the revealed
 * serverSeed to confirm the traps were never moved.
 *
 * NOTE: sessions are in-memory, so a server restart loses in-progress games (and
 * their locked stake). Fine for test credit; persist these before real money.
 */
import { randomBytes } from "node:crypto";
import {
  towerLayout,
  towerMultiplier,
  towerMaxMultiplier,
  TOWER_COLS,
  TOWER_ROWS,
  TOWER_TRAPS,
  type TowerDifficulty,
} from "../src/games/tower.ts";
import { BET } from "./config.ts";
import { save, type Account } from "./store.ts";

interface TowerSession {
  id: string;
  pubkey: string;
  difficulty: TowerDifficulty;
  stakeLamports: number;
  layout: number[][];
  rowsClimbed: number;
  active: boolean;
  nonceUsed: number;
  serverSeedHash: string;
  clientSeed: string;
}

const sessions = new Map<string, TowerSession>();

export class TowerError extends Error {}

export function towerStart(acct: Account, difficulty: TowerDifficulty, stakeLamports: number) {
  if (TOWER_TRAPS[difficulty] === undefined) throw new TowerError("Unknown difficulty");
  if (!Number.isFinite(stakeLamports) || stakeLamports <= 0) throw new TowerError("Invalid stake");
  if (stakeLamports < BET.minStakeLamports || stakeLamports > BET.maxStakeLamports) {
    throw new TowerError("Stake out of allowed range");
  }
  if (stakeLamports > acct.balanceLamports) throw new TowerError("Insufficient balance");

  const ctx = { serverSeed: acct.serverSeed, clientSeed: acct.clientSeed, nonce: acct.nonce };
  const layout = towerLayout(ctx, difficulty);

  // Debit stake, consume the commitment (advance nonce).
  acct.balanceLamports -= stakeLamports;
  acct.wagered += stakeLamports;
  const nonceUsed = acct.nonce;
  acct.nonce += 1;
  save(acct);

  const id = randomBytes(16).toString("hex");
  sessions.set(id, {
    id,
    pubkey: acct.pubkey,
    difficulty,
    stakeLamports,
    layout,
    rowsClimbed: 0,
    active: true,
    nonceUsed,
    serverSeedHash: acct.serverSeedHash,
    clientSeed: acct.clientSeed,
  });

  return {
    sessionId: id,
    difficulty,
    cols: TOWER_COLS,
    rows: TOWER_ROWS,
    traps: TOWER_TRAPS[difficulty],
    maxMultiplier: towerMaxMultiplier(difficulty),
    currentMultiplier: 1,
    balanceLamports: acct.balanceLamports,
    // commitment info for later verification
    nonceUsed,
    serverSeedHash: acct.serverSeedHash,
    clientSeed: acct.clientSeed,
  };
}

function owned(acct: Account, sessionId: string): TowerSession {
  const s = sessions.get(sessionId);
  if (!s || s.pubkey !== acct.pubkey) throw new TowerError("Session not found");
  if (!s.active) throw new TowerError("Session already finished");
  return s;
}

export function towerReveal(acct: Account, sessionId: string, pick: number) {
  const s = owned(acct, sessionId);
  if (pick < 0 || pick >= TOWER_COLS) throw new TowerError("Invalid tile");

  const rowTraps = s.layout[s.rowsClimbed];
  const hitTrap = rowTraps.includes(pick);

  if (hitTrap) {
    s.active = false;
    return {
      safe: false,
      bust: true,
      row: s.rowsClimbed,
      pick,
      rowTraps,
      multiplier: 0,
      rowsClimbed: s.rowsClimbed,
      balanceLamports: acct.balanceLamports,
    };
  }

  s.rowsClimbed += 1;
  const multiplier = towerMultiplier(s.difficulty, s.rowsClimbed);
  const completed = s.rowsClimbed >= TOWER_ROWS;

  let payoutLamports = 0;
  if (completed) {
    payoutLamports = Math.floor(s.stakeLamports * multiplier);
    acct.balanceLamports += payoutLamports;
    s.active = false;
    save(acct);
  }

  return {
    safe: true,
    bust: false,
    row: s.rowsClimbed - 1,
    pick,
    rowTraps, // traps for the row just cleared (past rows only — no leak)
    multiplier,
    rowsClimbed: s.rowsClimbed,
    completed,
    payoutLamports,
    balanceLamports: acct.balanceLamports,
  };
}

export function towerCashout(acct: Account, sessionId: string) {
  const s = owned(acct, sessionId);
  if (s.rowsClimbed <= 0) throw new TowerError("Climb at least one row before cashing out");
  const multiplier = towerMultiplier(s.difficulty, s.rowsClimbed);
  const payoutLamports = Math.floor(s.stakeLamports * multiplier);
  acct.balanceLamports += payoutLamports;
  s.active = false;
  save(acct);
  return {
    multiplier,
    rowsClimbed: s.rowsClimbed,
    payoutLamports,
    balanceLamports: acct.balanceLamports,
  };
}
