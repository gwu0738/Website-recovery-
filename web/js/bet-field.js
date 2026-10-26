// =============================================================================
// Bet amount stepper shared by every game: −/+ steps, MIN, ½, 2×, MAX.
// MAX follows the player's balance (the app keeps the limits up to date).
// =============================================================================
let limits = { min: 0.001, max: null, step: 0.001 };
const fmt = (v) => (Math.round(v * 1e6) / 1e6).toString();

export function betField(id, label = "Bet") {
  return `<div class="betf" data-bet-field>
    <span class="k">${label}</span>
    <div class="betf-row">
      <button type="button" class="betf-btn" data-op="minus" aria-label="less">−</button>
      <input id="${id}" type="number" step="0.001" min="0" value="0.001" inputmode="decimal" />
      <button type="button" class="betf-btn" data-op="plus" aria-label="more">+</button>
    </div>
    <div class="betf-row2">
      <button type="button" class="betf-mini" data-op="min">MIN</button>
      <button type="button" class="betf-mini" data-op="half">½</button>
      <button type="button" class="betf-mini" data-op="double">2×</button>
      <button type="button" class="betf-mini" data-op="max">MAX</button>
    </div>
  </div>`;
}

/** The app calls this whenever the balance (or server limits) change. */
export function setBetLimits(next) {
  limits = { ...limits, ...next };
}

export function wireBetFields(container) {
  container.querySelectorAll("[data-bet-field]").forEach((f) => {
    const input = f.querySelector("input");
    f.querySelectorAll("[data-op]").forEach((b) =>
      b.addEventListener("click", () => {
        let v = parseFloat(input.value) || 0;
        switch (b.dataset.op) {
          case "minus": v -= limits.step; break;
          case "plus": v += limits.step; break;
          case "min": v = limits.min; break;
          case "half": v /= 2; break;
          case "double": v *= 2; break;
          case "max": v = limits.max ?? v; break;
        }
        v = Math.max(limits.min, v);
        if (limits.max != null) v = Math.min(limits.max, v);
        input.value = fmt(v);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }));
  });
}
