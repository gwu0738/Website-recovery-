// =============================================================================
// Mines — a 5×5 field. Choose how many mines are buried, then reveal tiles one
// by one: a gem raises the multiplier, a mine ends it. Cash out any time.
// Session game: onStart({ mines, amount }) -> { sessionId }
//   onReveal(sessionId, tile) -> { safe, bust, revealed, multiplier, nextMultiplier, completed, minePositions? }
//   onCashout(sessionId) -> { multiplier, minePositions }
// =============================================================================
import { minesMultiplier, MINES_GRID } from "./games.js";

const reducedMotion = () => !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const GEM = `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M12 8 h16 l8 10 -16 16 -16 -16z" fill="#00e0b8"/><path d="M12 8 l8 10 8 -10 M4 18 h32 M20 18 v16" stroke="#0a3b33" stroke-width="1.5" fill="none"/></svg>`;
const BOMB = `<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="18" cy="24" r="12" fill="#11131c" stroke="#ff5c7a" stroke-width="2"/><path d="M24 14 l6 -6 M30 8 l3 -1 M31 11 l2 2" stroke="#ffb02e" stroke-width="2.5" stroke-linecap="round"/><circle cx="14" cy="20" r="3" fill="#2a2e40"/></svg>`;

export function createMinesGame(container, { onStart, onReveal, onCashout, amountLabel = "Bet" }) {
  let mines = 3;
  let session = null;
  let revealed = [];
  let busy = false;

  container.innerHTML = `
    <div class="mn">
      <div class="mn-controls">
        <label class="field"><span class="k">Mines <strong id="mn-mines-val">3</strong></span>
          <input id="mn-mines" type="range" min="1" max="24" value="3" /></label>
        <div class="mn-stats">
          <div><span class="k">Current</span><strong id="mn-mult">1.00×</strong></div>
          <div><span class="k">Next gem</span><strong id="mn-next">—</strong></div>
        </div>
        <label class="field"><span class="k">${amountLabel}</span>
          <input id="mn-amount" type="number" step="0.001" min="0" value="0.001" /></label>
        <button id="mn-action" class="btn btn-primary big">Bet</button>
        <button id="mn-random" class="btn btn-ghost" type="button" disabled>Random pick</button>
      </div>
      <div class="mn-board">
        <div class="mn-max">MAX PAYOUT <strong id="mn-max">×0</strong> · <span id="mn-gems"></span></div>
        <div id="mn-grid" class="mn-grid">${Array.from({ length: MINES_GRID }, (_, i) => `<button type="button" class="mn-tile" data-t="${i}" disabled></button>`).join("")}</div>
        <div id="mn-status" class="mn-status">Set the mine count and press Bet.</div>
      </div>
    </div>`;

  const $ = (s) => container.querySelector(s);
  const grid = $("#mn-grid");
  const actionBtn = $("#mn-action");
  const randomBtn = $("#mn-random");
  const tiles = [...grid.querySelectorAll(".mn-tile")];

  function header() {
    $("#mn-mines-val").textContent = mines;
    $("#mn-max").textContent = "×" + minesMultiplier(mines, MINES_GRID - mines).toLocaleString();
    $("#mn-gems").textContent = `${MINES_GRID - mines} gems`;
  }
  function stats() {
    const k = revealed.length;
    $("#mn-mult").textContent = minesMultiplier(mines, k).toFixed(2) + "×";
    $("#mn-next").textContent = session && k < MINES_GRID - mines ? minesMultiplier(mines, k + 1).toFixed(2) + "×" : "—";
  }
  function setTiles() {
    tiles.forEach((t) => (t.disabled = !session || busy || t.classList.contains("gem") || t.classList.contains("bomb")));
    randomBtn.disabled = !session || busy;
  }
  function resetGrid() {
    tiles.forEach((t) => { t.className = "mn-tile"; t.innerHTML = ""; });
  }
  function showMines(positions, hit) {
    positions.forEach((p) => {
      const t = tiles[p];
      if (!t.classList.contains("gem")) {
        t.classList.add("bomb");
        if (p === hit) t.classList.add("hit");
        t.innerHTML = BOMB;
      }
    });
  }

  $("#mn-mines").addEventListener("input", () => {
    if (session) return;
    mines = Number($("#mn-mines").value);
    header();
  });

  async function reveal(tile) {
    if (!session || busy) return;
    const t = tiles[tile];
    if (t.classList.contains("gem") || t.classList.contains("bomb")) return;
    busy = true;
    setTiles();
    t.classList.add("flip");
    try {
      const r = await onReveal(session.sessionId, tile);
      if (!r) return;
      if (!reducedMotion()) await new Promise((res) => setTimeout(res, 180));
      if (r.bust) {
        t.classList.add("bomb", "hit");
        t.innerHTML = BOMB;
        showMines(r.minePositions ?? [], tile);
        $("#mn-status").textContent = "💥 Mine! Lost the stake.";
        endGame();
        return;
      }
      t.classList.add("gem");
      t.innerHTML = GEM;
      revealed = r.revealed;
      stats();
      if (r.completed) {
        showMines(r.minePositions ?? [], null);
        $("#mn-status").textContent = `🏆 Every gem found! ×${r.multiplier}`;
        endGame();
      } else {
        actionBtn.textContent = `Cash Out ×${r.multiplier.toFixed(2)}`;
        $("#mn-status").textContent = `💎 Gem · ×${r.multiplier.toFixed(2)} — next gem ×${r.nextMultiplier.toFixed(2)}`;
      }
    } finally {
      t.classList.remove("flip");
      busy = false;
      setTiles();
    }
  }
  tiles.forEach((t) => t.addEventListener("click", () => reveal(+t.dataset.t)));
  randomBtn.addEventListener("click", () => {
    const open = tiles.filter((t) => !t.classList.contains("gem") && !t.classList.contains("bomb"));
    if (open.length) reveal(+open[Math.floor(Math.random() * open.length)].dataset.t);
  });

  function endGame() {
    session = null;
    revealed = [];
    actionBtn.textContent = "Bet";
    $("#mn-mines").disabled = false;
    setTiles();
    stats();
  }

  actionBtn.addEventListener("click", async () => {
    if (busy) return;
    if (session) {
      if (!revealed.length) { $("#mn-status").textContent = "Reveal at least one tile before cashing out."; return; }
      busy = true;
      try {
        const r = await onCashout(session.sessionId);
        if (r) {
          showMines(r.minePositions ?? [], null);
          $("#mn-status").textContent = `💰 Cashed out ×${r.multiplier.toFixed(2)}.`;
        }
        endGame();
      } finally { busy = false; setTiles(); }
      return;
    }
    busy = true;
    actionBtn.disabled = true;
    try {
      const amount = parseFloat($("#mn-amount").value) || 0;
      const s = await onStart({ mines, amount });
      if (!s) return;
      session = s;
      revealed = [];
      resetGrid();
      $("#mn-mines").disabled = true;
      actionBtn.textContent = "Cash Out";
      $("#mn-status").textContent = "Pick a tile.";
      stats();
    } finally {
      busy = false;
      actionBtn.disabled = false;
      setTiles();
    }
  });

  /** Resume an unfinished game: the gems already found stay revealed. */
  function restore({ sessionId, mines: m, revealed: rv, multiplier }) {
    mines = m;
    $("#mn-mines").value = m;
    $("#mn-mines").disabled = true;
    header();
    session = { sessionId };
    revealed = rv;
    resetGrid();
    rv.forEach((p) => { tiles[p].classList.add("gem"); tiles[p].innerHTML = GEM; });
    actionBtn.textContent = rv.length ? `Cash Out ×${multiplier.toFixed(2)}` : "Cash Out";
    $("#mn-status").textContent = rv.length ? `Resumed · ${rv.length} gem${rv.length > 1 ? "s" : ""} · ×${multiplier.toFixed(2)}` : "Resumed. Pick a tile.";
    stats();
    setTiles();
  }

  header();
  stats();
  setTiles();
  return { restore };
}
