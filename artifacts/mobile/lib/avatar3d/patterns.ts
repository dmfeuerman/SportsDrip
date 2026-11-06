/**
 * Procedural fabric patterns, drawn by the shader on any garment template.
 *
 * A catalog item's `pattern` turns one template into many distinct designs
 * (camo, plaid, tie-dye, flames…) with no new asset: the pattern is computed
 * from each vertex's rest-pose position in metres, so it doesn't swim when the
 * avatar moves and keeps the same scale on every garment. Only the tint
 * materials `primary` / `primary_dark` take it; trims, metal and soles keep
 * their own look.
 *
 * Colours: the item's `color` is the ground, `pattern.color` (default: the
 * item's `secondaryColor`) is the main motif, `pattern.color2` an optional
 * third colour.
 */
import * as THREE from "three";

import { PATTERN_MATERIALS, type PatternSpec, type PatternType } from "./patternSpec";
export * from "./patternSpec";

const GLSL_COMMON = /* glsl */ `
varying vec3 vSdPat;
varying vec3 vSdPatN;
uniform vec3 uSdC1;
uniform vec3 uSdC2;
uniform float uSdScale;
uniform float uSdAngle;
uniform vec2 uSdRange;

float sdHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float sdNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sdHash(i), sdHash(i + vec3(1, 0, 0)), f.x),
                 mix(sdHash(i + vec3(0, 1, 0)), sdHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(sdHash(i + vec3(0, 0, 1)), sdHash(i + vec3(1, 0, 1)), f.x),
                 mix(sdHash(i + vec3(0, 1, 1)), sdHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float sdFbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * sdNoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return s;
}
/* Distance to the nearest feature point of a 3D cell grid, and that point's id. */
vec2 sdCells(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float best = 8.0, id = 0.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    float h = sdHash(i + g);
    vec3 o = vec3(h, fract(h * 13.7), fract(h * 71.3));
    float d = length(g + o - f);
    if (d < best) { best = d; id = h; }
  }
  return vec2(best, id);
}
/* Anti-aliased step: 1 where v > edge. */
float sdAA(float edge, float v) {
  float w = max(fwidth(v), 1e-5);
  return smoothstep(edge - w, edge + w, v);
}
vec2 sdRot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
/* Triplanar weights from the rest-pose normal. */
vec3 sdTriW() {
  vec3 w = pow(abs(normalize(vSdPatN)), vec3(4.0));
  return w / (w.x + w.y + w.z + 1e-5);
}
`;

