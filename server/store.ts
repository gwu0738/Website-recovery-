/**
 * Dead-simple JSON-file store for accounts. Fine for private testing.
 * For production, swap this module for SQLite/Postgres — the interface stays
 * the same. Writes are atomic (temp file + rename) so a crash can't corrupt it.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateServerSeed, hashServerSeed, generateClientSeed } from "../src/fairness/engine.ts";

const here = dirname(fileURLToPath(import.meta.url));
// VANTA_DATA_DIR lets tests (and alternate deployments) isolate their data.
const DATA_DIR = process.env.VANTA_DATA_DIR ?? join(here, "data");
const DB_FILE = join(DATA_DIR, "accounts.json");

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

type Db = { accounts: Record<string, Account> };

let db: Db = { accounts: {} };

function load() {
  if (existsSync(DB_FILE)) {
    try {
      db = JSON.parse(readFileSync(DB_FILE, "utf8"));
    } catch {
      db = { accounts: {} };
    }
  }
}
load();

function persist() {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(db, null, 2));
  renameSync(tmp, DB_FILE);
}

export function getAccount(pubkey: string): Account | undefined {
  return db.accounts[pubkey];
}

export function getOrCreateAccount(pubkey: string): Account {
  let acct = db.accounts[pubkey];
  if (!acct) {
    const serverSeed = generateServerSeed();
    acct = {
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
    db.accounts[pubkey] = acct;
    persist();
  }
  return acct;
}

export function save(acct: Account) {
  db.accounts[acct.pubkey] = acct;
  persist();
}

/** Public, safe-to-send view of an account (never leaks the live serverSeed). */
export function publicView(acct: Account) {
  return {
    pubkey: acct.pubkey,
    balanceLamports: acct.balanceLamports,
    serverSeedHash: acct.serverSeedHash,
    clientSeed: acct.clientSeed,
    nonce: acct.nonce,
    prevServerSeed: acct.prevServerSeed, // ok to reveal (already rotated out)
    lastFaucetAt: acct.lastFaucetAt,
    wagered: acct.wagered,
  };
}
