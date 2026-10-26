# Vanta

**Provably fair. Verifiably yours.**

A from-scratch, provably-fair crypto casino game engine with eight classic games.
No dependencies, no blockchain required to run — it works on plain Node.js so you
can learn, test, and verify every outcome locally before anything touches real SOL.

> This is original code built on the public, industry-standard provably-fair
> scheme. It is a learning/engineering project — not a copy of any site.

## Quick start

Requires **Node.js 22.6+** (runs TypeScript natively — no build step, no installs).

```bash
npm run demo    # play one bet of every game from a single committed seed, then verify
npm test        # run the full test suite (includes a 200k-bet house-edge check)
```

## How "provably fair" works here

Every bet is decided by three inputs and one rule:

| Input | Who sets it | Purpose |
|-------|-------------|---------|
| `serverSeed` | the house (secret) | the house commits to `sha256(serverSeed)` **before** any bet |
| `clientSeed` | the player | stops the house pre-picking a seed rigged against this player |
| `nonce` | per-bet counter | same seeds, fresh result each bet |

Randomness for a bet is:

```
HMAC_SHA256( key = serverSeed, msg = `${clientSeed}:${nonce}:${cursor}` )
```

Each HMAC yields 32 bytes → eight floats in `[0, 1)`. Games consume these floats.
When the server seed is later revealed, the player re-hashes it, confirms it matches
the commitment, and replays the bet to reproduce the exact result.

**What this proves:** no individual bet was tampered with after the wager.
**What it does *not* hide:** the house edge, which lives openly in the payout math.

## The games

All eight sit on the one fairness engine in `src/fairness/`:

| Game | File | Core idea |
|------|------|-----------|
| Dice | `src/games/dice.ts` | roll 0–100, bet under/over a target |
| Limbo | `src/games/limbo.ts` | random multiplier ≥ your target wins |
| Crash | `src/games/crash.ts` | Limbo on a timeline — cash out before the bust |
| Mines | `src/games/mines.ts` | provably-fair shuffle hides N mines on a 5×5 grid |
| Plinko | `src/games/plinko.ts` | 16-row binomial drop into a payout bucket |
| Roulette | `src/games/roulette.ts` | European single-zero wheel; one spin settles a whole table of chips |
| Wheel | `src/games/wheel.ts` | segmented wheel, multiplier per segment |
| Coinflip | `src/games/coinflip.ts` | heads/tails, ~2× payout |

Payout rule shared by most games: `payout = (1 / winProbability) × (1 − houseEdge)`,
so expected return is exactly `1 − houseEdge`. Edge and branding live in
`src/config.ts` (one place to change).

## Project layout

```
src/                   server/engine (Node, TypeScript)
  config.ts            brand name + house edge (single source of truth)
  fairness/
    engine.ts          seeds, HMAC, float/byte derivation
    verify.ts          standalone verifier (commitment check + replay)
  games/               the eight games + shared math
  demo.ts              runnable demo
test/                  determinism, correctness, and RTP tests

web/                   front-end (static, no build step)
  index.html           branded landing: games grid, bet panel, verifier, chat
  css/styles.css       dark casino-noir theme (accent = one CSS var)
  js/
    config.js          brand, socials, Solana cluster/RPC (one place)
    fairness.js        same fairness engine, in-browser (Web Crypto)
    games.js           in-browser (demo) logic for every game + the catalogue
    *-game.js          one visual per game: dice die, coin, limbo rocket, crash
                       curve, wheel, plinko board, roulette wheel + table, hilo
                       cards, darts board, snakes board, keno draw, mines field,
                       tower, chicken
    wallet.js          Phantom connect + balance (cluster-aware)
    wallet-panel.js    deposits/withdrawals; remembers deposits until credited
    chat.js            live chat UI: rolling history, auto-scroll, persistence

marketing/             Telegram post templates + visual-assets guide
```

### Running the front-end

It's static — serve the `web/` folder with anything:

```bash
npx serve web        # or: python3 -m http.server -d web 8080
```

Then open the printed URL. If the backend (`npm run server`) is running on the
same host, the page finds it by itself and you get accounts, balances and the
faucet; otherwise the games run on the in-browser engine with a balance kept in
your browser. Wallet connect works with any Solana wallet (Phantom, Solflare,
Backpack, …). Socials live in `web/js/config.js`.

## Roadmap — adding Solana

The game logic is intentionally chain-agnostic. The plan to wire it to SOL:

1. **Localnet first.** Run `solana-test-validator` — a full Solana chain on your own
   machine. Airdrop yourself unlimited test SOL, move it between your own wallets.
   RPC is `http://localhost:8899`, so there are no rate limits or `403`s.
2. **Devnet.** Same code, RPC URL points at a devnet endpoint, still free test SOL.
3. **Mainnet — last.** Real SOL only after everything is proven and reviewed.

The RPC endpoint is meant to be a single env var, so moving between the three is a
one-line change. (A `403 Forbidden` on mainnet almost always means the free public
RPC is rate-limiting you — use a proper RPC provider or your own node, not the
public endpoint.)

## Hosting it

`deploy/DEPLOY.md` walks through a VPS setup end to end: systemd service for the
backend, nginx serving `web/` and proxying `/api/`, HTTPS via certbot, the house
wallet, environment variables, and backups. Start on devnet, then mainnet.

## A note on responsibility

Code that handles real money is unforgiving — bugs are irreversible. Keep the house
edge disclosed, publish your verifier, test exhaustively on localnet/devnet, and get
the money-handling layer reviewed before mainnet. Online gambling is also regulated
or illegal in many places; understand your obligations before going live.
