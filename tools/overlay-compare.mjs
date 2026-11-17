// Draws the reference line art and the model's side projection on one image,
// in two colours, with a legend and the residual band.
//
// Compositing happens inside the browser canvas so real text can be used —
// hand-plotting pixels in node gives no labels and no way to show the axes.
//
//   red   = reference line art  (pic/koi-side.jpg, traced by tools/trace-ref.mjs)
//   blue  = model side projection (orthographic render via ?silhouette=1)
//
// The red curve is median-filtered: the raw trace has 1-3 column notches where
// the gill stroke and the pectoral root cut into the body region. Those are
// artefacts of separating body from fin, not the drawn outline, and they were
// making the comparison unreadable.
//
// usage: node tools/overlay-compare.mjs [baseUrl] [outPng]
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureSilhouette, normalise } from './silhouette.mjs';

const base = process.argv[2] || 'http://localhost:5173';
const outPng = process.argv[3] || 'shots/overlay-side.png';
const IMG = 'pic/koi-side.jpg';

// ---- reference ------------------------------------------------------------
const side = JSON.parse(readFileSync('tools/side.json', 'utf8'));
const { cols, x0, x1 } = side;
const span = x1 - x0;
const DIL = 7;

const refRaw = cols.map(([x, t, b]) => [x, t - DIL, b + DIL]);
const median = (vals, k) => vals.map((_, i) => {
  const w = vals.slice(Math.max(0, i - k), Math.min(vals.length, i + k + 1)).sort((a, b) => a - b);
  return w[Math.floor(w.length / 2)];
});
const refT = median(refRaw.map((c) => c[1]), 7);
const refB = median(refRaw.map((c) => c[2]), 7);
const refCols = refRaw.map(([x], i) => [x, refT[i], refB[i]]);

let maxDepth = 0;
for (const [, t, b] of refCols) maxDepth = Math.max(maxDepth, b - t);
const midRow = (() => {
  const c = refCols[Math.floor(refCols.length / 2)];
  return (c[1] + c[2]) / 2;
})();
const halfPx = maxDepth / 2;

// ---- model ---------------------------------------------------------------
const silh = await captureSilhouette(base, 'koi');
const model = normalise(silh.cols);
const mAt = (u) => {
  const x = (1 - u) * (model.length - 1);
  const i = Math.floor(x), f = x - i;
  const a = i, b = Math.min(model.length - 1, i + 1);
  return {
    top: model[a].top * (1 - f) + model[b].top * f,
    bot: model[a].bot * (1 - f) + model[b].bot * f,
  };
};
const modelPts = [];
for (let i = 0; i <= 400; i++) {
  const u = i / 400;
  const m = mAt(u);
  const x = x1 - u * span;                 // u = 1 is the nose, at x0
  modelPts.push([x, midRow - m.top * halfPx, midRow - m.bot * halfPx]);
}

// residual, in units of half-depth, over the length
const refAt = (x) => {
  let best = refCols[0];
  let bd = 1e9;
  for (const c of refCols) { const d = Math.abs(c[0] - x); if (d < bd) { bd = d; best = c; } }
  return best;
};
const resid = [];
for (let i = 0; i <= 200; i++) {
  const u = i / 200;
  const x = x1 - u * span;
  const r = refAt(x);
  const m = mAt(u);
  // Both sides must be in the SAME units before subtracting. r[1]/r[2] are
  // pixel ROWS; m.top/m.bot are offsets in half-depths. Converting the
  // reference to an offset while leaving the model as a row subtracted unlike
  // quantities and reported a meaningless few-hundred-percent error.
  const mt = midRow - m.top * halfPx;
  const mb = midRow - m.bot * halfPx;
  resid.push({ u, dt: (r[1] - mt) / halfPx, db: (r[2] - mb) / halfPx });
}
const meanAbs = resid.slice(10, -10).reduce((a, r) => a + Math.abs(r.dt) + Math.abs(r.db), 0) / (2 * (resid.length - 20));

// ---- composite in the browser so text can be drawn -----------------------
const ca = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath = ca.find((p) => existsSync(p));
const browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 900, deviceScaleFactor: 2 });

