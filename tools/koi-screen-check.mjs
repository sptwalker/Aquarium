// Compares a SCREENSHOT of the koi against the reference side-view line art.
//
// Both contours are the FULL outer envelope — body plus fins — because that is
// what the eye judges. They are normalised by their own nose-to-tail length, so
// scale and framing drop out and what is left is shape.
//
// Differs from tools/overlay-compare.mjs, which used an orthographic render:
// this starts from the actual screenshot, so camera perspective, fin pose and
// cloth tail are all included.
//
// usage: node tools/koi-screen-check.mjs [screenshot] [outPng]
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const shotPath = process.argv[2] || 'pic/koi-screen.jpg';
const outPng = process.argv[3] || 'shots/koi-screen-check.png';

const ca = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath = ca.find((p) => existsSync(p));
const browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 700, deviceScaleFactor: 2 });

const b64 = readFileSync(resolve(shotPath)).toString('base64');
const silB64 = readFileSync(resolve('pic/koi-side.jpg')).toString('base64');

const res = await page.evaluate(async (shotUrl, artUrl) => {
  const load = async (url) => {
    const im = new Image();
    await new Promise((r, j) => { im.onload = r; im.onerror = j; im.src = url; });
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const cx = c.getContext('2d');
    cx.drawImage(im, 0, 0);
    return { W: c.width, H: c.height, d: cx.getImageData(0, 0, c.width, c.height).data };
  };
  const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

  // ---- screenshot: the fish is warm (R >> B) or bright; the backdrop is not
  const shot = await load(shotUrl);
  const SW = shot.W, SH = shot.H;
  const M = new Uint8Array(SW * SH);
  for (let i = 0; i < SW * SH; i++) {
    const r = shot.d[i * 4], b = shot.d[i * 4 + 2];
    M[i] = (r - b > 14 || lum(shot.d, i * 4) > 110) ? 1 : 0;
  }
  const morph = (src, R, grow) => {
    const out = new Uint8Array(SW * SH);
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
      let hit = grow ? 0 : 1;
      for (let dy = -R; dy <= R && (grow ? !hit : hit); dy++) for (let dx = -R; dx <= R; dx++) {
        const xx = x + dx, yy = y + dy;
        const v = (xx >= 0 && yy >= 0 && xx < SW && yy < SH) ? src[yy * SW + xx] : 0;
        if (grow) { if (v) { hit = 1; break; } } else if (!v) { hit = 0; break; }
      }
      out[y * SW + x] = hit;
    }
    return out;
  };
  let mask = morph(M, 4, true);
  mask = morph(mask, 4, false);
  {
    const seen = new Uint8Array(SW * SH), st = [];
    for (let x = 0; x < SW; x++) { st.push(x, 0, x, SH - 1); }
    for (let y = 0; y < SH; y++) { st.push(0, y, SW - 1, y); }
    while (st.length) {
      const y = st.pop(), x = st.pop();
      if (x < 0 || y < 0 || x >= SW || y >= SH) continue;
      const i = y * SW + x;
      if (seen[i] || mask[i]) continue;
      seen[i] = 1; st.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
    for (let i = 0; i < SW * SH; i++) if (!mask[i] && !seen[i]) mask[i] = 1;
  }
  {
    const comp = new Int32Array(SW * SH).fill(-1);
    let bestId = -1, bestArea = 0, id = 0;
    for (let i = 0; i < SW * SH; i++) {
      if (!mask[i] || comp[i] >= 0) continue;
      const cid = id++;
      let area = 0; const q = [i]; comp[i] = cid;
      while (q.length) {
        const p = q.pop(); const px = p % SW; area++;
        for (const n of [p + 1, p - 1, p + SW, p - SW]) {
          if (n < 0 || n >= SW * SH) continue;
          if (Math.abs((n % SW) - px) > 1) continue;
          if (!mask[n] || comp[n] >= 0) continue;
          comp[n] = cid; q.push(n);
        }
      }
      if (area > bestArea) { bestArea = area; bestId = cid; }
    }
    for (let i = 0; i < SW * SH; i++) mask[i] = comp[i] === bestId ? 1 : 0;
  }
  const shotCols = [];
  {
    const top = new Int32Array(SW).fill(-1), bot = new Int32Array(SW).fill(-1);
    for (let x = 0; x < SW; x++) {
      for (let y = 0; y < SH; y++) if (mask[y * SW + x]) { top[x] = y; break; }
      for (let y = SH - 1; y >= 0; y--) if (mask[y * SW + x]) { bot[x] = y; break; }
    }
    for (let x = 0; x < SW; x++) if (top[x] >= 0) shotCols.push([x, top[x], bot[x]]);
  }

  // ---- line art: full ink envelope
  const art = await load(artUrl);
  const AW = art.W, AH = art.H;
  const artCols = [];
  {
    const top = new Int32Array(AW).fill(-1), bot = new Int32Array(AW).fill(-1);
    for (let x = 0; x < AW; x++) {
      for (let y = 0; y < AH; y++) if (lum(art.d, (y * AW + x) * 4) < 150) { top[x] = y; break; }
      for (let y = AH - 1; y >= 0; y--) if (lum(art.d, (y * AW + x) * 4) < 150) { bot[x] = y; break; }
    }
    for (let x = 0; x < AW; x++) if (top[x] >= 0) artCols.push([x, top[x], bot[x]]);
  }

  return { shotCols, artCols };
}, `data:image/jpeg;base64,${b64}`, `data:image/jpeg;base64,${silB64}`);

