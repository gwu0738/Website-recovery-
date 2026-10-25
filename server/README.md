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

The account view never exposes the live server seed — only its hash
(the commitment). Rotating the seed reveals the previous one so players can
verify their past bets with the shared verifier (`src/fairness/verify.ts`).

## Data

Account state lives in `server/data/accounts.json` (gitignored). It's a plain
file store — fine for private testing. For production, swap `store.ts` for
SQLite/Postgres; the interface stays the same.

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
