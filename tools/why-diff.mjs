// Measures, in ONE image frame, the user's red contour and the black line art
// underneath it.
//
// No normalisation is applied here — both are in the same pixels, so any offset
// between them is exactly what the user sees. That isolates the question of
// whether the traced contour is bigger than the drawing, and by how much.
//
// usage: node tools/why-diff.mjs
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import zlib from 'node:zlib';

const IMG = 'pic/user-overlay.jpg';
const ca = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath = ca.find((p) => existsSync(p));
const browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
const page = await browser.newPage();
const b64 = readFileSync(resolve(IMG)).toString('base64');

const res = await page.evaluate(async (url) => {
  const im = new Image();
  await new Promise((r, j) => { im.onload = r; im.onerror = j; im.src = url; });
  const W = im.naturalWidth, H = im.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const cx = c.getContext('2d');
  cx.drawImage(im, 0, 0);
  const d = cx.getImageData(0, 0, W, H).data;

  const isRed = (i) => d[i] > 120 && d[i] - d[i + 1] > 70 && d[i] - d[i + 2] > 70;
  const isInk = (i) => {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r > 120 && r - g > 70 && r - b > 70) return false;   // red is not ink
    return 0.299 * r + 0.587 * g + 0.114 * b < 130;
  };

  // The upload has a dark frame around the white page, so a naive "dark pixel"
  // scan finds the border in every column and reports ink at row 0. Locate the
  // white page first and scan only inside it.
  const nearWhite = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    nearWhite[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2] > 210 ? 1 : 0;
  }
  let pageX0 = 0, pageX1 = W - 1, pageY0 = 0, pageY1 = H - 1;
  {
    const seen = new Uint8Array(W * H);
    let best = 0, bx0 = 0, bx1 = 0, by0 = 0, by1 = 0;
    for (let i = 0; i < W * H; i++) {
      if (!nearWhite[i] || seen[i]) continue;
      let area = 0;
      const q = [i];
      seen[i] = 1;
      let x0 = W, x1 = 0, y0 = H, y1 = 0;
      while (q.length) {
        const p = q.pop();
        const px = p % W, py = (p - px) / W;
        area++;
        if (px < x0) x0 = px; if (px > x1) x1 = px;
        if (py < y0) y0 = py; if (py > y1) y1 = py;
        for (const n of [p + 1, p - 1, p + W, p - W]) {
          if (n < 0 || n >= W * H) continue;
          if (Math.abs((n % W) - px) > 1) continue;
          if (!nearWhite[n] || seen[n]) continue;
          seen[n] = 1; q.push(n);
        }
      }
      if (area > best) { best = area; pageX0 = x0; pageX1 = x1; pageY0 = y0; pageY1 = y1; }
    }
  }

  const scan = (pred, xa, xb, ya, yb) => {
    const top = new Int32Array(W).fill(-1), bot = new Int32Array(W).fill(-1);
    for (let x = xa; x <= xb; x++) {
      for (let y = ya; y <= yb; y++) if (pred((y * W + x) * 4)) { top[x] = y; break; }
      for (let y = yb; y >= ya; y--) if (pred((y * W + x) * 4)) { bot[x] = y; break; }
    }
    return { top, bot };
  };

  const red = scan(isRed, 0, W - 1, 0, H - 1);
  const ink = scan(isInk, pageX0, pageX1, pageY0, pageY1);

  // restrict the ink scan to the red contour's x-range, so the right-hand panel
  // and the page margins cannot contribute
  let minX = W, maxX = -1;
  for (let x = 0; x < W; x++) if (red.top[x] >= 0) { if (x < minX) minX = x; if (x > maxX) maxX = x; }

  const redCols = [];
  const inkCols = [];
  for (let x = minX; x <= maxX; x++) {
    if (red.top[x] >= 0) redCols.push([x, red.top[x], red.bot[x]]);
    if (ink.top[x] >= 0) inkCols.push([x, ink.top[x], ink.bot[x]]);
  }
  return { W, H, minX, maxX, redCols, inkCols, page: [pageX0, pageY0, pageX1, pageY1] };
}, `data:image/jpeg;base64,${b64}`);
await browser.close();

const { redCols, inkCols, W, H, page: pageBox } = res;
console.log(`white page bbox: x ${pageBox[0]}..${pageBox[2]}  y ${pageBox[1]}..${pageBox[3]}`);

const stats = (cols) => {
  const x0 = cols[0][0], x1 = cols[cols.length - 1][0];
  let maxD = 0, atX = x0;
  for (const [x, t, b] of cols) if (b - t > maxD) { maxD = b - t; atX = x; }
  return { x0, x1, len: x1 - x0, maxD, ratio: maxD / (x1 - x0), deepestAt: (atX - x0) / (x1 - x0) };
};
const R = stats(redCols);
const K = stats(inkCols);

console.log('--- in the SAME pixel frame (no normalisation) ---');
console.log(`red contour : x ${R.x0}..${R.x1}  length ${R.len}  maxDepth ${R.maxD}  ratio ${R.ratio.toFixed(4)}  deepest ${(R.deepestAt * 100).toFixed(0)}% from nose`);
console.log(`black ink   : x ${K.x0}..${K.x1}  length ${K.len}  maxDepth ${K.maxD}  ratio ${K.ratio.toFixed(4)}  deepest ${(K.deepestAt * 100).toFixed(0)}% from nose`);

// per-column vertical offset, sampled
const inkAt = (x) => {
  // nearest ink column
  let best = inkCols[0], bd = 1e9;
  for (const c of inkCols) { const dd = Math.abs(c[0] - x); if (dd < bd) { bd = dd; best = c; } }
  return best;
};
console.log('\n  x     red top  ink top   d      red bot  ink bot   d');
const marks = [];
for (let k = 0; k <= 16; k++) {
  const x = Math.round(R.x0 + (k / 16) * R.len);
  const rc = redCols.find((c) => c[0] === x);
  if (!rc) continue;
  const ic = inkAt(x);
  marks.push({ x, dt: rc[1] - ic[1], db: rc[2] - ic[2] });
  console.log(`${x}   ${rc[1].toString().padStart(7)}  ${ic[1].toString().padStart(7)}  ${(rc[1] - ic[1]).toString().padStart(5)}   ${rc[2].toString().padStart(7)}  ${ic[2].toString().padStart(7)}  ${(rc[2] - ic[2]).toString().padStart(5)}`);
}

// overlay image
const buf = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) { buf[i * 3] = 240; buf[i * 3 + 1] = 241; buf[i * 3 + 2] = 243; }
for (const [x, t, b] of inkCols) {
  for (let y = Math.round(t); y <= Math.round(b); y++) { const o = (y * W + x) * 3; buf[o] = 40; buf[o + 1] = 42; buf[o + 2] = 46; }
}
for (const [x, t, b] of redCols) {
  for (let y = Math.round(t) - 1; y <= Math.round(t) + 1; y++) if (y >= 0 && y < H) { const o = (y * W + x) * 3; buf[o] = 225; buf[o + 1] = 50; buf[o + 2] = 50; }
  for (let y = Math.round(b) - 1; y <= Math.round(b) + 1; y++) if (y >= 0 && y < H) { const o = (y * W + x) * 3; buf[o] = 225; buf[o + 1] = 50; buf[o + 2] = 50; }
}
mkdirSync('shots', { recursive: true });
writePng('shots/why-diff.png', W, H, buf);

function writePng(path, w, h, rgb) {
  const crcT = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => {
    const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
    return Buffer.concat([l, td, cr]);
  };
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(path, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
}
console.log('\nwrote shots/why-diff.png');