const b64 = readFileSync(resolve(IMG)).toString('base64');
const png = await page.evaluate(async (url, payload) => {
  const { refCols, modelPts, resid, meanAbs, W: imgW, H: imgH } = payload;
  const im = new Image();
  await new Promise((r, j) => { im.onload = r; im.onerror = j; im.src = url; });

  // Canvas is the drawing's own pixel frame plus a strip for the residual
  // plot. Every curve coordinate is already in that frame, so no scaling is
  // applied to them — earlier this drew a 900x678 drawing into a 960x820
  // canvas and left the curves unscaled, which put them out of register.
  const W = imgW, H = imgH + 110;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const cx = cv.getContext('2d');

  cx.fillStyle = '#ffffff';
  cx.fillRect(0, 0, W, H);

  // artwork, lightened so the overlay colours dominate
  cx.globalAlpha = 0.30;
  cx.drawImage(im, 0, 0, imgW, imgH);
  cx.globalAlpha = 1;

  // residual band along the top edge
  const bandY = 44, bandH = 44;
  cx.fillStyle = '#f2f4f7';
  cx.fillRect(40, bandY, W - 80, bandH);
  cx.strokeStyle = '#d8dce3';
  cx.strokeRect(40, bandY, W - 80, bandH);
  const toBand = (r) => bandY + bandH / 2 - Math.max(-0.1, Math.min(0.1, r)) * (bandH / 0.2) * 1.7;
  cx.strokeStyle = '#c9ced8';
  cx.beginPath(); cx.moveTo(40, bandY + bandH / 2); cx.lineTo(W - 40, bandY + bandH / 2); cx.stroke();

  cx.beginPath();
  resid.forEach((r, i) => {
    const x = 40 + (i / (resid.length - 1)) * (W - 80);
    const y = toBand(r.dt);
    i ? cx.lineTo(x, y) : cx.moveTo(x, y);
  });
  cx.strokeStyle = '#1f6feb'; cx.lineWidth = 1.2; cx.stroke();
  cx.beginPath();
  resid.forEach((r, i) => {
    const x = 40 + (i / (resid.length - 1)) * (W - 80);
    const y = toBand(r.db);
    i ? cx.lineTo(x, y) : cx.moveTo(x, y);
  });
  cx.strokeStyle = '#e5484d'; cx.lineWidth = 1.2; cx.stroke();

  cx.fillStyle = '#5b6472';
  cx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
  cx.fillText('RESIDUAL   vertical scale x8.5, range ±0.1 half-depth', 44, bandY - 10);
  cx.font = '11px ui-sans-serif, system-ui, sans-serif';
  cx.fillStyle = '#3f4652';
  cx.fillText(`mean |error| ${meanAbs.toFixed(4)}`, W - 200, bandY - 10);

  // reference curve
  const stroke = (pts, key, color, width) => {
    cx.beginPath();
    pts.forEach((p, i) => {
      const y = p[key];
      i ? cx.lineTo(p[0], y) : cx.moveTo(p[0], y);
    });
    cx.strokeStyle = color; cx.lineWidth = width; cx.lineJoin = 'round'; cx.stroke();
  };
  const refT2 = refCols.map(([x, t]) => [x, t]);
  const refB2 = refCols.map(([x, , b]) => [x, b]);
  stroke(refT2, 1, '#e5484d', 2.2);
  stroke(refB2, 1, '#e5484d', 2.2);

  const mTop = modelPts.map((p) => [p[0], p[1]]);
  const mBot = modelPts.map((p) => [p[0], p[2]]);
  stroke(mTop, 1, '#1f6feb', 2.2);
  stroke(mBot, 1, '#1f6feb', 2.2);

  // legend
  const lx = 60, ly = H - 74;
  cx.fillStyle = '#ffffff';
  cx.fillRect(lx - 12, ly - 22, 300, 62);
  cx.strokeStyle = '#e3e6ea';
  cx.strokeRect(lx - 12, ly - 22, 300, 62);
  const swatch = (y, color, label) => {
    cx.strokeStyle = color; cx.lineWidth = 3;
    cx.beginPath(); cx.moveTo(lx, y); cx.lineTo(lx + 34, y); cx.stroke();
    cx.fillStyle = '#24292f';
    cx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
    cx.fillText(label, lx + 44, y + 5);
  };
  swatch(ly, '#e5484d', 'reference line art');
  swatch(ly + 26, '#1f6feb', 'model side projection');

  return cv.toDataURL('image/png');
}, `data:image/jpeg;base64,${b64}`, {
  refCols, modelPts, resid, meanAbs,
  W: 900, H: 678,
});

await browser.close();
mkdirSync(outPng.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
const { writeFileSync } = await import('node:fs');
writeFileSync(outPng, Buffer.from(png.split(',')[1], 'base64'));
console.log(`wrote ${outPng}`);
console.log(`mean |error| ${meanAbs.toFixed(4)} half-depths`);