await browser.close();

// ---- normalise: body-length units, nose at u = 0 -------------------------
// The screenshot faces LEFT (mouth on the left); the drawing also faces left.
// Both therefore run nose -> tail with increasing x.
const desk = (cols, label) => {
  const x0 = cols[0][0], x1 = cols[cols.length - 1][0];
  const len = x1 - x0;
  let maxD = 0, peakX = x0;
  for (const [x, t, b] of cols) if (b - t > maxD) { maxD = b - t; peakX = x; }
  const mid = (() => { const c = cols[Math.floor(cols.length / 2)]; return (c[1] + c[2]) / 2; })();
  const at = (u) => {
    const x = Math.round(x0 + u * len);
    let best = cols[0], bd = 1e9;
    for (const c of cols) { const dd = Math.abs(c[0] - x); if (dd < bd) { bd = dd; best = c; } }
    return { top: (mid - best[1]) / len, bot: (mid - best[2]) / len };
  };
  return { label, len, maxD, ratio: maxD / len, peakU: (peakX - x0) / len, at };
};

const S = desk(res.shotCols, 'screenshot');
const A = desk(res.artCols, 'line art');

console.log(`screenshot depth/length ${S.ratio.toFixed(4)}   deepest at ${(S.peakU * 100).toFixed(0)}%`);
console.log(`line art   depth/length ${A.ratio.toFixed(4)}   deepest at ${(A.peakU * 100).toFixed(0)}%`);
console.log('');
console.log(' u     shot top  art top    d      shot bot  art bot    d');
let sum = 0, n = 0, wt = 0, wtt = 0, wb = 0, wbt = 0;
for (let k = 0; k <= 20; k++) {
  const u = k / 20;
  if (u < 0.05 || u > 0.95) continue;
  const s = S.at(u), a = A.at(u);
  const dt = s.top - a.top, db = s.bot - a.bot;
  sum += Math.abs(dt) + Math.abs(db); n += 2;
  if (Math.abs(dt) > Math.abs(wt)) { wt = dt; wtt = u; }
  if (Math.abs(db) > Math.abs(wb)) { wb = db; wbt = u; }
  const mark = Math.abs(dt) > 0.04 || Math.abs(db) > 0.04 ? '  <--' : '';
  console.log(`${u.toFixed(2)}  ${s.top.toFixed(3).padStart(8)} ${a.top.toFixed(3).padStart(8)} ${((dt >= 0 ? '+' : '') + dt.toFixed(3)).padStart(7)}`
    + `   ${s.bot.toFixed(3).padStart(8)} ${a.bot.toFixed(3).padStart(8)} ${((db >= 0 ? '+' : '') + db.toFixed(3)).padStart(7)}${mark}`);
}
console.log('');
console.log(`mean |error| ${(sum / n).toFixed(4)} body-lengths`);
console.log(`worst top    ${wt >= 0 ? '+' : ''}${wt.toFixed(3)} at u=${wtt.toFixed(2)}`);
console.log(`worst bottom ${wb >= 0 ? '+' : ''}${wb.toFixed(3)} at u=${wbt.toFixed(2)}`);

