/**
 * Pure helpers behind the team crest and the team info strip. No React, no
 * network: everything here is derived on the device from what the games feed
 * already carries.
 */
export type FormResult = "W" | "L" | "D";
export type CrestShape = "shield" | "roundel" | "hex" | "plate";
export type CrestPattern = "band" | "chevron" | "stripes" | "sash" | "halves";

const SHAPES: CrestShape[] = ["shield", "roundel", "hex", "plate"];
const PATTERNS: CrestPattern[] = ["band", "chevron", "stripes", "sash", "halves"];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The same team always gets the same crest; different teams usually differ. */
export function crestStyle(abbr: string, sport?: string | null): { shape: CrestShape; pattern: CrestPattern } {
  const h = hash(`${sport ?? ""}:${abbr.toUpperCase()}`);
  return { shape: SHAPES[h % SHAPES.length]!, pattern: PATTERNS[(h >>> 3) % PATTERNS.length]! };
}

const HEX = /^#?([0-9a-f]{6})$/i;

export function normHex(c: string | null | undefined): string | null {
  const m = c ? HEX.exec(c) : null;
  return m ? `#${m[1]!.toUpperCase()}` : null;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 0 (identical) to ~441 (black vs white). */
export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/** Lighten (amt > 0) or darken (amt < 0) a hex colour. */
export function shade(hex: string, amt: number): string {
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + (amt < 0 ? v * amt : (255 - v) * amt))));
  const [r, g, b] = rgb(hex);
  return `#${((f(r) << 16) | (f(g) << 8) | f(b)).toString(16).padStart(6, "0")}`;
}

export function isLight(hex: string): boolean {
  const [r, g, b] = rgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 160;
}

/**
 * Trim colour for a crest: the first candidate that is a real colour and far
 * enough from the base to read; otherwise white or near-black.
 */
export function pickTrim(base: string, ...candidates: Array<string | null | undefined>): string {
  for (const c of candidates) {
    const n = normHex(c);
    if (n && colorDistance(base, n) >= 70) return n;
  }
  return isLight(base) ? "#0B1220" : "#FFFFFF";
}

/** Current run from results listed newest first: W,W,L -> { kind: "W", count: 2 }. */
export function streakOf(form: readonly FormResult[] | null | undefined): { kind: FormResult; count: number } | null {
  if (!form?.length) return null;
  const kind = form[0]!;
  let count = 0;
  for (const r of form) {
    if (r !== kind) break;
    count++;
  }
  return { kind, count };
}

/** "4-1" (or "3-1-1" with draws) over the results given. */
export function formRecord(form: readonly FormResult[] | null | undefined): string | null {
  if (!form?.length) return null;
  const w = form.filter((r) => r === "W").length;
  const l = form.filter((r) => r === "L").length;
  const d = form.length - w - l;
  return d ? `${w}-${l}-${d}` : `${w}-${l}`;
}

/** Win share of a "9-3" or "9-3-1" record, or null when it can't be read. */
export function winPct(record: string | null | undefined): number | null {
  const m = record ? /^(\d+)-(\d+)(?:-(\d+))?$/.exec(record.trim()) : null;
  if (!m) return null;
  const w = Number(m[1]);
  const l = Number(m[2]);
  const t = Number(m[3] ?? 0);
  const n = w + l + t;
  return n > 0 ? (w + t / 2) / n : null;
}

/** "5-1 Home" -> "5-1". */
export function splitOnly(split: string | null | undefined): string | null {
  const m = split ? /^\s*(\d+-\d+(?:-\d+)?)/.exec(split) : null;
  return m ? m[1]! : null;
}

/** Nickname without the city: ("Detroit Lions", "Detroit") -> "Lions". */
export function nickname(name: string, location?: string | null): string {
  if (location && name.startsWith(location)) return name.slice(location.length).trim() || name;
  return name;
}
