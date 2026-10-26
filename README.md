# Vanta

**Provably fair. Verifiably yours.**

A provably-fair Solana casino built from scratch: 14 games, each with its own
real visual, a custodial balance backend with on-chain SOL deposits and
withdrawals, any Solana wallet, and a verifier so every result can be checked.

> Original code built on the public, industry-standard provably-fair scheme.
> Not a copy of any site.

## Launch it on your computer

Requires **Node.js 22.18 or newer** (it runs the TypeScript files directly, so
there is no build step). Check with `node --version`.

```bash
npm install          # one-time: installs the Solana library
npm test             # 67 tests; all should pass
npm run server       # terminal 1: the backend on http://localhost:8787
npx serve web        # terminal 2: the site — open the URL it prints
```

The page finds the backend on port 8787 by itself. Click **Connect Wallet**
(Phantom, Solflare, Backpack or any Solana wallet), claim the free faucet, and
play. Balances are per wallet and persist in `server/data/accounts.db`.

Without the backend running, the site still works: games run on the in-browser
engine with a balance kept in your browser, and the page says so. The single
file `web/dist/standalone.html` does the same when opened directly.

To try real deposits and withdrawals, create a house wallet and start the
server with it (devnet first — free test SOL):

```bash
node scripts/make-house-wallet.mjs house.keypair.json   # prints the address to fund
HOUSE_KEYPAIR_FILE=house.keypair.json SOLANA_CLUSTER=devnet npm run server
```

(Windows PowerShell: `$env:HOUSE_KEYPAIR_FILE="house.keypair.json"; $env:SOLANA_CLUSTER="devnet"; npm run server`.)

## Hosting it

`deploy/DEPLOY.md` is the step-by-step VPS guide: systemd service for the
backend, nginx serving `web/` and proxying `/api/` on one origin, HTTPS via
certbot, house wallet, environment variables, backups, and a mainnet checklist.
`deploy/vanta.service` and `deploy/nginx.conf` are ready to copy.

## The games

All on one fairness engine (`src/fairness/`). Engines in `src/games/`, visuals in
`web/js/*-game.js`.

| Game | Mechanic | Visual |
|------|----------|--------|
| Dice | roll 0–100, bet under/over a target | tumbling die lands showing the roll |
| Limbo | random multiplier ≥ your target wins | rocket + climbing counter |
| Crash | bust point on a timeline, auto cash-out | live curve with cash-out line |
| Mines | 5×5 field, N mines, reveal tile by tile (session) | gems / bombs |
| Plinko | 8–16 rows, low/medium/high risk, binomial buckets | ball bounces down the pegs |
| Roulette | European single-zero; a whole table of chips on one spin | spinning wheel + table |
| Wheel | segmented wheel per risk level | spinning wheel |
| Coinflip | heads/tails, ~2× | 3D coin flip |
| Tower | 4 columns, climb past traps (session) | tower grid |
| Chicken | 20 lanes, hidden hazards (session) | road scene with traffic |
| HiLo | streak over a fixed card stream (session) | felt table, dealt cards |
| Darts | six scoring rings by difficulty | numbered dartboard |
| Snakes | prize tiers, snakes bite | snakes-and-ladders board |
| Keno | pick 1–10 of 40, ten drawn | lottery drum, ball draw |

Payout rule for most games: `payout = (1 / winProbability) × (1 − houseEdge)`.
House edge lives in `src/config.ts` and is shown on the site.

## How "provably fair" works here

| Input | Who sets it | Purpose |
|-------|-------------|---------|
| `serverSeed` | the house (secret) | the house commits to `sha256(serverSeed)` **before** any bet |
| `clientSeed` | the player | stops the house pre-picking a seed rigged against this player |
| `nonce` | per-bet counter | same seeds, fresh result each bet |

```
HMAC_SHA256( key = serverSeed, msg = `${clientSeed}:${nonce}:${cursor}` )
```

Each HMAC yields 32 bytes → eight floats in `[0, 1)` that the games consume. When
the server seed is revealed (Rotate seed), the player re-hashes it, confirms it
matches the commitment, and replays the bet with `src/fairness/verify.ts` or the
Verify widget on the site.

## Project layout

```
src/        fairness engine + the 14 game rules (TypeScript, run directly by Node)
server/     backend: wallet sign-in, SQLite balances, bets, game sessions,
            SOL deposits/withdrawals (server/solana.ts), faucet gate, config
web/        the site (static): index.html, css/, js/ (one *-game.js per game,
            wallets.js, wallet-panel.js, api.js, feed.js, chat.js)
web/dist/   standalone.html — the whole site in one file (npm run build:web)
test/       67 tests: engine, games, backend, money rules, faucet gate
scripts/    ui-smoke.mjs / ui-games-smoke.mjs (browser tests, no validator needed),
            sol-e2e.mjs / ui-wallet-e2e.mjs (against a local Solana validator),
            make-house-wallet.mjs
deploy/     DEPLOY.md, vanta.service, nginx.conf
marketing/  Telegram post templates + visual-assets guide
```

## Money, in one paragraph

Balances are custodial: deposits are plain SOL transfers to the house wallet
that the server verifies on-chain and credits once per transaction; withdrawals
are signed by the house wallet after balance, wagering and solvency checks, and
anything interrupted mid-send is reconciled on restart. Sign-in sessions and
in-progress games live in the database, so restarts never sign anyone out or
strand a stake. Limits, faucet size and the anti-bot gate are environment
variables (see `server/config.ts`).

## A note on responsibility

Code that handles real money is unforgiving. Keep the house edge disclosed,
publish the verifier, test on devnet first, keep only what you can lose in the
house wallet, and back up the database. Online gambling is regulated or illegal
in many places; know your obligations before going live.
