/**
 * Account store backed by SQLite (Node's built-in `node:sqlite` — no deps).
 *
 * Why SQLite over a JSON file: balances are real money state. SQLite gives
 * ACID durability — each write is an atomic transaction that either fully
 * lands on disk or not at all, so a crash mid-bet can never corrupt the file
 * or half-apply a wager. WAL mode makes writes durable and fast.
 *
 * Accounts are keyed by wallet pubkey, so a user who signs out and returns
 * weeks later gets the exact same balance back — the data lives here, not in
 * the login session.
 *
 * Still do automated backups (copy the .db file / `VACUUM INTO`) — a database
 * protects against corruption, backups protect against a dead disk.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateServerSeed, hashServerSeed, generateClientSeed } from "../src/fairness/engine.ts";

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VANTA_DATA_DIR ?? join(here, "data");
mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = join(DATA_DIR, "accounts.db");

const db = new DatabaseSync(DB_FILE);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA synchronous = NORMAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    pubkey           TEXT PRIMARY KEY,
    created_at       INTEGER NOT NULL,
    balance_lamports INTEGER NOT NULL DEFAULT 0,
    server_seed      TEXT NOT NULL,
    server_seed_hash TEXT NOT NULL,
    prev_server_seed TEXT,
    client_seed      TEXT NOT NULL,
    nonce            INTEGER NOT NULL DEFAULT 1,
    last_faucet_at   INTEGER,
    wagered          INTEGER NOT NULL DEFAULT 0
  )
`);
// Migration: wagering requirement (bonus credit must be wagered before withdraw).
{
  const cols = (db.prepare("PRAGMA table_info(accounts)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("wager_remaining")) {
    db.exec("ALTER TABLE accounts ADD COLUMN wager_remaining INTEGER NOT NULL DEFAULT 0");
  }
}

export interface Account {
  pubkey: string;
  createdAt: number;
  balanceLamports: number;
  serverSeed: string; // secret
  serverSeedHash: string; // public commitment
  prevServerSeed: string | null; // revealed on rotation, for verification
  clientSeed: string;
  nonce: number;
  lastFaucetAt: number | null;
  wagered: number; // lifetime wagered, lamports
  /** Bonus wagering still required before any withdrawal (lamports). */
  wagerRemaining: number;
}

type Row = {
  pubkey: string;
  created_at: number;
  balance_lamports: number;
  server_seed: string;
  server_seed_hash: string;
  prev_server_seed: string | null;
  client_seed: string;
  nonce: number;
  last_faucet_at: number | null;
  wagered: number;
  wager_remaining: number;
};

function rowToAccount(r: Row): Account {
  return {
    pubkey: r.pubkey,
    createdAt: r.created_at,
    balanceLamports: r.balance_lamports,
    serverSeed: r.server_seed,
    serverSeedHash: r.server_seed_hash,
    prevServerSeed: r.prev_server_seed,
    clientSeed: r.client_seed,
    nonce: r.nonce,
    lastFaucetAt: r.last_faucet_at,
    wagered: r.wagered,
    wagerRemaining: r.wager_remaining,
  };
}

