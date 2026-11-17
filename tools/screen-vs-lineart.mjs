// Compares a RENDER SCREENSHOT's outer contour against the reference line art.
//
// Different from tools/overlay-compare.mjs, which used an orthographic
// silhouette render of the body mesh. This one starts from a screenshot of the
// actual model, so it captures whatever the camera, the fins, the cloth tail and
// the perspective do — i.e. what the user is looking at.
//
// Both sides are traced the same way: the topmost and bottommost "subject"
// pixel in each column, which gives the ENVELOPE (body + fins). For the
// screenshot the subject is "brighter than the background"; for the line art it
// is "ink". Each is then normalised by its own body length and half-depth, so
// the comparison is shape-only.
//
// usage: node tools/screen-vs-lineart.mjs [screenshot] [reference] [outPng]
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const shotPath = process.argv[2] || 'pic/model-side.jpg';
const refPath = process.argv[3] || 'pic/koi-side.jpg';
const outPng = process.argv[4] || 'shots/overlay-screen.png';

const ca = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const executablePath = ca.find((p) => existsSync(p));
if (!executablePath) throw new Error('no chrome/edge found');

const browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 620, deviceScaleFactor: 2 });

const shotB64 = readFileSync(resolve(shotPath)).toString('base64');
const refB64 = readFileSync(resolve(refPath)).toString('base64');

