// =============================================================================
// Darts — a real dartboard: twenty numbered wedges, wire lines, and six
// concentric scoring rings (0.5× outer singles … 8.5× bull), coloured like a
// tournament board. The dart flies in from the player's hand and sticks in
// the ring the engine picked (the wedge/angle is cosmetic).
// `onPlay({ difficulty }, amount)` returns { outcome: { band, multiplier }, win, afterReveal }.
// =============================================================================
import { DARTS_MULTIPLIERS, DARTS_WEIGHTS } from "./games.js";
import { betField, wireBetFields } from "./bet-field.js";

const DIFFS = ["easy", "medium", "hard", "expert"];
const NUMBERS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
// Outer radius of band 0..5 (band 0 is the wide outer ring, band 5 the bull).
const RINGS = [150, 118, 90, 64, 40, 16];
// Two alternating tones per band, like a real board's singles/doubles/trebles.
const TONES = [
  ["#1c1d24", "#e9e2cf"], // 0.5× singles (black / cream)
  ["#b3202e", "#1f8f4a"], // 0.8× doubles ring (red / green)
  ["#1c1d24", "#e9e2cf"], // 1.2× inner singles
  ["#b3202e", "#1f8f4a"], // 1.5× trebles ring
  ["#1f8f4a", "#1f8f4a"], // 2.7× outer bull (green)
  ["#b3202e", "#b3202e"], // 8.5× bull (red)
];
const LEGEND = ["#5a5c66", "#b3202e", "#9a9484", "#1f8f4a", "#2bbf6a", "#ff4d5e"];
const reducedMotion = () => !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const FLIGHT_MS = 700;

const polar = (cx, cy, r, deg) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};
function wedge(cx, cy, r0, r1, a0, a1) {
  const [x0, y0] = polar(cx, cy, r1, a0), [x1, y1] = polar(cx, cy, r1, a1);
  const [x2, y2] = polar(cx, cy, r0, a1), [x3, y3] = polar(cx, cy, r0, a0);
  return `M${x0} ${y0} A${r1} ${r1} 0 0 1 ${x1} ${y1} L${x2} ${y2} A${r0} ${r0} 0 0 0 ${x3} ${y3} Z`;
}

function boardSvg() {
  const C = 200;
  let sectors = "";
  for (let band = 0; band < 6; band++) {
    const r1 = RINGS[band], r0 = band < 5 ? RINGS[band + 1] : 0;
    if (band === 5) {
      sectors += `<circle cx="${C}" cy="${C}" r="${r1}" fill="${TONES[5][0]}" data-band="5"/>`;
      continue;
    }
    for (let i = 0; i < 20; i++) {
      const a0 = i * 18 - 9, a1 = a0 + 18;
      sectors += `<path d="${wedge(C, C, r0, r1, a0, a1)}" fill="${TONES[band][i % 2]}" data-band="${band}"/>`;
    }
  }
  let wires = "";
  for (let i = 0; i < 20; i++) {
    const [x0, y0] = polar(C, C, RINGS[4], i * 18 - 9), [x1, y1] = polar(C, C, 158, i * 18 - 9);
    wires += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}"/>`;
  }
  wires += RINGS.map((r) => `<circle cx="${C}" cy="${C}" r="${r}"/>`).join("");
  let numbers = "";
  NUMBERS.forEach((n, i) => {
    const [x, y] = polar(C, C, 172, i * 18);
    numbers += `<text x="${x}" y="${y}" class="dt-num">${n}</text>`;
  });
  const labels = RINGS.map((r, i) => {
    const y = C - (i < 5 ? (r + RINGS[i + 1]) / 2 : 0);
    return `<text x="${C}" y="${y + 3.5}" class="dt-mult">${DARTS_MULTIPLIERS[i]}×</text>`;
  }).join("");
  return `<svg viewBox="0 0 400 400" class="dt-board" id="dt-board">
    <defs><radialGradient id="dt-rim" cx="50%" cy="50%" r="50%"><stop offset=".9" stop-color="#101117"/><stop offset="1" stop-color="#2a2c36"/></radialGradient></defs>
    <circle cx="${C}" cy="${C}" r="198" fill="url(#dt-rim)"/>
    <circle cx="${C}" cy="${C}" r="186" fill="#0d0e13"/>
    <g>${sectors}</g>
    <g class="dt-wires">${wires}</g>
    <g>${numbers}</g>
    <g>${labels}</g>
  </svg>`;
}

