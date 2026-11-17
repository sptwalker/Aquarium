// Extracts the drawing's FULL outer envelope, fins included.
//
// The component-based trace deliberately drops the fins (it wants the body
// alone). But the user judges the whole animal, so the fin extents matter just
// as much. This takes the topmost and bottommost ink pixel in each column
// instead — no component logic, no dilation, so the fins are part of the
// envelope by construction.
//
// usage: node tools/lineart-envelope.mjs [image] [outJson]
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const img = process.argv[2] || 'pic/model04.jpeg';
const outJson = process.argv[3] || 'tools/lineart-envelope.json';

const ca = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const executablePath = ca.find((p) => existsSync(p));
if (!executablePath) throw new Error('no chrome/edge found');

const browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
const page = await browser.newPage();
const b64 = readFileSync(resolve(img)).toString('base64');

const res = await page.evaluate(async (url) => {
  const im = new Image();
  await new Promise((r, j) => { im.onload = r; im.onerror = j; im.src = url; });
  const W = im.naturalWidth, H = im.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const cx = c.getContext('2d');
  cx.drawImage(im, 0, 0);
  const d = cx.getImageData(0, 0, W, H).data;
  const top = new Int32Array(W).fill(-1);
  const bot = new Int32Array(W).fill(-1);
  const cols = [];
  for (let x = 0; x < W; x++) {
    let t = -1, b = -1;
    for (let y = 0; y < H; y++) {
      const o = (y * W + x) * 4;
      const l = 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
      if (l < 120) { t = y; break; }
    }
    for (let y = H - 1; y >= 0; y--) {
      const o = (y * W + x) * 4;
      const l = 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
      if (l < 120) { b = y; break; }
    }
    // a column needs ink at both ends to belong to the drawing
    if (t >= 0 && b > t) cols.push([x, t, b]);
  }
  return { W, H, cols };
}, `data:image/jpeg;base64,${b64}`);
await browser.close();

// Drop stray specks: keep the run of columns around the widest vertical extent.
let bestI = 0, bestD = 0;
res.cols.forEach(([, t, b], i) => { if (b - t > bestD) { bestD = b - t; bestI = i; } });
const keep = res.cols.filter(([, t, b]) => b - t > bestD * 0.25);
const x0 = keep[0][0], x1 = keep[keep.length - 1][0];
let maxDepth = 0;
for (const [, t, b] of keep) maxDepth = Math.max(maxDepth, b - t);
const mid = (() => {
  const c = keep[Math.floor(keep.length / 2)];
  return (c[1] + c[2]) / 2;
})();

const stations = keep.map(([x, t, b]) => ({
  u: +(1 - (x - x0) / (x1 - x0)).toFixed(4),   // 0 at the tail end .. 1 at the nose
  top: +(-(t - mid) / (maxDepth / 2)).toFixed(4),
  bot: +(-(b - mid) / (maxDepth / 2)).toFixed(4),
}));

writeFileSync(outJson, JSON.stringify({
  image: img,
  x0, x1, maxDepth,
  depthOverLen: +(maxDepth / (x1 - x0)).toFixed(4),
  stations,
}, null, 2));
console.log(JSON.stringify({
  x0, x1, maxDepth,
  depthOverLen: +(maxDepth / (x1 - x0)).toFixed(4),
  columns: keep.length,
}, null, 2));