const selectStmt = db.prepare("SELECT * FROM accounts WHERE pubkey = ?");
const insertStmt = db.prepare(`
  INSERT INTO accounts
    (pubkey, created_at, balance_lamports, server_seed, server_seed_hash,
     prev_server_seed, client_seed, nonce, last_faucet_at, wagered, wager_remaining)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateStmt = db.prepare(`
  UPDATE accounts SET
    balance_lamports = ?, server_seed = ?, server_seed_hash = ?,
    prev_server_seed = ?, client_seed = ?, nonce = ?, last_faucet_at = ?, wagered = ?,
    wager_remaining = ?
  WHERE pubkey = ?
`);

export function getAccount(pubkey: string): Account | undefined {
  const row = selectStmt.get(pubkey) as Row | undefined;
  return row ? rowToAccount(row) : undefined;
}

export function getOrCreateAccount(pubkey: string): Account {
  const existing = getAccount(pubkey);
  if (existing) return existing;
  const serverSeed = generateServerSeed();
  const acct: Account = {
    pubkey,
    createdAt: Date.now(),
    balanceLamports: 0,
    serverSeed,
    serverSeedHash: hashServerSeed(serverSeed),
    prevServerSeed: null,
    clientSeed: generateClientSeed(),
    nonce: 1,
    lastFaucetAt: null,
    wagered: 0,
    wagerRemaining: 0,
  };
  insertStmt.run(
    acct.pubkey,
    acct.createdAt,
    acct.balanceLamports,
    acct.serverSeed,
    acct.serverSeedHash,
    acct.prevServerSeed,
    acct.clientSeed,
    acct.nonce,
    acct.lastFaucetAt,
    acct.wagered,
    acct.wagerRemaining,
  );
  return acct;
}

/** Persist an account. One atomic UPDATE — durable on return. */
export function save(acct: Account) {
  updateStmt.run(
    acct.balanceLamports,
    acct.serverSeed,
    acct.serverSeedHash,
    acct.prevServerSeed,
    acct.clientSeed,
    acct.nonce,
    acct.lastFaucetAt,
    acct.wagered,
    acct.wagerRemaining,
    acct.pubkey,
  );
}

/** Public, safe-to-send view of an account (never leaks the live serverSeed). */
export function publicView(acct: Account) {
  return {
    pubkey: acct.pubkey,
    balanceLamports: acct.balanceLamports,
    serverSeedHash: acct.serverSeedHash,
    clientSeed: acct.clientSeed,
    nonce: acct.nonce,
    prevServerSeed: acct.prevServerSeed,
    lastFaucetAt: acct.lastFaucetAt,
    wagered: acct.wagered,
    wagerRemaining: acct.wagerRemaining,
  };
}

// ---------------------------------------------------------------------------
// Transactions, game sessions, and bet history.
//
// Every balance change and its matching session/bet record are written in ONE
// transaction, so they land together or not at all (no paid-but-not-closed or
// debited-but-no-session states, even if the process dies mid-request).
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS game_sessions (
    id               TEXT PRIMARY KEY,
    pubkey           TEXT NOT NULL,
    game             TEXT NOT NULL,
    stake_lamports   INTEGER NOT NULL,
    state            TEXT NOT NULL,
    nonce_used       INTEGER NOT NULL,
    server_seed_hash TEXT NOT NULL,
    client_seed      TEXT NOT NULL,
    active           INTEGER NOT NULL DEFAULT 1,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_owner ON game_sessions (pubkey, active);

  CREATE TABLE IF NOT EXISTS bets (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    pubkey           TEXT NOT NULL,
    game             TEXT NOT NULL,
    stake_lamports   INTEGER NOT NULL,
    payout_lamports  INTEGER NOT NULL,
    multiplier       REAL NOT NULL,
    nonce            INTEGER NOT NULL,
    server_seed_hash TEXT NOT NULL,
    client_seed      TEXT NOT NULL,
    outcome          TEXT NOT NULL,
    created_at       INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_bets_owner ON bets (pubkey, id);
`);

/** Run `fn` atomically. Any throw rolls back every write made inside it. */
export function tx<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export interface SessionRow {
  id: string;
  pubkey: string;
  game: string;
  stakeLamports: number;
  state: unknown;
  nonceUsed: number;
  serverSeedHash: string;
  clientSeed: string;
  active: boolean;
}

const insertSessionStmt = db.prepare(`
  INSERT INTO game_sessions
    (id, pubkey, game, stake_lamports, state, nonce_used, server_seed_hash, client_seed, active, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
`);
const selectSessionStmt = db.prepare("SELECT * FROM game_sessions WHERE id = ?");
const updateSessionStmt = db.prepare(
  "UPDATE game_sessions SET state = ?, active = ?, updated_at = ? WHERE id = ?",
);
const activeSessionsStmt = db.prepare(
  "SELECT * FROM game_sessions WHERE pubkey = ? AND active = 1 ORDER BY created_at",
);

