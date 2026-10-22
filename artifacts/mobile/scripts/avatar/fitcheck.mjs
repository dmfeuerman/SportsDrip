#!/usr/bin/env node
/**
 * Poke-through check: does skin show through any garment, in the rest pose?
 * And does each garment really cover the body regions it hides?
 *
 *   node scripts/avatar/fitcheck.mjs            # every garment in assets/avatar
 *   node scripts/avatar/fitcheck.mjs top_tee
 *   node scripts/avatar/fitcheck.mjs --hides    # measure each garment's `hides`
 *   node scripts/avatar/fitcheck.mjs --hides --write   # …and store them in the GLBs' metadata
 *
 * For every body/head vertex, a ray is cast outward along its normal and
 * another inward. A vertex is "poking through" when there is garment surface
 * just *beneath* it (inward hit within 1.5 cm) but none above it — i.e. skin
 * lying on top of cloth. Skin within 1.5 cm of a garment's open edge (hem,
 * cuff, collar, armhole) is expected to show and isn't counted. Exit code 1
 * if any garment exceeds the tolerance.
 *
 * Hidden regions: a garment may hide a body region (rig.BODY_REGIONS) only if
 * every skin vertex of the region is under cloth, and all but a sliver of it
 * (HIDE_CLEAR) is at least HIDE_MARGIN from uncovered skin — so sliding a
 * sleeve or hem that far during animation still doesn't open a hole where the
 * skin was removed. Skin across a crevice from other skin, or facing the
 * floor, counts as covered: no camera in the app can see it.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readGlb, restMeshes, writeGlb } from "./glb.mjs";
import { TEMPLATES } from "./templates.mjs";
import { assetDir } from "./validate.mjs";

const TOLERANCE = Number(process.env.FIT_TOLERANCE ?? 0.015); // fraction of covered skin vertices
/**
 * Headphone cups enclose the ears on purpose; the creases behind the ears
 * face away from the cup and read as "skin over cloth" to this test even
 * though the cup hides them. Everything else uses the default tolerance.
 */
const PER_GARMENT = { acc_headphones: 0.3 };
export const HIDE_MARGIN = 0.015;

/** A GLB's JSON and its meshes in rest-pose world space (glb.mjs). */
export function parseGlb(file) {
  const { json, bin } = readGlb(file);
  return { json, meshes: restMeshes(json, bin) };
}

/** Uniform grid over triangles for ray queries. */
export class TriGrid {
  constructor(meshes, cell = 0.02) {
    this.cell = cell;
    this.tris = [];
    for (const m of meshes) for (let t = 0; t < m.idx.length; t += 3) this.tris.push([m.pos, m.idx[t], m.idx[t + 1], m.idx[t + 2]]);
    this.map = new Map();
    this.tris.forEach(([P, a, b, c], ti) => {
      const lo = [0, 1, 2].map((k) => Math.floor(Math.min(P[a * 3 + k], P[b * 3 + k], P[c * 3 + k]) / cell));
      const hi = [0, 1, 2].map((k) => Math.floor(Math.max(P[a * 3 + k], P[b * 3 + k], P[c * 3 + k]) / cell));
      for (let x = lo[0]; x <= hi[0]; x++)
        for (let y = lo[1]; y <= hi[1]; y++)
          for (let z = lo[2]; z <= hi[2]; z++) {
            const k = `${x},${y},${z}`;
            let l = this.map.get(k);
            if (!l) this.map.set(k, (l = []));
            l.push(ti);
          }
    });
  }

  /** Number of distinct crossings of the ray o + t·d for t in (0, tMax). */
  crossings(o, d, tMax) {
    const seen = new Set();
    const ts = [];
    for (let t = 0; t <= tMax + this.cell; t += this.cell * 0.5) {
      const k = `${Math.floor((o[0] + d[0] * t) / this.cell)},${Math.floor((o[1] + d[1] * t) / this.cell)},${Math.floor((o[2] + d[2] * t) / this.cell)}`;
      const l = this.map.get(k);
      if (!l) continue;
      for (const ti of l) {
        if (seen.has(ti)) continue;
        seen.add(ti);
        const h = rayTri(o, d, this.tris[ti]);
        if (h > 0 && h < tMax && !ts.some((x) => Math.abs(x - h) < 1e-5)) ts.push(h);
      }
    }
    return ts.length;
  }

  /** True if the ray o + t·d hits a triangle for t in (tMin, tMax). */
  hit(o, d, tMin, tMax) {
    const seen = new Set();
    for (let t = 0; t <= tMax + this.cell; t += this.cell * 0.5) {
      const k = `${Math.floor((o[0] + d[0] * t) / this.cell)},${Math.floor((o[1] + d[1] * t) / this.cell)},${Math.floor((o[2] + d[2] * t) / this.cell)}`;
      const l = this.map.get(k);
      if (!l) continue;
      for (const ti of l) {
        if (seen.has(ti)) continue;
        seen.add(ti);
        const h = rayTri(o, d, this.tris[ti]);
        if (h > tMin && h < tMax) return true;
      }
    }
    return false;
  }
}

