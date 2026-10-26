# Vanta backend

Custodial backend for accounts, balances, faucet, and server-side betting.
No framework, no dependencies — Node 22+ built-ins only.

```bash
npm run server      # starts on http://localhost:8787
```

## Status

- **Phase 1 (done):** wallet sign-in, balances, faucet (free test credit), and
  betting on all 8 games. **Everything runs on test credit — no real SOL.** Fully
  testable: `npm test` includes end-to-end backend tests.
- **Phase 2 (next):** real SOL deposits + withdrawals against a house hot wallet,
  cluster-configurable (localnet / devnet / mainnet).

## How sign-in works (no passwords)

1. `GET /api/auth/challenge?pubkey=<base58>` → returns a message to sign.
2. Wallet signs it (Phantom `signMessage`) — proves wallet ownership, costs no
   SOL, authorizes nothing on-chain.
3. `POST /api/auth/verify { pubkey, signature }` → server verifies the ed25519
   signature and returns a session `token`.
4. Send `Authorization: Bearer <token>` on later requests.

## API

| Method & path | Auth | Purpose |
|---------------|------|---------|
| `GET /api/health` | – | liveness |
| `GET /api/config` | – | house edge, stake limits, faucet, game list |
| `GET /api/auth/challenge?pubkey=` | – | get message to sign |
| `POST /api/auth/verify` | – | exchange signature for a token |
| `GET /api/me` | ✓ | account view (balance, commitment, nonce) |
| `POST /api/faucet` | ✓ | claim free test credit (cooldown enforced) |
| `POST /api/client-seed` | ✓ | set your own client seed |
| `POST /api/rotate-seed` | ✓ | reveal old server seed, commit a new one |
| `POST /api/bet` | ✓ | `{ game, bet, stake }` → result + new balance |
| `POST /api/auth/logout` | ✓ | revoke this token everywhere (balance stays with the wallet) |
| `GET /api/sessions/active` | ✓ | unfinished Tower/Chicken games (locked stakes) + public progress, to resume |
| `GET /api/wallet` | ✓ | house address, balance, wagering left, deposit/withdrawal history |
| `POST /api/deposit/confirm` | ✓ | `{ signature }` → verify on-chain, credit once |
| `POST /api/withdraw` | ✓ | `{ lamports }` → pay out from the house wallet |

Roulette takes either one bet (`{ type: "red" }`, `{ type: "straight", number: 17 }`, …)
or a whole table: `{ type: "multi", bets: [{ bet, weight }] }` where each `weight` is
that chip's lamports and `stake` is their sum — one spin, one nonce, each chip paid
at its own odds.

The account view never exposes the live server seed — only its hash
(the commitment). Rotating the seed reveals the previous one so players can
verify their past bets with the shared verifier (`src/fairness/verify.ts`).

## Data & persistence

Accounts **and sign-in sessions** live in a **SQLite database** at `server/data/accounts.db` (gitignored),
via Node's built-in `node:sqlite` — no dependency. Each account is keyed by wallet
pubkey, so balances persist across logins and restarts: a user who signs out and
returns weeks later gets the same balance back (the data lives here, not in the
session). Writes are atomic ACID transactions in WAL mode, so a crash mid-bet
can't corrupt the file or half-apply a wager.

Because sessions are in the database too, restarting or redeploying the server
never signs players out: the same token keeps resolving to the same wallet.
Withdrawals interrupted mid-send are reconciled at startup (refunded when they
certainly never landed, marked sent when they did).

**Still back it up.** A database prevents corruption; backups prevent loss from a
dead disk. For real money, run automated backups, e.g. a periodic
`sqlite3 accounts.db ".backup backup.db"` (or `VACUUM INTO`) copied offsite
(Cloudflare R2 / S3). For many concurrent users or multiple app servers, move to
Postgres — the `store.ts` interface stays the same, only its internals change.

## Phase 2 — real SOL (planned)

When we wire real funds, this is the shape and the safety rules:

- A **house hot wallet** (a dedicated keypair) holds the bankroll and signs
  payouts. Its secret key is loaded from an **env var / untracked file** and is
  **never committed** (see `.gitignore`).
- **Use a throwaway wallet with a small balance**, not your main wallet — a
  backend key can be compromised, and bugs can mis-send. Top it up as needed.
- Deposits: watch the house address for incoming transfers, credit the sender's
  account. Withdrawals: debit balance, sign a transfer from the house wallet.
- Cluster (localnet / devnet / mainnet) is a single config switch. Strongly
  recommended: run the first full deposit→bet→withdraw cycle on localnet once
  (free, instant, no 403s) to catch bugs before real SOL.
