// Measures a photo of a real fish: body outline, eye, and where the scales
// begin relative to the nose — the numbers needed to place the head/operculum
// boundary. The photo has a white background, so "fish" is "not near-white".
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const img = process.argv[2] || 'pic/ref-goldfish.jpg';
const ca = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath = ca.find((p) => existsSync(p));
const b = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
const p = await b.newPage();
const b64 = readFileSync(resolve(img)).toString('base64');
const r = await p.evaluate(async (url) => {
  const im = new Image();
  await new Promise((s, j) => { im.onload = s; im.onerror = j; im.src = url; });
  const W = im.naturalWidth, H = im.naturalHeight;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const cx = c.getContext('2d'); cx.drawImage(im, 0, 0);
  const d = cx.getImageData(0, 0, W, H).data;
  const isFish = (i) => {
    const r0 = d[i], g0 = d[i + 1], b0 = d[i + 2];
    const l = 0.299 * r0 + 0.587 * g0 + 0.114 * b0;
    const sat = Math.max(r0, g0, b0) - Math.min(r0, g0, b0);
    return l < 235 || sat > 30;      // not white paper
  };
  let x0 = W, x1 = 0, y0 = H, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (isFish((y * W + x) * 4)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  // per-column vertical extent, to find where the body (not fins) is
  const top = new Int32Array(W).fill(-1), bot = new Int32Array(W).fill(-1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) if (isFish((y * W + x) * 4)) { top[x] = y; break; }
    for (let y = H - 1; y >= 0; y--) if (isFish((y * W + x) * 4)) { bot[x] = y; break; }
  }
  // eye: darkest compact blob in the head third
  const headX1 = x0 + (x1 - x0) * 0.35;
  let eyeN = 0, eyeSX = 0, eyeSY = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < headX1; x++) {
    const i = (y * W + x) * 4;
    if (d[i] < 60 && d[i + 1] < 60 && d[i + 2] < 60) { eyeN++; eyeSX += x; eyeSY += y; }
  }
  // scale boundary: red channel gradient is strongest along the flank near the
  // operculum; report a vertical intensity profile of the upper flank instead
  const row = Math.round(y0 + (y1 - y0) * 0.30);
  const prof = [];
  for (let x = x0; x < x0 + (x1 - x0) * 0.45; x += Math.max(1, Math.round((x1 - x0) / 90))) {
    const i = (row * W + x) * 4;
    prof.push([+((x - x0) / (x1 - x0)).toFixed(3), d[i], d[i + 1], d[i + 2]]);
  }
  return { W, H, x0, x1, y0, y1, eye: eyeN ? [eyeSX / eyeN, eyeSY / eyeN] : null, eyeN, row, prof };
}, `data:image/jpeg;base64,${b64}`);
await b.close();
const { W, H, x0, x1, y0, y1, eye } = r;
const len = x1 - x0, dep = y1 - y0;
console.log(`image ${W}x${H}  fish bbox ${x0},${y0} .. ${x1},${y1}`);
console.log(`overall length ${len}px, overall height ${dep}px  (height/length ${(dep / len).toFixed(3)})`);
if (eye) {
  console.log(`eye centre at u=${((eye[0] - x0) / len).toFixed(3)}  v=${((eye[1] - y0) / dep).toFixed(3)}  (${r.eyeN} dark px)`);
  console.log(`eye height above the bbox bottom: ${((y1 - eye[1]) / dep).toFixed(3)} of total height`);
}
