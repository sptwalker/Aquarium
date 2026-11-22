// How sensitive is the photo's body depth to the colour threshold?
// The belly is pale (low saturation) and the caudal fin is pale blue-white, so
// the threshold has to be loose enough to include the belly but tight enough to
// exclude the fin. This prints the resulting depth/body-length for each setting,
// which bounds how much of any disagreement is measurement noise.
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const img = process.argv[2] || 'pic/ref-goldfish.jpg';
const ca = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath = ca.find((p) => existsSync(p));
const b = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox','--use-angle=default'] });
const p = await b.newPage();
const b64 = readFileSync(resolve(img)).toString('base64');
const r = await p.evaluate(async (url) => {
  const im = new Image();
  await new Promise((s, j) => { im.onload = s; im.onerror = j; im.src = url; });
  const W = im.naturalWidth, H = im.naturalHeight;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const cx = c.getContext('2d'); cx.drawImage(im, 0, 0);
  const d = cx.getImageData(0, 0, W, H).data;
  const out = [];
  for (const satMin of [20, 30, 40, 50, 62, 75]) {
    const sat = (i) => { const r0=d[i],g0=d[i+1],b0=d[i+2]; return Math.max(r0,g0,b0)-Math.min(r0,g0,b0); };
    const lum = (i) => 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
    const ok = (i) => sat(i) > satMin && lum(i) > 30 && lum(i) < 236;
    const top = new Int32Array(W).fill(-1), bot = new Int32Array(W).fill(-1);
    let x0 = W, x1 = 0;
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) if (ok((y*W+x)*4)) { top[x]=y; break; }
      for (let y = H-1; y >= 0; y--) if (ok((y*W+x)*4)) { bot[x]=y; break; }
      if (top[x]>=0) { if (x<x0) x0=x; if (x>x1) x1=x; }
    }
    // body end = where height drops under 40% of peak, scanning from the right
    const hh = [];
    for (let x = 0; x < W; x++) hh[x] = (top[x]>=0) ? bot[x]-top[x] : -1;
    const peak = Math.max(...hh);
    let end = x1;
    for (let x = x1; x > x0 + (x1-x0)*0.4; x--) if (hh[x] > 0 && hh[x] < peak*0.42) { end = x; break; }
    const BL = end - x0;
    // depth at mid-body, sampled away from any fin
    const mid = Math.round(x0 + BL*0.5);
    let dmax = 0, dat = 0;
    for (let x = Math.round(x0+BL*0.30); x <= Math.round(x0+BL*0.65); x++) {
      if (hh[x] > dmax) { dmax = hh[x]; dat = (x-x0)/BL; }
    }
    out.push({ satMin, BL, dmax, ratio: dmax/BL, dat });
  }
  return out;
}, `data:image/jpeg;base64,${b64}`);
await b.close();
console.log('satMin  bodyLen  depth   depth/BL  deepest@');
for (const o of r) {
  console.log(`${String(o.satMin).padStart(6)}  ${String(o.BL).padStart(7)}  ${String(o.dmax).padStart(5)}   ${o.ratio.toFixed(3)}     ${o.dat.toFixed(2)}`);
}
