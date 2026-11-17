// Extracts the user's hand-drawn red contour from pic/user-overlay.jpg.
//
// The red line is the model's outer contour as the user sees it, drawn on top of
// the reference drawing. Measuring it directly is the ground truth every
// automatic comparison has been missing.
//
// usage: node tools/user-contour.mjs
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import zlib from 'node:zlib';

const IMG = 'pic/user-overlay.jpg';
const ca = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const executablePath = ca.find((p) => existsSync(p));
if (!executablePath) throw new Error('no chrome/edge found');

const browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
const page = await browser.newPage();
const b64 = readFileSync(resolve(IMG)).toString('base64');

const res = await page.evaluate(async (url) => {
  const im = new Image();
  await new Promise((r, j) => { im.onload = r; im.onerror = j; im.src = url; });
  const W = im.naturalWidth, H = im.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const cx = c.getContext('2d');
  cx.drawImage(im, 0, 0);
  const d = cx.getImageData(0, 0, W, H).data;

  // "red" = strongly red-dominant, which the black line art and the grey model
  // cut-out both fail: they have R ≈ G ≈ B.
  const isRed = (i) => {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    return r > 120 && r - g > 70 && r - b > 70;
  };

  const top = new Int32Array(W).fill(-1);
  const bot = new Int32Array(W).fill(-1);
  let minX = W, maxX = -1;
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) if (isRed((y * W + x) * 4)) { top[x] = y; break; }
    for (let y = H - 1; y >= 0; y--) if (isRed((y * W + x) * 4)) { bot[x] = y; break; }
    if (top[x] >= 0) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
  }
  const cols = [];
  for (let x = minX; x <= maxX; x++) {
    if (top[x] < 0) continue;
    // a stroke is ~6px thick; take the stroke centre on each side
    let tSum = 0, tN = 0, bSum = 0, bN = 0;
    for (let y = top[x]; y < Math.min(top[x] + 14, H); y++) if (isRed((y * W + x) * 4)) { tSum += y; tN++; }
    for (let y = bot[x]; y > Math.max(bot[x] - 14, 0); y--) if (isRed((y * W + x) * 4)) { bSum += y; bN++; }
    cols.push([x, tN ? tSum / tN : top[x], bN ? bSum / bN : bot[x]]);
  }
  return { W, H, cols };
}, `data:image/jpeg;base64,${b64}`);
await browser.close();

const { cols, W, H } = res;
const x0 = cols[0][0], x1 = cols[cols.length - 1][0];
const len = x1 - x0;
let maxD = 0;
for (const [, t, b] of cols) maxD = Math.max(maxD, b - t);

// mask overlay so the extraction is auditable
const buf = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) { buf[i * 3] = 20; buf[i * 3 + 1] = 22; buf[i * 3 + 2] = 26; }
for (const [x, t, b] of cols) {
  for (let y = Math.round(t) - 1; y <= Math.round(t) + 1; y++) {
    if (y < 0 || y >= H) continue;
    const o = (y * W + x) * 3; buf[o] = 255; buf[o + 1] = 60; buf[o + 2] = 60;
  }
  for (let y = Math.round(b) - 1; y <= Math.round(b) + 1; y++) {
    if (y < 0 || y >= H) continue;
    const o = (y * W + x) * 3; buf[o] = 60; buf[o + 1] = 200; buf[o + 2] = 120;
  }
}
mkdirSync('shots', { recursive: true });
writePng('shots/user-contour-extracted.png', W, H, buf);

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

console.log(`red contour: ${cols.length} columns, x ${x0}..${x1}, length ${len}px`);
console.log(`max depth ${maxD}px  ->  depth/length = ${(maxD / len).toFixed(4)}`);
// where is the deepest point, as a fraction from the nose (x0 is the nose side)
let at = 0;
for (const [x, t, b] of cols) if (b - t === maxD) { at = (x - x0) / len; break; }
console.log(`deepest at ${(at * 100).toFixed(0)}% of the length from the nose`);
console.log(`wrote shots/user-contour-extracted.png`);