/** One 2D motif function per pattern, evaluated on each triplanar plane: returns (mix to c1, mix to c2). */
const MOTIF_2D: Partial<Record<PatternType, string>> = {
  stripes: /* glsl */ `
    float k = 0.05 * uSdScale;
    float v = fract(sdRot(uv, uSdAngle).y / k);
    return vec2(sdAA(0.5, v) * (1.0 - sdAA(0.92, v)), sdAA(0.92, v));`,
  pinstripe: /* glsl */ `
    float k = 0.022 * uSdScale;
    float v = abs(fract(sdRot(uv, uSdAngle).x / k) - 0.5);
    return vec2(1.0 - sdAA(0.06, v), 0.0);`,
  check: /* glsl */ `
    float k = 0.045 * uSdScale;
    vec2 q = fract(sdRot(uv, uSdAngle) / k);
    float a = 1.0 - sdAA(0.5, q.x), b = 1.0 - sdAA(0.5, q.y);
    return vec2(max(a, b) * 0.55 + a * b * 0.45, 0.0);`,
  plaid: /* glsl */ `
    float k = 0.11 * uSdScale;
    vec2 q = fract(sdRot(uv, uSdAngle) / k);
    float wide = max(1.0 - sdAA(0.34, abs(q.x - 0.5)) , 1.0 - sdAA(0.34, abs(q.y - 0.5)));
    float both = (1.0 - sdAA(0.34, abs(q.x - 0.5))) * (1.0 - sdAA(0.34, abs(q.y - 0.5)));
    float thin = max(1.0 - sdAA(0.02, abs(q.x - 0.06)), 1.0 - sdAA(0.02, abs(q.y - 0.06)));
    return vec2(clamp(wide * 0.55 + both * 0.45, 0.0, 1.0) * (1.0 - thin), thin);`,
  dots: /* glsl */ `
    float k = 0.04 * uSdScale;
    vec2 q = uv / k;
    q.x += 0.5 * mod(floor(q.y), 2.0);
    float d = length(fract(q) - 0.5);
    return vec2(1.0 - sdAA(0.22, d), 0.0);`,
  chevron: /* glsl */ `
    float k = 0.06 * uSdScale;
    vec2 r = sdRot(uv, uSdAngle);
    float v = fract((r.y + abs(fract(r.x / k) - 0.5) * k) / k);
    return vec2(sdAA(0.5, v) * (1.0 - sdAA(0.85, v)), sdAA(0.85, v));`,
  stars: /* glsl */ `
    float k = 0.055 * uSdScale;
    vec2 q = uv / k;
    q.x += 0.5 * mod(floor(q.y), 2.0);
    vec2 p = (fract(q) - 0.5) * 2.0;
    float a = atan(p.x, p.y);
    float r = length(p);
    float star = 0.42 + 0.2 * cos(5.0 * a);
    return vec2(1.0 - sdAA(star * 0.75, r), 0.0);`,
  argyle: /* glsl */ `
    float k = 0.08 * uSdScale;
    vec2 q = uv / vec2(k, k * 1.4);
    vec2 c = fract(q) - 0.5;
    float dia = 1.0 - sdAA(0.5, abs(c.x) + abs(c.y));
    float alt = mod(floor(q.x) + floor(q.y), 2.0);
    vec2 l = abs(fract(q + 0.5) - 0.5);
    float line = 1.0 - sdAA(0.025, abs(l.x - l.y * 1.0));
    return vec2(dia * alt, line);`,
  lightning: /* glsl */ `
    float k = 0.14 * uSdScale;
    vec2 r = sdRot(uv, uSdAngle);
    float zig = abs(fract(r.x / (k * 0.5)) - 0.5) * k * 0.6;
    float v = fract((r.y + zig) / k);
    float bolt = 1.0 - sdAA(0.09, abs(v - 0.5));
    return vec2(bolt, (1.0 - sdAA(0.03, abs(v - 0.5))));`,
  scales: /* glsl */ `
    float k = 0.018 * uSdScale;
    vec2 q = uv / k;
    q.x += 0.5 * mod(floor(q.y), 2.0);
    vec2 c = fract(q) - vec2(0.5, 0.0);
    float r = length(c);
    float edge = 1.0 - sdAA(0.07, abs(r - 0.62));
    return vec2(edge, smoothstep(0.7, 0.1, r) * 0.25);`,
};