function rowToSession(r: any): SessionRow {
  return {
    id: r.id,
    pubkey: r.pubkey,
    game: r.game,
    stakeLamports: r.stake_lamports,
    state: JSON.parse(r.state),
    nonceUsed: r.nonce_used,
    serverSeedHash: r.server_seed_hash,
    clientSeed: r.client_seed,
    active: r.active === 1,
  };
}

export function insertSession(s: Omit<SessionRow, "active">) {
  const now = Date.now();
  insertSessionStmt.run(
    s.id, s.pubkey, s.game, s.stakeLamports, JSON.stringify(s.state),
    s.nonceUsed, s.serverSeedHash, s.clientSeed, now, now,
  );
}

export function getSession(id: string): SessionRow | undefined {
  const r = selectSessionStmt.get(id);
  return r ? rowToSession(r) : undefined;
}

export function updateSession(id: string, state: unknown, active: boolean) {
  updateSessionStmt.run(JSON.stringify(state), active ? 1 : 0, Date.now(), id);
}

export function activeSessions(pubkey: string): SessionRow[] {
  return (activeSessionsStmt.all(pubkey) as any[]).map(rowToSession);
}

export interface BetRecord {
  pubkey: string;
  game: string;
  stakeLamports: number;
  payoutLamports: number;
  multiplier: number;
  nonce: number;
  serverSeedHash: string;
  clientSeed: string;
  outcome: unknown;
}