export function rayTri(o, d, [P, a, b, c]) {
  const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
  const e1x = P[b * 3] - ax, e1y = P[b * 3 + 1] - ay, e1z = P[b * 3 + 2] - az;
  const e2x = P[c * 3] - ax, e2y = P[c * 3 + 1] - ay, e2z = P[c * 3 + 2] - az;
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det;
  const tx = o[0] - ax, ty = o[1] - ay, tz = o[2] - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
  if (v < 0 || u + v > 1) return -1;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}

function boundaryCount(m) {
  const count = new Map();
  for (let t = 0; t < m.idx.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = m.idx[t + e], b = m.idx[t + ((e + 1) % 3)];
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  let open = 0;
  for (const c of count.values()) if (c === 1) open++;
  return open;
}

/** Open edges of the garment (hems, cuffs, collars) as segments, hashed by cell. */
export function boundary(meshes, cell = 0.02) {
  const segs = [];
  for (const m of meshes) {
    const count = new Map();
    const key = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
    for (let t = 0; t < m.idx.length; t += 3)
      for (let e = 0; e < 3; e++) {
        const k = key(m.idx[t + e], m.idx[t + ((e + 1) % 3)]);
        count.set(k, (count.get(k) ?? 0) + 1);
      }
    for (const [k, c] of count) {
      if (c !== 1) continue;
      const [a, b] = k.split("_").map(Number);
      segs.push([[m.pos[a * 3], m.pos[a * 3 + 1], m.pos[a * 3 + 2]], [m.pos[b * 3], m.pos[b * 3 + 1], m.pos[b * 3 + 2]]]);
    }
  }
  const map = new Map();
  segs.forEach((s, i) => {
    const k = s[0].map((v) => Math.floor(v / cell)).join(",");
    let l = map.get(k);
    if (!l) map.set(k, (l = []));
    l.push(i);
  });
  return (p, r) => {
    const c = p.map((v) => Math.floor(v / cell));
    const n = Math.ceil(r / cell) + 1;
    for (let x = -n; x <= n; x++)
      for (let y = -n; y <= n; y++)
        for (let z = -n; z <= n; z++) {
          const l = map.get(`${c[0] + x},${c[1] + y},${c[2] + z}`);
          if (!l) continue;
          for (const i of l) {
            const [a, b] = segs[i];
            const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
            const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1)));
            if (Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t) < r) return true;
          }
        }
    return false;
  };
}

export function fitCheck(baseFile, garmentFile, { face = "oval", edgeMargin = 0.015 } = {}) {
  const base = parseGlb(baseFile).meshes.filter((m) => m.name.startsWith("Body_") || m.name === `Head_${face}` || m.name === "Underwear");
  const garment = parseGlb(garmentFile).meshes;
  const grid = new TriGrid(garment);
  const nearEdge = boundary(garment);
  // Closed parts (headphone cups, lenses): anything inside one is hidden.
  const closed = garment.filter((m) => !boundaryCount(m)).map((m) => new TriGrid([m], 0.01));
  const inside = (o) => closed.some((g) => g.crossings(o, [0.3, 0.9, 0.31].map((v) => v / Math.hypot(0.3, 0.9, 0.31)), 0.6) % 2 === 1);
  let covered = 0;
  let poke = 0;
  const where = [];
  for (const m of base) {
    for (let v = 0; v < m.pos.length / 3; v++) {
      const o = [m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]];
      const n = [m.nrm[v * 3], m.nrm[v * 3 + 1], m.nrm[v * 3 + 2]];
      const below = grid.hit(o, [-n[0], -n[1], -n[2]], 0, 0.015);
      const above = grid.hit(o, n, 0.0002, 0.12);
      if (above) covered++;
      // Skin just past a hem, cuff or collar is meant to show.
      if (below && !above && !nearEdge(o, edgeMargin) && !inside(o)) {
        poke++;
        if (where.length < 6) where.push(o.map((q) => +q.toFixed(3)));
      }
    }
  }
  return { covered, poke, where };
}

/** n tipped by small angles about two axes across it (renormalised). */
function tilt(n, a, b) {
  const u = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const t = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const tl = Math.hypot(...t);
  const w = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
  const d = [0, 1, 2].map((k) => n[k] + (t[k] / tl) * a + (w[k] / tl) * b);
  const l = Math.hypot(...d);
  return d.map((c) => c / l);
}

/**
 * Per body region: how many of its vertices are under the garment, and how
 * many lie within `margin` of skin that isn't. A region is safe to hide when
 * both are complete.
 */
