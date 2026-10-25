# Vanta — Progress & What's Left

_Living tracker. Last updated: 2026-10-25._

Vanta is an original, provably-fair crypto casino (Solana) built from scratch —
not a copy of any site. It benchmarks against nuts.gg for scope/UX (see
`reference/nuts-gg/`), using it as design reference only.

Legend: ✅ done · 🟡 partial · ⬜ not started

---

## Done

- ✅ **Provably-fair engine** (`src/fairness/`) — HMAC-SHA256 commit/reveal
  (server seed + client seed + nonce), standalone verifier, 30 tests passing.
- ✅ **14 game engines** (`src/games/`) — all tested (see table below).
- ✅ **Backend** (`server/`) — no-dependency Node:
  - Wallet sign-in (ed25519 challenge/signature, no passwords).
  - Faucet (free test credit; cooldown now 3 min to match nuts.gg).
  - Balances + server-side betting on every game.
  - **SQLite store** (`node:sqlite`) — durable, crash-safe (WAL, ACID); balances
    persist across logins/restarts (verified across a process restart).
- ✅ **Front-end** (`web/`) — branded dark site: games grid, live chat, bet
  verifier, Phantom wallet connect, social links, responsible-gambling footer.
  Two modes via `API_BASE`: in-browser demo, or real backend.
- ✅ **Interactive Dice UI** — slider with win/lose zones, live odds, animated
  roll. Works in demo and backend modes. (The quality bar for the rest.)
- ✅ **Single-file build** (`web/dist/standalone.html`) — runs in sandbox / by
  double-click.
- ✅ **Marketing** (`marketing/`) — Telegram templates + visual-assets guide.
- ✅ **Reference** (`reference/nuts-gg/`) — analysis + game screenshots.

### Game status

| Game | Engine | Interactive UI | Notes |
|------|:--:|:--:|------|
| Dice | ✅ | ✅ | slider + animated roll |
| Limbo | ✅ | 🟡 basic | |
| Crash | ✅ | 🟡 basic | not in nuts.gg set |
| Mines | ✅ | ⬜ | 5×5 grid UI needed |
| Plinko | ✅ | ⬜ | engine supports 8/12/16 rows + risk; UI fixed/none |
| Roulette | ✅ | ⬜ | wheel UI needed |
| Wheel | ✅ | 🟡 basic | not in nuts.gg set |
| Coinflip | ✅ | 🟡 basic | not in nuts.gg set |
| Tower | ✅ | ⬜ | **align engine to 4 cols + trap-count difficulty** (see below) |
| HiLo | ✅ | ⬜ | card-flip UI; streak mode is a UI layer |
| Chicken | ✅ | ⬜ | crash-ladder UI |
| Darts | ✅ | ⬜ | ⚠️ payout weights are our own — RTP-tune |
| Snakes | ✅ | ⬜ | ⚠️ our interpretation — RTP-tune |
| Keno | ✅ | ⬜ | ⚠️ paytable illustrative — RTP-tune |

---

## What's left

### 1. Game UIs (the "real games" work) — biggest chunk
Build each remaining game to Dice quality, following the nuts.gg layout spec
below. Suggested order: Tower → Chicken → HiLo → Keno → Darts → Snakes, then
polish Limbo/Mines/Plinko/Roulette.
- [ ] Also add the 6 new games to the front-end catalog (`web/js/games.js`) with
      icons (currently only the original 8 show in the grid).

### 2. Email-verification layer (faucet gate)
Chosen faucet model = nuts.gg style: claim every 3 min, **requires verified
email** (anti-bot). Needs: email field on account, verification token + email
send, and enforcing `FAUCET.requireVerifiedEmail` in `claimFaucet`.

### 3. Phase 2 — real SOL
- [ ] House hot wallet; secret key from env/untracked file (never committed).
      **Use a throwaway wallet with a small balance, not a main wallet.**
- [ ] Deposits: watch house address, credit sender's account.
- [ ] Withdrawals: debit balance, sign + send transfer.
- [ ] Faucet credit = **bonus** with a wagering requirement before withdraw
      (so a small bankroll, e.g. $2, isn't drained). `FAUCET.wagerRequirementX`
      already stubbed.
- [ ] Cluster is one config switch (localnet → devnet → mainnet). Test the full
      deposit→bet→withdraw cycle on **localnet/devnet first** (free, no 403s);
      flip to mainnet only once proven. (`@solana/web3.js` confirmed installable.)

### 4. Deployment
- [ ] VPS: run backend as a service (always-on); serve `web/`.
- [ ] Cloudflare (proxy/SSL/DDoS) + domain + HTTPS.
- [ ] Automated DB backups (`sqlite3 … .backup` / `VACUUM INTO`) offsite.

### 5. Nice-to-haves (from nuts.gg)
- [ ] Races / leaderboard strip (Daily/Weekly/Monthly), Live Games / Big Wins.
- [ ] Autoplay (the "A" toggle), bet stepper with MIN/MAX, USD value display.
- [ ] Configurable Plinko rows/risk in the UI.
- [ ] Blackjack (most complex — later).

---

## UI design spec (from `reference/nuts-gg/` screenshots)

Consistent **two-column game card**:
- **Left column:** difficulty/option controls (tabs or slider) → big gradient
  **PLAY** button with an autoplay toggle → bet-amount stepper (−/+, **MIN/MAX**,
  shows SOL + USD).
- **Right column:** a **MAX PAYOUT xN** header → the game visualization (slider /
  grid / board / wheel) → any live stat fields (e.g. Multiplier / Roll Over /
  Win Chance are editable inputs on Dice).
- Dark theme (#1a1a1a–#292929), purple→pink gradient buttons.
- Below the card: Races / Live Games / My Games / Big Wins tabs.

Per-game notes:
- **Tower:** 4 columns always; difficulty = trap count per row (Easy/Med/Hard).
  Climb from the bottom. (Current engine varies columns — realign to 4 cols +
  trap-count when building the UI.)
- **Mines:** 5×5, mine-count slider, "Random Pick", max-payout header.
- **Plinko:** rows 8/12/16 + Low/Med/High risk; symmetric buckets.
- **Roulette:** European single-zero wheel, animated spinner.

---

## RTP / house-edge tuning (before real money)

- Exact edge by construction: Dice, Limbo, Crash, Mines, Tower, HiLo, Chicken,
  Coinflip (and Roulette's structural single-zero edge).
- **Needs tuning:** Darts & Snakes (our weight tables) and Keno (illustrative
  paytable). Tests assert a positive edge, not a target edge — tune to your
  target (e.g. 1%) before mainnet.

---

## Branches / PRs

- **Main working branch:** `ccr-fb27e026-uj4ydi` (this one) — has everything above.
- **`ccr-c0b3a0d8-tzwnrs`** (a separate session): forked before Dice UI / SQLite /
  the 6 new engines, added only `reference/nuts-gg/`. **PR #1** opens that into
  this branch. Those reference files are now committed here directly, so PR #1 is
  effectively redundant — close it, and don't merge that branch expecting the
  newer work (it doesn't have it).

---

## How to run

```bash
npm test          # 30 tests (engine + games + backend)
npm run demo      # play one bet of every game + verify, in the terminal
npm run server    # backend API on :8787
npm run build:web # regenerate web/dist/standalone.html
npx serve web     # serve the site (set API_BASE in web/js/config.js for backend)
```
