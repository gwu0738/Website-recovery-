// =============================================================================
// Darts — a dartboard of six scoring rings (0.5× outer rim … 8.5× bull). The
// dart flies in and sticks in the ring the engine picked; the angle inside the
// ring is cosmetic. `onPlay({ difficulty }, amount)` returns
// { outcome: { band, multiplier }, win, afterReveal }.
// =============================================================================
import { DARTS_MULTIPLIERS, DARTS_WEIGHTS } from "./games.js";

const DIFFS = ["easy", "medium", "hard", "expert"];
// Ring outer radii for bands 0..5 (band 0 is the widest, outermost ring).
const RINGS = [150, 118, 90, 64, 40, 16];
const RING_FILL = ["#1e2130", "#2b3147", "#1f9d6b", "#2f6fd1", "#7c5cff", "#d9a83c"];
const reducedMotion = () => !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const FLIGHT_MS = 750;

const DART_SVG = `<svg viewBox="0 0 120 24" aria-hidden="true">
  <path d="M0 12 L22 8 L22 16z" fill="#e8eaf2"/>
  <rect x="22" y="9" width="40" height="6" rx="3" fill="#c9a24a"/>
  <rect x="62" y="10" width="34" height="4" fill="#8b90a6"/>
  <path d="M96 12 L120 2 L112 12 L120 22z" fill="#ff5c7a"/>
</svg>`;

export function createDartsGame(container, { onPlay, amountLabel = "Bet" }) {
  let difficulty = "medium";
  let busy = false;
  const history = [];

  const rings = RINGS.map((r, i) => `<circle cx="160" cy="160" r="${r}" fill="${RING_FILL[i]}" stroke="#0a0b10" stroke-width="2" data-band="${i}"/>`).join("");
  const labels = RINGS.map((r, i) => {
    const y = 160 - (i < 5 ? (r + RINGS[i + 1]) / 2 : 0);
    return `<text x="160" y="${y + 4}" class="dt-lbl">${DARTS_MULTIPLIERS[i]}×</text>`;
  }).join("");
  container.innerHTML = `
    <div class="dt">
      <div class="dt-controls">
        <div class="toggle dt-diff">${DIFFS.map((d) => `<button class="toggle-btn${d === "medium" ? " active" : ""}" data-d="${d}">${d[0].toUpperCase() + d.slice(1)}</button>`).join("")}</div>
        <div class="dt-odds" id="dt-odds"></div>
        <label class="field"><span class="k">${amountLabel}</span>
          <input id="dt-amount" type="number" step="0.001" min="0" value="0.001" /></label>
        <button id="dt-throw" class="btn btn-primary big">Throw</button>
      </div>
      <div class="dt-stage">
        <div class="dt-board-wrap" id="dt-wrap">
          <svg viewBox="0 0 320 320" class="dt-board" id="dt-board">
            <circle cx="160" cy="160" r="156" fill="#3a2f12"/>
            ${rings}
            <g class="dt-wires">${[0, 45, 90, 135].map((a) => `<line x1="160" y1="10" x2="160" y2="310" transform="rotate(${a} 160 160)"/>`).join("")}</g>
            ${labels}
          </svg>
          <div class="dart" id="dart" hidden>${DART_SVG}</div>
        </div>
        <div class="dt-status" id="dt-status">Pick a difficulty and throw.</div>
        <div class="dt-hist" id="dt-hist"></div>
      </div>
    </div>`;

  const $ = (s) => container.querySelector(s);
  const dart = $("#dart");

  function renderOdds() {
    const w = DARTS_WEIGHTS[difficulty];
    $("#dt-odds").innerHTML = DARTS_MULTIPLIERS.map((m, i) =>
      `<span><i style="background:${RING_FILL[i]}"></i>${m}× <small>${(w[i] * 100).toFixed(0)}%</small></span>`).join("");
  }
  container.querySelectorAll(".dt-diff .toggle-btn").forEach((b) =>
    b.addEventListener("click", () => {
      if (busy) return;
      difficulty = b.dataset.d;
      container.querySelectorAll(".dt-diff .toggle-btn").forEach((x) => x.classList.toggle("active", x === b));
      renderOdds();
    }));

  // Fly the dart in to a point inside the band's ring (angle is cosmetic).
  function throwTo(band) {
    const wrap = $("#dt-wrap");
    const size = wrap.clientWidth || 320;
    const scale = size / 320;
    const outer = RINGS[band], inner = band < 5 ? RINGS[band + 1] : 0;
    const r = (inner + (outer - inner) * (0.25 + Math.random() * 0.5)) * scale;
    const a = Math.random() * Math.PI * 2;
    const x = size / 2 + r * Math.cos(a), y = size / 2 + r * Math.sin(a);
    dart.hidden = false;
    dart.classList.remove("stuck");
    $("#dt-board").classList.remove("hit");
    if (reducedMotion()) {
      dart.style.transition = "none";
      dart.style.transform = `translate(${x}px, ${y}px) scale(1) rotate(-20deg)`;
      dart.classList.add("stuck");
      return Promise.resolve();
    }
    dart.style.transition = "none";
    dart.style.transform = `translate(${size * 0.9}px, ${size * 0.95}px) scale(2.6) rotate(-40deg)`;
    dart.style.opacity = "0";
    void dart.offsetWidth;
    dart.style.transition = `transform ${FLIGHT_MS}ms cubic-bezier(.2,.8,.3,1), opacity .2s`;
    dart.style.opacity = "1";
    dart.style.transform = `translate(${x}px, ${y}px) scale(1) rotate(-20deg)`;
    return new Promise((resolve) => setTimeout(() => {
      dart.classList.add("stuck");
      $("#dt-board").classList.add("hit");
      resolve();
    }, FLIGHT_MS));
  }

  $("#dt-throw").addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    const btn = $("#dt-throw");
    btn.disabled = true;
    btn.textContent = "Throwing…";
    $("#dt-board").querySelectorAll("[data-band]").forEach((c) => c.classList.remove("lit"));
    try {
      const amount = parseFloat($("#dt-amount").value) || 0;
      const res = await onPlay({ difficulty }, amount);
      if (!res) return;
      $("#dt-status").textContent = "…";
      await throwTo(res.outcome.band);
      $("#dt-board").querySelector(`[data-band="${res.outcome.band}"]`)?.classList.add("lit");
      const m = res.outcome.multiplier;
      $("#dt-status").textContent = res.outcome.band === 5 ? `🎯 BULLSEYE! ${m}×` : `🎯 Ring ${6 - res.outcome.band} — ${m}×${res.win ? " · win" : ""}`;
      history.unshift({ m, win: res.win });
      if (history.length > 10) history.pop();
      $("#dt-hist").innerHTML = history.map((h) => `<span class="${h.win ? "win" : "lose"}">${h.m}×</span>`).join("");
      res.afterReveal?.();
    } finally {
      busy = false;
      btn.disabled = false;
      btn.textContent = "Throw";
    }
  });

  renderOdds();
  return {};
}
