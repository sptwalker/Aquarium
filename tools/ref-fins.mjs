// Measures fin extents on the reference photo, in body-length units.
// "body" = saturated skin; "anything" = the whole silhouette including the
// translucent fins.
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
  const sat = (i) => {
    const r0 = d[i], g0 = d[i + 1], b0 = d[i + 2];
    return Math.max(r0, g0, b0) - Math.min(r0, g0, b0);
  };
  const bodyMask = (i) => sat(i) > 70;
  const anyMask = (i) => {
    const r0 = d[i], g0 = d[i + 1], b0 = d[i + 2];
    const l = 0.299 * r0 + 0.587 * g0 + 0.114 * b0;
    return sat(i) > 12 || l < 236;
  };
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
  return { W, H, body: scan(bodyMask), all: scan(anyMask) };
}, `data:image/jpeg;base64,${b64}`);
await b.close();
const { body, all } = r;
const x0 = body.x0, pedX = Math.round(x0 + (body.x1 - x0) * 0.778);
const BL = pedX - x0;   // body length in px (measured earlier as 0.778 of total)

// dorsal height: how far the silhouette rises above the body, over the back
let dorsal = 0, dorsalU = 0;
for (let x = x0; x < pedX; x++) {
  if (body.top[x] < 0 || all.top[x] < 0) continue;
  const h = body.top[x] - all.top[x];
  if (h > dorsal) { dorsal = h; dorsalU = (x - x0) / BL; }
}
// caudal: extent behind the peduncle, and its height
const tailLen = all.x1 - pedX;
let tailTop = 1e9, tailBot = -1e9;
for (let x = pedX; x <= all.x1; x++) {
  if (all.top[x] >= 0) tailTop = Math.min(tailTop, all.top[x]);
  if (all.bot[x] >= 0) tailBot = Math.max(tailBot, all.bot[x]);
}
console.log(`body length ${BL}px`);
console.log(`dorsal fin height = ${(dorsal / BL).toFixed(3)} body lengths, peak at u=${dorsalU.toFixed(2)} of body`);
console.log(`caudal extends ${(tailLen / BL).toFixed(3)} body lengths behind the peduncle`);
console.log(`caudal total height = ${((tailBot - tailTop) / BL).toFixed(3)} body lengths`);
