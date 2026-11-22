// Prints the shape metrics the user is describing, for the reference drawing
// and for the rendered model, in the same units (u from the nose, body lengths).
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureSilhouette } from './silhouette.mjs';

const ca = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath = ca.find((p) => existsSync(p));

// ---- reference: ink envelope + body-only trace
const body = JSON.parse(readFileSync('tools/side.json', 'utf8')).cols;
const b = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
const pg = await b.newPage();
const b64 = readFileSync(resolve('pic/koi-side.jpg')).toString('base64');
const env = await pg.evaluate(async (url) => {
  const im = new Image();
  await new Promise((s, j) => { im.onload = s; im.onerror = j; im.src = url; });
  const W = im.naturalWidth, H = im.naturalHeight;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const cx = c.getContext('2d'); cx.drawImage(im, 0, 0);
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
await b.close();

function analyse(label, cols) {
  const x0 = cols[0][0], x1 = cols[cols.length - 1][0], len = x1 - x0;
  const at = (u) => {
    const x = Math.round(x0 + u * len);
    let best = cols[0], bd = 1e9;
    for (const c of cols) { const dd = Math.abs(c[0] - x); if (dd < bd) { bd = dd; best = c; } }
    return best;
  };
  let hiU = 0, loU = 0, hi = 1e9, lo = -1e9;
  for (let k = 0; k <= 200; k++) {
    const u = k / 200, p = at(u);
    if (p[1] < hi) { hi = p[1]; hiU = u; }
    if (p[2] > lo) { lo = p[2]; loU = u; }
  }
  // trailing-edge profile in the caudal region: rightmost ink per row
  const y0 = Math.min(...cols.map((c) => c[1])), y1 = Math.max(...cols.map((c) => c[2]));
  const rightAt = new Map();
  for (const [x, t, bb] of cols) for (let y = t; y <= bb; y++) {
    const cur = rightAt.get(y);
    if (cur === undefined || x > cur) rightAt.set(y, x);
  }
  const ys = [...rightAt.keys()].sort((a, b2) => a - b2);
  const mid = rightAt.get(ys[Math.floor(ys.length / 2)]) ?? x1;
  const far = Math.max(...rightAt.values());
  const forkDepth = (far - mid) / len;    // how far the notch cuts inward
  // snout: half-depth at several stations near the tip
  // u = 0 is the NOSE (leftmost ink), so the snout is sampled near 0.
  const snout = [0.00, 0.02, 0.05, 0.08, 0.12].map((u) => {
    const p = at(u); return [u, ((p[2] - p[1]) / 2) / len];
  });
  console.log(`\n=== ${label} ===`);
  console.log(`  back highest at u=${hiU.toFixed(3)}   belly lowest at u=${loU.toFixed(3)}`);
  console.log(`  caudal notch depth = ${forkDepth.toFixed(3)} body lengths`);
  // caudal height: furthest the fin reaches up/down in the rear quarter
  let cTop = 0, cBot = 0;
  for (let u = 0.75; u <= 1.0; u += 0.01) {
    const p = at(u);
    cTop = Math.max(cTop, Math.abs(p[1] - mid)); cBot = Math.max(cBot, Math.abs(p[2] - mid));
  }
  console.log(`  caudal half-height above/below the axis = ${(cTop / len).toFixed(3)} / ${(cBot / len).toFixed(3)}`);
  console.log(`  snout half-depth (fraction of body length):`);
  for (const [u, h] of snout) console.log(`     u=${u.toFixed(2)}  ${h.toFixed(4)}`);
}

analyse('REFERENCE  body only', body);
analyse('REFERENCE  envelope (fins in)', env);

const sil = await captureSilhouette('http://localhost:5173', 'koi', { all: false });
analyse('MODEL  body only', sil.cols);
const silAll = await captureSilhouette('http://localhost:5173', 'koi', { all: true });
analyse('MODEL  envelope', silAll.cols);
