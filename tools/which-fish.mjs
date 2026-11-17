// Identifies which species the screenshot actually shows.
//
// The showcase page defaults to `oranda` when no ?species= is given. If the
// screenshot was taken without that parameter, every comparison I ran against
// the koi line art was comparing two different fish.
//
// This compares the user's traced contour against each species' own
// orthographic silhouette — normalised by nose-to-tail length, sampled at the
// same stations — and reports the RMS shape difference.
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureSilhouette, normalise } from './silhouette.mjs';

const ca = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath = ca.find((p) => existsSync(p));
const browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
const page = await browser.newPage();

const b64 = readFileSync(resolve('pic/user-overlay.jpg')).toString('base64');
const userCols = await page.evaluate(async (url) => {
  const im = new Image();
  await new Promise((r, j) => { im.onload = r; im.onerror = j; im.src = url; });
  const W = im.naturalWidth, H = im.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const cx = c.getContext('2d');
  cx.drawImage(im, 0, 0);
  const d = cx.getImageData(0, 0, W, H).data;
  const isRed = (i) => d[i] > 120 && d[i] - d[i + 1] > 70 && d[i] - d[i + 2] > 70;
  const top = new Int32Array(W).fill(-1), bot = new Int32Array(W).fill(-1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) if (isRed((y * W + x) * 4)) { top[x] = y; break; }
    for (let y = H - 1; y >= 0; y--) if (isRed((y * W + x) * 4)) { bot[x] = y; break; }
  }
  const cols = [];
  for (let x = 0; x < W; x++) if (top[x] >= 0) cols.push([x, top[x], bot[x]]);
  return cols;
}, `data:image/jpeg;base64,${b64}`);
await browser.close();

// Both are put in body-length units, nose at u = 0, then sampled at 21 stations.
const desk = (cols) => {
  const x0 = cols[0][0], x1 = cols[cols.length - 1][0];
  const len = x1 - x0;
  let maxD = 0;
  for (const [, t, b] of cols) maxD = Math.max(maxD, b - t);
  const mid = (() => { const c = cols[Math.floor(cols.length / 2)]; return (c[1] + c[2]) / 2; })();
  const at = (u) => {
    const x = Math.round(x0 + u * len);
    let best = cols[0], bd = 1e9;
    for (const c of cols) { const dd = Math.abs(c[0] - x); if (dd < bd) { bd = dd; best = c; } }
    return [(mid - best[1]) / len, (mid - best[2]) / len];
  };
  return { ratio: maxD / len, at };
};

const U = desk(userCols);
const STATIONS = Array.from({ length: 21 }, (_, i) => i / 20);

console.log(`user's red trace: depth/length ${U.ratio.toFixed(4)}`);
console.log('');
console.log('species     depth/length   RMS shape diff vs the trace');
for (const sp of ['koi', 'oranda', 'fantail', 'ryukin', 'comet']) {
  const silh = await captureSilhouette('http://localhost:5173', sp);
  const cols = silh.cols;
  const D = desk(cols.map(([x, t, b]) => [x, t, b]));
  let ss = 0, n = 0;
  for (const u of STATIONS) {
    const [ut, ub] = U.at(u);
    const [dt, db] = D.at(u);
    ss += (ut - dt) ** 2 + (ub - db) ** 2;
    n += 2;
  }
  const rms = Math.sqrt(ss / n);
  console.log(`${sp.padEnd(10)}  ${D.ratio.toFixed(4).padStart(9)}      ${rms.toFixed(4)}`);
}