export function hideCoverage(baseFile, garmentFile, { face = "oval", margin = HIDE_MARGIN, cover = (m) => m.skinned } = {}) {
  const base = parseGlb(baseFile).meshes.filter((m) => m.name.startsWith("Body_") || m.name === `Head_${face}`);
  const garment = parseGlb(garmentFile).meshes.filter(cover);
  const out = {};
  if (!garment.length) return out;
  const grid = new TriGrid(garment);
  // Skin facing other skin across a crevice (between the thighs, in the armpit), or facing the floor (the
  // underside of the crotch and armpits — the app's cameras never look up), is hidden from view either way.
  const skin = new TriGrid(base);
  const open = [];
  const per = [];
  for (const m of base) {
    const cov = new Uint8Array(m.pos.length / 3);
    for (let v = 0; v < cov.length; v++) {
      const o = [m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]];
      const n = [m.nrm[v * 3], m.nrm[v * 3 + 1], m.nrm[v * 3 + 2]];
      // Three rays a few degrees apart, so one slipping through a crack between two triangles doesn't count as bare skin.
      const rays = [n, tilt(n, 0.06, 0), tilt(n, 0, 0.06)];
      cov[v] = n[1] < -0.5 || rays.some((d) => grid.hit(o, d, 0.0002, 0.12)) || skin.hit(o, n, 0.0015, 0.05) ? 1 : 0;
      if (!cov[v]) open.push(o);
    }
    per.push({ m, cov });
  }
  // Uncovered skin, hashed for "is any within margin" queries.
  const cell = margin;
  const hashOpen = new Map();
  for (const p of open) {
    const k = p.map((c) => Math.floor(c / cell)).join(",");
    let l = hashOpen.get(k);
    if (!l) hashOpen.set(k, (l = []));
    l.push(p);
  }
  const nearOpen = (p) => {
    const c = p.map((x) => Math.floor(x / cell));
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++)
          for (const q of hashOpen.get(`${c[0] + x},${c[1] + y},${c[2] + z}`) ?? []) if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < margin) return true;
    return false;
  };
  for (const { m, cov } of per) {
    if (!m.name.startsWith("Body_")) continue;
    const r = m.name.slice(5);
    let covered = 0;
    let clear = 0;
    for (let v = 0; v < cov.length; v++) {
      if (!cov[v]) continue;
      covered++;
      if (!nearOpen([m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]])) clear++;
    }
    out[r] = { verts: cov.length, covered, clear };
  }
  return out;
}

/**
 * Regions a garment can hide: every vertex under cloth, and all but a sliver
 * (HIDE_CLEAR) at least HIDE_MARGIN from uncovered skin.
 */
export const HIDE_CLEAR = 0.985;
export const canHide = (c) => !!c && c.verts > 0 && c.covered === c.verts && c.clear >= HIDE_CLEAR * c.verts;
export const hidable = (cov) => Object.entries(cov).filter(([, c]) => canHide(c)).map(([r]) => r);

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = assetDir();
  const baseFile = readdirSync(dir).filter((f) => /^sd_base_v\d+\.glb$/.test(f)).sort().pop();
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const suggest = process.argv.includes("--hides");
  const keys = args.length
    ? args
    : readdirSync(dir)
        .filter((f) => f.endsWith(".glb") && !/^(sd_base|hair_|beard_)/.test(f))
        .map((f) => f.replace(/\.glb$/, ""));
  let failed = 0;
  for (const k of keys) {
    const file = join(dir, `${k}.glb`);
    if (suggest) {
      const cov = hideCoverage(join(dir, baseFile), file);
      const pct = Object.entries(cov).filter(([, c]) => c.covered > c.verts * 0.5).map(([r, c]) => `${r}:${((100 * c.covered) / c.verts).toFixed(1)}/${((100 * c.clear) / c.verts).toFixed(1)}%`);
      // A template may pin its own list (templates.mjs `hides`); otherwise it's what the garment measurably covers.
      const hides = TEMPLATES[k]?.hides ?? hidable(cov);
      console.log(`${k.padEnd(22)} hides: ${JSON.stringify(hides)}   ${pct.join(" ")}`);
      if (process.argv.includes("--write")) {
        const { json, bin } = readGlb(file);
        json.scenes[0].extras.sdAvatar.hides = hides;
        writeGlb(file, json, bin);
      }
      continue;
    }
    const r = fitCheck(join(dir, baseFile), file);
    const frac = r.covered ? r.poke / r.covered : 0;
    let ok = frac <= (PER_GARMENT[k] ?? TOLERANCE);
    const declared = parseGlb(file).json.scenes[0].extras?.sdAvatar?.hides ?? [];
    let bad = [];
    if (declared.length) {
      const cov = hideCoverage(join(dir, baseFile), file);
      bad = declared.filter((reg) => !canHide(cov[reg])).map((reg) => `${reg} ${cov[reg] ? `${cov[reg].verts - cov[reg].covered} uncovered, ${cov[reg].verts - cov[reg].clear} near an edge, of ${cov[reg].verts}` : "missing"}`);
      if (bad.length) ok = false;
    }
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${k.padEnd(22)} ${String(r.poke).padStart(4)} skin verts over cloth / ${r.covered} covered (${(frac * 100).toFixed(2)}%) ${r.poke ? JSON.stringify(r.where) : ""}${declared.length ? ` hides ${declared.length}` : ""}${bad.length ? ` — can't hide: ${bad.join(", ")}` : ""}`);
  }
  process.exit(failed ? 1 : 0);
}
