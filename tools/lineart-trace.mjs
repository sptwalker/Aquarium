// Extracts the body silhouette from the reference line drawing.
//
// Eyeballing stations off a picture is what produced every wrong outline so
// far. This reads the actual pixels: it decodes the JPEG in headless Chrome,
// flood-fills the background, and takes the largest enclosed white region as
// the body interior. Fins and the eye are drawn as separate closed shapes, so
// they come out as their own components and are ignored automatically — no
// heuristic about hatch spacing needed.
//
// usage: node tools/lineart-trace.mjs [image] [outJson]
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import zlib from 'node:zlib';

const img = process.argv[2] || 'pic/model04.jpeg';
const outJson = process.argv[3] || 'tools/lineart.json';
const DILATE = Number(process.argv[4] ?? 4);

const ca = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const executablePath = ca.find((p) => existsSync(p));
if (!executablePath) throw new Error('no chrome/edge found');

const browser = await puppeteer.launch({
  executablePath,
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=default'],
  defaultViewport: { width: 1200, height: 900, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const b64 = readFileSync(resolve(img)).toString('base64');
const mime = img.endsWith('.png') ? 'image/png' : 'image/jpeg';

const result = await page.evaluate(async (dataUrl, DILATE) => {
  const image = new Image();
  await new Promise((res, rej) => {
    image.onload = res;
    image.onerror = rej;
    image.src = dataUrl;
  });
  const W = image.naturalWidth;
  const H = image.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const cx = cv.getContext('2d');
  cx.drawImage(image, 0, 0);
  const img0 = cx.getImageData(0, 0, W, H);
  const d = img0.data;

  // ink = clearly dark stroke
  const ink = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    ink[i] = l < 120 ? 1 : 0;
  }

  // Fuse the fin hatching into solid ink before looking for components.
  //
  // The fins are drawn as a comb of parallel strokes 2-3 px apart. Rather than
  // classify them by ink density (which flickers near the body's own outline),
  // dilate the ink mask by a few pixels: the strokes merge into one solid black
  // shape, the fin stops being part of any white region, and the body interior
  // — broad blank paper — is untouched. Then the largest enclosed white region
  // IS the body, with no heuristic at all.
  {
    const R = DILATE;
    const closed = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!ink[y * W + x]) continue;
        const x0 = Math.max(0, x - R), x1 = Math.min(W - 1, x + R);
        const y0 = Math.max(0, y - R), y1 = Math.min(H - 1, y + R);
        for (let yy = y0; yy <= y1; yy++) {
          const dy = yy - y;
          for (let xx = x0; xx <= x1; xx++) {
            const dx = xx - x;
            if (dx * dx + dy * dy <= R * R) closed[yy * W + xx] = 1;
          }
        }
      }
    }
    ink.set(closed);
  }

  // flood the background from every border pixel over non-ink
  const seen = new Uint8Array(W * H);
  const stack = [];
  for (let x = 0; x < W; x++) { stack.push(x, 0, x, H - 1); }
  for (let y = 0; y < H; y++) { stack.push(0, y, W - 1, y); }
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const i = y * W + x;
    if (seen[i] || ink[i]) continue;
    seen[i] = 1;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }

  // connected components of the enclosed white regions
  const comp = new Int32Array(W * H).fill(-1);
  let bestId = -1, bestArea = 0;
  const comps = [];
  for (let i = 0; i < W * H; i++) {
    if (seen[i] || ink[i] || comp[i] >= 0) continue;
    const id = comps.length;
    let area = 0;
    const q = [i];
    comp[i] = id;
    let minX = W, maxX = 0, minY = H, maxY = 0;
    while (q.length) {
      const p = q.pop();
      const px = p % W, py = (p - px) / W;
      area++;
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
      const nb = [p + 1, p - 1, p + W, p - W];
      for (const n of nb) {
        if (n < 0 || n >= W * H) continue;
        const nx = n % W;
        if (Math.abs(nx - px) > 1) continue;   // row wrap guard
        if (seen[n] || ink[n] || comp[n] >= 0) continue;
        comp[n] = id;
        q.push(n);
      }
    }
    comps.push({ id, area, minX, maxX, minY, maxY });
    if (area > bestArea) { bestArea = area; bestId = id; }
  }

  const top = new Int32Array(W).fill(-1);
  const bot = new Int32Array(W).fill(-1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      if (comp[y * W + x] === bestId) { top[x] = y; break; }
    }
    for (let y = H - 1; y >= 0; y--) {
      if (comp[y * W + x] === bestId) { bot[x] = y; break; }
    }
  }

  const body = comps[bestId];
  const cols = [];
  for (let x = body.minX; x <= body.maxX; x++) {
    if (top[x] >= 0) cols.push([x, top[x], bot[x]]);
  }
  // Raw outline in pixels, for direct consumption: [x, top, bot].
  return { W, H, best: body, comps: comps.map(c => ({ area: c.area, minX: c.minX, maxX: c.maxX, minY: c.minY, maxY: c.maxY })), cols, img: Array.from(d.slice(0)) };
}, `data:${mime};base64,${b64}`, DILATE);

