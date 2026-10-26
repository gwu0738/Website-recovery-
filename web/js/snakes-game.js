// =============================================================================
// Snakes — a snakes-and-ladders board of 20 squares. Your piece climbs the
// board and stops on the square the engine's tier says: a multiplier square
// pays it, a snake square bites (0×). Which square of that tier it stops on is
// cosmetic; the tier is the provably-fair result.
// `onPlay({}, amount)` returns { outcome: { index, multiplier }, win, afterReveal }.
// =============================================================================
import { SNAKES_OUTCOMES } from "./games.js";

const COLS = 5, ROWS = 4;
// Square 1 bottom-left, boustrophedon upward. Values: 0 = snake, else multiplier.
const BOARD = [1.11, 0, 1.11, 0, 1.11, 1.4, 0, 1.11, 2.5, 0, 1.11, 1.4, 0, 1.11, 1.11, 2.5, 1.11, 1.4, 1.11, 4.0];
const HOP_MS = 110;
const reducedMotion = () => !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const SNAKE_SVG = `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M8 32 c0 -8 10 -8 10 -14 s-10 -6 -10 -12" stroke="#35d07f" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="8" cy="6" r="3.5" fill="#35d07f"/><circle cx="7" cy="5" r="1" fill="#0a0b10"/></svg>`;
const PIECE_SVG = `<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="15" fill="#7c5cff" stroke="#e8eaf2" stroke-width="3"/><circle cx="20" cy="20" r="6" fill="#00e0b8"/></svg>`;

// Grid position (row from top, col) of square n (1..20).
function pos(n) {
  const i = n - 1;
  const rowFromBottom = Math.floor(i / COLS);
  const colL = i % COLS;
  const col = rowFromBottom % 2 === 0 ? colL : COLS - 1 - colL;
  return { row: ROWS - 1 - rowFromBottom, col };
}

export function createSnakesGame(container, { onPlay, amountLabel = "Bet" }) {
  let busy = false;
  let current = 0;
  const history = [];

  const squares = Array.from({ length: COLS * ROWS }, (_, i) => {
    const n = i + 1;
    const { row, col } = pos(n);
    const v = BOARD[i];
    return `<div class="sn-sq ${v ? "mult" : "snake"}" data-n="${n}" style="grid-row:${row + 1};grid-column:${col + 1}">
      <span class="sn-n">${n}</span>${v ? `<span class="sn-v">${v}×</span>` : SNAKE_SVG}</div>`;
  }).join("");

  container.innerHTML = `
    <div class="sn">
      <div class="sn-controls">
        <div class="sn-odds" id="sn-odds"></div>
        <label class="field"><span class="k">${amountLabel}</span>
          <input id="sn-amount" type="number" step="0.001" min="0" value="0.001" /></label>
        <button id="sn-go" class="btn btn-primary big">Roll &amp; climb</button>
        <div class="sn-hist" id="sn-hist"></div>
      </div>
      <div class="sn-stage">
        <div class="sn-board" id="sn-board">${squares}<div class="sn-piece" id="sn-piece">${PIECE_SVG}</div></div>
        <div class="sn-status" id="sn-status">Climb the board; snakes bite.</div>
      </div>
    </div>`;

  const $ = (s) => container.querySelector(s);
  const board = $("#sn-board");
  const piece = $("#sn-piece");

  $("#sn-odds").innerHTML = SNAKES_OUTCOMES.map((o) =>
    `<span class="${o.multiplier ? "" : "snake"}">${o.multiplier ? o.multiplier + "×" : "🐍 0×"} <small>${(o.weight * 100).toFixed(1)}%</small></span>`).join("");

  function placeAt(n, instant = false) {
    const sq = board.querySelector(`.sn-sq[data-n="${n}"]`);
    if (!sq) { piece.style.left = "-40px"; piece.style.top = board.clientHeight - 44 + "px"; return; }
    piece.style.transition = instant ? "none" : `left ${HOP_MS}ms ease-out, top ${HOP_MS}ms ease-out`;
    piece.style.left = sq.offsetLeft + sq.offsetWidth / 2 - 18 + "px";
    piece.style.top = sq.offsetTop + sq.offsetHeight / 2 - 18 + "px";
  }

  async function climbTo(target) {
    if (reducedMotion()) { placeAt(target, true); current = target; return; }
    const from = target <= current ? 0 : current; // a new lap starts from the bottom
    if (from === 0) placeAt(0, true);
    for (let n = from + 1; n <= target; n++) {
      piece.classList.add("hop");
      placeAt(n);
      await new Promise((r) => setTimeout(r, HOP_MS));
      piece.classList.remove("hop");
    }
    current = target;
  }

  $("#sn-go").addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    const btn = $("#sn-go");
    btn.disabled = true;
    btn.textContent = "Climbing…";
    board.querySelectorAll(".sn-sq.hit").forEach((s) => s.classList.remove("hit"));
    piece.classList.remove("bitten");
    try {
      const amount = parseFloat($("#sn-amount").value) || 0;
      const res = await onPlay({}, amount);
      if (!res) return;
      const m = res.outcome.multiplier;
      // Choose a square of the result's tier, ahead of the piece if possible.
      const candidates = BOARD.map((v, i) => (v === m ? i + 1 : 0)).filter(Boolean);
      const ahead = candidates.filter((n) => n > current);
      const pool = ahead.length ? ahead : candidates;
      const target = pool[Math.floor(Math.random() * pool.length)];
      $("#sn-status").textContent = "Climbing…";
      await climbTo(target);
      board.querySelector(`.sn-sq[data-n="${target}"]`)?.classList.add("hit");
      if (m === 0) {
        piece.classList.add("bitten");
        $("#sn-status").textContent = `🐍 Bitten on square ${target}! Lost.`;
        if (!reducedMotion()) await new Promise((r) => setTimeout(r, 500));
        current = 0;
        placeAt(0);
      } else {
        $("#sn-status").textContent = `Square ${target}: ${m}×${res.win ? " · win" : ""}`;
      }
      history.unshift({ m, win: res.win });
      if (history.length > 10) history.pop();
      $("#sn-hist").innerHTML = history.map((h) => `<span class="${h.win ? "win" : "lose"}">${h.m ? h.m + "×" : "🐍"}</span>`).join("");
      res.afterReveal?.();
    } finally {
      busy = false;
      btn.disabled = false;
      btn.innerHTML = "Roll &amp; climb";
    }
  });

  requestAnimationFrame(() => placeAt(0, true));
  return {};
}
