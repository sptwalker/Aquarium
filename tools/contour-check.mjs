// Puts the model's orthographic silhouette and the user's hand-traced contour
// on one normalised frame, so the two can be compared directly.
//
// This exists because three different measurements of the same model had been
// produced and they disagreed badly:
//   orthographic silhouette render   depth/length 0.334
//   screenshot colour mask           depth/length 0.352
//   user's hand trace (this)         depth/length 0.422
// At most one of those can be right, so they are put side by side here.
//
// Both contours are scaled by their own nose-to-tail extent and centred, which
// is the only normalisation that does not presuppose the answer.
//
// usage: node tools/contour-check.mjs [baseUrl]
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import zlib from 'node:zlib';
import { captureSilhouette } from './silhouette.mjs';

const base = process.argv[2] || 'http://localhost:5173';

// ---- user's red contour --------------------------------------------------
const ca = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath = ca.find((p) => existsSync(p));
const browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 640, deviceScaleFactor: 2 });

const b64 = readFileSync(resolve('pic/user-overlay.jpg')).toString('base64');
const user = await page.evaluate(async (url) => {
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

// ---- model silhouette ----------------------------------------------------
const silh = await captureSilhouette(base, 'koi');
const model = silh.cols;

// ---- normalise both the same way: u along the length, y in length units ---
const norm = (cols) => {
  const x0 = cols[0][0], x1 = cols[cols.length - 1][0];
  const len = x1 - x0;
  let maxD = 0;
  for (const [, t, b] of cols) maxD = Math.max(maxD, b - t);
  const mid = (() => { const c = cols[Math.floor(cols.length / 2)]; return (c[1] + c[2]) / 2; })();
  return {
    ratio: maxD / len,
    pts: cols.map(([x, t, b]) => ({
      u: (x - x0) / len,
      top: (mid - t) / len,
      bot: (mid - b) / len,
    })),
  };
};
const U = norm(user);
const M = norm(model);

const png = await page.evaluate((U2, M2) => {
  const W = 1100, H = 560;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, H);

  let peak = 0;
  for (const p of [...U2.pts, ...M2.pts]) peak = Math.max(peak, Math.abs(p.top), Math.abs(p.bot));
  const padL = 50, padR = 30, padT = 70, padB = 90;
  const plotW = W - padL - padR;
  const midY = padT + (H - padT - padB) / 2;
  const sy = (H - padT - padB) / 2 / (peak * 1.08);
  const X = (u) => padL + u * plotW;
  const Y = (v) => midY - v * sy;

  cx.strokeStyle = '#eceff3';
  for (let k = -4; k <= 4; k++) {
    const v = k * peak / 4;
    cx.beginPath(); cx.moveTo(padL, Y(v)); cx.lineTo(padL + plotW, Y(v)); cx.stroke();
  }
  cx.strokeStyle = '#cfd5de';
  cx.beginPath(); cx.moveTo(padL, Y(0)); cx.lineTo(padL + plotW, Y(0)); cx.stroke();

  const draw = (pts, color) => {
    cx.strokeStyle = color; cx.lineWidth = 2.2; cx.lineJoin = 'round';
    for (const key of ['top', 'bot']) {
      cx.beginPath();
      pts.forEach((p, i) => (i ? cx.lineTo(X(p.u), Y(p[key])) : cx.moveTo(X(p.u), Y(p[key]))));
      cx.stroke();
    }
  };
  draw(U2.pts, '#e5484d');
  draw(M2.pts, '#1f6feb');

  cx.fillStyle = '#24292f';
  cx.font = '600 15px ui-sans-serif, system-ui, sans-serif';
  cx.fillText('MODEL CONTOUR — user trace vs orthographic render', padL, 30);
  cx.font = '12px ui-sans-serif, system-ui, sans-serif';
  cx.fillStyle = '#5b6472';
  cx.fillText(`depth/length: user trace ${U2.ratio.toFixed(3)}   orthographic render ${M2.ratio.toFixed(3)}`, padL, 50);

  const legend = (y, color, label) => {
    cx.strokeStyle = color; cx.lineWidth = 3;
    cx.beginPath(); cx.moveTo(padL, y); cx.lineTo(padL + 32, y); cx.stroke();
    cx.fillStyle = '#24292f';
    cx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
    cx.fillText(label, padL + 42, y + 5);
  };
  legend(H - 56, '#e5484d', "user's trace of the model (pic/user-overlay.jpg)");
  legend(H - 30, '#1f6feb', 'orthographic silhouette render (?silhouette=1)');
  return cv.toDataURL('image/png');
}, U, M);

await browser.close();
mkdirSync('shots', { recursive: true });
writeFileSync('shots/contour-check.png', Buffer.from(png.split(',')[1], 'base64'));

console.log(`user trace      depth/length = ${U.ratio.toFixed(4)}`);
console.log(`ortho silhouette depth/length = ${M.ratio.toFixed(4)}`);
console.log('wrote shots/contour-check.png');
void zlib;