await browser.close();

// ---- fit: x runs nose..peduncle; normalise by body length and max depth
const cols = result.cols;
const x0 = cols[0][0], x1 = cols[cols.length - 1][0];
let maxDepth = 0;
for (const [, t, b] of cols) maxDepth = Math.max(maxDepth, b - t);
const bodyLen = x1 - x0;

// station table, nose (t=1) to peduncle (t=0)
const N = 40;
const stations = [];
for (let i = 0; i <= N; i++) {
  const t = i / N;                        // 0 peduncle .. 1 nose
  const x = Math.round(x1 - t * bodyLen);
  let hit = cols.find((c) => c[0] === x);
  if (!hit) {
    // nearest column
    let bd = 1e9;
    for (const c of cols) { const dd = Math.abs(c[0] - x); if (dd < bd) { bd = dd; hit = c; } }
  }
  const top = hit[1], bot = hit[2];
  stations.push({
    t: +t.toFixed(4),
    yTop: +((top) / maxDepth).toFixed(4),
    yBot: +((bot) / maxDepth).toFixed(4),
    // depth fraction of body length, for cross-checking style.depth
    halfH: +(((bot - top) / 2) / bodyLen).toFixed(5),
  });
}

// ---- overlay png: reference greyscale + detected outline in red
const { W, H } = result;
const out = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) {
  const g = result.img[i * 4 + 1];
  out[i * 3] = g; out[i * 3 + 1] = g; out[i * 3 + 2] = g;
}
for (const [x, t, b] of cols) {
  for (let y = t; y <= b; y++) {
    out[(y * W + x) * 3] = 255;
    out[(y * W + x) * 3 + 1] = 60;
    out[(y * W + x) * 3 + 2] = 60;
  }
}

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, cr]);
};
const raw = Buffer.alloc(H * (W * 3 + 1));
for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; out.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
mkdirSync('shots', { recursive: true });
writeFileSync('shots/lineart-trace.png', Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
]));

const payload = {
  image: img, width: W, height: H,
  bodyPixels: { x0, x1, bodyLen, maxDepth, depthOverLen: +(maxDepth / bodyLen).toFixed(4) },
  otherComponents: result.comps.filter(c => c.area > 300).length,
  stations,
};
writeFileSync(outJson, JSON.stringify(payload, null, 2));
console.log(JSON.stringify({ ...payload, stations: undefined }, null, 2));
console.log('stations: t, yTop, yBot (both / maxDepth), halfH (fraction of body length)');
for (const s of stations) console.log(`${s.t.toFixed(3)}  ${s.yTop.toFixed(3)}  ${s.yBot.toFixed(3)}   ${s.halfH}`);
