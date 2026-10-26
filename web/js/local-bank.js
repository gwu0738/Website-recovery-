// =============================================================================
// Balance kept in this browser when no server is connected (the single-file
// preview, or the site served without its backend). Nothing here is money.
// =============================================================================
const KEY = "vanta_local_balance";
const START = 1; // starting balance, in SOL units

export function localBalance() {
  try {
    const v = parseFloat(localStorage.getItem(KEY));
    return Number.isFinite(v) ? v : START;
  } catch {
    return START;
  }
}
export function setLocalBalance(v) {
  const clean = Math.max(0, Math.round(v * 1e9) / 1e9);
  try { localStorage.setItem(KEY, String(clean)); } catch { /* storage unavailable */ }
  return clean;
}
export function resetLocalBalance() {
  return setLocalBalance(START);
}
