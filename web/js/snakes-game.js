// =============================================================================
// Snakes — a snakes-and-ladders board (20 squares, bottom-left to top-right).
// Snakes are drawn across the board; multiplier squares pay. The piece climbs
// to a square of the tier the engine picked; landing on a snake's head slides
// it down the snake's body to the tail — bitten, 0×. The tier is the
// provably-fair result; which square of that tier is cosmetic.
// `onPlay({}, amount)` returns { outcome: { index, multiplier }, win, afterReveal }.
// =============================================================================
import { SNAKES_OUTCOMES } from "./games.js";
import { betField, wireBetFields } from "./bet-field.js";

const COLS = 5, ROWS = 4;
// Square 1..20 boustrophedon from bottom-left. 0 = snake head square.
const BOARD = [1.11, 1.11, 1.11, 1.4, 1.11, 0, 1.11, 1.11, 0, 1.4, 1.11, 2.5, 0, 1.11, 1.4, 0, 1.11, 2.5, 0, 4.0];
const SNAKES = { 6: 2, 9: 3, 13: 5, 16: 8, 19: 11 }; // head square -> tail square
const LADDERS = [[2, 10], [7, 15], [14, 18]]; // decorative: bottom -> top
const HOP_MS = 120;
const reducedMotion = () => !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const PIECE_SVG = `<svg viewBox="0 0 40 40" aria-hidden="true"><ellipse cx="20" cy="34" rx="12" ry="4" fill="rgba(0,0,0,.5)"/><path d="M20 4 a9 9 0 0 1 9 9 c0 6 -5 9 -5 14 h-8 c0 -5 -5 -8 -5 -14 a9 9 0 0 1 9 -9z" fill="#7c5cff" stroke="#e8eaf2" stroke-width="2"/><rect x="11" y="27" width="18" height="6" rx="3" fill="#5b3cff" stroke="#e8eaf2" stroke-width="2"/></svg>`;

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
      <span class="sn-n">${n}</span>${v ? `<span class="sn-v">${v}×</span>` : `<span class="sn-v bite">🐍</span>`}</div>`;
  }).join("");

  container.innerHTML = `
    <div class="sn">
      <div class="sn-controls">
        <div class="sn-odds" id="sn-odds"></div>
        <button id="sn-go" class="btn btn-primary big">Play</button>
        ${betField("sn-amount", amountLabel)}
        <div class="sn-hist" id="sn-hist"></div>
      </div>
      <div class="sn-stage">
        <div class="sn-max">MAX PAYOUT <strong>×4</strong></div>
        <div class="sn-board" id="sn-board">
          ${squares}
          <svg class="sn-art" id="sn-art"></svg>
          <div class="sn-piece" id="sn-piece">${PIECE_SVG}</div>
        </div>
        <div class="sn-status" id="sn-status">Climb the board. Snakes bite.</div>
      </div>
    </div>`;

  const $ = (s) => container.querySelector(s);
  wireBetFields(container);
  const board = $("#sn-board");
  const piece = $("#sn-piece");
  const art = $("#sn-art");
  const snakePaths = {};

  $("#sn-odds").innerHTML = SNAKES_OUTCOMES.map((o) =>
    `<span class="${o.multiplier ? "" : "snake"}">${o.multiplier ? o.multiplier + "×" : "🐍 0×"} <small>${(o.weight * 100).toFixed(1)}%</small></span>`).join("");

  const centerOf = (n) => {
    const sq = board.querySelector(`.sn-sq[data-n="${n}"]`);
    return [sq.offsetLeft + sq.offsetWidth / 2, sq.offsetTop + sq.offsetHeight / 2];
  };

  // Draw snakes (S-curves head→tail) and ladders over the grid, sized to the DOM.
  function drawArt() {
    const w = board.clientWidth, h = board.clientHeight;
    if (!w || !h) return;
    art.setAttribute("viewBox", `0 0 ${w} ${h}`);
    art.setAttribute("width", w);
    art.setAttribute("height", h);
    let html = "";
    for (const [a, b] of LADDERS) {
      const [x0, y0] = centerOf(a), [x1, y1] = centerOf(b);
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
      const nx = (-dy / len) * 9, ny = (dx / len) * 9;
      html += `<g class="sn-ladder"><line x1="${x0 + nx}" y1="${y0 + ny}" x2="${x1 + nx}" y2="${y1 + ny}"/><line x1="${x0 - nx}" y1="${y0 - ny}" x2="${x1 - nx}" y2="${y1 - ny}"/>`;
      const rungs = Math.floor(len / 22);
      for (let i = 1; i < rungs; i++) {
        const t = i / rungs, px = x0 + dx * t, py = y0 + dy * t;
        html += `<line x1="${px + nx}" y1="${py + ny}" x2="${px - nx}" y2="${py - ny}"/>`;
      }
      html += `</g>`;
    }
    for (const [head, tail] of Object.entries(SNAKES)) {
      const [hx, hy] = centerOf(+head), [tx, ty] = centerOf(tail);
      const mx = (hx + tx) / 2, my = (hy + ty) / 2;
      const sway = (Math.abs(hx - tx) < 1 ? 1 : Math.sign(hx - tx)) * Math.max(40, Math.abs(hy - ty) * 0.35);
      const d = `M${hx} ${hy} C${hx + sway} ${hy + (ty - hy) * 0.3}, ${mx - sway} ${my}, ${tx} ${ty}`;
      html += `<g class="sn-snake" data-head="${head}"><path d="${d}" class="sn-body-out"/><path d="${d}" class="sn-body" id="sn-path-${head}"/>
        <path d="${d}" class="sn-stripes"/>
        <circle cx="${hx}" cy="${hy}" r="11" class="sn-head"/><circle cx="${hx - 4}" cy="${hy - 3}" r="2" fill="#0a0b10"/><circle cx="${hx + 4}" cy="${hy - 3}" r="2" fill="#0a0b10"/>
        <path d="M${hx} ${hy + 6} l-3 7 M${hx} ${hy + 6} l3 7" stroke="#ff4d5e" stroke-width="2" fill="none"/>
        <circle cx="${tx}" cy="${ty}" r="4" class="sn-tail"/></g>`;
    }
    art.innerHTML = html;
    for (const head of Object.keys(SNAKES)) snakePaths[head] = art.querySelector(`#sn-path-${head}`);
  }

  function placeAt(n, instant = false) {
    piece.style.transition = instant ? "none" : `left ${HOP_MS}ms ease-out, top ${HOP_MS}ms ease-out`;
    if (n === 0) {
      piece.style.left = "-6px";
      piece.style.top = board.clientHeight - 44 + "px";
      return;
    }
    const [x, y] = centerOf(n);
    piece.style.left = x - 20 + "px";
    piece.style.top = y - 24 + "px";
  }

  async function climbTo(target) {
    if (reducedMotion()) { placeAt(target, true); current = target; return; }
    const from = target <= current ? 0 : current;
    if (from === 0) placeAt(0, true);
    for (let n = from + 1; n <= target; n++) {
      piece.classList.add("hop");
      placeAt(n);
      await new Promise((r) => setTimeout(r, HOP_MS));
      piece.classList.remove("hop");
    }
    current = target;
  }

  // Slide the piece along the snake's body from head to tail.
  function slideDown(head) {
    const path = snakePaths[head];
    if (!path) { placeAt(SNAKES[head], true); return Promise.resolve(); }
    const len = path.getTotalLength();
    const ms = reducedMotion() ? 0 : 900;
    piece.style.transition = "none";
    return new Promise((resolve) => {
      const t0 = performance.now();
      const frame = (now) => {
        const t = ms ? Math.min(1, (now - t0) / ms) : 1;
        const p = path.getPointAtLength(len * t);
        piece.style.left = p.x - 20 + "px";
        piece.style.top = p.y - 24 + "px";
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  $("#sn-go").addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    const btn = $("#sn-go");
    btn.disabled = true;
    btn.textContent = "Climbing…";
    board.querySelectorAll(".sn-sq.hit").forEach((s) => s.classList.remove("hit"));
    art.querySelectorAll(".sn-snake.bite").forEach((s) => s.classList.remove("bite"));
    piece.classList.remove("bitten");
    try {
      const amount = parseFloat($("#sn-amount").value) || 0;
      const res = await onPlay({}, amount);
      if (!res) return;
      const m = res.outcome.multiplier;
      const candidates = BOARD.map((v, i) => (v === m ? i + 1 : 0)).filter(Boolean);
      const ahead = candidates.filter((n) => n > current);
      const pool = ahead.length ? ahead : candidates;
      const target = pool[Math.floor(Math.random() * pool.length)];
      $("#sn-status").textContent = "Climbing…";
      await climbTo(target);
      board.querySelector(`.sn-sq[data-n="${target}"]`)?.classList.add("hit");
      if (m === 0) {
        art.querySelector(`.sn-snake[data-head="${target}"]`)?.classList.add("bite");
        $("#sn-status").textContent = `🐍 Snake on ${target}! Sliding down…`;
        if (!reducedMotion()) await new Promise((r) => setTimeout(r, 350));
        await slideDown(target);
        piece.classList.add("bitten");
        current = SNAKES[target];
        $("#sn-status").textContent = `🐍 Bitten — down to square ${SNAKES[target]}. Lost.`;
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
      btn.textContent = "Play";
    }
  });

  const layout = () => { drawArt(); placeAt(current, true); };
  requestAnimationFrame(layout);
  window.addEventListener("resize", layout);
  return {};
}
