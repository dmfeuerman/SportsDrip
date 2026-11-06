/**
 * Catalog-facing half of the pattern system: the spec, its validation and its
 * cache key. No three.js, so the pure outfit rules (and the server tests) can
 * use it. The shader side is patterns.ts.
 */
export const PATTERN_TYPES = [
  "stripes",
  "pinstripe",
  "check",
  "plaid",
  "dots",
  "camo",
  "digicamo",
  "tiedye",
  "flames",
  "fade",
  "marble",
  "galaxy",
  "tortoise",
  "chevron",
  "stars",
  "splatter",
  "heather",
  "leopard",
  "argyle",
  "lightning",
  "glitter",
  "scales",
] as const;
export type PatternType = (typeof PATTERN_TYPES)[number];

export interface PatternSpec {
  type: PatternType;
  /** Motif colour; defaults to the item's secondaryColor. */
  color?: string | null;
  /** Optional third colour (plaid accent, camo shadow, galaxy stars…). */
  color2?: string | null;
  /** Size multiplier, 1 = default. */
  scale?: number | null;
  /** Rotation in degrees for directional patterns (stripes, check, plaid, chevron). */
  angle?: number | null;
}

const isHex = (c: unknown): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);

/** A usable pattern from an untrusted catalog field, or null. */
export function normalizePattern(p: unknown): PatternSpec | null {
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  if (!PATTERN_TYPES.includes(o.type as PatternType)) return null;
  const scale = typeof o.scale === "number" && o.scale > 0.1 && o.scale < 10 ? o.scale : null;
  const angle = typeof o.angle === "number" && Number.isFinite(o.angle) ? o.angle : null;
  return {
    type: o.type as PatternType,
    color: isHex(o.color) ? o.color : null,
    color2: isHex(o.color2) ? o.color2 : null,
    scale,
    angle,
  };
}

/** Stable short form for cache keys; "" for no pattern. */
export function patternKey(p: PatternSpec | null | undefined): string {
  if (!p) return "";
  return `${p.type}/${(p.color ?? "").toLowerCase()}/${(p.color2 ?? "").toLowerCase()}/${p.scale ?? ""}/${p.angle ?? ""}`;
}

/** Materials the pattern is drawn on, and how much darker each is. */
export const PATTERN_MATERIALS: Record<string, number> = { primary: 1, primary_dark: 0.72 };
