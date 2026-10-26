// =============================================================================
// Game logos — inline SVG so they render everywhere (normal site AND the
// sandboxed single-file preview, which can't fetch external .svg files).
// Each uses the brand gradient (teal -> violet). Unique gradient ids avoid
// collisions when several render on the same page.
// Standalone copies live in web/assets/games/*.svg for marketing use.
// =============================================================================

const g = (id) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse"><stop stop-color="#00e0b8"/><stop offset="1" stop-color="#7c5cff"/></linearGradient>`;

const S = (id, body) =>
  `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" class="game-ico"><defs>${g("ic-" + id)}</defs>${body.replaceAll("GRAD", `url(#ic-${id})`)}</svg>`;

export const ICONS = {
  dice: S(
    "dice",
    `<rect x="9" y="9" width="30" height="30" rx="8" stroke="GRAD" stroke-width="2.5"/>
     <circle cx="18" cy="18" r="2.4" fill="GRAD"/><circle cx="30" cy="18" r="2.4" fill="GRAD"/>
     <circle cx="24" cy="24" r="2.4" fill="GRAD"/>
     <circle cx="18" cy="30" r="2.4" fill="GRAD"/><circle cx="30" cy="30" r="2.4" fill="GRAD"/>`,
  ),
  limbo: S(
    "limbo",
    `<path d="M11 37 L37 11" stroke="GRAD" stroke-width="2.5" stroke-linecap="round"/>
     <path d="M23 11 H37 V25" stroke="GRAD" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  crash: S(
    "crash",
    `<polyline points="9,35 18,28 24,30 33,15" stroke="GRAD" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
     <circle cx="33" cy="15" r="2.6" fill="GRAD"/>
     <path d="M33 7 V11 M39 10 L36 13 M27 10 L30 13" stroke="GRAD" stroke-width="2" stroke-linecap="round"/>`,
  ),
  mines: S(
    "mines",
    `<circle cx="21" cy="29" r="11" stroke="GRAD" stroke-width="2.5"/>
     <path d="M29 22 Q34 15 38 17" stroke="GRAD" stroke-width="2.5" stroke-linecap="round"/>
     <path d="M38 10 V14 M34 13 L37 15 M42 13 L39 15" stroke="GRAD" stroke-width="2" stroke-linecap="round"/>`,
  ),
  plinko: S(
    "plinko",
    `<circle cx="24" cy="9" r="3" fill="GRAD"/>
     <circle cx="24" cy="20" r="2" fill="GRAD"/>
     <circle cx="17" cy="28" r="2" fill="GRAD"/><circle cx="31" cy="28" r="2" fill="GRAD"/>
     <circle cx="12" cy="36" r="2" fill="GRAD"/><circle cx="24" cy="36" r="2" fill="GRAD"/><circle cx="36" cy="36" r="2" fill="GRAD"/>`,
  ),
  roulette: S(
    "roulette",
    `<circle cx="24" cy="24" r="15" stroke="GRAD" stroke-width="2.5"/>
     <path d="M24 9 V39 M9 24 H39 M13.5 13.5 L34.5 34.5 M34.5 13.5 L13.5 34.5" stroke="GRAD" stroke-width="1.6"/>
     <circle cx="24" cy="24" r="3" fill="GRAD"/>`,
  ),
  wheel: S(
    "wheel",
    `<path d="M24 6 L19.5 13 H28.5 Z" fill="GRAD"/>
     <circle cx="24" cy="27" r="13" stroke="GRAD" stroke-width="2.5"/>
     <path d="M24 14 V40 M11 27 H37 M15 18 L33 36 M33 18 L15 36" stroke="GRAD" stroke-width="1.4"/>`,
  ),
  coinflip: S(
    "coinflip",
    `<ellipse cx="25" cy="25" rx="10" ry="13" stroke="GRAD" stroke-width="2.5"/>
     <path d="M25 19 V31 M22 22 H27 A2.5 2.5 0 0 1 27 27 H22 A2.5 2.5 0 0 0 22 32 H28" stroke="GRAD" stroke-width="1.8" stroke-linecap="round"/>
     <path d="M11 16 A11 11 0 0 1 15 11" stroke="GRAD" stroke-width="2" stroke-linecap="round"/>`,
  ),
  chicken: S(
    "chicken",
    `<circle cx="22" cy="26" r="11" stroke="GRAD" stroke-width="2.5"/>
     <circle cx="18" cy="23" r="1.8" fill="GRAD"/>
     <path d="M33 25 L39 27 L33 29 Z" fill="GRAD"/>
     <path d="M22 15 V10 M18 12 L22 15 L26 12" stroke="GRAD" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  tower: S(
    "tower",
    `<rect x="13" y="10" width="9" height="9" rx="1.5" stroke="GRAD" stroke-width="2"/>
     <rect x="26" y="10" width="9" height="9" rx="1.5" stroke="GRAD" stroke-width="2"/>
     <rect x="13" y="21" width="9" height="9" rx="1.5" stroke="GRAD" stroke-width="2"/>
     <rect x="26" y="21" width="9" height="9" rx="1.5" fill="GRAD" opacity="0.25" stroke="GRAD" stroke-width="2"/>
     <rect x="13" y="32" width="9" height="9" rx="1.5" fill="GRAD" opacity="0.25" stroke="GRAD" stroke-width="2"/>
     <rect x="26" y="32" width="9" height="9" rx="1.5" stroke="GRAD" stroke-width="2"/>`,
  ),
  hilo: S(
    "hilo",
    `<rect x="10" y="8" width="20" height="28" rx="3" stroke="GRAD" stroke-width="2.2" transform="rotate(-8 20 22)"/>
     <rect x="20" y="12" width="20" height="28" rx="3" stroke="GRAD" stroke-width="2.2" fill="#11131c" transform="rotate(8 30 26)"/>
     <path d="M30 20 l4 6 h-8z" fill="GRAD"/>`,
  ),
  darts: S(
    "darts",
    `<circle cx="24" cy="24" r="16" stroke="GRAD" stroke-width="2.2"/>
     <circle cx="24" cy="24" r="10" stroke="GRAD" stroke-width="1.6"/>
     <circle cx="24" cy="24" r="3.5" fill="GRAD"/>
     <path d="M24 24 L40 8 M36 8 h4 v4" stroke="GRAD" stroke-width="2.2" stroke-linecap="round"/>`,
  ),
  snakes: S(
    "snakes",
    `<path d="M12 36 c0 -8 8 -8 8 -14 s-8 -6 -8 -12" stroke="GRAD" stroke-width="3" stroke-linecap="round"/>
     <path d="M26 10 h12 M26 18 h12 M26 26 h12 M26 34 h12 M28 8 v30 M36 8 v30" stroke="GRAD" stroke-width="2" stroke-linecap="round"/>
     <circle cx="12" cy="9" r="3" fill="GRAD"/>`,
  ),
  keno: S(
    "keno",
    `<circle cx="16" cy="16" r="6" stroke="GRAD" stroke-width="2.2"/>
     <circle cx="32" cy="16" r="6" fill="GRAD"/>
     <circle cx="16" cy="32" r="6" fill="GRAD"/>
     <circle cx="32" cy="32" r="6" stroke="GRAD" stroke-width="2.2"/>`,
  ),
};