const insertBetStmt = db.prepare(`
  INSERT INTO bets
    (pubkey, game, stake_lamports, payout_lamports, multiplier, nonce, server_seed_hash, client_seed, outcome, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const myBetsStmt = db.prepare("SELECT * FROM bets WHERE pubkey = ? ORDER BY id DESC LIMIT ?");
const recentBetsStmt = db.prepare("SELECT * FROM bets ORDER BY id DESC LIMIT ?");

export function recordBet(b: BetRecord) {
  insertBetStmt.run(
    b.pubkey, b.game, b.stakeLamports, b.payoutLamports, b.multiplier,
    b.nonce, b.serverSeedHash, b.clientSeed, JSON.stringify(b.outcome), Date.now(),
  );
}

function rowToBet(r: any) {
  return {
    id: r.id,
    pubkey: r.pubkey,
    game: r.game,
    stakeLamports: r.stake_lamports,
    payoutLamports: r.payout_lamports,
    multiplier: r.multiplier,
    nonce: r.nonce,
    serverSeedHash: r.server_seed_hash,
    clientSeed: r.client_seed,
    outcome: JSON.parse(r.outcome),
    createdAt: r.created_at,
  };
}

export function myBets(pubkey: string, limit = 50) {
  return (myBetsStmt.all(pubkey, limit) as any[]).map(rowToBet);
}

export function recentBets(limit = 50) {
  return (recentBetsStmt.all(limit) as any[]).map(rowToBet);
}

/**
 * Re-read an account from the database into the given object. Call this inside
 * `tx()` before moving money, so a stale copy loaded earlier in the request
 * (before an await) can never be spent twice.
 */
export function reloadAccount(acct: Account): Account {
  const fresh = getAccount(acct.pubkey);
  if (!fresh) throw new Error("Account not found");
  return Object.assign(acct, fresh);
}

// ---------------------------------------------------------------------------
// Real SOL: deposits (keyed by transaction signature, so one transfer can only
// ever be credited once) and withdrawals (with a status trail).
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS deposits (
    signature  TEXT PRIMARY KEY,
    pubkey     TEXT NOT NULL,
    lamports   INTEGER NOT NULL,
    slot       INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS withdrawals (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    pubkey     TEXT NOT NULL,
    lamports   INTEGER NOT NULL,
    status     TEXT NOT NULL,      -- pending | sent | failed
    signature  TEXT,
    error      TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

const depositExistsStmt = db.prepare("SELECT 1 FROM deposits WHERE signature = ?");
const insertDepositStmt = db.prepare(
  "INSERT INTO deposits (signature, pubkey, lamports, slot, created_at) VALUES (?, ?, ?, ?, ?)",
);
const myDepositsStmt = db.prepare("SELECT * FROM deposits WHERE pubkey = ? ORDER BY created_at DESC LIMIT ?");

export function depositExists(signature: string): boolean {
  return !!depositExistsStmt.get(signature);
}

export function insertDeposit(signature: string, pubkey: string, lamports: number, slot: number | null) {
  insertDepositStmt.run(signature, pubkey, lamports, slot, Date.now());
}

export function myDeposits(pubkey: string, limit = 20) {
  return (myDepositsStmt.all(pubkey, limit) as any[]).map((r) => ({
    signature: r.signature, lamports: r.lamports, slot: r.slot, createdAt: r.created_at,
  }));
}

const insertWithdrawalStmt = db.prepare(
  "INSERT INTO withdrawals (pubkey, lamports, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)",
);
const updateWithdrawalStmt = db.prepare(
  "UPDATE withdrawals SET status = ?, signature = ?, error = ?, updated_at = ? WHERE id = ?",
);
const myWithdrawalsStmt = db.prepare("SELECT * FROM withdrawals WHERE pubkey = ? ORDER BY id DESC LIMIT ?");
const pendingWithdrawalsStmt = db.prepare("SELECT * FROM withdrawals WHERE status = 'pending'");

export function insertWithdrawal(pubkey: string, lamports: number): number {
  const now = Date.now();
  const r = insertWithdrawalStmt.run(pubkey, lamports, now, now);
  return Number(r.lastInsertRowid);
}

const setWithdrawalSigStmt = db.prepare("UPDATE withdrawals SET signature = ?, updated_at = ? WHERE id = ?");

/** Persist a withdrawal's signature the moment it's signed (before broadcast). */
export function recordWithdrawalSignature(id: number, signature: string) {
  setWithdrawalSigStmt.run(signature, Date.now(), id);
}

export function updateWithdrawal(id: number, status: "sent" | "failed", signature: string | null, error: string | null) {
  updateWithdrawalStmt.run(status, signature, error, Date.now(), id);
}

function rowToWithdrawal(r: any) {
  return {
    id: r.id, pubkey: r.pubkey, lamports: r.lamports, status: r.status,
    signature: r.signature, error: r.error, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function myWithdrawals(pubkey: string, limit = 20) {
  return (myWithdrawalsStmt.all(pubkey, limit) as any[]).map(rowToWithdrawal);
}

/** Withdrawals that were debited but never confirmed sent/failed (e.g. a crash mid-send). */
export function pendingWithdrawals() {
  return (pendingWithdrawalsStmt.all() as any[]).map(rowToWithdrawal);
}

// ---------------------------------------------------------------------------
// Sign-in sessions. Kept here (not in memory) so a server restart or redeploy
// never signs players out: their token keeps resolving to their wallet, and
// their balance is right there when the page reloads.
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS auth_sessions (
    token      TEXT PRIMARY KEY,
    pubkey     TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
`);
const insertAuthStmt = db.prepare(
  "INSERT INTO auth_sessions (token, pubkey, expires_at, created_at) VALUES (?, ?, ?, ?)",
);
const selectAuthStmt = db.prepare("SELECT pubkey, expires_at FROM auth_sessions WHERE token = ?");
const deleteAuthStmt = db.prepare("DELETE FROM auth_sessions WHERE token = ?");
const purgeAuthStmt = db.prepare("DELETE FROM auth_sessions WHERE expires_at < ?");

export function insertAuthSession(token: string, pubkey: string, expiresAt: number) {
  purgeAuthStmt.run(Date.now());
  insertAuthStmt.run(token, pubkey, expiresAt, Date.now());
}

export function getAuthSession(token: string): { pubkey: string; expiresAt: number } | undefined {
  const r = selectAuthStmt.get(token) as { pubkey: string; expires_at: number } | undefined;
  return r ? { pubkey: r.pubkey, expiresAt: r.expires_at } : undefined;
}

export function deleteAuthSession(token: string) {
  deleteAuthStmt.run(token);
}
