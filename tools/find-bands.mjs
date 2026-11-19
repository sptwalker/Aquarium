// Locates dark bands on the fish objectively, by shape rather than by eye.
//
// Every previous attempt started from "it looks like the gill cover / the
// scales / the peduncle". This instead builds a residual map (pixel / wide
// blur), thresholds it, groups the dark pixels into connected regions, and
// reports each region's bounding box in body-length units plus how tall and
// narrow it is. A band that spans most of the fish's height is a ring around
// the body; a short one is a local artefact.
//
// usage: node tools/find-bands.mjs <image> [outPng]
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const img = process.argv[2] || 'pic/koi-screen5.jpg';
const outPng = process.argv[3] || 'shots/bands-found.png';

const ca = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath = ca.find((p) => existsSync(p));
const b = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
const p = await b.newPage();
await p.setViewport({ width: 1200, height: 700, deviceScaleFactor: 1 });
const b64 = readFileSync(resolve(img)).toString('base64');

const res = await p.evaluate(async (url) => {
  const im = new Image();
  await new Promise((r, j) => { im.onload = r; im.onerror = j; im.src = url; });
  const W = im.naturalWidth, H = im.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const cx = c.getContext('2d');
  cx.drawImage(im, 0, 0);
  const d = cx.getImageData(0, 0, W, H).data;
  const lum = new Float32Array(W * H);
  const fish = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], bl = d[i * 4 + 2];
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * bl;
    fish[i] = (r - bl > 18 || lum[i] > 110) ? 1 : 0;
  }
  // fish bbox
  let x0 = W, x1 = 0, y0 = H, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (fish[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;

  // wide blur of luminance, over fish pixels only, to be the local background
  const R = Math.round(bw * 0.08);
  const integ = new Float64Array((W + 1) * (H + 1));
  const cnt = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let rs = 0, rc = 0;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (fish[i]) { rs += lum[i]; rc++; }
      integ[(y + 1) * (W + 1) + (x + 1)] = integ[y * (W + 1) + (x + 1)] + rs;
      cnt[(y + 1) * (W + 1) + (x + 1)] = cnt[y * (W + 1) + (x + 1)] + rc;
    }
  }
  const box = (S, x, y) => {
    const a = Math.max(0, x - R), b2 = Math.min(W - 1, x + R);
    const c0 = Math.max(0, y - R), d0 = Math.min(H - 1, y + R);
    return S[(d0 + 1) * (W + 1) + (b2 + 1)] - S[c0 * (W + 1) + (b2 + 1)]
         - S[(d0 + 1) * (W + 1) + a] + S[c0 * (W + 1) + a];
  };

  // residual: how much darker than its neighbourhood
  const res = new Float32Array(W * H);
  const dark = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!fish[i]) continue;
    const n = box(cnt, x, y);
    if (n < 20) continue;
    const bg = box(integ, x, y) / n;
    res[i] = lum[i] / Math.max(1e-3, bg);
    dark[i] = res[i] < 0.90 ? 1 : 0;
  }

  // connected components of dark
  const comp = new Int32Array(W * H).fill(-1);
  const out = [];
  for (let i = 0; i < W * H; i++) {
    if (!dark[i] || comp[i] >= 0) continue;
    const id = out.length;
    let area = 0, minX = W, maxX = 0, minY = H, maxY = 0, minsum = 0;
    const q = [i]; comp[i] = id;
    while (q.length) {
      const pIdx = q.pop(); const px = pIdx % W; const py = (pIdx - px) / W;
      area++; minsum += res[pIdx];
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
      for (const n2 of [pIdx + 1, pIdx - 1, pIdx + W, pIdx - W]) {
        if (n2 < 0 || n2 >= W * H) continue;
        if (Math.abs((n2 % W) - px) > 1) continue;
        if (!dark[n2] || comp[n2] >= 0) continue;
        comp[n2] = id; q.push(n2);
      }
    }
    out.push({
      area, minX, maxX, minY, maxY,
      w: maxX - minX + 1, h: maxY - minY + 1,
      depth: +(minsum / area).toFixed(3),
      // where along the body, 0 = nose
      u: +(((minX + maxX) / 2 - x0) / bw).toFixed(3),
      vspan: +((maxY - minY + 1) / bh).toFixed(3),
    });
  }
  return { W, H, x0, x1, y0, y1, bw, bh, regions: out };
}, `data:image/jpeg;base64,${b64}`);

await b.close();

const { bw, bh, regions } = res;
const big = regions
  .filter((r) => r.area > bw * bh * 0.0015)
  .sort((a, b2) => b2.area - a.area)
  .slice(0, 14);

console.log(`fish bbox ${res.x0},${res.y0} .. ${res.x1},${res.y1}  (${bw}x${bh})`);
console.log('top dark regions (u = fraction from nose, vspan = fraction of body height):');
console.log('   u      w      h     area   vspan  depth');
for (const r of big) {
  console.log(`${r.u.toFixed(3)}  ${String(r.w).padStart(4)}  ${String(r.h).padStart(5)}  ${String(r.area).padStart(6)}   ${r.vspan.toFixed(2)}   ${r.depth.toFixed(3)}`);
}

// highlight them
const png = await (async () => {
  const b2 = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
  const pg = await b2.newPage();
  const out = await pg.evaluate(async (url, regions2, W, H) => {
    const im = new Image();
    await new Promise((r, j) => { im.onload = r; im.onerror = j; im.src = url; });
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const cx = c.getContext('2d');
    cx.drawImage(im, 0, 0, W, H);
    cx.lineWidth = 3;
    cx.strokeStyle = '#00ff66';
    for (const r of regions2) cx.strokeRect(r.minX, r.minY, r.w, r.h);
    return c.toDataURL('image/png');
  }, `data:image/jpeg;base64,${b64}`, big, res.W, res.H);
  await b2.close();
  return out;
})();
writeFileSync(outPng, Buffer.from(png.split(',')[1], 'base64'));
console.log(`\nwrote ${outPng}  (green = detected regions)`);
