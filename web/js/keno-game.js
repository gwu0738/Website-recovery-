// =============================================================================
// Keno — pick 1–10 numbers on a 40-number board. Ten balls are drawn one by
// one (in the engine's draw order); your hits light up and the paytable row
// shows what the hit count pays. `onPlay({ picks }, amount)` returns
// { outcome: { picks, drawn, hits }, multiplier, win, afterReveal }.
// =============================================================================
import { KENO_PAYTABLE, KENO_POOL, KENO_MAX_PICKS } from "./games.js";

const DRAW_MS = 260;
const reducedMotion = () => !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

import { betField, wireBetFields } from "./bet-field.js";

export function createKenoGame(container, { onPlay, amountLabel = "Bet" }) {
  const picks = new Set();
  let busy = false;
  const history = [];

  container.innerHTML = `
    <div class="kn">
      <div class="kn-controls">
        <div class="kn-row">
          <button id="kn-quick" class="btn btn-ghost" type="button">Quick pick</button>
          <button id="kn-clear" class="btn btn-ghost" type="button">Clear</button>
        </div>
        <div class="kn-stats"><div><span class="k">Picked</span><strong id="kn-count">0 / ${KENO_MAX_PICKS}</strong></div>
          <div><span class="k">Hits</span><strong id="kn-hits">—</strong></div></div>
        ${betField("kn-amount", amountLabel)}
        <button id="kn-draw" class="btn btn-primary big" disabled>Draw</button>
        <div class="kn-hist" id="kn-hist"></div>
      </div>
      <div class="kn-stage">
        <div class="kn-board" id="kn-board">${Array.from({ length: KENO_POOL }, (_, i) =>
          `<button type="button" class="kn-cell" data-n="${i + 1}">${i + 1}</button>`).join("")}</div>
        <div class="kn-machine">
          <div class="kn-drum" id="kn-drum">
            <div class="kn-glass"></div>
            ${Array.from({ length: 14 }, (_, i) => `<span class="kn-dball" style="--i:${i};--d:${(i * 0.37) % 1.4}s;--x:${12 + ((i * 53) % 70)}%;--y:${20 + ((i * 29) % 55)}%">${1 + ((i * 7) % 40)}</span>`).join("")}
            <div class="kn-chute"></div>
          </div>
          <div class="kn-balls" id="kn-balls"></div>
        </div>
        <div class="kn-paytable" id="kn-paytable"></div>
        <div class="kn-status" id="kn-status">Pick up to 10 numbers.</div>
      </div>
    </div>`;

  const $ = (s) => container.querySelector(s);
  wireBetFields(container);
  const board = $("#kn-board");

  function renderPaytable(hits = null) {
    const row = KENO_PAYTABLE[picks.size];
    $("#kn-paytable").innerHTML = row
      ? row.map((m, h) => `<span class="${hits === h ? "hit" : ""}${m ? "" : " zero"}"><small>${h} hit${h === 1 ? "" : "s"}</small>${m}×</span>`).join("")
      : `<span class="muted">Pick numbers to see the paytable.</span>`;
  }
  function renderPicks(hits = null) {
    board.querySelectorAll(".kn-cell").forEach((c) => c.classList.toggle("picked", picks.has(+c.dataset.n)));
    $("#kn-count").textContent = `${picks.size} / ${KENO_MAX_PICKS}`;
    $("#kn-draw").disabled = busy || picks.size === 0;
    renderPaytable(hits);
  }
  function clearDraw() {
    board.querySelectorAll(".kn-cell").forEach((c) => c.classList.remove("drawn", "hit", "miss"));
    $("#kn-balls").innerHTML = "";
    $("#kn-hits").textContent = "—";
  }

  board.addEventListener("click", (e) => {
    const cell = e.target.closest(".kn-cell");
    if (!cell || busy) return;
    const n = +cell.dataset.n;
    if (picks.has(n)) picks.delete(n);
    else if (picks.size < KENO_MAX_PICKS) picks.add(n);
    else { $("#kn-status").textContent = `At most ${KENO_MAX_PICKS} numbers.`; return; }
    clearDraw();
    renderPicks();
  });
  $("#kn-quick").addEventListener("click", () => {
    if (busy) return;
    picks.clear();
    while (picks.size < 10) picks.add(1 + Math.floor(Math.random() * KENO_POOL));
    clearDraw();
    renderPicks();
  });
  $("#kn-clear").addEventListener("click", () => {
    if (busy) return;
    picks.clear();
    clearDraw();
    renderPicks();
  });

  async function animateDraw(drawn) {
    let hits = 0;
    $("#kn-drum").classList.add("spinning");
    for (const n of drawn) {
      const cell = board.querySelector(`.kn-cell[data-n="${n}"]`);
      const hit = picks.has(n);
      if (hit) hits++;
      cell.classList.add("drawn", hit ? "hit" : "miss");
      const ball = document.createElement("span");
      ball.className = "kn-ball " + (hit ? "hit" : "");
      ball.textContent = n;
      $("#kn-balls").appendChild(ball);
      $("#kn-hits").textContent = `${hits}`;
      if (!reducedMotion()) await new Promise((r) => setTimeout(r, DRAW_MS));
    }
    $("#kn-drum").classList.remove("spinning");
    return hits;
  }

  $("#kn-draw").addEventListener("click", async () => {
    if (busy || !picks.size) return;
    busy = true;
    const btn = $("#kn-draw");
    btn.disabled = true;
    btn.textContent = "Drawing…";
    clearDraw();
    let lastHits = null;
    try {
      const amount = parseFloat($("#kn-amount").value) || 0;
      const res = await onPlay({ picks: [...picks].sort((a, b) => a - b) }, amount);
      if (!res) return;
      $("#kn-status").textContent = "Drawing 10 balls…";
      await animateDraw(res.outcome.drawn);
      lastHits = res.outcome.hits;
      $("#kn-status").textContent = `${res.outcome.hits} of ${picks.size} hit — ${res.multiplier}×${res.win ? " · win" : ""}`;
      history.unshift({ m: res.multiplier, win: res.win });
      if (history.length > 10) history.pop();
      $("#kn-hist").innerHTML = history.map((h) => `<span class="${h.win ? "win" : "lose"}">${h.m}×</span>`).join("");
      res.afterReveal?.();
    } finally {
      busy = false;
      btn.textContent = "Draw";
      renderPicks(lastHits);
    }
  });

  renderPicks();
  return {};
}
