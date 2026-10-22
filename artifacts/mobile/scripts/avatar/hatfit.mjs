#!/usr/bin/env node
/**
 * Headwear fit check: every hat (and the headphones) on every face shape with
 * every hairstyle, using the generated GLBs and each item's attachment spec
 * exactly as the app resolves it.
 *
 *   node scripts/avatar/hatfit.mjs              # all headwear
 *   node scripts/avatar/hatfit.mjs hat_cap      # one
 *
 * Per combination it measures:
 *   poke   hair or skin vertices showing through the item (under it, with
 *          nothing of the item above them), as a fraction of those it covers
 *   gap    how far the item's inner rim sits off whatever is under it
 *          (95th percentile) — a visible floating gap if large
 *   sink   item vertices inside the skin (the head, ears included)
 *   eyes   item vertices in front of either eye, and how far above the eyes
 *          the lowest part of a brim is
 * Exit code 1 if any combination is out of tolerance.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FACE_SHAPES, HAIR_STYLES, SOCKETS } from "./rig.mjs";
import { EYE, headD } from "./character.mjs";
import { coverage, hatInnerD } from "./fit.mjs";
import { parseGlb, TriGrid } from "./fitcheck.mjs";
import { assetDir } from "./validate.mjs";

export const LIMITS = { poke: 0.01, gap: 0.0065, sink: 0.004, eyeClear: 0.003 };
/** The inside of a helmet sits on padding; a headband is a little proud of the hair it presses. */
const GAP_LIMIT = { helmet: 0.013, banded: 0.0075 };
/** Ears: inside ear cups and ear guards by design, so neither poke nor sink counts there. */
const atEar = (p) => Math.abs(p[0]) > 0.085 && Math.abs(p[1] - 1.626) < 0.045 && Math.abs(p[2] + 0.008) < 0.045;

/* ── attachment (same composition as lib/avatar3d/attach.ts) ─────────────── */

function resolveAttach(spec, { hairStyle, faceShape }) {
  const out = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], hidden: false };
  const apply = (t) => {
    if (!t) return;
    const p = t.position ?? [0, 0, 0];
    const r = t.rotation ?? [0, 0, 0];
    const s = typeof t.scale === "number" ? [t.scale, t.scale, t.scale] : t.scale ?? [1, 1, 1];
    for (let i = 0; i < 3; i++) {
      out.position[i] += p[i];
      out.rotation[i] += (r[i] * Math.PI) / 180;
      out.scale[i] *= s[i];
    }
    if (t.hidden) out.hidden = true;
  };
  if (!spec) return out;
  apply(spec);
  apply(spec.perFace?.[faceShape]);
  apply(spec.perHair?.[hairStyle]);
  return out;
}

/** XYZ Euler rotation applied to v (three.js order: R = Rz·Ry·Rx). */
function rotate([x, y, z], [rx, ry, rz]) {
  let [a, b, c] = [x, y, z];
  [b, c] = [b * Math.cos(rx) - c * Math.sin(rx), b * Math.sin(rx) + c * Math.cos(rx)];
  [a, c] = [a * Math.cos(ry) + c * Math.sin(ry), -a * Math.sin(ry) + c * Math.cos(ry)];
  [a, b] = [a * Math.cos(rz) - b * Math.sin(rz), a * Math.sin(rz) + b * Math.cos(rz)];
  return [a, b, c];
}

/** The item's meshes placed for this look: socket + attachment transform. */
function placed(meshes, socket, t) {
  const o = SOCKETS[socket].position;
  return meshes.map((m) => {
    const pos = new Float32Array(m.pos.length);
    const nrm = new Float32Array(m.nrm.length);
    for (let i = 0; i < m.pos.length; i += 3) {
      const local = [(m.pos[i] - o[0]) * t.scale[0], (m.pos[i + 1] - o[1]) * t.scale[1], (m.pos[i + 2] - o[2]) * t.scale[2]];
      const r = rotate(local, t.rotation);
      pos[i] = o[0] + t.position[0] + r[0];
      pos[i + 1] = o[1] + t.position[1] + r[1];
      pos[i + 2] = o[2] + t.position[2] + r[2];
      const n = rotate([m.nrm[i] / t.scale[0], m.nrm[i + 1] / t.scale[1], m.nrm[i + 2] / t.scale[2]], t.rotation);
      const l = Math.hypot(...n) || 1;
      nrm[i] = n[0] / l;
      nrm[i + 1] = n[1] / l;
      nrm[i + 2] = n[2] / l;
    }
    return { ...m, pos, nrm };
  });
}

/* ── the check ───────────────────────────────────────────────────────────── */