const DART_SVG = `<svg viewBox="0 0 140 28" aria-hidden="true">
  <path d="M0 14 L28 10 L28 18z" fill="#dfe3f0"/>
  <rect x="28" y="10.5" width="44" height="7" rx="3.5" fill="#c9a24a"/>
  <rect x="34" y="12" width="4" height="4" fill="#8a6a26"/><rect x="44" y="12" width="4" height="4" fill="#8a6a26"/><rect x="54" y="12" width="4" height="4" fill="#8a6a26"/>
  <rect x="72" y="11.5" width="36" height="5" rx="2.5" fill="#8b90a6"/>
  <path d="M108 14 L140 2 L128 14 L140 26z" fill="#ff4d5e"/>
  <path d="M112 14 L136 5 L128 14z" fill="#ffd1d6" opacity=".6"/>
</svg>`;

export function createDartsGame(container, { onPlay, amountLabel = "Bet" }) {
  let difficulty = "medium";
  let busy = false;
  const history = [];

  container.innerHTML = `
    <div class="dt">
      <div class="dt-controls">
        <div class="toggle dt-diff">${DIFFS.map((d) => `<button class="toggle-btn${d === "medium" ? " active" : ""}" data-d="${d}">${d[0].toUpperCase() + d.slice(1)}</button>`).join("")}</div>
        <div class="dt-odds" id="dt-odds"></div>
        <button id="dt-throw" class="btn btn-primary big">Throw</button>
        ${betField("dt-amount", amountLabel)}
      </div>
      <div class="dt-stage">
        <div class="dt-max">MAX PAYOUT <strong>×${Math.max(...DARTS_MULTIPLIERS)}</strong></div>
        <div class="dt-board-wrap" id="dt-wrap">
          ${boardSvg()}
          <div class="dart" id="dart" hidden>${DART_SVG}</div>
        </div>
        <div class="dt-status" id="dt-status">Pick a difficulty and throw.</div>
        <div class="dt-hist" id="dt-hist"></div>
      </div>
    </div>`;

  const $ = (s) => container.querySelector(s);
  wireBetFields(container);
  const dart = $("#dart");

  function renderOdds() {
    const w = DARTS_WEIGHTS[difficulty];
    $("#dt-odds").innerHTML = DARTS_MULTIPLIERS.map((m, i) =>
      `<span><i style="background:${LEGEND[i]}"></i>${m}× <small>${(w[i] * 100).toFixed(0)}%</small></span>`).join("");
  }
  container.querySelectorAll(".dt-diff .toggle-btn").forEach((b) =>
    b.addEventListener("click", () => {
      if (busy) return;
      difficulty = b.dataset.d;
      container.querySelectorAll(".dt-diff .toggle-btn").forEach((x) => x.classList.toggle("active", x === b));
      renderOdds();
    }));

  // Fly the dart from the player's hand to a point inside the band's ring.
  function throwTo(band) {
    const wrap = $("#dt-wrap");
    const size = wrap.clientWidth || 400;
    const scale = size / 400;
    const outer = RINGS[band], inner = band < 5 ? RINGS[band + 1] : 0;
    const r = (inner + (outer - inner) * (0.3 + Math.random() * 0.45)) * scale;
    const a = Math.random() * Math.PI * 2;
    const x = size / 2 + r * Math.cos(a), y = size / 2 + r * Math.sin(a);
    dart.hidden = false;
    dart.classList.remove("stuck");
    $("#dt-board").classList.remove("hit");
    if (reducedMotion()) {
      dart.style.transition = "none";
      dart.style.transform = `translate(${x}px, ${y}px) scale(.9) rotate(-18deg)`;
      dart.classList.add("stuck");
      return Promise.resolve();
    }
    dart.style.transition = "none";
    dart.style.transform = `translate(${size * 0.85}px, ${size * 1.05}px) scale(2.8) rotate(-55deg)`;
    dart.style.opacity = "0";
    void dart.offsetWidth;
    dart.style.transition = `transform ${FLIGHT_MS}ms cubic-bezier(.15,.85,.3,1), opacity .15s`;
    dart.style.opacity = "1";
    dart.style.transform = `translate(${x}px, ${y}px) scale(.9) rotate(-18deg)`;
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
      $("#dt-board").querySelectorAll(`[data-band="${res.outcome.band}"]`).forEach((c) => c.classList.add("lit"));
      const m = res.outcome.multiplier;
      const names = ["outer single", "double ring", "inner single", "treble ring", "outer bull", "BULLSEYE"];
      $("#dt-status").textContent = `🎯 ${names[res.outcome.band]} — ${m}×${res.win ? " · win" : ""}`;
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
