// Finds out whether the user's traced body contour and the model's own
// silhouette actually disagree, or whether they are measuring different
// denominators.
//
// The user traced the BODY: nose to the point where the caudal fin begins.
// The automated silhouette measurements took nose to TAIL TIP. Those give very
// different depth/length ratios for the same shape, so this measures both
// denominators on the screenshot itself.
//
// usage: node tools/peduncle-check.mjs
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import zlib from 'node:zlib';

const ca = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath = ca.find((p) => existsSync(p));
const browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
const page = await browser.newPage();
const b64 = readFileSync(resolve('pic/model-side.jpg')).toString('base64');

const res = await page.evaluate(async (url) => {
  const im = new Image();
  await new Promise((r, j) => { im.onload = r; im.onerror = j; im.src = url; });
  const W = im.naturalWidth, H = im.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const cx = c.getContext('2d');
  cx.drawImage(im, 0, 0);
  const d = cx.getImageData(0, 0, W, H).data;
  const lum = (i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

  // mask: orange fish on a blue-grey backdrop
  const M = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = d[i * 4], b = d[i * 4 + 2];
    M[i] = (r - b > 12 || lum(i * 4) > 120) ? 1 : 0;
  }
  // close, then fill holes reachable-only-from-outside, then keep the largest blob
  const erodeDilate = (src, R, grow) => {
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let hit = grow ? 0 : 1;
      for (let dy = -R; dy <= R && (grow ? !hit : hit); dy++) for (let dx = -R; dx <= R; dx++) {
        const xx = x + dx, yy = y + dy;
        const v = (xx >= 0 && yy >= 0 && xx < W && yy < H) ? src[yy * W + xx] : 0;
        if (grow) { if (v) { hit = 1; break; } } else if (!v) { hit = 0; break; }
      }
      out[y * W + x] = hit;
    }
    return out;
  };
  let mask = erodeDilate(M, 3, true);
  mask = erodeDilate(mask, 3, false);
  {
    const seen = new Uint8Array(W * H), st = [];
    for (let x = 0; x < W; x++) { st.push(x, 0, x, H - 1); }
    for (let y = 0; y < H; y++) { st.push(0, y, W - 1, y); }
    while (st.length) {
      const y = st.pop(), x = st.pop();
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x;
      if (seen[i] || mask[i]) continue;
      seen[i] = 1; st.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
    for (let i = 0; i < W * H; i++) if (!mask[i] && !seen[i]) mask[i] = 1;
  }

  const top = new Int32Array(W).fill(-1), bot = new Int32Array(W).fill(-1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) if (mask[y * W + x]) { top[x] = y; break; }
    for (let y = H - 1; y >= 0; y--) if (mask[y * W + x]) { bot[x] = y; break; }
  }
  const cols = [];
  for (let x = 0; x < W; x++) if (top[x] >= 0) cols.push([x, top[x], bot[x]]);
  return { W, H, cols };
}, `data:image/jpeg;base64,${b64}`);
await browser.close();

const { cols, W, H } = res;
const x0 = cols[0][0], x1 = cols[cols.length - 1][0];
const full = x1 - x0;
let maxD = 0;
for (const [, t, b] of cols) maxD = Math.max(maxD, b - t);

// Peduncle = the narrowest column in the rear half. The fish faces left, so the
// tail is on the right.
let pedX = x1, pedW = 1e9;
for (const [x, t, b] of cols) {
  if (x < x0 + full * 0.62) continue;
  if (b - t < pedW) { pedW = b - t; pedX = x; }
}
const bodyLen = pedX - x0;

console.log(`screenshot mask: x ${x0}..${x1}, full length ${full}px, max depth ${maxD}px`);
console.log(`narrowest rear column (peduncle) at x=${pedX}, width ${pedW}px`);
console.log('');
console.log(`depth / FULL length (incl. caudal fin) = ${(maxD / full).toFixed(4)}`);
console.log(`depth / BODY length (nose to peduncle) = ${(maxD / bodyLen).toFixed(4)}   [peduncle at ${((pedX - x0) / full * 100).toFixed(0)}% of full length]`);
console.log('');
console.log('user\'s red trace reported depth/length = 0.4415 (body only, per the user)');

// where the depth peak sits, relative to BODY length
let peakX = x0;
for (const [x, t, b] of cols) if (b - t === maxD) { peakX = x; break; }
console.log(`deepest point at ${((peakX - x0) / bodyLen * 100).toFixed(0)}% of BODY length from the nose`);

// export the mask outline for inspection
const buf = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) { buf[i * 3] = 250; buf[i * 3 + 1] = 250; buf[i * 3 + 2] = 252; }
for (const [x, t, b] of cols) {
  for (let y = Math.round(t); y <= Math.round(b); y++) { const o = (y * W + x) * 3; buf[o] = 150; buf[o + 1] = 160; buf[o + 2] = 175; }
  for (let y = Math.round(t) - 1; y <= Math.round(t) + 1; y++) if (y >= 0 && y < H) { const o = (y * W + x) * 3; buf[o] = 20; buf[o + 1] = 90; buf[o + 2] = 220; }
  for (let y = Math.round(b) - 1; y <= Math.round(b) + 1; y++) if (y >= 0 && y < H) { const o = (y * W + x) * 3; buf[o] = 20; buf[o + 1] = 90; buf[o + 2] = 220; }
}
// mark the peduncle and the depth peak
for (let y = 0; y < H; y++) {
  const o = (y * W + pedX) * 3; buf[o] = 230; buf[o + 1] = 60; buf[o + 2] = 40;
  const p = (y * W + peakX) * 3; buf[p] = 40; buf[p + 1] = 170; buf[p + 2] = 90;
}
mkdirSync('shots', { recursive: true });
writePng('shots/peduncle-check.png', W, H, buf);

function writePng(path, w, h, rgb) {
  const crcT = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => {
    const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
    return Buffer.concat([l, td, cr]);
  };
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(path, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
}
console.log('\nwrote shots/peduncle-check.png  (blue outline, red = peduncle column, green = deepest column)');