export function hatFit(dir, key, { faces = FACE_SHAPES, styles = HAIR_STYLES } = {}) {
  const { json, meshes } = parseGlb(join(dir, `${key}.glb`));
  const meta = json.scenes[0].extras.sdAvatar;
  const mode = meta.hairMode ?? null;
  const socket = meta.attach?.socket ?? "HeadTop";
  const base = parseGlb(join(dir, readdirSync(dir).filter((f) => /^sd_base_v\d+\.glb$/.test(f)).sort().pop())).meshes;
  const hairs = {};
  for (const style of styles) {
    if (style === "bald") continue;
    const f = join(dir, `hair_${style}.glb`);
    if (!existsSync(f)) continue;
    const ms = parseGlb(f).meshes;
    const want = mode ? `Hair_${mode}` : "Hair";
    hairs[style] = ms.filter((m) => m.name === want || (mode ? m.name === `HairTie_${mode}` : m.name === "HairTie"));
  }
  const results = [];
  for (const face of faces) {
    const head = base.filter((m) => m.name === `Head_${face}`);
    for (const style of styles) {
      const t = resolveAttach(meta.attach, { hairStyle: style, faceShape: face });
      const item = placed(meshes, socket, t);
      const itemGrid = new TriGrid(item, 0.01);
      const under = [...head, ...(hairs[style] ?? [])];
      const underGrid = new TriGrid(under, 0.01);

      // poke: hair/skin vertices inside the region the item covers (3 mm in from its edge — below the
      // edge, hair is meant to show) that reach past the item's inner surface, i.e. into or through it.
      let covered = 0;
      let poke = 0;
      for (const m of under) {
        for (let v = 0; v < m.pos.length / 3; v++) {
          const o = [m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]];
          if (o[1] < 1.5) continue;
          if (coverage(mode, ...o).u < 0.003 || atEar(o)) continue;
          covered++;
          if (hatInnerD(mode, ...o) > 0.0005) poke++;
        }
      }
      void itemGrid;

      // gap / sink / eyes, from the item's vertices.
      const rimGaps = [];
      let sink = 0;
      let eyeHits = 0;
      let brimLow = Infinity;
      const cx = 0, cy = 1.648, cz = 0.004;
      for (const m of item) {
        for (let v = 0; v < m.pos.length / 3; v++) {
          const p = [m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]];
          const n = [m.nrm[v * 3], m.nrm[v * 3 + 1], m.nrm[v * 3 + 2]];
          const d = headD(face, ...p);
          if (d < -0.0012 && !atEar(p)) sink = Math.max(sink, -d);
          for (const s of [1, -1]) {
            if (Math.abs(p[0] - EYE.x * s) < 0.017 && Math.abs(p[1] - EYE.y) < 0.012 && p[2] > EYE.z) eyeHits++;
          }
          if (p[2] > 0.08 && Math.abs(p[0]) < 0.06) brimLow = Math.min(brimLow, p[1]);
          // Inner rim: faces the head, within 12 mm of the item's lower edge.
          const toC = [cx - p[0], cy - p[1], cz - p[2]];
          const inward = n[0] * toC[0] + n[1] * toC[1] + n[2] * toC[2] > 0;
          if (!inward || !mode) continue;
          const { u } = coverage(mode, ...p);
          if (u < 0 || u > 0.012) continue;
          // The inside of the crown or band only (built on the mode's inner surface) — brims, peaks
          // and ear cups stand off the head by design.
          if (Math.abs(hatInnerD(mode, ...p)) > 0.002) continue;
          // Distance to whatever is under it, toward the cranium's centre.
          const tl = Math.hypot(...toC);
          const dir = toC.map((c) => c / tl);
          let g = null;
          for (let s = 0.0004; s <= 0.03; s += 0.0004) {
            const q = [p[0] + dir[0] * s, p[1] + dir[1] * s, p[2] + dir[2] * s];
            if (headD(face, ...q) < 0 || underGrid.hit(p, dir, 0, s)) {
              g = s;
              break;
            }
          }
          rimGaps.push(g ?? 0.03);
        }
      }
      rimGaps.sort((a, b) => a - b);
      const gap = rimGaps.length ? rimGaps[Math.floor(rimGaps.length * 0.95)] : 0;
      const eyeTop = EYE.y + EYE.r * 0.8;
      results.push({
        face,
        style,
        hidden: t.hidden,
        covered,
        poke: covered ? poke / covered : 0,
        gap,
        sink,
        eyeHits,
        brimClear: brimLow - eyeTop,
      });
    }
  }
  return { key, mode, results };
}

