# Reference game mechanics (our notes)

How the reference site's games generate outcomes, summarised in our own words
from its published per-game fairness pages (`/provably-fair/code/<game>`, which
render client-side, so read them with a headless browser rather than curl).
Input for **our own** implementations; no reference source is stored here.

Shared RNG (same design as `src/fairness/engine.ts`): bytes from
`HMAC_SHA256(serverSeed, clientSeed:nonce:round)`, 32 bytes per round; each
4 bytes become one float in [0, 1). Games consume floats in order.

The reference uses a 2% house edge where an edge applies; we use our own
`HOUSE_EDGE` (1%) from `src/config.ts`.

| Game | Mechanic | Our status |
|---|---|---|
| Dice | One float → roll = floor(f × 10001) / 100, i.e. 0.00–100.00. | matches |
| Limbo ("target") | One float → n = floor(f × 10⁸) + 1; result = (10⁸ / n) × (1 − edge), at least 1, floored to 2dp. | aligned |
| Mines | 25 tiles. Mines placed one at a time: the i-th float picks an index among the tiles still free (25 − i of them). | aligned |
| Tower | 4 tiles per row. Per row, safe tiles are placed one at a time from the columns still free (easy 3 safe, medium 2, hard 1); the rest are traps. Rows consume floats in order. | aligned |
| Chicken | 20 lane positions. Draw 20 floats; Fisher-Yates from the top, swap index i with floor(f[i] × (i + 1)). The first k positions are hazards (easy 1, medium 3, hard 5, expert 10); you're caught on the lowest. | aligned |
| Plinko | One float per row: floor(f × 2) → left/right; bucket = number of rights. Rows 8–16, risk low/medium/high, each with a published payout table. | aligned (8–16 + tables) |
| Roulette | One float → floor(f × 37) → pocket 0–36; standard European colours. | matches |
| Keno | 40 numbers; 10 drawn one at a time from those remaining. Risks Classic/Low/Medium/High. **Paytables are not published** — ours are designed from the exact odds. | draw aligned |
| HiLo | A stream of cards: each float → card id floor(f × 52) (with replacement), deck ordered ♦ ♥ ♠ ♣ × A, 2…10, J, Q, K. | rebuild pending |
| Blackjack | Same card stream as HiLo, up to 29 cards dealt in order. Table rules shown in UI: blackjack pays 3:2, insurance 2:1; hit/stand/split/double. | new game pending |
| Darts | Two floats: distance from centre = √f₁ × 0.5 (uniform over the disc's area), angle = f₂ of a turn. **Ring radii per difficulty not published** — ours are sized so each tier's area gives the target RTP. | rebuild pending |
| Snakes | Five rounds of two dice, each die = floor(f × 6) + 1. Board UI: a ring of tiles with multipliers or snakes, per risk level. **Board layout not published** — ours is designed and its edge proven exactly. | rebuild pending |