/** Solid (3D) patterns: evaluated once on the position. Same return convention. */
const MOTIF_3D: Partial<Record<PatternType, string>> = {
  camo: /* glsl */ `
    vec3 q = p / (0.09 * uSdScale);
    float a = sdFbm(q), b = sdFbm(q + 37.0);
    return vec2(sdAA(0.52, a) * (1.0 - sdAA(0.55, b)), sdAA(0.55, b) * sdAA(0.45, a));`,
  digicamo: /* glsl */ `
    float px = 0.011 * uSdScale;
    vec3 q = floor(p / px) * px / (0.08 * uSdScale);
    float a = sdFbm(q), b = sdFbm(q + 19.0);
    return vec2(step(0.52, a) * (1.0 - step(0.56, b)), step(0.56, b));`,
  tiedye: /* glsl */ `
    vec3 q = p / (0.09 * uSdScale);
    float w = sdFbm(q * 1.3 + 3.5 * vec3(sdFbm(q * 0.7), sdFbm(q * 0.7 + 7.0), sdFbm(q * 0.7 + 13.0)));
    float band = 0.5 + 0.5 * sin(w * 22.0);
    float band2 = 0.5 + 0.5 * sin(w * 22.0 + 2.1);
    return vec2(smoothstep(0.3, 0.8, band), smoothstep(0.65, 0.95, band2) * 0.9);`,
  flames: /* glsl */ `
    float h = clamp((p.y - uSdRange.x) / max(uSdRange.y - uSdRange.x, 0.01), 0.0, 1.0);
    float n = sdFbm(vec3(p.x * 22.0, p.y * 9.0, p.z * 22.0) / uSdScale);
    float tongue = h + 0.55 * n - 0.15 * sin(atan(p.x, p.z) * 9.0);
    float outer = 1.0 - sdAA(0.62, tongue);
    float inner = 1.0 - sdAA(0.42, tongue);
    return vec2(outer * (1.0 - inner), inner);`,
  fade: /* glsl */ `
    float h = clamp((p.y - uSdRange.x) / max(uSdRange.y - uSdRange.x, 0.01), 0.0, 1.0);
    h = smoothstep(0.0, 1.0, h + 0.05 * (sdNoise(p * 60.0) - 0.5));
    return vec2(1.0 - h, 0.0);`,
  marble: /* glsl */ `
    vec3 q = p / (0.12 * uSdScale);
    float v = sin((q.x + q.y * 0.6 + 3.0 * sdFbm(q * 1.7)) * 3.1416);
    float vein = 1.0 - sdAA(0.06, abs(v));
    return vec2(0.25 * smoothstep(-1.0, 1.0, v), vein);`,
  galaxy: /* glsl */ `
    vec3 q = p / (0.1 * uSdScale);
    float neb = smoothstep(0.42, 0.78, sdFbm(q + sdFbm(q * 2.0)));
    float cell = sdHash(floor(p * 900.0 / uSdScale));
    float star = step(0.985, cell);
    return vec2(neb, star);`,
  tortoise: /* glsl */ `
    vec3 q = p / (0.02 * uSdScale);
    float a = sdFbm(q), b = sdFbm(q * 2.3 + 5.0);
    return vec2(smoothstep(0.45, 0.62, a), smoothstep(0.55, 0.7, b) * smoothstep(0.5, 0.6, a));`,
  splatter: /* glsl */ `
    vec3 q = p / (0.05 * uSdScale);
    float a = sdFbm(q * 1.3), b = sdFbm(q * 1.3 + 41.0);
    float specks = step(0.93, sdHash(floor(p * 260.0 / uSdScale)));
    return vec2(sdAA(0.66, a) + specks * (1.0 - sdAA(0.66, a)), sdAA(0.68, b));`,
  heather: /* glsl */ `
    float n = sdNoise(p * vec3(900.0, 300.0, 900.0) / uSdScale);
    float m = sdNoise(p * 2200.0 / uSdScale);
    return vec2(smoothstep(0.45, 0.8, n) * 0.7, step(0.8, m) * 0.6);`,
  leopard: /* glsl */ `
    vec3 q = p / (0.03 * uSdScale);
    q += 0.35 * vec3(sdNoise(q * 1.7), sdNoise(q * 1.7 + 9.0), sdNoise(q * 1.7 + 17.0));
    float d = sdCells(q).x;
    float ring = (1.0 - sdAA(0.42, d)) * sdAA(0.26, d);
    float centre = 1.0 - sdAA(0.26, d);
    return vec2(ring, centre * 0.55);`,
  glitter: /* glsl */ `
    vec3 g = floor(p * 700.0 / uSdScale);
    float h = sdHash(g);
    float flake = step(0.6, h) * (0.5 + 0.5 * sin(h * 50.0 + dot(normalize(vSdPatN), vec3(3.0, 5.0, 7.0))));
    return vec2(flake * 0.8, step(0.97, h));`,
};

