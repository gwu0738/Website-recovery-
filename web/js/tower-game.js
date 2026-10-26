// =============================================================================
// Tower — interactive game UI (two-column layout, like nuts.gg).
//   Left:  difficulty tabs, PLAY / CASH OUT button, bet amount.
//   Right: MAX PAYOUT header + a 4-column grid you climb from the bottom.
//
// Presentation only. The app wires onStart/onReveal/onCashout to either the
// in-browser logic (demo) or the backend tower-session API (real).
// =============================================================================
import { TOWER_COLS, TOWER_ROWS, towerMaxMultiplier } from "./tower-logic.js";

export function createTowerGame(container, { onStart, onReveal, onCashout, amountLabel = "Bet" }) {
  let difficulty = "medium";
  let session = null; // { sessionId } while a game is live
  let rowsClimbed = 0;
  let busy = false;

  container.innerHTML = `
    <div class="tower">
      <div class="tower-controls">
        <div class="toggle tower-diff">
          <button class="toggle-btn" data-d="easy">Easy</button>
          <button class="toggle-btn active" data-d="medium">Medium</button>
          <button class="toggle-btn" data-d="hard">Hard</button>
        </div>
        <button id="tw-action" class="btn btn-primary big">Bet</button>
        <label class="field"><span class="k">${amountLabel}</span>
          <input id="tw-amount" type="number" step="0.001" min="0" value="0.001" /></label>
      </div>
      <div class="tower-board">
        <div class="tower-max">MAX PAYOUT <strong id="tw-max">x0</strong></div>
        <div id="tw-grid" class="tower-grid"></div>
        <div id="tw-status" class="tower-status">Pick a difficulty and press Bet.</div>
      </div>
    </div>`;

  const $ = (s) => container.querySelector(s);
  const grid = $("#tw-grid");
  const actionBtn = $("#tw-action");
  const amountEl = $("#tw-amount");
  const statusEl = $("#tw-status");
  const maxEl = $("#tw-max");

  function updateMax() {
    maxEl.textContent = "x" + towerMaxMultiplier(difficulty).toLocaleString();
  }

  // Build the grid: rows top (highest) to bottom (row 0). Climb from the bottom.
  function buildGrid() {
    grid.innerHTML = "";
    for (let r = TOWER_ROWS - 1; r >= 0; r--) {
      const row = document.createElement("div");
      row.className = "tower-row";
      row.dataset.row = r;
      for (let c = 0; c < TOWER_COLS; c++) {
        const tile = document.createElement("button");
        tile.className = "tower-tile";
        tile.dataset.row = r;
        tile.dataset.col = c;
        tile.disabled = true;
        tile.addEventListener("click", () => onTileClick(r, c));
        row.appendChild(tile);
      }
      grid.appendChild(row);
    }
    highlightActiveRow();
  }

  function rowEls(r) {
    return [...grid.querySelectorAll(`.tower-tile[data-row="${r}"]`)];
  }

  function highlightActiveRow() {
    grid.querySelectorAll(".tower-row").forEach((rw) => {
      const r = Number(rw.dataset.row);
      const active = session && r === rowsClimbed;
      rw.classList.toggle("active", !!active);
      rowEls(r).forEach((t) => (t.disabled = !active || busy));
    });
  }

  async function onTileClick(r, c) {
    if (!session || r !== rowsClimbed || busy) return;
    busy = true;
    highlightActiveRow();
    try {
      const res = await onReveal(session.sessionId, c);
      if (!res) return;
      // Mark the row: picked tile safe/trap, and show that row's traps.
      rowEls(r).forEach((t) => {
        const col = Number(t.dataset.col);
        if (res.rowTraps && res.rowTraps.includes(col)) t.classList.add("trap");
        else t.classList.add("safe-row");
      });
      const picked = rowEls(r)[c];
      picked.classList.add(res.bust ? "hit" : "picked");

      if (res.bust) {
        statusEl.textContent = `💥 Trap on row ${r + 1}. Lost the climb.`;
        endGame();
      } else {
        rowsClimbed = res.rowsClimbed;
        if (res.completed) {
          statusEl.textContent = `🏆 Topped out! x${res.multiplier} — paid out.`;
          endGame();
        } else {
          actionBtn.textContent = `Cash Out x${res.multiplier}`;
          statusEl.textContent = `Safe! Row ${rowsClimbed} cleared · x${res.multiplier}`;
          highlightActiveRow();
        }
      }
    } finally {
      busy = false;
      highlightActiveRow();
    }
  }

  function endGame() {
    session = null;
    rowsClimbed = 0;
    actionBtn.textContent = "Bet";
    grid.querySelectorAll(".tower-tile").forEach((t) => (t.disabled = true));
    enableDiff(true);
  }

  function enableDiff(on) {
    container.querySelectorAll(".tower-diff .toggle-btn").forEach((b) => (b.disabled = !on));
  }

  container.querySelectorAll(".tower-diff .toggle-btn").forEach((b) => {
    b.addEventListener("click", () => {
      if (session) return;
      difficulty = b.dataset.d;
      container.querySelectorAll(".tower-diff .toggle-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      updateMax();
    });
  });

  actionBtn.addEventListener("click", async () => {
    if (busy) return;
    if (session) {
      // Cash out
      busy = true;
      try {
        const res = await onCashout(session.sessionId);
        if (res) statusEl.textContent = `💰 Cashed out x${res.multiplier}.`;
        endGame();
      } finally {
        busy = false;
      }
      return;
    }
    // Start a new game
    const amount = parseFloat(amountEl.value) || 0;
    busy = true;
    actionBtn.disabled = true;
    try {
      const s = await onStart({ difficulty, amount });
      if (!s) return;
      session = s;
      rowsClimbed = 0;
      enableDiff(false);
      buildGrid();
      actionBtn.textContent = "Cash Out x1";
      statusEl.textContent = "Climb! Pick a tile on the bottom row.";
    } finally {
      busy = false;
      actionBtn.disabled = false;
      highlightActiveRow();
    }
  });

  updateMax();
  buildGrid();
  return {};
}
