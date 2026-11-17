// Measures the on-screen body proportions of several images the same way, to
// find out which of my measurements was the outlier.
//
// Three different "model silhouettes" had been produced and they disagreed:
//   orthographic rest-pose render      depth/length 0.333
//   user's trace of the screenshot     depth/length 0.442
//   colour-mask of the screenshot      depth/length 0.416
// This runs the identical envelope measurement over every image so the
// disagreement can be attributed, rather than argued about.
//
// usage: node tools/proportions.mjs <img> [<img> ...]
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const imgs = process.argv.slice(2);
if (!imgs.length) {
  console.error('usage: node tools/proportions.mjs <img> [<img> ...]');
  process.exit(1);
}

const ca = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath = ca.find((p) => existsSync(p));
const browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
const page = await browser.newPage();

for (const img of imgs) {
  const b64 = readFileSync(resolve(img)).toString('base64');
  const r = await page.evaluate(async (url) => {
    const im = new Image();
    await new Promise((res, j) => { im.onload = res; im.onerror = j; im.src = url; });
    const W = im.naturalWidth, H = im.naturalHeight;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const cx = c.getContext('2d');
    cx.drawImage(im, 0, 0);
    const d = cx.getImageData(0, 0, W, H).data;
    const lum = (i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

    // "fish" = pixels that are either orange (R >> B) or bright (white fins /
    // highlights). The dark navy backdrop fails both.
    const M = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const rr = d[i * 4], bb = d[i * 4 + 2];
      M[i] = (rr - bb > 12 || lum(i * 4) > 120) ? 1 : 0;
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
    let mask = morph(M, 3, true);
    mask = morph(mask, 3, false);
    // fill interior holes
    {
      const seen = new Uint8Array(W * H), st = [];
      for (let x = 0; x < W; x++) { st.push(x, 0, x, H - 1); }
      for (let y = 0; y < H; y++) { st.push(0, y, W - 1, y); }
      while (st.length) {
        const y = st.pop(), x = st.pop();
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        if (seen[i] || mask[i]) continue;
        seen[i] = 1; st.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
      }
      for (let i = 0; i < W * H; i++) if (!mask[i] && !seen[i]) mask[i] = 1;
    }
    // largest blob only
    {
      const comp = new Int32Array(W * H).fill(-1);
      let bestId = -1, bestArea = 0, id = 0;
      for (let i = 0; i < W * H; i++) {
        if (!mask[i] || comp[i] >= 0) continue;
        const cid = id++;
        let area = 0; const q = [i]; comp[i] = cid;
        while (q.length) {
          const p = q.pop(); const px = p % W; area++;
          for (const n of [p + 1, p - 1, p + W, p - W]) {
            if (n < 0 || n >= W * H) continue;
            if (Math.abs((n % W) - px) > 1) continue;
            if (!mask[n] || comp[n] >= 0) continue;
            comp[n] = cid; q.push(n);
          }
        }
        if (area > bestArea) { bestArea = area; bestId = cid; }
      }
      for (let i = 0; i < W * H; i++) mask[i] = comp[i] === bestId ? 1 : 0;
    }

    const top = new Int32Array(W).fill(-1), bot = new Int32Array(W).fill(-1);
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) if (mask[y * W + x]) { top[x] = y; break; }
      for (let y = H - 1; y >= 0; y--) if (mask[y * W + x]) { bot[x] = y; break; }
    }
    const cols = [];
    for (let x = 0; x < W; x++) if (top[x] >= 0) cols.push([x, top[x], bot[x]]);

    // profile sampled every 10% of the length, normalised by body length
    const x0 = cols[0][0], x1 = cols[cols.length - 1][0];
    const len = x1 - x0;
    let maxD = 0;
    for (const [, t, b] of cols) maxD = Math.max(maxD, b - t);
    const mid = (() => { const c = cols[Math.floor(cols.length / 2)]; return (c[1] + c[2]) / 2; })();
    const at = (u) => {
      const x = Math.round(x0 + u * len);
      let best = cols[0], bd = 1e9;
      for (const c of cols) { const dd = Math.abs(c[0] - x); if (dd < bd) { bd = dd; best = c; } }
      return { top: (mid - best[1]) / len, bot: (mid - best[2]) / len };
    };
    return {
      W, H, len, maxD,
      ratio: maxD / len,
      profTop: Array.from({ length: 11 }, (_, k) => +at(k / 10).top.toFixed(3)),
      profBot: Array.from({ length: 11 }, (_, k) => +at(k / 10).bot.toFixed(3)),
    };
  }, `data:image/jpeg;base64,${b64}`);

  console.log(`${img}`);
  console.log(`  image ${r.W}x${r.H}  subject length ${r.len}px  depth ${r.maxD}px  depth/length ${r.ratio.toFixed(4)}`);
  console.log(`  top edge (u=0..1, body-length units): ${r.profTop.join('  ')}`);
  console.log(`  bot edge                            : ${r.profBot.join('  ')}`);
}

await browser.close();
