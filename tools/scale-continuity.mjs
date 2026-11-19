// Checks the baked scale height field for discontinuities.
//
// The dark bands were a height field that stepped to zero once per lattice
// column. Numerically that is a big jump between adjacent pixels, so this scans
// the field and reports the largest ones — a picture shows the symptom, this
// shows the cause and proves it is gone.
//
// usage: node tools/scale-continuity.mjs
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const ca = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath = ca.find((p) => existsSync(p));
const b = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
const p = await b.newPage();

const r = await p.evaluate(async () => {
  // same constants as src/scaleTexture.ts
  const COLS = 8, ROWS = 12, RX = 0.95, RY = 0.72, FAN = 0.55;

  function heightAt(u, v) {
    const gu = u * COLS, gv = v * ROWS;
    const bx = Math.floor(gu), by = Math.floor(gv);
    let bestPrio = -1e9, bestH = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const cellY = by + dy;
        const shift = ((cellY % 2) + 2) % 2 === 0 ? 0 : 0.5;
        const cx = bx + dx + 0.5 + shift;
        const cy = cellY + 0.5;
        let ddx = gu - cx;
        const ddy = gv - cy;
        if (ddx > COLS * 0.5) ddx -= COLS;
        if (ddx < -COLS * 0.5) ddx += COLS;
        const prio = dy * 10 - Math.abs(ddx);
        if (prio <= bestPrio) continue;
        const along = Math.min(1, Math.max(0, (RY - ddy) / (2 * RY)));
        const width = RX * (1.0 - FAN + FAN * along * along);
        const nx = ddx / width, ny = ddy / RY;
        const r2 = nx * nx + ny * ny;
        if (r2 >= 1) continue;
        bestPrio = prio;
        bestH = Math.sqrt(1 - r2);
      }
    }
    return bestH;
  }

  const N = 512;
  const H = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) H[y * N + x] = heightAt((x + 0.5) / N, (y + 0.5) / N);

  // largest horizontal jump per row, then the worst row
  let worst = 0, worstAt = null;
  let totalBig = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const d = Math.abs(H[y * N + ((x + 1) % N)] - H[y * N + x]);
      if (d > 0.08) totalBig++;
      if (d > worst) { worst = d; worstAt = [x, y]; }
    }
  }

  // column means, to see any periodic structure
  const colMean = [];
  for (let x = 0; x < N; x++) {
    let s = 0;
    for (let y = 0; y < N; y++) s += H[y * N + x];
    colMean.push(s / N);
  }
  const cm = colMean.reduce((a, b) => a + b) / N;
  let cmMin = Infinity, cmMax = 0;
  for (const v of colMean) { cmMin = Math.min(cmMin, v); cmMax = Math.max(cmMax, v); }

  return { N, worst, worstAt, totalBig, cmMin: cmMin / cm, cmMax: cmMax / cm };
});
await b.close();

console.log(`largest adjacent-pixel jump in the height field: ${r.worst.toFixed(4)}`);
console.log(`  at (${r.worstAt[0]}, ${r.worstAt[1]}) of ${r.N}`);
console.log(`  pixels with a jump > 0.08: ${r.totalBig}`);
console.log(`column-mean height varies ${r.cmMin.toFixed(3)} .. ${r.cmMax.toFixed(3)} x the average`);
console.log(`  (a periodic seam shows up here as a strong ripple; smooth is ~1.00)`);