/** Crown-style items (no hair mode) sit on the hair: report how far the ring floats above / sinks into it. */
export function seatCheck(dir, key, { faces = FACE_SHAPES, styles = HAIR_STYLES } = {}) {
  const { json, meshes } = parseGlb(join(dir, `${key}.glb`));
  const meta = json.scenes[0].extras.sdAvatar;
  const base = parseGlb(join(dir, readdirSync(dir).filter((f) => /^sd_base_v\d+\.glb$/.test(f)).sort().pop())).meshes;
  const out = [];
  for (const style of styles) {
    const hair = style === "bald" ? [] : parseGlb(join(dir, `hair_${style}.glb`)).meshes.filter((m) => m.name === "Hair" || m.name === "HairTie");
    const head = base.filter((m) => m.name === `Head_${faces[0]}`);
    const grid = new TriGrid([...head, ...hair], 0.01);
    const t = resolveAttach(meta.attach, { hairStyle: style, faceShape: faces[0] });
    const item = placed(meshes, meta.attach?.socket ?? "HeadTop", t);
    // The lowest ring of vertices, and the distance straight down from each to the hair/head.
    let minY = Infinity;
    for (const m of item) for (let v = 1; v < m.pos.length; v += 3) minY = Math.min(minY, m.pos[v]);
    // Per azimuth (24 bins round the ring, so the result doesn't depend on how the mesh happens to be
    // tessellated): the gap under the ring's lowest edge there.
    const bins = new Array(24).fill(null);
    for (const m of item)
      for (let v = 0; v < m.pos.length / 3; v++) {
        const p = [m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]];
        if (p[1] > minY + 0.002) continue;
        let g = 0.05;
        for (let s = -0.01; s <= 0.05; s += 0.0005) {
          if (grid.hit([p[0], p[1] - s + 0.0005, p[2]], [0, -1, 0], 0, 0.0005)) {
            g = s;
            break;
          }
        }
        const k = Math.floor(((Math.atan2(p[0], p[2] - 0.004) / (2 * Math.PI) + 1) % 1) * 24);
        bins[k] = bins[k] === null ? g : Math.min(bins[k], g);
      }
    const gaps = bins.filter((g) => g !== null).sort((a, b) => a - b);
    out.push({ style, minGap: gaps[0], medGap: gaps[Math.floor(gaps.length / 2)] });
  }
  return { key, out };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = assetDir();
  const glbs = readdirSync(dir).filter((f) => f.endsWith(".glb"));
  const keys = process.argv.slice(2).length
    ? process.argv.slice(2)
    : glbs
        .map((f) => f.replace(/\.glb$/, ""))
        .filter((k) => {
          const meta = parseGlb(join(dir, `${k}.glb`)).json.scenes[0].extras?.sdAvatar;
          return meta?.kind === "garment" && (meta.slot === "hat" || meta.hairMode === "banded");
        });
  let failed = 0;
  for (const key of keys) {
    const meta = parseGlb(join(dir, `${key}.glb`)).json.scenes[0].extras.sdAvatar;
    if (!meta.hairMode) {
      const r = seatCheck(dir, key);
      for (const s of r.out) {
        // Hair is soft: the ring may settle up to 5 mm into the fullest parts, and float as much over the thinnest.
        const ok = s.minGap > -0.0055 && s.medGap < 0.0055;
        if (!ok) failed++;
        console.log(`${ok ? "ok  " : "FAIL"} ${key.padEnd(16)} ${s.style.padEnd(11)} seat: lowest point ${(s.minGap * 1000).toFixed(1)} mm, median ${(s.medGap * 1000).toFixed(1)} mm above the hair`);
      }
      continue;
    }
    const r = hatFit(dir, key);
    for (const x of r.results) {
      const bad = [];
      if (x.poke > LIMITS.poke) bad.push(`poke ${(x.poke * 100).toFixed(1)}%`);
      if (x.gap > (GAP_LIMIT[r.mode] ?? LIMITS.gap)) bad.push(`gap ${(x.gap * 1000).toFixed(1)}mm`);
      if (x.sink > LIMITS.sink) bad.push(`sink ${(x.sink * 1000).toFixed(1)}mm`);
      if (x.eyeHits) bad.push(`${x.eyeHits} verts over the eyes`);
      if (x.brimClear < LIMITS.eyeClear) bad.push(`brim ${(x.brimClear * 1000).toFixed(1)}mm over the eyes`);
      if (bad.length) failed++;
      console.log(
        `${bad.length ? "FAIL" : "ok  "} ${key.padEnd(16)} ${x.face.padEnd(7)} ${x.style.padEnd(11)} poke ${(x.poke * 100).toFixed(2).padStart(5)}%  rim gap ${(x.gap * 1000).toFixed(1).padStart(4)}mm  sink ${(x.sink * 1000).toFixed(1).padStart(4)}mm  brim +${(x.brimClear * 1000).toFixed(0)}mm${bad.length ? "  ← " + bad.join(", ") : ""}`
      );
    }
  }
  process.exit(failed ? 1 : 0);
}
