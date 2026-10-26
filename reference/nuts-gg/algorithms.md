# Reference game mechanics (our notes)

Summaries in our own words of how the reference site's games work, from its
published per-game fairness text (where we have it) and screenshots. This is
input for **our own** implementations; no reference source code is stored here.

Shared RNG (same approach as `src/fairness/engine.ts`): bytes from
`HMAC_SHA256(serverSeed, clientSeed:nonce:round)`, 32 bytes per round; every 4
bytes become one float in [0, 1).

Status key: ✅ published algorithm known · 👀 from screenshots only (need the
published text before we match it).

---

## Chicken ✅ (implemented: `src/games/chicken.ts`)
- 20 lane positions; hidden hazards by difficulty: easy 1, medium 3, hard 5,
  expert 10.
- Draw 20 floats; shuffle the positions 1..20 with them (Fisher-Yates); the first
  k positions are hazards; the chicken is caught on the **lowest** hazard lane.
- Crossable lanes = 20 − k. Multiplier for lane n = edge × C(20,k) / C(20−n,k);
  the reference's ladder corresponds to a 2% edge (we use 1%).

## Snakes 👀 — our current engine is WRONG, rebuild once the algorithm is known
- It's a board game: a ring of tiles around the edge, two dice in the centre, a
  Roll button, and a row of dots (likely the rolls in a round).
- Tiles carry multipliers (seen: 1.11x, 1.40x, 2.50x, 4.00x) or a snake (loss);
  a risk slider (seen: Medium) changes the board.
- Need: how the board is laid out per risk, how dice map to movement, how many
  rolls, and how multipliers combine.

## Darts 👀
- Dartboard of concentric colour rings with a bullseye; difficulty tabs
  easy/medium/hard/expert; colour-coded legend 0.5x, 0.8x, 1.2x, 1.5x, 2.7x, 8.5x
  (bullseye = top tier). Need: the landing distribution per difficulty.

## Keno 👀
- 40 numbers (8×5 grid), pick 1–10, risk selector (seen: "Classic"), Auto Pick,
  Clear Table. Need: draw count, how the draw is generated, paytables per risk.

## HiLo 👀
- Card in the centre; "Higher or same" / "Lower or same" each show a multiplier;
  Payout/Chance toggle; history strip of drawn cards; Start, then guess, skip
  possible. Need: card generation (deck or 52-float mapping) and edge.

## Plinko 👀
- Risk + rows sliders (rows seen: 8), triangular pegs, coloured buckets; 8-row
  medium example: 13x, 3x, 1.29x, 0.68x, 0.37x (centre), mirrored. Need: path
  generation and full payout tables.

## Mines 👀
- 5×5, mine-count slider (default 3), Random Pick, max-payout header. Need: mine
  placement method (likely shuffle like Chicken).

## Limbo 👀 · Roulette 👀 · Dice 👀 · Tower 👀 · Blackjack 👀
- Limbo: target slider, big result readout. Roulette: European wheel, x2/x36
  chip types. Dice: 0–100 slider, roll over. Tower: 4 columns, easy/medium/hard.
  Blackjack: hit/stand/split/double, pays 3:2, insurance 2:1.

---

Getting the rest: the per-game algorithm panel isn't served to a logged-out
headless browser (the provably-fair route falls back to the homepage), so these
come from a logged-in user pasting the panel text, as was done for Chicken.
