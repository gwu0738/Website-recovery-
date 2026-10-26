# Vanta — Progress & What's Left

_Living tracker. Last updated: 2026-10-26._

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
- ✅ **Real-balance foundation** (`server/sessions.ts`, `server/store.ts`):
  - Step-by-step games (Tower, Chicken, and every future one) run on one
    persistent session framework: locked stakes live in SQLite, so a server
    restart never loses a player's stake (tested across two processes).
  - Every balance change + its session update + its bet-history record commit
    in one transaction; the account is re-read inside it, which closes a
    double-spend where two simultaneous requests could spend one balance.
  - Bet history (`bets` table) + endpoints: `/api/bets/mine`,
    `/api/bets/recent` (Live Games), `/api/sessions/active` (resume).
- ✅ **Front-end** (`web/`) — branded dark site: games grid, live chat, bet
  verifier, Phantom wallet connect, social links, responsible-gambling footer.
  Two modes via `API_BASE`: in-browser demo, or real backend.
- ✅ **Interactive Dice UI** — slider with win/lose zones, live odds, animated
  roll. Works in demo and backend modes. (The quality bar for the rest.)
- ✅ **Roulette UI** — a real European wheel (37 pockets in true wheel order)
  with the ball orbiting against the spin and dropping into the engine's pocket;
  a full betting table (straights, columns, dozens, even-money) with stacked
  chips, Undo/Clear, and a results strip. All chips settle on ONE spin as one
  bet (`{ type: "multi" }` in the engine), so the stake is the sum of chips and
  each chip pays its own odds. Demo + backend.
- ✅ **Nobody loses a balance** (`server/`, `web/js/`):
  - Sign-in sessions are stored in SQLite, so a server restart or redeploy no
    longer signs everyone out — reload the page and the balance is right there.
    Sign-out revokes the token server-side; signing back in shows the same balance.
  - Withdrawals a crash left "pending" are reconciled at startup: never
    broadcast → refunded; landed → marked sent; failed/expired → refunded.
  - An unfinished Tower/Chicken game (locked stake) is listed by
    `/api/sessions/active` with its public progress, and the site shows a
    banner to **Resume** it (or cash out) — a page refresh can't strand a stake.
  - Deposits: the transaction signature is saved in the browser the moment
    Phantom returns it and retried until credited; a signature can also be
    pasted by hand; a deposit is refused if Phantom switched to another account
    than the signed-in one (that SOL would never be credited).
  - Payouts use `payoutLamports()` (floor with a 1e-6 tolerance) so an exact
    product like 3 chips × 2.00 can't lose a lamport to float noise.
  - Browser smoke test for all of it: `node scripts/ui-smoke.mjs` (no validator
    needed).
- ✅ **Single-file build** (`web/dist/standalone.html`) — runs in sandbox / by
  double-click.
- ✅ **Marketing** (`marketing/`) — Telegram templates + visual-assets guide.
- ✅ **Reference** (`reference/nuts-gg/`) — analysis + game screenshots.

### Game status

| Game | Engine | Interactive UI | Notes (⚠️ = engine to rebuild) |
|------|:--:|:--:|------|
| Dice | ✅ | ✅ | published mechanic (matches); slider + animated roll |
| Limbo | ✅ | 🟡 basic | aligned to published mechanic (10⁸ space) |
| Crash | ✅ | 🟡 basic | shares Limbo's formula; not in reference set |
| Mines | ✅ | ⬜ | aligned: mines placed one at a time from free tiles |
| Plinko | ✅ | ⬜ | 8–16 rows × 3 risks; published path; our generated tables (98.7–99.0% RTP) |
| Roulette | ✅ | ✅ | published mechanic (matches); real wheel + table, multi-chip spins |
| Wheel | ✅ | 🟡 basic | not in nuts.gg set |
| Coinflip | ✅ | 🟡 basic | not in nuts.gg set |
| Tower | ✅ | ✅ | aligned: safe tiles placed one at a time; interactive climb, demo + backend |
| HiLo | ⚠️ | ⬜ | rebuild as streak session over the published card stream |
| Chicken | ✅ | ✅ | death-point model (20 lanes, 1/3/5/10 hazards); road scene, leap-to-spot, traffic |
| Darts | ⚠️ | ⬜ | rebuild on published disc throw; ring radii ours, sized for exact RTP |
| Snakes | ⚠️ | ⬜ | rebuild: published 5×2 dice; board ours, edge proven exactly |
| Keno | ✅ | ⬜ | draw aligned to published; paytables per risk still to design from exact odds |

---

## What's left

### 1. Game UIs (the "real games" work) — biggest chunk
Build each remaining game to Dice quality, following the nuts.gg layout spec
below. Suggested order: HiLo → Keno → Darts → Snakes, then
polish Limbo/Mines/Plinko.
- [ ] Also add the 6 new games to the front-end catalog (`web/js/games.js`) with
      icons (currently only the original 8 show in the grid).

### 2. Email-verification layer (faucet gate)
Chosen faucet model = nuts.gg style: claim every 3 min, **requires verified
email** (anti-bot). Needs: email field on account, verification token + email
send, and enforcing `FAUCET.requireVerifiedEmail` in `claimFaucet`.

### 3. Phase 2 — real SOL ✅ (built + tested on a real local Solana validator)
- [x] House hot wallet; key from `HOUSE_KEYPAIR_FILE` / `HOUSE_SECRET_KEY`
      (never committed or logged). **Use a throwaway wallet holding only what
      you're willing to lose.**
- [x] Deposits: Phantom sends SOL to the house address; the server verifies the
      transfer on-chain (from the signed-in wallet, to the house) and credits
      exactly that amount, once per transaction signature.
- [x] Withdrawals: solvency + wagering + balance checks; debit and record in one
      transaction; signature stored before broadcast; refunds only when a send
      certainly didn't land, otherwise "pending" (flagged at startup).
- [x] Faucet credit is bonus: `FAUCET_WAGER_X` × amount must be wagered first.
- [x] Per-cluster safe defaults (mainnet faucet 0.0001 SOL, max stake 0.01 SOL);
      all limits are env vars (see `server/config.ts`).
- [x] Site wallet panel (deposit / withdraw / history with explorer links);
      browser follows the server's cluster; real-money mode is labelled as such
      and shows no simulated chat players.
- Verify any setup: `node scripts/sol-e2e.mjs` (API) and
  `node scripts/ui-wallet-e2e.mjs` (through the browser) against a validator.
- To go live: run the server with `SOLANA_CLUSTER=mainnet`, your own RPC URL in
  `SOLANA_RPC_URL`, and `HOUSE_KEYPAIR_FILE` pointing at your hot wallet; set
  `API_BASE` in `web/js/config.js` to your server.

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
- **Roulette:** European single-zero wheel, animated spinner. ✅ built.

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
npm test          # 58 tests (engine + games + backend + real-balance rules)
node scripts/ui-smoke.mjs   # browser: roulette spin, balance survives reload/restart, resume
npm run demo      # play one bet of every game + verify, in the terminal
npm run server    # backend API on :8787
npm run build:web # regenerate web/dist/standalone.html
npx serve web     # serve the site (set API_BASE in web/js/config.js for backend)
```
