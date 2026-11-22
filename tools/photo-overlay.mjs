// Draws the model's side silhouette directly ON the reference photo.
//
// Every previous comparison measured the photo and the render separately and
// compared numbers. This puts both outlines in the photo's own frame, so the
// discrepancy is visible rather than inferred, and prints the residual per
// station in body-length units.
//
// usage: node tools/photo-overlay.mjs [photo] [out]
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureSilhouette } from './silhouette.mjs';

const photoPath = process.argv[2] || 'pic/ref-goldfish.jpg';
const out = process.argv[3] || 'shots/photo-overlay.png';
const base = 'http://localhost:5173';

const ca = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath = ca.find((p) => existsSync(p));

// ---- photo: body = saturated skin; fins are pale and translucent
const browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 2 });
const b64 = readFileSync(resolve(photoPath)).toString('base64');

const photo = await page.evaluate(async (url) => {
  const im = new Image();
  await new Promise((r, j) => { im.onload = r; im.onerror = j; im.src = url; });
  const W = im.naturalWidth, H = im.naturalHeight;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const cx = c.getContext('2d'); cx.drawImage(im, 0, 0);
  const d = cx.getImageData(0, 0, W, H).data;
  const sat = (i) => {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    return Math.max(r, g, b) - Math.min(r, g, b);
  };
  const lum = (i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const isBody = (i) => sat(i) > 62 && lum(i) > 40;
  const isAny = (i) => sat(i) > 12 || lum(i) < 238;
  const scan = (pred) => {
    const top = new Int32Array(W).fill(-1), bot = new Int32Array(W).fill(-1);
    let x0 = W, x1 = 0;
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) if (pred((y * W + x) * 4)) { top[x] = y; break; }
      for (let y = H - 1; y >= 0; y--) if (pred((y * W + x) * 4)) { bot[x] = y; break; }
      if (top[x] >= 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
    }
    return { top, bot, x0, x1 };
  };
  return { W, H, body: scan(isBody), any: scan(isAny) };
}, `data:image/jpeg;base64,${b64}`);

const PH = photo;
// body end: first column from the right where height falls under 40% of peak
const bh = [];
for (let x = 0; x < PH.W; x++) {
  bh[x] = (PH.body.top[x] >= 0) ? PH.body.bot[x] - PH.body.top[x] : -1;
}
// Body end = the PEDUNCLE: the narrowest column between 60% and 92%. Using a
// height threshold instead ("under 42% of peak") landed on the caudal fin and
// made the ruler 7% too long, which inflated the model everywhere it was
// overlaid and made a real 1.05x difference look like 1.12x.
const peakH = Math.max(...bh);
let bodyEnd = PH.body.x1, pedW = 1e9;
for (let x = Math.round(PH.body.x0 + (PH.body.x1 - PH.body.x0) * 0.60);
     x <= Math.round(PH.body.x0 + (PH.body.x1 - PH.body.x0) * 0.92); x++) {
  if (bh[x] > 0 && bh[x] < pedW) { pedW = bh[x]; bodyEnd = x; }
}
void peakH;
const nose = PH.body.x0;
const BL = bodyEnd - nose;                 // body length in photo pixels
const midY = (() => {
  const c = Math.round(nose + BL * 0.45);
  return (PH.body.top[c] + PH.body.bot[c]) / 2;
})();

// ---- model silhouette, normalised to the same body-length ruler
const sil = await captureSilhouette(base, 'koi', { all: false });
const MC = sil.cols;
const mx0 = MC[0][0], mx1 = MC[MC.length - 1][0], ML = mx1 - mx0;
const silMid = (() => {
  const c = MC[Math.floor(MC.length * 0.55)];
  return (c[1] + c[2]) / 2;
})();
const silAt = (u) => {          // u = 0 at the nose
  const x = Math.round(mx0 + u * ML);
  let best = MC[0], bd = 1e9;
  for (const c of MC) { const d = Math.abs(c[0] - x); if (d < bd) { bd = d; best = c; } }
  return best;
};

await browser.close();

