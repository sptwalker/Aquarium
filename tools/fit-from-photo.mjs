// Derives PROFILE_KOI / AXIS_KOI from the reference photo itself.
//
// The photo's saturated-skin mask gives the body outline, but fins that happen
// to be reddish (the dorsal's base, the pelvic and anal) protrude into it and
// create spikes. Those columns are rejected by comparing each column against a
// running median and dropping the ones that deviate, then a smoothing spline is
// fitted through what survives.
//
// Output is normalised the same way bodySurface() consumes it: half-depth
// relative to the maximum, and the centreline drift in the same units.
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const img = process.argv[2] || 'pic/ref-goldfish.jpg';
const ca = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath = ca.find((p) => existsSync(p));
const b = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox','--use-angle=default'] });
const p = await b.newPage();
const b64 = readFileSync(resolve(img)).toString('base64');
const r = await p.evaluate(async (url) => {
  const im = new Image();
  await new Promise((s, j) => { im.onload = s; im.onerror = j; im.src = url; });
  const W = im.naturalWidth, H = im.naturalHeight;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const cx = c.getContext('2d'); cx.drawImage(im, 0, 0);
  const d = cx.getImageData(0, 0, W, H).data;
  const sat = (i) => { const r0=d[i],g0=d[i+1],b0=d[i+2]; return Math.max(r0,g0,b0)-Math.min(r0,g0,b0); };
  const lum = (i) => 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
  const top = new Int32Array(W).fill(-1), bot = new Int32Array(W).fill(-1);
  let x0 = W, x1 = 0;
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) { const i=(y*W+x)*4; if (sat(i)>62 && lum(i)>40) { top[x]=y; break; } }
    for (let y = H-1; y >= 0; y--) { const i=(y*W+x)*4; if (sat(i)>62 && lum(i)>40) { bot[x]=y; break; } }
    if (top[x]>=0) { if (x<x0) x0=x; if (x>x1) x1=x; }
  }
  return { W, H, top: Array.from(top), bot: Array.from(bot), x0, x1 };
}, `data:image/jpeg;base64,${b64}`);
await b.close();

// body end: first column from the right where the body is under 40% of peak
const h = r.bot.map((v, i) => (v >= 0 && r.top[i] >= 0) ? v - r.top[i] : -1);
const peak = Math.max(...h);
let bodyEnd = r.x1;
for (let x = r.x1; x > r.x0 + (r.x1 - r.x0) * 0.4; x--) {
  if (h[x] > 0 && h[x] < peak * 0.42) { bodyEnd = x; break; }
}
const nose = r.x0, BL = bodyEnd - nose;

// ---- outlier rejection against a running median
const cols = [];
for (let x = nose; x <= bodyEnd; x++) if (r.top[x] >= 0) cols.push(x);
function runningMedian(arr, x, half) {
  const w = [];
  for (let k = -half; k <= half; k++) { const v = arr[x + k]; if (v !== undefined && v >= 0) w.push(v); }
  w.sort((a, b2) => a - b2);
  return w.length ? w[Math.floor(w.length / 2)] : -1;
}
const half = Math.round(BL * 0.02);
const keep = [];
for (const x of cols) {
  const mt = runningMedian(r.top, x, half), mb = runningMedian(r.bot, x, half);
  if (mt < 0 || mb < 0) continue;
  // keep only columns whose outline agrees with its neighbourhood (fins deviate)
  if (Math.abs(r.top[x] - mt) < BL * 0.012 && Math.abs(r.bot[x] - mb) < BL * 0.012) keep.push(x);
}

// ---- smooth (Gaussian) resample of the kept columns onto the full range
const series = (arr) => {
  const xs = keep.map((x) => x), ys = keep.map((x) => arr[x]);
  const out = [];
  for (let x = nose; x <= bodyEnd; x++) {
    let s = 0, w = 0;
    for (let k = 0; k < xs.length; k++) {
      const dd = xs[k] - x;
      const ww = Math.exp(-(dd * dd) / (2 * (BL * 0.035) ** 2));
      s += ys[k] * ww; w += ww;
    }
    out[x] = w > 0 ? s / w : arr[x];
  }
  return out;
};
const topS = series(r.top), botS = series(r.bot);

const mid0 = (topS[nose] + botS[nose]) / 2;
const STN = [];
for (let k = 0; k <= 40; k++) STN.push(k / 40);
const halfD = [], axis = [];
for (const u of STN) {
  const x = Math.round(nose + u * BL);
  const t = topS[x], bt = botS[x];
  halfD.push((bt - t) / 2 / BL);                 // half depth / body length
  axis.push(((t + bt) / 2 - mid0) / BL);         // centreline drift
}
const maxH = Math.max(...halfD);
const prof = STN.map((u, i) => [1 - u, halfD[i] / maxH]);   // t from tail
const ax = STN.map((u, i) => [1 - u, axis[i] / maxH]);

console.log(`photo body length ${BL}px; max half-depth ${(maxH * 100).toFixed(2)}% of body length`);
console.log(`=> style.depth should be ${maxH.toFixed(4)}`);
console.log('');
console.log('const PROFILE_KOI: Profile = [');
for (let i = prof.length - 1; i >= 0; i--) console.log(`  [${prof[i][0].toFixed(3)}, ${prof[i][1].toFixed(3)}],`);
console.log('];');
console.log('const AXIS_KOI: Profile = [');
for (let i = ax.length - 1; i >= 0; i--) console.log(`  [${ax[i][0].toFixed(3)}, ${ax[i][1].toFixed(3)}],`);
console.log('];');
console.log('');
console.log('  u    halfD   axis');
for (let i = 0; i <= 40; i += 4) console.log(`${STN[i].toFixed(2)}  ${(halfD[i] / maxH).toFixed(3)}  ${(axis[i] / maxH).toFixed(3)}`);
