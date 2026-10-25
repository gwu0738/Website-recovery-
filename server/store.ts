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
  wagered: number; // lifetime wagered, lamports (wagering-requirement tracking)
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
  };
}

const selectStmt = db.prepare("SELECT * FROM accounts WHERE pubkey = ?");
const insertStmt = db.prepare(`
  INSERT INTO accounts
    (pubkey, created_at, balance_lamports, server_seed, server_seed_hash,
     prev_server_seed, client_seed, nonce, last_faucet_at, wagered)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateStmt = db.prepare(`
  UPDATE accounts SET
    balance_lamports = ?, server_seed = ?, server_seed_hash = ?,
    prev_server_seed = ?, client_seed = ?, nonce = ?, last_faucet_at = ?, wagered = ?
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
  };
}