const motifCall = (type: PatternType) => {
  if (MOTIF_3D[type]) return `vec2 sdMotif(vec3 p) {${MOTIF_3D[type]}\n}`;
  // 2D motif projected on the three axis planes (front, side, top), blended by the rest normal.
  return `vec2 sdMotif2(vec2 uv) {${MOTIF_2D[type]}\n}
vec2 sdMotif(vec3 p) {
  vec3 w = sdTriW();
  return w.z * sdMotif2(p.xy) + w.x * sdMotif2(vec2(-p.z * sign(vSdPatN.x + 1e-4), p.y)) + w.y * sdMotif2(p.xz);
}`;
};

export interface PatternUniforms {
  uSdC1: { value: THREE.Color };
  uSdC2: { value: THREE.Color };
  uSdScale: { value: number };
  uSdAngle: { value: number };
  uSdRange: { value: THREE.Vector2 };
}

/** Rest-pose positions (metres, rig space) and normals: what the pattern is drawn from. */
export const PAT_POS = "sdPatPos";
export const PAT_NRM = "sdPatNrm";

/**
 * A copy of `geo` carrying its rest-pose positions and normals in rig space
 * (through `matrix`, the mesh's world transform in its own file — this also
 * undoes vertex quantisation), plus the height range for hem-relative patterns.
 */
export function withPatternSpace(geo: THREE.BufferGeometry, matrix: THREE.Matrix4): { geometry: THREE.BufferGeometry; range: THREE.Vector2 } {
  const g = geo.clone();
  const pos = geo.getAttribute("position");
  const nrm = geo.hasAttribute("normal") ? geo.getAttribute("normal") : null;
  const n = pos.count;
  const P = new Float32Array(n * 3);
  const N = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3().getNormalMatrix(matrix);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
    if (v.y < lo) lo = v.y;
    if (v.y > hi) hi = v.y;
    if (nrm) v.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
    else v.set(0, 0, 1);
    N[i * 3] = v.x; N[i * 3 + 1] = v.y; N[i * 3 + 2] = v.z;
  }
  g.setAttribute(PAT_POS, new THREE.BufferAttribute(P, 3));
  g.setAttribute(PAT_NRM, new THREE.BufferAttribute(N, 3));
  return { geometry: g, range: new THREE.Vector2(lo, hi) };
}

/**
 * Turns a tint material into a patterned one, in place. `ground` is already
 * on the material's colour; `c1`/`c2` are the motif colours (pre-darkened for
 * primary_dark). The height range can be widened later (several meshes share
 * one material) through the returned uniforms.
 */
export function applyPattern(mat: THREE.Material, spec: PatternSpec, c1: THREE.Color, c2: THREE.Color): PatternUniforms {
  const uniforms: PatternUniforms = {
    uSdC1: { value: c1 },
    uSdC2: { value: c2 },
    uSdScale: { value: spec.scale ?? 1 },
    uSdAngle: { value: THREE.MathUtils.degToRad(spec.angle ?? 0) },
    uSdRange: { value: new THREE.Vector2(Infinity, -Infinity) },
  };
  const motif = motifCall(spec.type);
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nattribute vec3 ${PAT_POS};\nattribute vec3 ${PAT_NRM};\nvarying vec3 vSdPat;\nvarying vec3 vSdPatN;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvSdPat = ${PAT_POS};\nvSdPatN = ${PAT_NRM};`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${GLSL_COMMON}\n${motif}`)
      .replace(
        "#include <color_fragment>",
        `{ vec2 sdM = clamp(sdMotif(vSdPat), 0.0, 1.0);
           diffuseColor.rgb = mix(mix(diffuseColor.rgb, uSdC1, sdM.x), uSdC2, sdM.y);
           // Keeps the rest normal "read" for solid patterns too (an unread varying logs a link warning per program).
           diffuseColor.rgb += 1e-6 * vSdPatN; }
#include <color_fragment>`
      );
  };
  mat.customProgramCacheKey = () => `sdPattern:${spec.type}`;
  mat.needsUpdate = true;
  return uniforms;
}
