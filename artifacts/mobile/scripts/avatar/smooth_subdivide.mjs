/**
 * Loop subdivision + smooth normals for low-poly meshes with UV seams.
 * Geometry is smoothed on position-welded topology; UVs are interpolated per corner so seams stay intact.
 */
export function smoothSubdivide({ positions: P, uvs: UV, indices: I }, levels = 2) {
  let pos = P, uv = UV, idx = I;
  for (let l = 0; l < levels; l++) ({ pos, uv, idx } = loopOnce(pos, uv, idx));
  // Restore original height and ground contact (Loop subdivision shrinks slightly).
  const yr = (a) => { let lo = Infinity, hi = -Infinity; for (let i = 1; i < a.length; i += 3) { lo = Math.min(lo, a[i]); hi = Math.max(hi, a[i]); } return [lo, hi]; };
  const [y0, y1] = yr(P), [n0, n1] = yr(pos), sc = (y1 - y0) / (n1 - n0);
  for (let i = 0; i < pos.length; i += 3) { pos[i] *= sc; pos[i+1] = (pos[i+1] - n0) * sc + y0; pos[i+2] *= sc; }
  const normals = smoothNormals(pos, idx);
  const Idx = pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  return { positions: new Float32Array(pos), normals, uvs: new Float32Array(uv), indices: Idx };
}

function weld(pos) {
  const map = new Map(), wid = new Int32Array(pos.length / 3), wpos = [];
  for (let i = 0; i < wid.length; i++) {
    const k = `${pos[i*3].toFixed(5)},${pos[i*3+1].toFixed(5)},${pos[i*3+2].toFixed(5)}`;
    let w = map.get(k);
    if (w === undefined) { w = wpos.length / 3; map.set(k, w); wpos.push(pos[i*3], pos[i*3+1], pos[i*3+2]); }
    wid[i] = w;
  }
  return { wid, wpos };
}

function loopOnce(pos, uv, idx) {
  const { wid, wpos } = weld(pos);
  const nw = wpos.length / 3;
  const ek = (a, b) => (a < b ? a * nw + b : b * nw + a);
  const edges = new Map(); // key -> {a,b,opp:[]}
  const nbr = Array.from({ length: nw }, () => new Set());
  for (let t = 0; t < idx.length; t += 3) {
    const w = [wid[idx[t]], wid[idx[t+1]], wid[idx[t+2]]];
    for (let e = 0; e < 3; e++) {
      const a = w[e], b = w[(e+1)%3], c = w[(e+2)%3];
      if (a === b) continue;
      const k = ek(a, b);
      let E = edges.get(k); if (!E) edges.set(k, (E = { a, b, opp: [] }));
      E.opp.push(c); nbr[a].add(b); nbr[b].add(a);
    }
  }
  const boundary = new Array(nw).fill(null).map(() => []);
  for (const E of edges.values()) if (E.opp.length !== 2) { boundary[E.a].push(E.b); boundary[E.b].push(E.a); }
  // even vertices
  const even = new Float64Array(nw * 3);
  for (let v = 0; v < nw; v++) {
    const B = boundary[v];
    if (B.length === 2) {
      for (let k = 0; k < 3; k++) even[v*3+k] = 0.75*wpos[v*3+k] + 0.125*(wpos[B[0]*3+k] + wpos[B[1]*3+k]);
    } else if (B.length > 0) {
      for (let k = 0; k < 3; k++) even[v*3+k] = wpos[v*3+k];
    } else {
      const n = nbr[v].size; if (!n) { for (let k = 0; k < 3; k++) even[v*3+k] = wpos[v*3+k]; continue; }
      const beta = n === 3 ? 3/16 : 3/(8*n);
      for (let k = 0; k < 3; k++) {
        let s = 0; for (const u of nbr[v]) s += wpos[u*3+k];
        even[v*3+k] = (1 - n*beta)*wpos[v*3+k] + beta*s;
      }
    }
  }
  const odd = new Map();
  for (const [k, E] of edges) {
    const p = [0, 0, 0];
    for (let c = 0; c < 3; c++)
      p[c] = E.opp.length === 2
        ? 0.375*(wpos[E.a*3+c] + wpos[E.b*3+c]) + 0.125*(wpos[E.opp[0]*3+c] + wpos[E.opp[1]*3+c])
        : 0.5*(wpos[E.a*3+c] + wpos[E.b*3+c]);
    odd.set(k, p);
  }
  // emit vertices keyed by (geometry id, uv)
  const outP = [], outUV = [], outI = [], vmap = new Map();
  const emit = (gk, p, u0, u1) => {
    const key = `${gk}|${u0.toFixed(6)},${u1.toFixed(6)}`;
    let i = vmap.get(key);
    if (i === undefined) { i = outP.length / 3; vmap.set(key, i); outP.push(p[0], p[1], p[2]); outUV.push(u0, u1); }
    return i;
  };
  for (let t = 0; t < idx.length; t += 3) {
    const c = [idx[t], idx[t+1], idx[t+2]], w = c.map((i) => wid[i]);
    if (w[0] === w[1] || w[1] === w[2] || w[0] === w[2]) continue;
    const V = c.map((ci, j) => emit(`v${w[j]}`, [even[w[j]*3], even[w[j]*3+1], even[w[j]*3+2]], uv[ci*2], uv[ci*2+1]));
    const M = [0, 1, 2].map((j) => {
      const a = c[j], b = c[(j+1)%3], k = ek(w[j], w[(j+1)%3]);
      return emit(`e${k}`, odd.get(k), (uv[a*2] + uv[b*2]) / 2, (uv[a*2+1] + uv[b*2+1]) / 2);
    });
    outI.push(V[0], M[0], M[2], V[1], M[1], M[0], V[2], M[2], M[1], M[0], M[1], M[2]);
  }
  return { pos: outP, uv: outUV, idx: outI };
}

function smoothNormals(pos, idx) {
  const { wid, wpos } = weld(pos);
  const acc = new Float64Array(wpos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t+1], idx[t+2]];
    const ux = pos[b*3]-pos[a*3], uy = pos[b*3+1]-pos[a*3+1], uz = pos[b*3+2]-pos[a*3+2];
    const vx = pos[c*3]-pos[a*3], vy = pos[c*3+1]-pos[a*3+1], vz = pos[c*3+2]-pos[a*3+2];
    const n = [uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx];
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) acc[wid[v]*3+k] += n[k];
  }
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length / 3; i++) {
    const w = wid[i], x = acc[w*3], y = acc[w*3+1], z = acc[w*3+2], l = Math.hypot(x, y, z) || 1;
    out[i*3] = x/l; out[i*3+1] = y/l; out[i*3+2] = z/l;
  }
  return out;
}
