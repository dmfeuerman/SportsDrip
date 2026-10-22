/**
 * Attachment specs for rigid wearables — hats, eyewear, jewellery, watches,
 * headphones. Pure logic, no three.js: the rig turns the resolved transform
 * into an Object3D placement.
 *
 * A rigid wearable is authored in the space of a socket (a named point on a
 * bone in the base rig: HeadTop, Face, Neck, Wrist_L, Wrist_R). Its spec says
 * which socket, and how it sits there:
 *
 *   {
 *     socket: "HeadTop", bone: "Head",
 *     position: [x, y, z],            metres, socket space
 *     rotation: [x, y, z],            degrees, XYZ
 *     scale: 1 | [x, y, z],
 *     perHair: { afro: { position: [0, 0.06, 0] } },   by hairstyle
 *     perFace: { square: { scale: [1.02, 1, 1] } },    by face shape
 *     perBuild: { broad: { position: [0, 0, 0.006] } }, at the end of the
 *                                                      build slider, scaled in
 *     with:    { top_hoodie: { scale: 1.08 }, outerwear: { hidden: true } },
 *                                                      by another worn item's template id or slot
 *   }
 *
 * The spec ships inside the asset (GLB metadata `sdAvatar.attach`), and a
 * catalog document may override any part of it with its own `attach` field,
 * so one item can be nudged without touching others or releasing the app.
 * Offsets compose: positions and rotations add, scales multiply.
 */

export type Vec3 = [number, number, number];

export interface AttachTransform {
  position?: Vec3;
  rotation?: Vec3;
  scale?: number | Vec3;
  hidden?: boolean;
}

export interface AttachSpec extends AttachTransform {
  socket?: string;
  bone?: string;
  perHair?: Record<string, AttachTransform>;
  perFace?: Record<string, AttachTransform>;
  /** At the slim (-1) and broad (+1) ends of the build; applied in proportion. */
  perBuild?: { slim?: AttachTransform; broad?: AttachTransform };
  with?: Record<string, AttachTransform>;
}

export interface AttachContext {
  hairStyle?: string;
  faceShape?: string;
  /** Body build, -1 (slim) … 1 (broad). */
  build?: number;
  /** Template ids and slots of the other items being worn. */
  worn?: Array<{ template: string | null; slot: string }>;
}

export interface ResolvedAttach {
  socket: string | null;
  bone: string | null;
  position: Vec3;
  /** Radians. */
  rotation: Vec3;
  scale: Vec3;
  hidden: boolean;
}

const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
const vec = (v: unknown, d: Vec3): Vec3 => (isVec3(v) ? [v[0], v[1], v[2]] : d);
const scale3 = (s: unknown): Vec3 => (typeof s === "number" && Number.isFinite(s) && s > 0 ? [s, s, s] : isVec3(s) && s.every((n) => n > 0) ? [s[0], s[1], s[2]] : [1, 1, 1]);

/** Adds a transform's offsets, `k` of the way (0 … 1). */
function apply(out: ResolvedAttach, t: AttachTransform | undefined | null, k = 1) {
  if (!t || typeof t !== "object" || k <= 0) return;
  const p = vec(t.position, [0, 0, 0]);
  const r = vec(t.rotation, [0, 0, 0]);
  const s = scale3(t.scale);
  for (let i = 0; i < 3; i++) {
    out.position[i] = out.position[i]! + p[i]! * k;
    out.rotation[i] = out.rotation[i]! + ((r[i]! * Math.PI) / 180) * k;
    out.scale[i] = out.scale[i]! * Math.pow(s[i]!, k);
  }
  if (t.hidden === true && k >= 0.5) out.hidden = true;
}

/** A spec with an override merged over it (override wins, per key; maps merge per entry). */
export function mergeAttach(base: AttachSpec | null | undefined, override: AttachSpec | null | undefined): AttachSpec | null {
  if (!base && !override) return null;
  const b = base ?? {};
  const o = override ?? {};
  const map = <K extends "perHair" | "perFace" | "with" | "perBuild">(k: K) => {
    const m: Record<string, AttachTransform> = { ...((b[k] ?? {}) as Record<string, AttachTransform>) };
    for (const [key, v] of Object.entries((o[k] ?? {}) as Record<string, AttachTransform>)) m[key] = { ...(m[key] ?? {}), ...v };
    return (Object.keys(m).length ? m : undefined) as AttachSpec[K];
  };
  return {
    ...b,
    ...o,
    perHair: map("perHair"),
    perFace: map("perFace"),
    perBuild: map("perBuild"),
    with: map("with"),
  };
}

/**
 * Where a rigid wearable sits for this look: its base transform, then the
 * face-shape, build and hairstyle entries, then any rules for what else is
 * worn (a template id beats its slot).
 */
export function resolveAttach(spec: AttachSpec | null | undefined, ctx: AttachContext = {}): ResolvedAttach {
  const out: ResolvedAttach = {
    socket: spec?.socket ?? null,
    bone: spec?.bone ?? null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    hidden: false,
  };
  if (!spec) return out;
  apply(out, spec);
  if (ctx.faceShape) apply(out, spec.perFace?.[ctx.faceShape]);
  if (ctx.build) apply(out, ctx.build < 0 ? spec.perBuild?.slim : spec.perBuild?.broad, Math.min(1, Math.abs(ctx.build)));
  if (ctx.hairStyle) apply(out, spec.perHair?.[ctx.hairStyle]);
  for (const w of ctx.worn ?? []) {
    const rule = (w.template && spec.with?.[w.template]) || spec.with?.[w.slot];
    apply(out, rule);
  }
  return out;
}

/** Stable key for a resolved placement (portrait caching). */
export function attachKey(a: ResolvedAttach): string {
  const r = (n: number) => Math.round(n * 1e4) / 1e4;
  return [a.socket, ...a.position.map(r), ...a.rotation.map(r), ...a.scale.map(r), a.hidden ? 1 : 0].join(",");
}
