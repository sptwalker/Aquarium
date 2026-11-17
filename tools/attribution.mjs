// Puts three contours on one scale-free footing so the discrepancy can be
// attributed instead of argued about:
//
//   1. the user's red trace (pic/user-overlay.jpg)      — "the model's body"
//   2. the drawing's BODY outline (tools/side.json)     — fins excluded
//   3. the drawing's FULL envelope (ink top/bottom)     — fins included
//
// All three are normalised by their own nose-to-tail length, so scale and
// framing drop out and what remains is pure shape. If (1) matches (3) rather
// than (2), the trace is of the outer silhouette including the dorsal fin —
// which would explain most of the gap.
//
// usage: node tools/attribution.mjs
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const ca = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath = ca.find((p) => existsSync(p));
const browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
const page = await browser.newPage();

const load = async (path) => {
  const b64 = readFileSync(resolve(path)).toString('base64');
  return page.evaluate(async (url) => {
    const im = new Image();
    await new Promise((r, j) => { im.onload = r; im.onerror = j; im.src = url; });
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const cx = c.getContext('2d');
    cx.drawImage(im, 0, 0);
    return { W: c.width, H: c.height, d: Array.from(cx.getImageData(0, 0, c.width, c.height).data) };
  }, `data:image/jpeg;base64,${b64}`);
};

// ---- 1. the drawing: full ink envelope -----------------------------------
const art = await load('pic/koi-side.jpg');
const env = await page.evaluate((img) => {
  const { W, H, d } = img;
  const lum = (i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const top = new Int32Array(W).fill(-1), bot = new Int32Array(W).fill(-1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) if (lum((y * W + x) * 4) < 150) { top[x] = y; break; }
    for (let y = H - 1; y >= 0; y--) if (lum((y * W + x) * 4) < 150) { bot[x] = y; break; }
  }
  const cols = [];
  for (let x = 0; x < W; x++) if (top[x] >= 0) cols.push([x, top[x], bot[x]]);
  return cols;
}, art);

// ---- 2. the drawing: body-only outline ----------------------------------
const bodyJson = JSON.parse(readFileSync('tools/side.json', 'utf8'));
const bodyCols = bodyJson.cols;

// ---- 3. the user's red trace --------------------------------------------
const overlay = await load('pic/user-overlay.jpg');
const red = await page.evaluate((img) => {
  const { W, H, d } = img;
  const isRed = (i) => d[i] > 120 && d[i] - d[i + 1] > 70 && d[i] - d[i + 2] > 70;
  const top = new Int32Array(W).fill(-1), bot = new Int32Array(W).fill(-1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) if (isRed((y * W + x) * 4)) { top[x] = y; break; }
    for (let y = H - 1; y >= 0; y--) if (isRed((y * W + x) * 4)) { bot[x] = y; break; }
  }
  const cols = [];
  for (let x = 0; x < W; x++) if (top[x] >= 0) cols.push([x, top[x], bot[x]]);
  return cols;
}, overlay);

await browser.close();

// ---- normalise all three by their own length, nose at u = 0 --------------
// The fish faces left in every image, so increasing x runs nose -> tail.
const desk = (cols, label) => {
  const x0 = cols[0][0], x1 = cols[cols.length - 1][0];
  const len = x1 - x0;
  let maxD = 0, peakX = x0;
  for (const [x, t, b] of cols) if (b - t > maxD) { maxD = b - t; peakX = x; }
  const mid = (() => { const c = cols[Math.floor(cols.length / 2)]; return (c[1] + c[2]) / 2; })();
  const at = (u) => {
    const x = Math.round(x0 + u * len);
    let best = cols[0], bd = 1e9;
    for (const c of cols) { const dd = Math.abs(c[0] - x); if (dd < bd) { bd = dd; best = c; } }
    return { top: (mid - best[1]) / len, bot: (mid - best[2]) / len };
  };
  return { label, len, maxD, ratio: maxD / len, peakU: (peakX - x0) / len, at };
};

const tris = [
  desk(red, "user's red trace"),
  desk(bodyCols, 'drawing — body only'),
  desk(env, 'drawing — full envelope'),
];

console.log('contour                  depth/length   deepest at');
for (const t of tris) {
  console.log(`${t.label.padEnd(24)} ${t.ratio.toFixed(4).padStart(9)}   ${(t.peakU * 100).toFixed(0)}%`);
}

