/**
 * A small baseline JPEG encoder (no chroma subsampling, standard Huffman
 * tables) — enough for normal maps, which compress several times smaller
 * than PNG at a quality where the artefacts are invisible in shading.
 * No dependencies; based on the JFIF / ITU T.81 baseline process.
 */

const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];

const STD_LUMA_Q = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const STD_CHROMA_Q = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99];

// Standard Huffman tables (Annex K).
const DC_L_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_L_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const DC_C_BITS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const DC_C_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_L_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_L_VALS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
];
const AC_C_BITS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
const AC_C_VALS = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
];

/** Code table {symbol: [code, length]} from BITS/VALS. */
function huffman(bits, vals) {
  const table = {};
  let code = 0, k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < bits[len - 1]; i++) table[vals[k++]] = [code++, len];
    code <<= 1;
  }
  return table;
}
const HT = { dcL: huffman(DC_L_BITS, DC_L_VALS), acL: huffman(AC_L_BITS, AC_L_VALS), dcC: huffman(DC_C_BITS, DC_C_VALS), acC: huffman(AC_C_BITS, AC_C_VALS) };

function scaledQ(base, quality) {
  const q = Math.max(1, Math.min(100, quality));
  const s = q < 50 ? 5000 / q : 200 - q * 2;
  return base.map((v) => Math.max(1, Math.min(255, Math.floor((v * s + 50) / 100))));
}

// AAN-free straightforward separable DCT with precomputed cosines (fast enough for 1024² at build time).
const COS = Array.from({ length: 8 }, (_, x) => Array.from({ length: 8 }, (_, u) => Math.cos(((2 * x + 1) * u * Math.PI) / 16)));
const C0 = (u) => (u === 0 ? Math.SQRT1_2 : 1);
function fdct(block, out) {
  const tmp = new Float64Array(64);
  for (let y = 0; y < 8; y++)
    for (let u = 0; u < 8; u++) {
      let s = 0;
      for (let x = 0; x < 8; x++) s += block[y * 8 + x] * COS[x][u];
      tmp[y * 8 + u] = s * C0(u) * 0.5;
    }
  for (let u = 0; u < 8; u++)
    for (let v = 0; v < 8; v++) {
      let s = 0;
      for (let y = 0; y < 8; y++) s += tmp[y * 8 + u] * COS[y][v];
      out[v * 8 + u] = s * C0(v) * 0.5;
    }
}

class BitWriter {
  constructor() {
    this.bytes = [];
    this.acc = 0;
    this.n = 0;
  }
  write(code, len) {
    for (let i = len - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((code >> i) & 1);
      this.n++;
      if (this.n === 8) {
        this.bytes.push(this.acc);
        if (this.acc === 0xff) this.bytes.push(0);
        this.acc = 0;
        this.n = 0;
      }
    }
  }
  flush() {
    if (this.n) this.write((1 << (8 - this.n)) - 1, 8 - this.n);
  }
}

const category = (v) => {
  let a = Math.abs(v), c = 0;
  while (a) {
    c++;
    a >>= 1;
  }
  return c;
};
const bitsOf = (v, c) => (v < 0 ? v + (1 << c) - 1 : v);

/** RGBA bytes → JPEG Buffer (YCbCr 4:4:4). */
export function encodeJPEG(rgba, w, h, quality = 90) {
  const qL = scaledQ(STD_LUMA_Q, quality);
  const qC = scaledQ(STD_CHROMA_Q, quality);
  const out = [];
  const u16 = (v) => out.push((v >> 8) & 0xff, v & 0xff);
  const marker = (m) => out.push(0xff, m);
  marker(0xd8); // SOI
  marker(0xe0); // JFIF APP0
  u16(16);
  out.push(0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0);
  u16(1);
  u16(1);
  out.push(0, 0);
  marker(0xdb); // DQT
  u16(2 + 65 * 2);
  out.push(0, ...ZIGZAG.map((i) => qL[i]));
  out.push(1, ...ZIGZAG.map((i) => qC[i]));
  marker(0xc0); // SOF0
  u16(8 + 3 * 3);
  out.push(8);
  u16(h);
  u16(w);
  out.push(3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1);
  marker(0xc4); // DHT
  const tables = [[0x00, DC_L_BITS, DC_L_VALS], [0x10, AC_L_BITS, AC_L_VALS], [0x01, DC_C_BITS, DC_C_VALS], [0x11, AC_C_BITS, AC_C_VALS]];
  u16(2 + tables.reduce((n, [, b, v]) => n + 17 + v.length, 0));
  for (const [id, b, v] of tables) out.push(id, ...b, ...v);
  marker(0xda); // SOS
  u16(6 + 2 * 3);
  out.push(3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0);

  const bw = new BitWriter();
  const pred = [0, 0, 0];
  const block = new Float64Array(64);
  const coef = new Float64Array(64);
  const encodeBlock = (ci, q, dc, ac) => {
    fdct(block, coef);
    const z = new Int32Array(64);
    for (let i = 0; i < 64; i++) z[i] = Math.round(coef[ZIGZAG[i]] / q[ZIGZAG[i]]);
    const diff = z[0] - pred[ci];
    pred[ci] = z[0];
    const c = category(diff);
    bw.write(...dc[c]);
    if (c) bw.write(bitsOf(diff, c), c);
    let run = 0;
    for (let i = 1; i < 64; i++) {
      if (z[i] === 0) {
        run++;
        continue;
      }
      while (run > 15) {
        bw.write(...ac[0xf0]);
        run -= 16;
      }
      const cc = category(z[i]);
      bw.write(...ac[(run << 4) | cc]);
      bw.write(bitsOf(z[i], cc), cc);
      run = 0;
    }
    if (run) bw.write(...ac[0x00]);
  };
  for (let by = 0; by < h; by += 8)
    for (let bx = 0; bx < w; bx += 8) {
      for (const ci of [0, 1, 2]) {
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 8; x++) {
            const px = Math.min(w - 1, bx + x), py = Math.min(h - 1, by + y);
            const o = (py * w + px) * 4;
            const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
            const v = ci === 0 ? 0.299 * r + 0.587 * g + 0.114 * b - 128 : ci === 1 ? -0.168736 * r - 0.331264 * g + 0.5 * b : 0.5 * r - 0.418688 * g - 0.081312 * b;
            block[y * 8 + x] = v;
          }
        if (ci === 0) encodeBlock(0, qL, HT.dcL, HT.acL);
        else encodeBlock(ci, qC, HT.dcC, HT.acC);
      }
    }
  bw.flush();
  return Buffer.concat([Buffer.from(out), Buffer.from(bw.bytes), Buffer.from([0xff, 0xd9])]);
}