// ---- plot ---------------------------------------------------------------
const series = [S, A].map((t) => ({
  label: t.label,
  ratio: t.ratio,
  pts: Array.from({ length: 201 }, (_, k) => {
    const v = t.at(k / 200);
    return [k / 200, v.top, v.bot];
  }),
}));

const b2 = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
const p2 = await b2.newPage();
await p2.setViewport({ width: 1200, height: 620, deviceScaleFactor: 2 });
const png = await p2.evaluate((series2) => {
  const W = 1200, H = 620;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, H);

  let peak = 0;
  for (const t of series2) for (const [, a, c] of t.pts) peak = Math.max(peak, Math.abs(a), Math.abs(c));
  const padL = 60, padR = 40, padT = 76, padB = 96;
  const plotW = W - padL - padR;
  const midY = padT + (H - padT - padB) / 2;
  const sy = (H - padT - padB) / 2 / (peak * 1.1);
  const X = (u) => padL + u * plotW;
  const Y = (v) => midY - v * sy;

  cx.strokeStyle = '#eceff3';
  for (let k = -4; k <= 4; k++) {
    const v = k * peak / 4;
    cx.beginPath(); cx.moveTo(padL, Y(v)); cx.lineTo(padL + plotW, Y(v)); cx.stroke();
  }
  cx.strokeStyle = '#cfd5de';
  cx.beginPath(); cx.moveTo(padL, Y(0)); cx.lineTo(padL + plotW, Y(0)); cx.stroke();

  const colors = ['#1f6feb', '#e5484d'];
  series2.forEach((t, i) => {
    cx.strokeStyle = colors[i];
    cx.lineWidth = 2.4;
    for (const col of [1, 2]) {
      cx.beginPath();
      t.pts.forEach((pt, k) => (k ? cx.lineTo(X(pt[0]), Y(pt[col])) : cx.moveTo(X(pt[0]), Y(pt[col]))));
      cx.stroke();
    }
  });

  cx.fillStyle = '#24292f';
  cx.font = '600 16px ui-sans-serif, system-ui, sans-serif';
  cx.fillText('KOI — SCREENSHOT vs LINE ART', padL, 30);
  cx.font = '12px ui-sans-serif, system-ui, sans-serif';
  cx.fillStyle = '#5b6472';
  cx.fillText('outer contour including fins, both normalised by nose-to-tail length', padL, 50);

  let ly = H - 58;
  series2.forEach((t, i) => {
    cx.strokeStyle = colors[i]; cx.lineWidth = 3;
    cx.beginPath(); cx.moveTo(padL, ly); cx.lineTo(padL + 30, ly); cx.stroke();
    cx.fillStyle = '#24292f';
    cx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    cx.fillText(`${t.label}    depth/length ${t.ratio.toFixed(3)}`, padL + 40, ly + 4);
    ly += 22;
  });
  return cv.toDataURL('image/png');
}, series);
await b2.close();

mkdirSync(outPng.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
writeFileSync(outPng, Buffer.from(png.split(',')[1], 'base64'));
console.log(`\nwrote ${outPng}`);
