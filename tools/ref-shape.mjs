// Measures a photo: nose, peduncle (narrowest point of the rear half), tail tip,
// eye centre, and the body depth — so proportions can be compared with the model.
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
  // "body" = strongly coloured skin. A translucent fin is pale with thin rays,
  // so it fails this test and cannot be mistaken for the narrowest point, which
  // is what happened when the whole silhouette was used.
  const isFish = (i) => {
    const r0 = d[i], g0 = d[i + 1], b0 = d[i + 2];
    const sat = Math.max(r0, g0, b0) - Math.min(r0, g0, b0);
    return sat > 70;
  };
  const top = new Int32Array(W).fill(-1), bot = new Int32Array(W).fill(-1);
  let x0 = W, x1 = 0;
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) if (isFish((y * W + x) * 4)) { top[x] = y; break; }
    for (let y = H - 1; y >= 0; y--) if (isFish((y * W + x) * 4)) { bot[x] = y; break; }
    if (top[x] >= 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
  }
  const L = x1 - x0;
  // narrowest column in the rear half = peduncle
  // The peduncle is the local minimum of width between 55% and 90% of the
  // length. The vanishing tail base also narrows to nothing, so the search stops
  // at 90% to avoid latching onto it.
  let pedX = -1, pedW = 1e9;
  for (let x = Math.round(x0 + L * 0.55); x <= Math.round(x0 + L * 0.90); x++) {
    if (top[x] < 0) continue;
    const w = bot[x] - top[x];
    if (w < pedW) { pedW = w; pedX = x; }
  }
  // deepest column = body depth
  let deepX = x0, deepW = 0;
  for (let x = Math.round(x0); x <= x1; x++) {
    if (top[x] < 0) continue;
    const w = bot[x] - top[x];
    if (w > deepW) { deepW = w; deepX = x; }
  }
  // eye: darkest blob in the first 25%
  let n = 0, sx = 0, sy = 0;
  for (let y = 0; y < H; y++) for (let x = Math.round(x0); x < Math.round(x0 + L * 0.25); x++) {
    const i = (y * W + x) * 4;
    if (d[i] < 70 && d[i + 1] < 70 && d[i + 2] < 70) { n++; sx += x; sy += y; }
  }
  return { W, H, x0, x1, L, pedX, pedW, deepX, deepW, eye: n ? [sx / n, sy / n] : null, n,
    midY: (() => { const c2 = Math.round(x0 + L * 0.35); return (top[c2] + bot[c2]) / 2; })() };
}, `data:image/jpeg;base64,${b64}`);
await b.close();
const { x0, x1, L, pedX, pedW, deepX, deepW, eye, midY } = r;
console.log(`total length ${L}px, body depth ${deepW}px  -> depth/total ${(deepW / L).toFixed(3)}`);
console.log(`peduncle at u=${((pedX - x0) / L).toFixed(3)}  width ${pedW}px (${(pedW / L).toFixed(3)} of total)`);
console.log(`body length (nose->peduncle) = ${((pedX - x0) / L).toFixed(3)} of total`);
console.log(`depth/body-length = ${(deepW / (pedX - x0)).toFixed(3)}`);
console.log(`deepest at u=${((deepX - x0) / L).toFixed(3)} (${((deepX - x0) / (pedX - x0)).toFixed(3)} of body)`);
if (eye) {
  console.log(`eye centre u=${((eye[0] - x0) / L).toFixed(3)} of total, ${((eye[0] - x0) / (pedX - x0)).toFixed(3)} of body`);
  console.log(`eye vertical offset from body axis: ${((midY - eye[1]) / deepW).toFixed(3)} depths above centre`);
}
