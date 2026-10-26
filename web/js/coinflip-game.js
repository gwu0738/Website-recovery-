// =============================================================================
// Coinflip — a real coin: call heads or tails, the coin flips in 3D and lands
// on the side the engine chose. Presentation only; `onPlay({ call }, amount)`
// returns { outcome: { flip }, win, multiplier, payout, afterReveal }.
// =============================================================================
const FLIP_MS = 2200;
const reducedMotion = () => !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

import { betField, wireBetFields } from "./bet-field.js";

export function createCoinflipGame(container, { onPlay, amountLabel = "Bet", multiplier = 1.98 }) {
  let call = "heads";
  let busy = false;
  let turns = 0; // accumulated Y rotation so every flip keeps spinning the same way

  container.innerHTML = `
    <div class="cf">
      <div class="cf-controls">
        <div class="toggle cf-call">
          <button class="toggle-btn active" data-c="heads">Heads</button>
          <button class="toggle-btn" data-c="tails">Tails</button>
        </div>
        <div class="cf-stats"><div><span class="k">Multiplier</span><strong>${multiplier.toFixed(2)}×</strong></div>
          <div><span class="k">Win chance</span><strong>50%</strong></div></div>
        ${betField("cf-amount", amountLabel)}
        <button id="cf-flip" class="btn btn-primary big">Flip</button>
      </div>
      <div class="cf-stage">
        <div class="coin-scene">
          <div class="coin" id="coin">
            <div class="coin-face heads"><span>H</span></div>
            <div class="coin-face tails"><span>T</span></div>
            <div class="coin-edge"></div>
          </div>
          <div class="coin-shadow" id="coin-shadow"></div>
        </div>
        <div id="cf-status" class="cf-status">Call it, then flip.</div>
        <div class="cf-hist" id="cf-hist"></div>
      </div>
    </div>`;

  const $ = (s) => container.querySelector(s);
  wireBetFields(container);
  const coin = $("#coin");
  const statusEl = $("#cf-status");
  const history = [];

  container.querySelectorAll(".cf-call .toggle-btn").forEach((b) =>
    b.addEventListener("click", () => {
      if (busy) return;
      call = b.dataset.c;
      container.querySelectorAll(".cf-call .toggle-btn").forEach((x) => x.classList.toggle("active", x === b));
    }));

  function flipTo(side) {
    // Heads is 0° (mod 360), tails is 180°. Add whole turns so it visibly spins.
    const want = side === "heads" ? 0 : 180;
    const cur = ((turns % 360) + 360) % 360;
    const extra = (want - cur + 360) % 360;
    turns += 360 * 5 + extra;
    if (reducedMotion()) {
      coin.style.transition = "none";
      coin.style.transform = `rotateY(${turns}deg)`;
      return Promise.resolve();
    }
    coin.style.transition = `transform ${FLIP_MS}ms cubic-bezier(.15,.75,.25,1)`;
    coin.classList.add("air");
    coin.style.transform = `rotateY(${turns}deg)`;
    return new Promise((r) => setTimeout(r, FLIP_MS));
  }

  $("#cf-flip").addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    const btn = $("#cf-flip");
    btn.disabled = true;
    btn.textContent = "Flipping…";
    coin.classList.remove("win", "lose");
    try {
      const amount = parseFloat($("#cf-amount").value) || 0;
      const res = await onPlay({ call }, amount);
      if (!res) return;
      statusEl.textContent = "In the air…";
      await flipTo(res.outcome.flip);
      coin.classList.remove("air");
      coin.classList.add(res.win ? "win" : "lose");
      statusEl.textContent = res.win
        ? `🪙 ${res.outcome.flip.toUpperCase()} — you called it! ×${res.multiplier.toFixed(2)}`
        : `🪙 ${res.outcome.flip.toUpperCase()} — you called ${call}.`;
      history.unshift(res.outcome.flip);
      if (history.length > 12) history.pop();
      $("#cf-hist").innerHTML = history.map((h) => `<span class="cf-hist-chip ${h}">${h[0].toUpperCase()}</span>`).join("");
      res.afterReveal?.();
    } finally {
      busy = false;
      btn.disabled = false;
      btn.textContent = "Flip";
    }
  });
  return {};
}
