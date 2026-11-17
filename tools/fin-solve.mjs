// Solves for the fin scale factors directly.
//
// Guessing fin sizes has failed repeatedly, so this measures the defect at fixed
// stations and prints the multiplier each fin needs. No iteration, no eyeballing:
// measure drawing, measure model, divide.
//
// Regions are in u-from-the-nose (drawing orientation), matching
// tools/fin-measure.mjs.
//
// usage: node tools/fin-solve.mjs [baseUrl]
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureSilhouette } from './silhouette.mjs';

const base = process.argv[2] || 'http://localhost:5173';
const ca = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath = ca.find((p) => existsSync(p));

// ---- drawing: body vs full envelope, in the drawing's own pixels ----------
const browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
const page = await browser.newPage();
const b64 = readFileSync(resolve('pic/koi-side.jpg')).toString('base64');
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

const bodyCols = JSON.parse(readFileSync('tools/side.json', 'utf8')).cols;
const dx0 = envCols[0][0], dx1 = envCols[envCols.length - 1][0];
const dLen = dx1 - dx0;
const dMid = (() => { const c = envCols[Math.floor(envCols.length / 2)]; return (c[1] + c[2]) / 2; })();
const bodyAt = (x) => {
  let best = bodyCols[0], bd = 1e9;
  for (const c of bodyCols) { const dd = Math.abs(c[0] - x); if (dd < bd) { bd = dd; best = c; } }
  return best;
};
const drawFin = (u) => {
  const x = Math.round(dx0 + u * dLen);
  let best = envCols[0], bd = 1e9;
  for (const c of envCols) { const dd = Math.abs(c[0] - x); if (dd < bd) { bd = dd; best = c; } }
  const body = bodyAt(x);
  return { above: (body[1] - best[1]) / dLen, below: (best[2] - body[2]) / dLen };
};

// ---- model ---------------------------------------------------------------
//
// Normalise by the BODY's length, not the full silhouette's.
//
// Both captures were being divided by their own nose-to-tail extent, but the
// full silhouette's extent includes the caudal fin, which grows when the fins
// grow. So scaling a fin up enlarged the denominator as well as the numerator,
// and the measured projection barely moved — successive solves chased their own
// tail. The body-only capture gives a stable ruler that the fin sizes cannot
// influence.
const desk = (cols, refLen) => {
  const x0 = cols[0][0], x1 = cols[cols.length - 1][0];
  // if no reference length is given, this capture defines it
  const len = refLen ?? (x1 - x0);
  const mid = (() => { const c = cols[Math.floor(cols.length / 2)]; return (c[1] + c[2]) / 2; })();
  return {
    len,
    pts: cols.map(([x, t, b]) => ({ u: (x - x0) / len, top: (mid - t) / len, bot: (mid - b) / len })),
  };
};
const bodyCap = await captureSilhouette(base, 'koi', { all: false });
const allCap = await captureSilhouette(base, 'koi', { all: true });
const B = desk(bodyCap.cols);
const A = desk(allCap.cols, B.len);
const A_PTS = A.pts, B_PTS = B.pts;
const modelAt = (u) => {
  const near = (arr) => {
    let best = arr[0], bd = 1e9;
    for (const p of arr) { const d = Math.abs(p.u - u); if (d < bd) { bd = d; best = p; } }
    return best;
  };
  const a = near(A_PTS), b = near(B_PTS);
  return { above: a.top - b.top, below: b.bot - a.bot };
};

// ---- compare at the peaks of each drawing region -------------------------
const REGIONS = [
  { name: 'dorsal', u: 0.52, side: 'above' },
  { name: 'pectoral', u: 0.29, side: 'below' },
  { name: 'pelvic', u: 0.50, side: 'below' },
  { name: 'anal', u: 0.70, side: 'below' },
  { name: 'caudal upper', u: 0.94, side: 'above' },
  { name: 'caudal lower', u: 0.94, side: 'below' },
];

console.log('region          u     drawing   model    needed x');
for (const r of REGIONS) {
  const d = drawFin(r.u)[r.side];
  const m = modelAt(r.u)[r.side];
  const k = m > 0.002 ? d / m : Infinity;
  console.log(`${r.name.padEnd(14)} ${r.u.toFixed(2)}   ${d.toFixed(3).padStart(6)}  ${m.toFixed(3).padStart(6)}   ${Number.isFinite(k) ? k.toFixed(2) : '  inf'}`);
}
