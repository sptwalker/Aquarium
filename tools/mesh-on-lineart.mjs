// Draws the rendered model outline on top of the reference drawing itself.
//
// Everything else has been a number; this is the picture. The model silhouette
// (from an orthographic render) and the traced line art are both put in the
// drawing's own pixel frame, so any disagreement is visible as a gap between
// the green and red curves sitting on the original artwork.
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import zlib from 'node:zlib';
import { captureSilhouette, normalise } from './silhouette.mjs';

const base = process.argv[2] || 'http://localhost:5173';
const species = process.argv[3] || 'koi';
const IMG = 'pic/model04.jpeg';

const trace = JSON.parse(readFileSync('tools/lineart.json', 'utf8'));
const DIL = 7 / trace.bodyPixels.maxDepth;
const ref = trace.stations.map((s) => ({ t: s.t, top: -s.yTop + DIL, bot: -s.yBot - DIL }));
const sm = (key) => {
  const med = ref.map((_, i) => {
    const w = ref.slice(Math.max(0, i - 2), Math.min(ref.length, i + 3)).map((o) => o[key]).sort((a, b) => a - b);
    return w[Math.floor(w.length / 2)];
  });
  return med.map((_, i) => {
    const w = med.slice(Math.max(0, i - 1), Math.min(med.length, i + 2));
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
};
const rT = sm('top'), rB = sm('bot');
const rMax = Math.max(...rT.map((v, i) => (v - rB[i]) / 2));
const rMid = (rT[13] + rB[13]) / 2;

const silh = await captureSilhouette(base, species);
const model = normalise(silh.cols);
const mMaxHalf = 1;      // normalise() already divides by half depth

// ---- decode the drawing in the browser, then composite in node
const ca = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath = ca.find((p) => existsSync(p));
const browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
const page = await browser.newPage();
const b64 = readFileSync(resolve(IMG)).toString('base64');
const img = await page.evaluate(async (url) => {
  const im = new Image();
  await new Promise((r, j) => { im.onload = r; im.onerror = j; im.src = url; });
  const c = document.createElement('canvas');
  c.width = im.naturalWidth; c.height = im.naturalHeight;
  c.getContext('2d').drawImage(im, 0, 0);
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const out = new Uint8Array(c.width * c.height * 3);
  for (let i = 0; i < c.width * c.height; i++) {
    out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = d[i * 4 + 1];
  }
  return { W: c.width, H: c.height, px: Array.from(out) };
}, `data:image/jpeg;base64,${b64}`);
await browser.close();

const { W, H } = img;
const out = Buffer.from(img.px);
const put = (x, y, rgb) => {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 3;
  out[o] = rgb[0]; out[o + 1] = rgb[1]; out[o + 2] = rgb[2];
};

// The drawing's own frame. The trace reports every edge as image-row/maxDepth,
// so a pixel row is just value*maxDepth; the centreline is rMid in those same
// units. The model is normalised by HALF depth, hence maxDepth/2 px per unit.
const { x0, x1, bodyLen, maxDepth } = trace.bodyPixels;
// rT/rB hold -row/maxDepth (y flipped so up is positive), so undo that here to
// get back into image rows, where the artwork lives.
const midRow = -rMid * maxDepth;
const halfPx = maxDepth / 2;

const tracePts = [];
const modelPts = [];
for (let i = 0; i <= 400; i++) {
  const t = i / 400;
  // line art, straight from the trace
  const j = t * (rT.length - 1);
  const a = Math.floor(j), f = j - a, b = Math.min(rT.length - 1, a + 1);
  const tt = rT[a] * (1 - f) + rT[b] * f;
  const tb = rB[a] * (1 - f) + rB[b] * f;
  const x = x1 - t * bodyLen;
  tracePts.push([x, tt * maxDepth, tb * maxDepth]);

  // model: u = 0 at the peduncle end, matching the trace direction
  const k = t * (model.length - 1);
  const ka = Math.floor(k), kf = k - ka, kb = Math.min(model.length - 1, ka + 1);
  const mt = model[model.length - 1 - ka].top * (1 - kf) + model[model.length - 1 - kb].top * kf;
  const mb = model[model.length - 1 - ka].bot * (1 - kf) + model[model.length - 1 - kb].bot * kf;
  modelPts.push([x, midRow - mt * halfPx, midRow - mb * halfPx]);
}

const poly = (pts, rgb) => {
  for (let i = 1; i < pts.length; i++) {
    const [xa, ya, yb] = pts[i - 1], [xb, yc, yd] = pts[i];
    const n = Math.ceil(Math.hypot(xb - xa, yc - ya) * 2) + 1;
    for (let s = 0; s <= n; s++) {
      const g = s / n;
      put(xa + (xb - xa) * g, ya + (yc - ya) * g, rgb);
      put(xa + (xb - xa) * g, yb + (yd - yb) * g, rgb);
    }
  }
};
poly(tracePts, [235, 60, 60]);     // red  = line art
poly(modelPts, [40, 230, 120]);    // green = rendered model

const crcT = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, cr]);
};
const raw = Buffer.alloc(H * (W * 3 + 1));
for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; out.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync('shots/mesh-on-lineart.png', Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
]));
console.log('wrote shots/mesh-on-lineart.png   red = line art, green = model');
