// Measures the FIN extents from the reference drawing.
//
// Two traces of the same image are available and differ only by the fins:
//   tools/side.json  — body only (ink dilated so the fins drop out)
//   an ink envelope  — body + fins
// Their difference, column by column, IS the fins: above the body is the dorsal,
// below it the pelvic/anal, and the same at the tail for the caudal lobes.
//
// This exists because the screenshot-vs-lineart comparison showed the model is
// 32% flatter than the drawing, while the body alone is only 5% shallow. The gap
// is nearly all fin, and guessing fin sizes is what produced it.
//
// usage: node tools/fin-measure.mjs
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const IMG = 'pic/koi-side.jpg';
const ca = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath = ca.find((p) => existsSync(p));
const browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
const page = await browser.newPage();
const b64 = readFileSync(resolve(IMG)).toString('base64');

const envCols = await page.evaluate(async (url) => {
  const im = new Image();
  await new Promise((r, j) => { im.onload = r; im.onerror = j; im.src = url; });
  const W = im.naturalWidth, H = im.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const cx = c.getContext('2d');
  cx.drawImage(im, 0, 0);
  const d = cx.getImageData(0, 0, W, H).data;
  const lum = (i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const top = new Int32Array(W).fill(-1), bot = new Int32Array(W).fill(-1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) if (lum((y * W + x) * 4) < 150) { top[x] = y; break; }
    for (let y = H - 1; y >= 0; y--) if (lum((y * W + x) * 4) < 150) { bot[x] = y; break; }
  }
  const cols = [];
  for (let x = 0; x < W; x++) if (top[x] >= 0) cols.push([x, top[x], bot[x]]);
  return cols;
}, `data:image/jpeg;base64,${b64}`);
await browser.close();

const bodyJson = JSON.parse(readFileSync('tools/side.json', 'utf8'));
const bodyCols = bodyJson.cols;
const bodyMap = new Map(bodyCols.map(([x, t, b]) => [x, [t, b]]));

// Common frame: the drawing's own pixels, u measured from the nose.
const x0 = envCols[0][0];
const x1 = envCols[envCols.length - 1][0];
const len = x1 - x0;

// A straight reference for the body outline: fill gaps by nearest body column.
const bodyAt = (x) => {
  let best = bodyCols[0], bd = 1e9;
  for (const c of bodyCols) { const dd = Math.abs(c[0] - x); if (dd < bd) { bd = dd; best = c; } }
  return [best[1], best[2]];
};

console.log(`drawing body length ${len}px, nose at x=${x0}, tail tip at x=${x1}`);
console.log('');

// Sample fin protrusions
const rows = [];
for (const [x, t, b] of envCols) {
  const [bt, bb] = bodyAt(x);
  rows.push({
    u: (x - x0) / len,
    finAbove: (bt - t) / len,     // dorsal / caudal upper lobe
    finBelow: (b - bb) / len,     // pelvic / anal / caudal lower lobe
  });
}

const runs = (key, thr) => {
  const out = [];
  let cur = null;
  for (const r of rows) {
    if (r[key] > thr) {
      if (!cur) cur = { u0: r.u, u1: r.u, peak: 0, peakU: 0 };
      cur.u1 = r.u;
      if (r[key] > cur.peak) { cur.peak = r[key]; cur.peakU = r.u; }
    } else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.filter((c) => c.u1 - c.u0 > 0.02);
};

console.log('FIN REGIONS (height in body-length units, u from the nose)');
console.log('');
console.log('above the body (dorsal + caudal upper lobe):');
for (const c of runs('finAbove', 0.012)) {
  console.log(`  u ${c.u0.toFixed(2)}–${c.u1.toFixed(2)}   peak ${c.peak.toFixed(3)} at u=${c.peakU.toFixed(2)}`);
}
console.log('below the body (pelvic / anal / caudal lower lobe):');
for (const c of runs('finBelow', 0.012)) {
  console.log(`  u ${c.u0.toFixed(2)}–${c.u1.toFixed(2)}   peak ${c.peak.toFixed(3)} at u=${c.peakU.toFixed(2)}`);
}

// Current model values, for comparison. t in fish.ts runs 0 at the tail,
// 1 at the nose, so u = 1 - t.
const L = 1.45;
const cur = [
  ['dorsal', 0.30, 0.66, L * 0.095],
  ['anal', 0.24, 0.44, L * 0.065],
  ['pectoral', 0.60, 0.73, L * 0.058],
  ['pelvic', 0.44, 0.56, L * 0.050],
];
console.log('');
console.log('CURRENT MODEL (maxH converted to body-length units by dividing by L)');
for (const [name, t0, t1, maxH] of cur) {
  console.log(`  ${name.padEnd(9)} u ${(1 - t1).toFixed(2)}–${(1 - t0).toFixed(2)}   maxH ${(maxH / L).toFixed(3)}`);
}
