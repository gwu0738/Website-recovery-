// =============================================================================
// Dice — a real interactive game UI (Stake-style), not a stub.
//
//   - a slider track split into lose/win zones by the target
//   - drag or type to move the target; toggle roll-under / roll-over
//   - live multiplier, win chance, and payout-on-win
//   - an animated marker that lands on the rolled number, with a win/lose flash
//
// It is presentation only. The actual bet runs through `onRoll(params)`, which
// the app wires to either the in-browser engine (demo) or the backend (real).
// This same pattern will drive the other games' UIs.
// =============================================================================
import { HOUSE_EDGE } from "./config.js";

const diceClamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const diceFloor2 = (x) => Math.floor(x * 100) / 100;

export function createDiceGame(container, { onRoll, amountLabel = "Bet" }) {
  let target = 50;
  let direction = "under"; // "under" | "over"

  const pips = {
    1: [[50, 50]], 2: [[25, 25], [75, 75]], 3: [[25, 25], [50, 50], [75, 75]],
    4: [[25, 25], [75, 25], [25, 75], [75, 75]], 5: [[25, 25], [75, 25], [50, 50], [25, 75], [75, 75]],
    6: [[25, 25], [75, 25], [25, 50], [75, 50], [25, 75], [75, 75]],
  };
  const face = (n, cls) =>
    `<div class="die-face ${cls}" data-n="${n}">${pips[n].map(([x, y]) => `<i style="left:${x}%;top:${y}%"></i>`).join("")}<span class="die-roll"></span></div>`;

  container.innerHTML = `
    <div class="dice">
      <div class="die-stage">
        <div class="die-scene">
          <div class="die-cube" id="die-cube">
            ${face(1, "front")}${face(6, "back")}${face(3, "right")}${face(4, "left")}${face(2, "top")}${face(5, "bottom")}
          </div>
        </div>
        <div class="die-readout" id="die-readout"><span class="k">Last roll</span><strong id="die-last">—</strong></div>
      </div>
      <div class="dice-track" id="dice-track">
        <div class="dice-zone-win" id="dice-zone"></div>
        <div class="dice-ticks"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
        <div class="dice-marker" id="dice-marker" hidden><span id="dice-marker-val">0</span></div>
        <div class="dice-thumb" id="dice-thumb"></div>
      </div>

      <div class="dice-stats">
        <div><span class="k">Multiplier</span><strong id="dice-mult">1.98×</strong></div>
        <div><span class="k">Win chance</span><strong id="dice-chance">50%</strong></div>
        <div><span class="k">Payout on win</span><strong id="dice-payout">—</strong></div>
      </div>

      <div class="dice-controls">
        <label class="field"><span class="k">${amountLabel}</span>
          <input id="dice-amount" type="number" step="0.001" min="0" value="0.001" /></label>
        <label class="field"><span class="k">Target</span>
          <input id="dice-target" type="number" step="0.01" min="0.01" max="99.99" value="50" /></label>
        <div class="field"><span class="k">Direction</span>
          <div class="toggle">
            <button id="dice-under" class="toggle-btn active">Under</button>
            <button id="dice-over" class="toggle-btn">Over</button>
          </div>
        </div>
      </div>

      <button id="dice-roll" class="btn btn-primary big dice-roll">Roll Dice</button>
    </div>`;

  const $ = (s) => container.querySelector(s);
  const zone = $("#dice-zone");
  const thumb = $("#dice-thumb");
  const marker = $("#dice-marker");
  const markerVal = $("#dice-marker-val");
  const track = $("#dice-track");
  const amountEl = $("#dice-amount");
  const targetEl = $("#dice-target");
  const rollBtn = $("#dice-roll");
  const cube = $("#die-cube");
  const reducedMotion = () => !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function winChance() {
    return direction === "under" ? target : 100 - target;
  }
  function multiplier() {
    const p = winChance() / 100;
    return p <= 0 ? 0 : diceFloor2((1 / p) * (1 - HOUSE_EDGE));
  }

  function render() {
    const pct = diceClamp(target, 0, 100);
    thumb.style.left = pct + "%";
    if (direction === "under") {
      zone.style.left = "0%";
      zone.style.width = pct + "%";
    } else {
      zone.style.left = pct + "%";
      zone.style.width = 100 - pct + "%";
    }
    $("#dice-mult").textContent = multiplier().toFixed(2) + "×";
    $("#dice-chance").textContent = winChance().toFixed(2) + "%";
    const amt = parseFloat(amountEl.value) || 0;
    $("#dice-payout").textContent = amt > 0 ? (amt * multiplier()).toFixed(4) : "—";
  }

  function setTarget(v) {
    target = diceClamp(Number(v) || 0, 0.01, 99.99);
    targetEl.value = target;
    render();
  }

  // drag on the track to set the target
  let dragging = false;
  const fromEvent = (e) => {
    const rect = track.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    setTarget((x / rect.width) * 100);
  };
  track.addEventListener("pointerdown", (e) => {
    dragging = true;
    fromEvent(e);
  });
  window.addEventListener("pointermove", (e) => dragging && fromEvent(e));
  window.addEventListener("pointerup", () => (dragging = false));

  targetEl.addEventListener("input", () => setTarget(targetEl.value));
  amountEl.addEventListener("input", render);
  $("#dice-under").addEventListener("click", () => {
    direction = "under";
    $("#dice-under").classList.add("active");
    $("#dice-over").classList.remove("active");
    render();
  });
  $("#dice-over").addEventListener("click", () => {
    direction = "over";
    $("#dice-over").classList.add("active");
    $("#dice-under").classList.remove("active");
    render();
  });

  // The die tumbles while the bet is in flight, then settles face-up showing
  // the exact roll (0.00–100.00) in the colour of the verdict.
  function startTumble() {
    cube.classList.remove("settled", "win", "lose");
    cube.querySelector(".die-face.front .die-roll").textContent = "";
    if (!reducedMotion()) cube.classList.add("rolling");
  }
  function settleDie(roll, win) {
    cube.classList.remove("rolling");
    cube.querySelector(".die-face.front .die-roll").textContent = roll.toFixed(2);
    cube.classList.add("settled", win ? "win" : "lose");
    $("#die-last").textContent = roll.toFixed(2);
    $("#die-readout").className = "die-readout " + (win ? "win" : "lose");
  }

  function animateTo(roll, win) {
    settleDie(roll, win);
    marker.hidden = false;
    marker.style.left = diceClamp(roll, 0, 100) + "%";
    markerVal.textContent = roll.toFixed(2);
    marker.classList.remove("win", "lose");
    // force reflow so the class re-triggers the flash
    void marker.offsetWidth;
    marker.classList.add(win ? "win" : "lose");
  }

  rollBtn.addEventListener("click", async () => {
    rollBtn.disabled = true;
    rollBtn.textContent = "Rolling…";
    startTumble();
    try {
      const amount = parseFloat(amountEl.value) || 0;
      const started = performance.now();
      const res = await onRoll({ target, direction, amount });
      // Let the die tumble for at least a moment even when the server is instant.
      const left = 900 - (performance.now() - started);
      if (res && left > 0 && !reducedMotion()) await new Promise((r) => setTimeout(r, left));
      if (res) animateTo(res.roll, res.win);
      else cube.classList.remove("rolling");
      res?.afterReveal?.();
    } finally {
      rollBtn.disabled = false;
      rollBtn.textContent = "Roll Dice";
    }
  });

  render();
  return { render };
}
