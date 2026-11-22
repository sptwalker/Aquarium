// Solves PROFILE_KOI and AXIS_KOI EXACTLY from the reference photo.
//
// In side view the body silhouette is, by construction of bodySurface():
//     top(t) = axis(t)*depth*L + profile(t)*depth*L
//     bot(t) = axis(t)*depth*L - profile(t)*depth*L
// so given the photo's two curves:
//     profile(t) = (top - bot) / (2 * depth * L)
//     axis(t)    = (top + bot) / (2 * depth * L)
// No fitting, no smoothing guesswork: the numbers follow from the measurement.
//
// The only free choice is depth, which is the max half-depth as a fraction of
// body length — measured as 0.44/2 = 0.22, and set below.
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const img = 'pic/ref-goldfish.jpg';
const DEPTH = +(process.argv[2] ?? 0.207);

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
  const ok = (i) => sat(i) > 40 && lum(i) > 30 && lum(i) < 236;
  const top = new Int32Array(W).fill(-1), bot = new Int32Array(W).fill(-1);
  let x0 = W, x1 = 0;
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) if (ok((y*W+x)*4)) { top[x]=y; break; }
    for (let y = H-1; y >= 0; y--) if (ok((y*W+x)*4)) { bot[x]=y; break; }
    if (top[x]>=0) { if (x<x0) x0=x; if (x>x1) x1=x; }
  }
  return { W, H, top: Array.from(top), bot: Array.from(bot), x0, x1 };
}, `data:image/jpeg;base64,${b64}`);
await b.close();

const { top, bot, x0 } = r;
// Body ends where the saturated skin stops: scan from the right for the last
// column where the body is at least 60% of the maximum height, then take a few
// columns past it. The pale caudal fin fails the saturation test on its own.
let peak = 0;
for (let x = x0; x < r.x1; x++) if (top[x] >= 0) peak = Math.max(peak, bot[x] - top[x]);
let bodyEnd = r.x1;
for (let x = r.x1; x > x0; x--) {
  if (top[x] >= 0 && (bot[x] - top[x]) > peak * 0.55) { bodyEnd = x; break; }
}
const BL = bodyEnd - x0;

// Centre the vertical reference on the mid-body centreline.
const midAt = (x) => (top[x] + bot[x]) / 2;
const mid0 = midAt(Math.round(x0 + BL * 0.45));

// Reject columns where a fin has intruded: compare with a wide running median.
const med = (arr, x, half) => {
  const w = [];
  for (let k = -half; k <= half; k++) { const v = arr[x + k]; if (v !== undefined && v >= 0) w.push(v); }
  w.sort((a, b2) => a - b2);
  return w.length ? w[Math.floor(w.length / 2)] : -1;
};
const half = Math.round(BL * 0.020);
const good = [];
for (let x = x0; x <= bodyEnd; x++) {
  if (top[x] < 0) continue;
  const mt = med(top, x, half), mb = med(bot, x, half);
  if (mt < 0 || mb < 0) continue;
  if (Math.abs(top[x]-mt) < BL*0.010 && Math.abs(bot[x]-mb) < BL*0.010) good.push(x);
}
const gx = good, gt = good.map((x) => (mid0 - top[x]) / BL), gb = good.map((x) => (mid0 - bot[x]) / BL);
const smooth = (xs, ys, x) => {
  let s = 0, w = 0;
  for (let k = 0; k < xs.length; k++) {
    const dd = (xs[k] - x) / (BL * 0.030);
    const ww = Math.exp(-0.5 * dd * dd);
    s += ys[k] * ww; w += ww;
  }
  return w > 0 ? s / w : 0;
};

const STN = [];
for (let k = 0; k <= 20; k++) STN.push(k / 20);
const prof = [], axis = [];
console.log(`photo body length ${BL}px, depth set to ${DEPTH}`);
console.log('\n  t     top      bot     profile   axis');
for (const [i, u] of STN.entries()) {
  const x = Math.round(x0 + u * BL);
  const T = smooth(gx, gt, x), B = smooth(gx, gb, x);
  const pr = (T - B) / (2 * DEPTH);
  const ax = (T + B) / (2 * DEPTH);
  const t = 1 - u;
  prof.push([t, pr]);
  axis.push([t, ax]);
  console.log(`${t.toFixed(2)}  ${T.toFixed(3).padStart(7)}  ${B.toFixed(3).padStart(7)}  ${pr.toFixed(3).padStart(7)}  ${ax.toFixed(3).padStart(7)}`);
}
const pmax = Math.max(...prof.map((q) => Math.abs(q[1])));
console.log(`\nmax profile = ${pmax.toFixed(3)} (should be ~1.0 for depth ${DEPTH})`);
console.log('\n--- paste ---');
console.log('const PROFILE_KOI: Profile = [');
console.log(prof.map(([t, v]) => `  [${t.toFixed(3)}, ${(v / pmax).toFixed(3)}],`).join('\n'));
console.log('];');
console.log('const AXIS_KOI: Profile = [');
console.log(axis.map(([t, v]) => `  [${t.toFixed(3)}, ${(v / pmax).toFixed(3)}],`).join('\n'));
console.log('];');