console.log('\ntop edge (body-length units, nose at u=0):');
console.log('  u     ' + [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
  .map((v) => v.toFixed(1).padStart(7)).join(''));
for (const t of tris) {
  console.log(`  ${t.label.slice(0, 14).padEnd(14)}` + [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
    .map((u) => t.at(u).top.toFixed(3).padStart(7)).join(''));
}
console.log('\nbottom edge:');
for (const t of tris) {
  console.log(`  ${t.label.slice(0, 14).padEnd(14)}` + [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
    .map((u) => t.at(u).bot.toFixed(3).padStart(7)).join(''));
}

// ---- serialise the sampled contours, then plot in the browser --------------
// Functions cannot cross into page.evaluate, so the samples are materialised
// first. (The earlier version passed the desk objects and failed with
// "t.at is not a function".)
const series = tris.map((t) => ({
  label: t.label,
  ratio: t.ratio,
  pts: Array.from({ length: 201 }, (_, k) => {
    const v = t.at(k / 200);
    return [k / 200, v.top, v.bot];
  }),
}));

const W = 1100, H = 560;
const b = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
const p = await b.newPage();
await p.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
const png = await p.evaluate((series2) => {
  const W2 = 1100, H2 = 560;
  const cv = document.createElement('canvas');
  cv.width = W2; cv.height = H2;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, W2, H2);

  let peak = 0;
  for (const t of series2) for (const [, a, c] of t.pts) peak = Math.max(peak, Math.abs(a), Math.abs(c));
  const padL = 55, padR = 30, padT = 66, padB = 92;
  const plotW = W2 - padL - padR;
  const midY = padT + (H2 - padT - padB) / 2;
  const sy = (H2 - padT - padB) / 2 / (peak * 1.1);
  const X = (u) => padL + u * plotW;
  const Y = (v) => midY - v * sy;

  cx.strokeStyle = '#eceff3';
  for (let k = -4; k <= 4; k++) {
    const v = k * peak / 4;
    cx.beginPath(); cx.moveTo(padL, Y(v)); cx.lineTo(padL + plotW, Y(v)); cx.stroke();
  }
  cx.strokeStyle = '#cfd5de';
  cx.beginPath(); cx.moveTo(padL, Y(0)); cx.lineTo(padL + plotW, Y(0)); cx.stroke();

  const colors = ['#e5484d', '#1f6feb', '#14a06a'];
  series2.forEach((t, i) => {
    cx.strokeStyle = colors[i];
    cx.lineWidth = i === 0 ? 2.6 : 1.9;
    if (i === 2) cx.setLineDash([7, 4]);
    for (const col of [1, 2]) {
      cx.beginPath();
      t.pts.forEach((pt, k) => {
        const u = pt[0], v = pt[col];
        k ? cx.lineTo(X(u), Y(v)) : cx.moveTo(X(u), Y(v));
      });
      cx.stroke();
    }
    cx.setLineDash([]);
  });

  cx.fillStyle = '#24292f';
  cx.font = '600 15px ui-sans-serif, system-ui, sans-serif';
  cx.fillText('WHY THE CONTOURS DISAGREE', padL, 28);
  cx.font = '12px ui-sans-serif, system-ui, sans-serif';
  cx.fillStyle = '#5b6472';
  cx.fillText('each normalised by its own nose-to-tail length; vertical axis in the same units', padL, 48);

  let ly = H2 - 62;
  series2.forEach((t, i) => {
    cx.strokeStyle = colors[i]; cx.lineWidth = 3;
    if (i === 2) cx.setLineDash([7, 4]);
    cx.beginPath(); cx.moveTo(padL, ly); cx.lineTo(padL + 30, ly); cx.stroke();
    cx.setLineDash([]);
    cx.fillStyle = '#24292f';
    cx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    cx.fillText(`${t.label}    depth/length ${t.ratio.toFixed(3)}`, padL + 40, ly + 4);
    ly += 22;
  });
  return cv.toDataURL('image/png');
}, series);
await b.close();

writeFileSync('shots/attribution.png', Buffer.from(png.split(',')[1], 'base64'));
console.log('wrote shots/attribution.png');
