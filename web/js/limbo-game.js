// =============================================================================
// Limbo — pick a target multiplier; a rocket launches and the multiplier
// counter climbs to the engine's result. Reaches your target = win; falls
// short = the rocket fizzles. `onPlay({ target }, amount)` returns
// { outcome: { result }, win, multiplier, afterReveal }.
// =============================================================================
import { HOUSE_EDGE } from "./config.js";

const reducedMotion = () => !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const easeOut = (t) => 1 - Math.pow(1 - t, 2.2);
const ROCKET_SVG = `<svg viewBox="0 0 40 80" aria-hidden="true">
  <path d="M20 2 C30 14 32 30 30 54 H10 C8 30 10 14 20 2z" fill="#e8eaf2"/>
  <path d="M20 2 C26 12 28 24 27 40 H13 C12 24 14 12 20 2z" fill="#c9ccdb"/>
  <circle cx="20" cy="30" r="5" fill="#00e0b8"/>
  <path d="M10 44 L2 62 L10 58z M30 44 L38 62 L30 58z" fill="#7c5cff"/>
  <path d="M14 54 h12 l-2 8 h-8z" fill="#5b3cff"/>
  <path class="flame" d="M16 62 q4 14 8 0 q-4 8 -8 0z" fill="#ffb02e"/>
</svg>`;

import { betField, wireBetFields } from "./bet-field.js";

export function createLimboGame(container, { onPlay, amountLabel = "Bet" }) {
  let target = 2;
  let busy = false;
  const history = [];

  container.innerHTML = `
    <div class="lb">
      <div class="lb-controls">
        <label class="field"><span class="k">Target multiplier</span>
          <input id="lb-target" type="number" step="0.01" min="1.01" value="2.00" /></label>
        <div class="lb-stats">
          <div><span class="k">Win chance</span><strong id="lb-chance">49.50%</strong></div>
          <div><span class="k">Payout on win</span><strong id="lb-payout">—</strong></div>
        </div>
        ${betField("lb-amount", amountLabel)}
        <button id="lb-go" class="btn btn-primary big">Launch</button>
      </div>
      <div class="lb-stage" id="lb-stage">
        <div class="lb-stars"></div>
        <div class="lb-target-line" id="lb-line"><span id="lb-line-label">2.00×</span></div>
        <div class="lb-rocket" id="lb-rocket">${ROCKET_SVG}</div>
        <div class="lb-counter" id="lb-counter">1.00×</div>
        <div class="lb-hist" id="lb-hist"></div>
      </div>
    </div>`;

  const $ = (s) => container.querySelector(s);
  wireBetFields(container);
  const counter = $("#lb-counter");
  const rocket = $("#lb-rocket");
  const line = $("#lb-line");

  // Height on the stage for a multiplier: log scale so 1.00→100× all fit.
  const heightPct = (m) => Math.min(88, (Math.log10(Math.max(1, m)) / 2.3) * 100);

  function render() {
    const chance = Math.min(1, (1 - HOUSE_EDGE) / target);
    $("#lb-chance").textContent = (chance * 100).toFixed(2) + "%";
    const amt = parseFloat($("#lb-amount").value) || 0;
    $("#lb-payout").textContent = amt > 0 ? (amt * target).toFixed(4) : "—";
    line.style.bottom = heightPct(target) + "%";
    $("#lb-line-label").textContent = target.toFixed(2) + "×";
  }
  $("#lb-target").addEventListener("input", () => {
    target = Math.max(1.01, parseFloat($("#lb-target").value) || 1.01);
    render();
  });
  $("#lb-amount").addEventListener("input", render);

  function climbTo(result, win) {
    const stage = $("#lb-stage");
    stage.classList.remove("win", "lose");
    counter.className = "lb-counter";
    rocket.className = "lb-rocket flying";
    rocket.style.bottom = "4%";
    if (reducedMotion()) {
      counter.textContent = result.toFixed(2) + "×";
      rocket.style.bottom = heightPct(result) + "%";
      return Promise.resolve();
    }
    const ms = 900 + Math.min(2200, Math.log10(result) * 1400);
    return new Promise((resolve) => {
      const t0 = performance.now();
      const frame = (now) => {
        const t = Math.min(1, (now - t0) / ms);
        const m = 1 + (result - 1) * easeOut(t);
        counter.textContent = m.toFixed(2) + "×";
        rocket.style.bottom = heightPct(m) + "%";
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  $("#lb-go").addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    const btn = $("#lb-go");
    btn.disabled = true;
    btn.textContent = "Launching…";
    try {
      const amount = parseFloat($("#lb-amount").value) || 0;
      const res = await onPlay({ target }, amount);
      if (!res) return;
      const result = res.outcome.result;
      await climbTo(result, res.win);
      const stage = $("#lb-stage");
      stage.classList.add(res.win ? "win" : "lose");
      counter.classList.add(res.win ? "win" : "lose");
      rocket.className = "lb-rocket " + (res.win ? "won" : "fizzled");
      history.unshift({ result, win: res.win });
      if (history.length > 10) history.pop();
      $("#lb-hist").innerHTML = history.map((h) => `<span class="${h.win ? "win" : "lose"}">${h.result.toFixed(2)}×</span>`).join("");
      res.afterReveal?.();
    } finally {
      busy = false;
      btn.disabled = false;
      btn.textContent = "Launch";
    }
  });

  render();
  return {};
}
