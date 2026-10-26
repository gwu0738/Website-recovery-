// =============================================================================
// Chicken — interactive crash-ladder UI. Advance step by step across a lane;
// each cell shows the multiplier you'd lock in. Cash out before a step kills
// the chicken. Presentation only; app wires onStart/onStep/onCashout.
// =============================================================================
import { CHICKEN_MAX_STEPS, chickenMultiplier, chickenMaxMultiplier } from "./chicken-logic.js";

const DIFFS = ["easy", "medium", "hard", "expert"];

export function createChickenGame(container, { onStart, onStep, onCashout, amountLabel = "Bet" }) {
  let difficulty = "medium";
  let session = null;
  let stepsTaken = 0;
  let busy = false;

  container.innerHTML = `
    <div class="chicken">
      <div class="chicken-controls">
        <div class="toggle chicken-diff">
          ${DIFFS.map((d) => `<button class="toggle-btn${d === "medium" ? " active" : ""}" data-d="${d}">${d[0].toUpperCase() + d.slice(1)}</button>`).join("")}
        </div>
        <button id="ck-action" class="btn btn-primary big">Bet</button>
        <label class="field"><span class="k">${amountLabel}</span>
          <input id="ck-amount" type="number" step="0.001" min="0" value="0.001" /></label>
      </div>
      <div class="chicken-board">
        <div class="chicken-max">MAX PAYOUT <strong id="ck-max">x0</strong></div>
        <div id="ck-lane" class="chicken-lane"></div>
        <button id="ck-go" class="btn btn-ghost chicken-go" disabled>Go ▶</button>
        <div id="ck-status" class="chicken-status">Pick a difficulty and press Bet.</div>
      </div>
    </div>`;

  const $ = (s) => container.querySelector(s);
  const lane = $("#ck-lane");
  const actionBtn = $("#ck-action");
  const goBtn = $("#ck-go");
  const amountEl = $("#ck-amount");
  const statusEl = $("#ck-status");
  const maxEl = $("#ck-max");

  function updateMax() {
    maxEl.textContent = "x" + chickenMaxMultiplier(difficulty).toLocaleString();
  }

  function buildLane() {
    lane.innerHTML = "";
    for (let i = 1; i <= CHICKEN_MAX_STEPS; i++) {
      const cell = document.createElement("div");
      cell.className = "chicken-cell";
      cell.dataset.step = i;
      cell.innerHTML = `<span class="ck-mult">x${chickenMultiplier(difficulty, i)}</span>`;
      lane.appendChild(cell);
    }
    markLane();
  }

  function markLane() {
    lane.querySelectorAll(".chicken-cell").forEach((c) => {
      const step = Number(c.dataset.step);
      c.classList.toggle("passed", session && step <= stepsTaken);
      c.classList.toggle("next", !!session && step === stepsTaken + 1);
    });
    const next = lane.querySelector(".chicken-cell.next");
    if (next) next.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }

  function endGame() {
    session = null;
    stepsTaken = 0;
    goBtn.disabled = true;
    actionBtn.textContent = "Bet";
    enableDiff(true);
  }

  function enableDiff(on) {
    container.querySelectorAll(".chicken-diff .toggle-btn").forEach((b) => (b.disabled = !on));
  }

  container.querySelectorAll(".chicken-diff .toggle-btn").forEach((b) => {
    b.addEventListener("click", () => {
      if (session) return;
      difficulty = b.dataset.d;
      container.querySelectorAll(".chicken-diff .toggle-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      updateMax();
      buildLane();
    });
  });

  goBtn.addEventListener("click", async () => {
    if (!session || busy) return;
    busy = true;
    goBtn.disabled = true;
    try {
      const r = await onStep(session.sessionId);
      if (!r) return;
      if (r.bust) {
        const cell = lane.querySelector(`.chicken-cell[data-step="${r.step + 1}"]`);
        if (cell) cell.classList.add("dead");
        statusEl.textContent = `💥 Caught on step ${r.step + 1}. Lost.`;
        endGame();
      } else {
        stepsTaken = r.stepsTaken;
        markLane();
        if (r.completed) {
          statusEl.textContent = `🏆 Made it all the way! x${r.multiplier}`;
          endGame();
        } else {
          actionBtn.textContent = `Cash Out x${r.multiplier}`;
          statusEl.textContent = `Safe! Step ${stepsTaken} · x${r.multiplier}`;
          goBtn.disabled = false;
        }
      }
    } finally {
      busy = false;
    }
  });

  actionBtn.addEventListener("click", async () => {
    if (busy) return;
    if (session) {
      busy = true;
      try {
        const r = await onCashout(session.sessionId);
        if (r) statusEl.textContent = `💰 Cashed out x${r.multiplier}.`;
        endGame();
      } finally {
        busy = false;
      }
      return;
    }
    const amount = parseFloat(amountEl.value) || 0;
    busy = true;
    actionBtn.disabled = true;
    try {
      const s = await onStart({ difficulty, amount });
      if (!s) return;
      session = s;
      stepsTaken = 0;
      enableDiff(false);
      buildLane();
      goBtn.disabled = false;
      actionBtn.textContent = "Cash Out x1";
      statusEl.textContent = "Press Go to advance. Cash out any time.";
    } finally {
      busy = false;
      actionBtn.disabled = false;
    }
  });

  updateMax();
  buildLane();
  return {};
}
