// Tests whether the model's measured depth depends on how the fish is separated
// from the background — i.e. whether my automation is losing the shaded belly.
//
// For each colour threshold it reports the resulting depth/length. If the ratio
// climbs steadily as the threshold loosens, the measurement is not measuring the
// fish, it is measuring "how obvious the fish is to the pixel test" — and the
// user's eye, which uses edges rather than absolute colour, sees more than any
// of the thresholds do.
//
// usage: node tools/threshold-sweep.mjs [image]
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const IMG = process.argv[2] || 'pic/model-side.jpg';
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
  const lum = (i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

  // sample a vertical line through the belly to see what the values actually are
  const probeX = Math.round(W * 0.42);
  const probe = [];
  for (let y = Math.round(H * 0.30); y < Math.round(H * 0.92); y += Math.round(H * 0.02)) {
    const i = (y * W + probeX) * 4;
    probe.push([y, d[i], d[i + 1], d[i + 2], Math.round(lum(i))]);
  }

  const run = (thr, lumThr) => {
    const M = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const r = d[i * 4], b = d[i * 4 + 2];
      M[i] = (r - b > thr || lum(i * 4) > lumThr) ? 1 : 0;
    }
    const morph = (src, R, grow) => {
      const out = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let hit = grow ? 0 : 1;
        for (let dy = -R; dy <= R && (grow ? !hit : hit); dy++) for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx, yy = y + dy;
          const v = (xx >= 0 && yy >= 0 && xx < W && yy < H) ? src[yy * W + xx] : 0;
          if (grow) { if (v) { hit = 1; break; } } else if (!v) { hit = 0; break; }
        }
        out[y * W + x] = hit;
      }
      return out;
    };
    let m = morph(M, 3, true);
    m = morph(m, 3, false);
    {
      const seen = new Uint8Array(W * H), st = [];
      for (let x = 0; x < W; x++) { st.push(x, 0, x, H - 1); }
      for (let y = 0; y < H; y++) { st.push(0, y, W - 1, y); }
      while (st.length) {
        const y = st.pop(), x = st.pop();
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        if (seen[i] || m[i]) continue;
        seen[i] = 1; st.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
      }
      for (let i = 0; i < W * H; i++) if (!m[i] && !seen[i]) m[i] = 1;
    }
    {
      const comp = new Int32Array(W * H).fill(-1);
      let bestId = -1, bestArea = 0, id = 0;
      for (let i = 0; i < W * H; i++) {
        if (!m[i] || comp[i] >= 0) continue;
        const cid = id++;
        let area = 0; const q = [i]; comp[i] = cid;
        while (q.length) {
          const p = q.pop(); const px = p % W; area++;
          for (const n of [p + 1, p - 1, p + W, p - W]) {
            if (n < 0 || n >= W * H) continue;
            if (Math.abs((n % W) - px) > 1) continue;
            if (!m[n] || comp[n] >= 0) continue;
            comp[n] = cid; q.push(n);
          }
        }
        if (area > bestArea) { bestArea = area; bestId = cid; }
      }
      for (let i = 0; i < W * H; i++) m[i] = comp[i] === bestId ? 1 : 0;
    }
    const top = new Int32Array(W).fill(-1), bot = new Int32Array(W).fill(-1);
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) if (m[y * W + x]) { top[x] = y; break; }
      for (let y = H - 1; y >= 0; y--) if (m[y * W + x]) { bot[x] = y; break; }
    }
    let x0 = W, x1 = -1, maxD = 0;
    for (let x = 0; x < W; x++) if (top[x] >= 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
    for (let x = 0; x < W; x++) if (top[x] >= 0) maxD = Math.max(maxD, bot[x] - top[x]);
    return { ratio: maxD / (x1 - x0), len: x1 - x0, maxD };
  };

  const rows = [];
  for (const [thr, lumThr] of [[20, 120], [12, 120], [8, 100], [4, 80], [2, 60], [0, 45]]) {
    const r = run(thr, lumThr);
    rows.push({ thr, lumThr, ...r });
  }
  return { probe, rows };
}, `data:image/jpeg;base64,${b64}`);
await browser.close();

console.log(`vertical probe through the body at x = 42% of the width (image ${IMG})`);
console.log('   y     R    G    B   lum     R-B');
for (const [y, r, g, b, l] of res.probe) {
  console.log(`${String(y).padStart(5)} ${String(r).padStart(4)} ${String(g).padStart(4)} ${String(b).padStart(4)} ${String(l).padStart(5)} ${String(r - b).padStart(6)}`);
}
console.log('\nthreshold sweep (mask = R-B > thr, or luminance > lumThr):');
console.log('  R-B>   lum>   length   depth   depth/length');
for (const r of res.rows) {
  console.log(`${String(r.thr).padStart(5)} ${String(r.lumThr).padStart(6)} ${String(r.len).padStart(8)} ${String(r.maxD).padStart(7)}   ${r.ratio.toFixed(4)}`);
}
