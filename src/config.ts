/**
 * Global project configuration.
 *
 * BRAND is a single source of truth — change it here and it updates everywhere.
 * HOUSE_EDGE is the fraction the house keeps on a fair bet (0.01 = 1%).
 * Individual games may override the edge if you want.
 */
export const BRAND = {
  name: "Vanta",
  tagline: "Provably fair. Verifiably yours.",
} as const;

/** Default house edge as a fraction (0.01 = 1%). */
export const HOUSE_EDGE = 0.01;
