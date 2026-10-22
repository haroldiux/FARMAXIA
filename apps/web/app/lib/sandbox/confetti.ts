/** Confetti pieces for the training-completed dialog. Pure and seeded so a mount is stable. */

export interface ConfettiPiece {
  id: number;
  /** Burst direction in degrees (0-360). */
  angle: number;
  /** Burst distance in px. */
  distance: number;
  /** Extra downward travel in px while falling. */
  fall: number;
  /** Total spin in degrees. */
  rotation: number;
  delayMs: number;
  durationMs: number;
  /** Width in px; the height is derived in CSS. */
  size: number;
  color: string;
}

/** System palette tokens plus a few festive accents. */
export const CONFETTI_COLORS: readonly string[] = [
  "var(--blue)",
  "var(--blue-ink)",
  "var(--training-amber)",
  "#ec4899",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#06b6d4",
];

/** Small deterministic PRNG (mulberry32). */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createConfettiPieces(count: number, seed: number): ConfettiPiece[] {
  const random = seededRandom(seed);
  const between = (min: number, max: number) => min + random() * (max - min);
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, id) => ({
    id,
    angle: between(0, 360),
    distance: between(120, 520),
    fall: between(160, 520),
    rotation: between(-720, 720),
    delayMs: Math.round(between(0, 200)),
    durationMs: Math.round(between(1600, 2400)),
    size: Math.round(between(6, 12)),
    color: CONFETTI_COLORS[Math.floor(random() * CONFETTI_COLORS.length)]!,
  }));
}

/** Time after which every piece has finished its animation. */
export function confettiLifetimeMs(pieces: readonly ConfettiPiece[]): number {
  return pieces.reduce((max, piece) => Math.max(max, piece.delayMs + piece.durationMs), 0);
}