const result = await page.evaluate(async (shotUrl, refUrl) => {
  const load = async (url) => {
    const im = new Image();
    await new Promise((r, j) => { im.onload = r; im.onerror = j; im.src = url; });
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const cx = c.getContext('2d');
    cx.drawImage(im, 0, 0);
    return { W: c.width, H: c.height, d: cx.getImageData(0, 0, c.width, c.height).data };
  };

  // ---- screenshot: subject = the fish.
  //
  // Luminance alone is not usable here: the fish's shaded belly is nearly as
  // dark as the backdrop, so a brightness threshold punches holes through the
  // body and the contour comes out as a comb. Colour separates them cleanly —
  // the fish is orange (R >> B) and the backdrop is blue-grey (B > R). Bright
  // white specular highlights have R ≈ B, so those are added back by luminance.
  const shot = await load(shotUrl);
  const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const SW = shot.W, SH = shot.H;
  const bright = new Uint8Array(SW * SH);
  for (let i = 0; i < SW * SH; i++) {
    const r = shot.d[i * 4], b = shot.d[i * 4 + 2];
    bright[i] = (r - b > 12 || lum(shot.d, i * 4) > 120) ? 1 : 0;
  }

  // close: dilate then erode, so a lit scale edge does not fragment the mask
  const morph = (src, R, grow) => {
    const out = new Uint8Array(SW * SH);
    for (let y = 0; y < SH; y++) {
      for (let x = 0; x < SW; x++) {
        let hit = grow ? 0 : 1;
        for (let dy = -R; dy <= R && (grow ? !hit : hit); dy++) {
          for (let dx = -R; dx <= R; dx++) {
            const xx = x + dx, yy = y + dy;
            const inside = xx >= 0 && yy >= 0 && xx < SW && yy < SH;
            const v = inside ? src[yy * SW + xx] : 0;
            if (grow) { if (v) { hit = 1; break; } } else if (!v) { hit = 0; break; }
          }
        }
        out[y * SW + x] = hit;
      }
    }
    return out;
  };
  let mask = morph(bright, 3, true);
  mask = morph(mask, 3, false);

  // fill every hole that is not reachable from the border
  {
    const seen = new Uint8Array(SW * SH);
    const st = [];
    for (let x = 0; x < SW; x++) { st.push(x, 0, x, SH - 1); }
    for (let y = 0; y < SH; y++) { st.push(0, y, SW - 1, y); }
    while (st.length) {
      const y = st.pop(), x = st.pop();
      if (x < 0 || y < 0 || x >= SW || y >= SH) continue;
      const i = y * SW + x;
      if (seen[i] || mask[i]) continue;
      seen[i] = 1;
      st.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
    for (let i = 0; i < SW * SH; i++) if (!mask[i] && !seen[i]) mask[i] = 1;
  }

  // keep the largest connected component, so stray lit specks are dropped
  {
    const comp = new Int32Array(SW * SH).fill(-1);
    let bestId = -1, bestArea = 0, nComp = 0;
    for (let i = 0; i < SW * SH; i++) {
      if (!mask[i] || comp[i] >= 0) continue;
      const id = nComp++;
      let area = 0;
      const q = [i];
      comp[i] = id;
      while (q.length) {
        const p = q.pop(); const px = p % SW;
        area++;
        for (const nn of [p + 1, p - 1, p + SW, p - SW]) {
          if (nn < 0 || nn >= SW * SH) continue;
          if (Math.abs((nn % SW) - px) > 1) continue;
          if (!mask[nn] || comp[nn] >= 0) continue;
          comp[nn] = id; q.push(nn);
        }
      }
      if (area > bestArea) { bestArea = area; bestId = id; }
    }
    for (let i = 0; i < SW * SH; i++) mask[i] = comp[i] === bestId ? 1 : 0;
  }

  const shotTop = new Int32Array(SW).fill(-1);
  const shotBot = new Int32Array(SW).fill(-1);
  let minX = SW, maxX = -1;
  for (let x = 0; x < SW; x++) {
    for (let y = 0; y < SH; y++) if (mask[y * SW + x]) { shotTop[x] = y; break; }
    for (let y = SH - 1; y >= 0; y--) if (mask[y * SW + x]) { shotBot[x] = y; break; }
    if (shotTop[x] >= 0) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
  }
  const shotCols = [];
  for (let x = minX; x <= maxX; x++) if (shotTop[x] >= 0) shotCols.push([x, shotTop[x], shotBot[x]]);

  // ---- line art: subject = ink. Full envelope, fins included.
  const ref = await load(refUrl);
  const refTop = new Int32Array(ref.W).fill(-1);
  const refBot = new Int32Array(ref.W).fill(-1);
  let rMinX = ref.W, rMaxX = -1;
  for (let x = 0; x < ref.W; x++) {
    for (let y = 0; y < ref.H; y++) {
      const i = (y * ref.W + x) * 4;
      if (lum(ref.d, i) < 120) { refTop[x] = y; break; }
    }
    for (let y = ref.H - 1; y >= 0; y--) {
      const i = (y * ref.W + x) * 4;
      if (lum(ref.d, i) < 120) { refBot[x] = y; break; }
    }
    if (refTop[x] >= 0) { if (x < rMinX) rMinX = x; if (x > rMaxX) rMaxX = x; }
  }
  const refCols = [];
  for (let x = rMinX; x <= rMaxX; x++) if (refTop[x] >= 0) refCols.push([x, refTop[x], refBot[x]]);

  // ---- normalise both to (u, offset in half-depths)
  const norm = (cols) => {
    const x0 = cols[0][0], x1 = cols[cols.length - 1][0];
    const len = x1 - x0;
    const mid = (() => { const c = cols[Math.floor(cols.length / 2)]; return (c[1] + c[2]) / 2; })();
    // Normalise by BODY LENGTH only, not by each image's own half-depth.
    //
    // Dividing by half-depth forces both outlines to the same height, which
    // hides the very thing being asked about — how tall the fish is relative to
    // its length. With a shared length scale the vertical axis is directly
    // comparable and a difference in depth/length shows up as one curve sitting
    // inside or outside the other everywhere, rather than as crossing curves.
    return cols.map(([x, t, b]) => ({
      u: (x - x0) / len,
      top: (mid - t) / len,
      bot: (mid - b) / len,
    }));
  };

  // The screenshot faces right (nose at the right, u = 1); the drawing faces
  // left (nose at u = 1). BOTH already have the nose at u = 1, so a flip here
  // would turn the comparison into a mirror image — which is exactly the
  // crossed-over pair of curves it produced before.
  const sN = norm(shotCols);
  const rN = norm(refCols);

  return {
    shot: { W: shot.W, H: shot.H, cols: shotCols, depthOverLen: (() => {
      let m = 0; for (const [, t, b] of shotCols) m = Math.max(m, b - t);
      return m / (shotCols[shotCols.length - 1][0] - shotCols[0][0]);
    })() },
    ref: { W: ref.W, H: ref.H, cols: refCols, depthOverLen: (() => {
      let m = 0; for (const [, t, b] of refCols) m = Math.max(m, b - t);
      return m / (refCols[refCols.length - 1][0] - refCols[0][0]);
    })() },
    sN, rN,
  };
}, `data:image/jpeg;base64,${shotB64}`, `data:image/jpeg;base64,${refB64}`);

// ---- draw
const W = 1100, H = 620;
const padL = 60, padR = 40, padT = 70, padB = 90;
const plotW = W - padL - padR, plotH = H - padT - padB;
const midY = padT + plotH / 2;
const halfH = plotH / 2;

  // Values are in body-length units now, so the vertical scale is chosen to fit
  // the tallest curve rather than assuming a half-depth of 1.
  let peak = 0;
  for (const p of result.rN) peak = Math.max(peak, Math.abs(p.top), Math.abs(p.bot));
  for (const p of result.sN) peak = Math.max(peak, Math.abs(p.top), Math.abs(p.bot));
  const halfH2fit = (plotH / 2) / (peak * 1.12);

  const png = await page.evaluate((payload, W2, H2, padL2, padR2, padT2, plotW2, midY2, halfH2) => {
  const { sN, rN, shot, ref } = payload;
  const cv = document.createElement('canvas');
  cv.width = W2; cv.height = H2;
  const cx = cv.getContext('2d');

  cx.fillStyle = '#ffffff';
  cx.fillRect(0, 0, W2, H2);

  const X = (u) => padL2 + u * plotW2;
  const Y = (v) => midY2 - v * halfH2;

  // horizontal reference lines
  cx.strokeStyle = '#e8ebef';
  cx.lineWidth = 1;
  for (const v of [-1, -0.5, 0, 0.5, 1]) {
    cx.beginPath(); cx.moveTo(padL2, Y(v)); cx.lineTo(padL2 + plotW2, Y(v)); cx.stroke();
  }

  const draw = (pts, color) => {
    cx.beginPath();
    pts.forEach((p, i) => (i ? cx.lineTo(X(p.u), Y(p.top)) : cx.moveTo(X(p.u), Y(p.top))));
    cx.strokeStyle = color; cx.lineWidth = 2; cx.lineJoin = 'round'; cx.stroke();
    cx.beginPath();
    pts.forEach((p, i) => (i ? cx.lineTo(X(p.u), Y(p.bot)) : cx.moveTo(X(p.u), Y(p.bot))));
    cx.strokeStyle = color; cx.lineWidth = 2; cx.lineJoin = 'round'; cx.stroke();
  };

  draw(rN, '#e5484d');
  draw(sN, '#1f6feb');

  // legend
  const lx = padL2, ly = H2 - 44;
  const swatch = (y, color, label) => {
    cx.strokeStyle = color; cx.lineWidth = 3;
    cx.beginPath(); cx.moveTo(lx, y); cx.lineTo(lx + 32, y); cx.stroke();
    cx.fillStyle = '#24292f';
    cx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
    cx.fillText(label, lx + 42, y + 5);
  };
  swatch(ly, '#e5484d', 'reference line art (pic/koi-side.jpg)');
  swatch(ly + 24, '#1f6feb', 'model screenshot (pic/model-side.jpg)');

  cx.fillStyle = '#24292f';
  cx.font = '600 14px ui-sans-serif, system-ui, sans-serif';
  cx.fillText('OUTER CONTOUR  body + fins, both scaled to the same body length', lx, 34);
  cx.font = '12px ui-sans-serif, system-ui, sans-serif';
  cx.fillStyle = '#5b6472';
  cx.fillText(`depth / length   screenshot ${shot.depthOverLen.toFixed(3)}   line art ${ref.depthOverLen.toFixed(3)}`, lx, 54);

  return cv.toDataURL('image/png');
}, result, W, H, padL, padR, padT, plotW, midY, halfH2fit);

await browser.close();
mkdirSync(outPng.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
writeFileSync(outPng, Buffer.from(png.split(',')[1], 'base64'));

// ---- numeric residuals, resampled onto a common u
const at = (pts, u) => {
  let i = 0;
  while (i < pts.length - 2 && pts[i + 1].u < u) i++;
  const a = pts[i], b = pts[i + 1] ?? a;
  const f = b.u === a.u ? 0 : (u - a.u) / (b.u - a.u);
  return { top: a.top + (b.top - a.top) * f, bot: a.bot + (b.bot - a.bot) * f };
};
let sum = 0, n = 0, wt = 0, wtt = 0, wb = 0, wbt = 0;
const rows = [];
for (let k = 0; k <= 40; k++) {
  const u = k / 40;
  if (u < 0.04 || u > 0.96) continue;
  const s = at(result.sN, u), r = at(result.rN, u);
  const dt = s.top - r.top, db = s.bot - r.bot;
  sum += Math.abs(dt) + Math.abs(db); n += 2;
  if (Math.abs(dt) > Math.abs(wt)) { wt = dt; wtt = u; }
  if (Math.abs(db) > Math.abs(wb)) { wb = db; wbt = u; }
  rows.push({ u, dt, db });
}
console.log(`wrote ${outPng}`);
console.log(`depth/length   screenshot ${result.shot.depthOverLen.toFixed(3)}   line art ${result.ref.depthOverLen.toFixed(3)}`);
console.log(`mean |error| ${(sum / n).toFixed(4)} half-depths`);
console.log(`worst top    ${wt >= 0 ? '+' : ''}${wt.toFixed(3)} at u=${wtt.toFixed(2)}`);
console.log(`worst bottom ${wb >= 0 ? '+' : ''}${wb.toFixed(3)} at u=${wbt.toFixed(2)}`);