// ---- draw
const png = await (async () => {
  const b = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1500, height: 820, deviceScaleFactor: 2 });
  const url = await p.evaluate(async (url, payload) => {
    const { nose, bodyEnd, midY, PHw, PHh, modelPts, bodyPts } = payload;
    const im = new Image();
    await new Promise((r, j) => { im.onload = r; im.onerror = j; im.src = url; });
    const cv = document.createElement('canvas');
    cv.width = PHw; cv.height = PHh;
    const cx = cv.getContext('2d');
    cx.drawImage(im, 0, 0, PHw, PHh);
    cx.globalAlpha = 0.35; cx.fillStyle = '#fff'; cx.fillRect(0, 0, PHw, PHh); cx.globalAlpha = 1;
    cx.lineWidth = Math.max(2, PHw / 900);

    const stroke = (pts, color) => {
      cx.strokeStyle = color;
      cx.beginPath();
      pts.forEach((q, i) => (i ? cx.lineTo(q[0], q[1]) : cx.moveTo(q[0], q[1])));
      cx.stroke();
    };
    stroke(bodyPts.top, '#e5484d');
    stroke(bodyPts.bot, '#e5484d');
    stroke(modelPts.top, '#1f6feb');
    stroke(modelPts.bot, '#1f6feb');
    return cv.toDataURL('image/png');
  }, `data:image/jpeg;base64,${b64}`, {
    nose, bodyEnd, midY, PHw: PH.W, PHh: PH.H,
    modelPts: {
      top: Array.from({ length: 201 }, (_, k) => {
        const u = k / 200, c = silAt(u);
        return [nose + u * BL, midY - (silMid - c[1]) / ML * BL];
      }),
      bot: Array.from({ length: 201 }, (_, k) => {
        const u = k / 200, c = silAt(u);
        return [nose + u * BL, midY - (silMid - c[2]) / ML * BL];
      }),
    },
    bodyPts: {
      top: Array.from({ length: 201 }, (_, k) => {
        const u = k / 200, x = Math.round(nose + u * BL);
        return [x, PH.body.top[x] < 0 ? midY : PH.body.top[x]];
      }),
      bot: Array.from({ length: 201 }, (_, k) => {
        const u = k / 200, x = Math.round(nose + u * BL);
        return [x, PH.body.bot[x] < 0 ? midY : PH.body.bot[x]];
      }),
    },
  });
  await b.close();
  return url;
})();

mkdirSync(out.replace(/[\/][^\/]+$/, ''), { recursive: true });
writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));

// ---- numbers
console.log(`photo body length ${BL}px, nose x=${nose}, body end x=${bodyEnd}`);
console.log('\n  u     photo top  model top    d      photo bot  model bot    d   (body lengths)');
let worst = 0, worstU = 0, sum = 0, n = 0;
for (let k = 0; k <= 20; k++) {
  const u = k / 20;
  const x = Math.round(nose + u * BL);
  const pt = PH.body.top[x] < 0 ? midY : PH.body.top[x];
  const pb = PH.body.bot[x] < 0 ? midY : PH.body.bot[x];
  const c = silAt(u);
  const mt = midY - (silMid - c[1]) / ML * BL;
  const mb = midY - (silMid - c[2]) / ML * BL;
  const rt = (mt - pt) / BL, rb = (mb - pb) / BL;
  sum += Math.abs(rt) + Math.abs(rb); n += 2;
  if (Math.abs(rt) > Math.abs(worst)) { worst = rt; worstU = u; }
  if (Math.abs(rb) > Math.abs(worst)) { worst = rb; worstU = u; }
  console.log(`${u.toFixed(2)}  ${(midY - pt) / BL > 0 ? '+' : ''}${((midY - pt) / BL).toFixed(3)}     ${((midY - mt) / BL).toFixed(3)}     ${rt >= 0 ? '+' : ''}${rt.toFixed(3)}   ` +
    `${((midY - pb) / BL).toFixed(3)}     ${((midY - mb) / BL).toFixed(3)}     ${rb >= 0 ? '+' : ''}${rb.toFixed(3)}`);
}
console.log(`\nmean |error| ${(sum / n).toFixed(4)}   worst ${worst >= 0 ? '+' : ''}${worst.toFixed(3)} at u=${worstU.toFixed(2)}`);
console.log(`wrote ${out}`);
