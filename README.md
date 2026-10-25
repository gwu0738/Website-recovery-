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
| Roulette | `src/games/roulette.ts` | European single-zero wheel + standard bets |
| Wheel | `src/games/wheel.ts` | segmented wheel, multiplier per segment |
| Coinflip | `src/games/coinflip.ts` | heads/tails, ~2× payout |

Payout rule shared by most games: `payout = (1 / winProbability) × (1 − houseEdge)`,
so expected return is exactly `1 − houseEdge`. Edge and branding live in
`src/config.ts` (one place to change).

## Project layout

```
src/
  config.ts            brand name + house edge (single source of truth)
  fairness/
    engine.ts          seeds, HMAC, float/byte derivation
    verify.ts          standalone verifier (commitment check + replay)
  games/               the eight games + shared math
  demo.ts              runnable demo
test/                  determinism, correctness, and RTP tests
```

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

## A note on responsibility

Code that handles real money is unforgiving — bugs are irreversible. Keep the house
edge disclosed, publish your verifier, test exhaustively on localnet/devnet, and get
the money-handling layer reviewed before mainnet. Online gambling is also regulated
or illegal in many places; understand your obligations before going live.
