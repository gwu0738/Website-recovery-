// =============================================================================
// Plinko — a peg board (8–16 rows) with payout buckets. The ball drops and
// bounces left/right exactly along the engine's path, then lands in its
// bucket. `onPlay({ rows, risk }, amount)` returns { outcome: { path, bucket,
// rows, risk }, win, multiplier, afterReveal }.
// =============================================================================
import { plinkoTable } from "./plinko-logic.js";

const reducedMotion = () => !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const ROW_OPTIONS = [8, 10, 12, 14, 16];
const STEP_MS = 170;

function bucketColor(m, max) {
  // red (lowest) → yellow → green (highest), on a log scale
  const t = Math.min(1, Math.log(Math.max(m, 0.2) / 0.2) / Math.log(Math.max(max, 1) / 0.2));
  const h = Math.round(t * 120);
  return `hsl(${h} 70% 48%)`;
}

import { betField, wireBetFields } from "./bet-field.js";

export function createPlinkoGame(container, { onPlay, amountLabel = "Bet" }) {
  let rows = 12;
  let risk = "medium";
  let busy = false;
  const history = [];

  container.innerHTML = `
    <div class="pk">
      <div class="pk-controls">
        <div class="toggle pk-risk">
          <button class="toggle-btn" data-r="low">Low</button>
          <button class="toggle-btn active" data-r="medium">Medium</button>
          <button class="toggle-btn" data-r="high">High</button>
        </div>
        <label class="field"><span class="k">Rows</span>
          <select id="pk-rows">${ROW_OPTIONS.map((r) => `<option value="${r}"${r === 12 ? " selected" : ""}>${r}</option>`).join("")}</select></label>
        ${betField("pk-amount", amountLabel)}
        <button id="pk-drop" class="btn btn-primary big">Drop ball</button>
        <div class="pk-hist" id="pk-hist"></div>
      </div>
      <div class="pk-stage">
        <svg id="pk-svg" class="pk-svg" viewBox="0 0 600 520"></svg>
        <div id="pk-status" class="pk-status">Choose rows and risk, then drop.</div>
      </div>
    </div>`;

  const $ = (s) => container.querySelector(s);
  wireBetFields(container);
  const svg = $("#pk-svg");
  const W = 600, TOP = 40, BOTTOM = 470;
  let geom = null;

  function build() {
    const table = plinkoTable(rows, risk);
    const max = Math.max(...table);
    const spacing = Math.min(44, (W - 40) / (rows + 3));
    const rowGap = (BOTTOM - TOP - 60) / rows;
    const cx = W / 2;
    geom = { spacing, rowGap, cx };
    let pegs = "", buckets = "";
    for (let r = 0; r < rows; r++) {
      const n = r + 3;
      for (let i = 0; i < n; i++) {
        const x = cx + (i - (n - 1) / 2) * spacing;
        pegs += `<circle cx="${x}" cy="${TOP + r * rowGap}" r="4" class="pk-peg"/>`;
      }
    }
    const by = TOP + rows * rowGap + 8;
    const bw = spacing - 4;
    table.forEach((m, k) => {
      const x = cx + (k - rows / 2) * spacing;
      buckets += `<g class="pk-bucket" data-k="${k}"><rect x="${x - bw / 2}" y="${by}" width="${bw}" height="30" rx="5" fill="${bucketColor(m, max)}"/>
        <text x="${x}" y="${by + 20}">${m >= 100 ? Math.round(m) : m}${bw > 30 ? "×" : ""}</text></g>`;
    });
    svg.innerHTML = `<g>${pegs}</g><g>${buckets}</g><circle id="pk-ball" class="pk-ball" r="7" cx="${cx}" cy="${TOP - 24}" hidden/>`;
  }

  container.querySelectorAll(".pk-risk .toggle-btn").forEach((b) =>
    b.addEventListener("click", () => {
      if (busy) return;
      risk = b.dataset.r;
      container.querySelectorAll(".pk-risk .toggle-btn").forEach((x) => x.classList.toggle("active", x === b));
      build();
    }));
  $("#pk-rows").addEventListener("change", () => {
    if (busy) return;
    rows = Number($("#pk-rows").value);
    build();
  });

  // Walk the ball peg to peg: at row r it sits above the peg it hits, then
  // hops half a spacing left or right with a little arc.
  function drop(path) {
    const ball = svg.querySelector("#pk-ball");
    const { spacing, rowGap, cx } = geom;
    ball.hidden = false;
    let p = 0; // horizontal position in half-spacings
    const points = [[cx, TOP - 24]];
    path.forEach((d, r) => {
      points.push([cx + p * spacing, TOP + r * rowGap - 9]); // on the peg
      p += d === "R" ? 0.5 : -0.5;
    });
    points.push([cx + p * spacing, TOP + rows * rowGap + 14]); // into the bucket
    if (reducedMotion()) {
      const [x, y] = points[points.length - 1];
      ball.setAttribute("cx", x);
      ball.setAttribute("cy", y);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let i = 0;
      let t0 = performance.now();
      const frame = (now) => {
        const t = Math.min(1, (now - t0) / STEP_MS);
        const [x0, y0] = points[i], [x1, y1] = points[i + 1];
        const arc = Math.sin(t * Math.PI) * 10; // small bounce between pegs
        ball.setAttribute("cx", x0 + (x1 - x0) * t);
        ball.setAttribute("cy", y0 + (y1 - y0) * (t * t) - arc);
        if (t < 1) return requestAnimationFrame(frame);
        i++;
        t0 = now;
        if (i < points.length - 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  $("#pk-drop").addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    const btn = $("#pk-drop");
    btn.disabled = true;
    btn.textContent = "Dropping…";
    svg.querySelectorAll(".pk-bucket.hit").forEach((b) => b.classList.remove("hit"));
    try {
      const amount = parseFloat($("#pk-amount").value) || 0;
      const res = await onPlay({ rows, risk }, amount);
      if (!res) return;
      $("#pk-status").textContent = "Bouncing…";
      await drop(res.outcome.path);
      const bucket = svg.querySelector(`.pk-bucket[data-k="${res.outcome.bucket}"]`);
      bucket?.classList.add("hit");
      $("#pk-status").textContent = `${res.multiplier}× — bucket ${res.outcome.bucket + 1} of ${rows + 1}${res.win ? " · win" : ""}`;
      history.unshift({ m: res.multiplier, win: res.win });
      if (history.length > 10) history.pop();
      $("#pk-hist").innerHTML = history.map((h) => `<span class="${h.win ? "win" : "lose"}">${h.m}×</span>`).join("");
      res.afterReveal?.();
    } finally {
      busy = false;
      btn.disabled = false;
      btn.textContent = "Drop ball";
    }
  });

  build();
  return {};
}
