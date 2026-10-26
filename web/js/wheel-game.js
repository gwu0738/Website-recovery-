// =============================================================================
// Wheel — a segmented wheel per risk level. It spins and stops with the
// engine's segment under the pointer. `onPlay({ risk }, amount)` returns
// { outcome: { segment, multiplier }, win, afterReveal }.
// =============================================================================
import { WHEEL_SEGMENTS } from "./games.js";

const SPIN_MS = 4000;
const reducedMotion = () => !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const colorFor = (m) => (m === 0 ? "#1e2130" : m < 1.6 ? "#1f9d6b" : m < 4 ? "#7c5cff" : "#d9a83c");

function polar(cx, cy, r, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function wedge(cx, cy, r0, r1, a0, a1) {
  const [x0, y0] = polar(cx, cy, r1, a0), [x1, y1] = polar(cx, cy, r1, a1);
  const [x2, y2] = polar(cx, cy, r0, a1), [x3, y3] = polar(cx, cy, r0, a0);
  return `M${x0} ${y0} A${r1} ${r1} 0 0 1 ${x1} ${y1} L${x2} ${y2} A${r0} ${r0} 0 0 0 ${x3} ${y3} Z`;
}

export function createWheelGame(container, { onPlay, amountLabel = "Bet" }) {
  let risk = "medium";
  let busy = false;
  let deg = 0;
  const history = [];

  container.innerHTML = `
    <div class="wh">
      <div class="wh-controls">
        <div class="toggle wh-risk">
          <button class="toggle-btn" data-r="low">Low</button>
          <button class="toggle-btn active" data-r="medium">Medium</button>
          <button class="toggle-btn" data-r="high">High</button>
        </div>
        <div class="wh-legend" id="wh-legend"></div>
        <label class="field"><span class="k">${amountLabel}</span>
          <input id="wh-amount" type="number" step="0.001" min="0" value="0.001" /></label>
        <button id="wh-spin" class="btn btn-primary big">Spin</button>
      </div>
      <div class="wh-stage">
        <div class="wh-wrap">
          <div class="wh-pointer"></div>
          <div class="wh-rotor" id="wh-rotor"></div>
          <div class="wh-center" id="wh-center">—</div>
        </div>
        <div class="wh-status" id="wh-status">Pick a risk level and spin.</div>
        <div class="wh-hist" id="wh-hist"></div>
      </div>
    </div>`;

  const $ = (s) => container.querySelector(s);
  const rotor = $("#wh-rotor");

  function build() {
    const segs = WHEEL_SEGMENTS[risk];
    const step = 360 / segs.length;
    let paths = "", labels = "";
    segs.forEach((m, i) => {
      const a0 = i * step, a1 = (i + 1) * step, mid = a0 + step / 2;
      paths += `<path d="${wedge(200, 200, 110, 190, a0, a1)}" fill="${colorFor(m)}" stroke="#0a0b10" stroke-width="2" data-seg="${i}"/>`;
      const [lx, ly] = polar(200, 200, 150, mid);
      labels += `<text x="${lx}" y="${ly}" transform="rotate(${mid} ${lx} ${ly})" class="wh-lbl">${m ? m + "×" : "0"}</text>`;
    });
    rotor.innerHTML = `<svg viewBox="0 0 400 400" class="wh-svg"><circle cx="200" cy="200" r="196" fill="#2a2412"/>${paths}${labels}<circle cx="200" cy="200" r="108" fill="#11131c" stroke="#c9a24a" stroke-width="3"/></svg>`;
    const counts = {};
    segs.forEach((m) => (counts[m] = (counts[m] || 0) + 1));
    $("#wh-legend").innerHTML = Object.entries(counts).sort((a, b) => b[0] - a[0])
      .map(([m, n]) => `<span><i style="background:${colorFor(+m)}"></i>${+m ? m + "×" : "0×"} <small>${n}/${segs.length}</small></span>`).join("");
  }

  container.querySelectorAll(".wh-risk .toggle-btn").forEach((b) =>
    b.addEventListener("click", () => {
      if (busy) return;
      risk = b.dataset.r;
      container.querySelectorAll(".wh-risk .toggle-btn").forEach((x) => x.classList.toggle("active", x === b));
      build();
    }));

  function spinTo(segment) {
    const segs = WHEEL_SEGMENTS[risk];
    const step = 360 / segs.length;
    const target = (360 - (segment + 0.5) * step) % 360;
    const cur = ((deg % 360) + 360) % 360;
    const end = deg + 5 * 360 + ((target - cur + 360) % 360);
    const start = deg;
    if (reducedMotion()) {
      deg = end;
      rotor.style.transform = `rotate(${deg}deg)`;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const t0 = performance.now();
      const frame = (now) => {
        const t = Math.min(1, (now - t0) / SPIN_MS);
        deg = start + (end - start) * easeOut(t);
        rotor.style.transform = `rotate(${deg}deg)`;
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  $("#wh-spin").addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    const btn = $("#wh-spin");
    btn.disabled = true;
    btn.textContent = "Spinning…";
    $("#wh-center").className = "wh-center";
    try {
      const amount = parseFloat($("#wh-amount").value) || 0;
      const res = await onPlay({ risk }, amount);
      if (!res) return;
      $("#wh-status").textContent = "Spinning…";
      await spinTo(res.outcome.segment);
      const m = res.outcome.multiplier;
      $("#wh-center").textContent = m ? m + "×" : "0×";
      $("#wh-center").className = "wh-center " + (res.win ? "win" : "lose");
      rotor.querySelectorAll("[data-seg]").forEach((p) => p.classList.toggle("hit", +p.dataset.seg === res.outcome.segment));
      $("#wh-status").textContent = res.win ? `🎡 Landed on ${m}× — win!` : "🎡 Landed on 0× — no win.";
      history.unshift({ m, win: res.win });
      if (history.length > 12) history.pop();
      $("#wh-hist").innerHTML = history.map((h) => `<span class="${h.win ? "win" : "lose"}">${h.m}×</span>`).join("");
      res.afterReveal?.();
    } finally {
      busy = false;
      btn.disabled = false;
      btn.textContent = "Spin";
    }
  });

  build();
  return {};
}
