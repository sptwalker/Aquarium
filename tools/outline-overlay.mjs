// Renders the model outline on top of the traced line art, as one image.
//
// The numeric comparison in outline-compare.mjs says how close the tables are;
// this shows it. Both silhouettes are normalised by body length and max
// half-depth, so they overlay directly even though the render and the drawing
// were made at different scales.
//
// usage: node tools/outline-overlay.mjs [traceJson] [out.png]
import fs from 'node:fs';
import zlib from 'node:zlib';

const traceJson = process.argv[2] || 'tools/la-7.json';
const outPng = process.argv[3] || 'shots/outline-overlay.png';
const d = JSON.parse(fs.readFileSync(traceJson, 'utf8'));

const src = fs.readFileSync('src/fish.ts', 'utf8');
const grab = (name) => {
  const i0 = src.indexOf(`const ${name}`);
  const i1 = src.indexOf('];', i0);
  return [...src.slice(i0, i1).matchAll(/\[([-\d.]+),\s*([-\d.]+)\]/g)].map((m) => [+m[1], +m[2]]);
};
const PROF = grab('PROFILE_KOI');
const AX = grab('AXIS_KOI');

function smooth(K, t) {
  const tt = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < K.length - 2 && tt > K[i + 1][0]) i++;
  const [t1, p1] = K[i];
  const [t2, p2] = K[i + 1];
  const p0 = K[Math.max(0, i - 1)][1];
  const p3 = K[Math.min(K.length - 1, i + 2)][1];
  const s = (tt - t1) / Math.max(1e-6, t2 - t1);
  const s2 = s * s, s3 = s2 * s;
  return 0.5 * (2 * p1 + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2 + (-p0 + 3 * p1 - 3 * p2 + p3) * s3);
}

const modelEdge = (t) => {
  let r = smooth(PROF, t);
  const cy = smooth(AX, t);
  if (t > 0.982) {
    const k = (t - 0.982) / 0.018;
    const r0 = smooth(PROF, 0.982);
    r = r0 * Math.max(0.10, Math.pow(Math.max(0, 1 - Math.pow(k, 2.4)), 1 / 2.4));
  }
  return { top: cy + r, bot: cy - r };
};

const DIL = 7 / d.bodyPixels.maxDepth;
const raw = d.stations.map((s) => ({ t: s.t, top: -s.yTop + DIL, bot: -s.yBot - DIL }));
const sm = (key) => {
  const med = raw.map((_, i) => {
    const w = raw.slice(Math.max(0, i - 2), Math.min(raw.length, i + 3)).map((o) => o[key]).sort((a, b) => a - b);
    return w[Math.floor(w.length / 2)];
  });
  return med.map((_, i) => {
    const w = med.slice(Math.max(0, i - 1), Math.min(med.length, i + 2));
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
};
const sT = sm('top'), sB = sm('bot');
const rMax = Math.max(...sT.map((v, i) => (v - sB[i]) / 2));
const midRef = (sT[Math.round(sT.length / 2)] + sB[Math.round(sB.length / 2)]) / 2;
const traceAt = (t) => {
  const x = t * (sT.length - 1);
  const i = Math.floor(x), f = x - i;
  const a = i, b = Math.min(sT.length - 1, i + 1);
  return {
    top: ((sT[a] * (1 - f) + sT[b] * f) - midRef) / rMax,
    bot: ((sB[a] * (1 - f) + sB[b] * f) - midRef) / rMax,
  };
};

// ---- draw: x = body length, y = half-depths, 2px per unit
const W = 1000, H = 460;
const cx = 40, cy0 = H / 2;
const SX = 900;          // px per body length
const SY = 150;          // px per half-depth
const buf = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) { buf[i * 3] = 18; buf[i * 3 + 1] = 20; buf[i * 3 + 2] = 24; }

const put = (x, y, rgb) => {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 3;
  buf[o] = rgb[0]; buf[o + 1] = rgb[1]; buf[o + 2] = rgb[2];
};
const line = (x0, y0, x1, y1, rgb) => {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    put(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, rgb);
  }
};

const RED = [235, 80, 70];      // traced line art
const GREEN = [90, 220, 140];   // model
let pt = null, pm = null;
for (let i = 0; i <= 400; i++) {
  const t = i / 400;
  const tr = traceAt(t), mo = modelEdge(t);
  const px = cx + t * SX;
  const yt = cy0 - tr.top * SY, yb = cy0 - tr.bot * SY;
  const mt = cy0 - mo.top * SY, mb = cy0 - mo.bot * SY;
  if (pt) { line(pt[0], pt[1], px, yt, RED); line(pt[2], pt[3], px, yb, RED); }
  if (pm) { line(pm[0], pm[1], px, mt, GREEN); line(pm[2], pm[3], px, mb, GREEN); }
  pt = [px, yt, px, yb];
  pm = [px, mt, px, mb];
}
// axis
line(cx, cy0, cx + SX, cy0, [60, 64, 72]);

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc = (b) => { let c = -1; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, cr]);
};
const rawP = Buffer.alloc(H * (W * 3 + 1));
for (let y = 0; y < H; y++) { rawP[y * (W * 3 + 1)] = 0; buf.copy(rawP, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(outPng, Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rawP)), chunk('IEND', Buffer.alloc(0)),
]));
console.log(`wrote ${outPng}  (red = line art, green = model)`);
