// One definition, used once: nose -> peduncle is the body length, and the
// peduncle is the narrowest point between 60% and 92% of the full silhouette.
// Reports depth/body and where the deepest point sits, for the photo and for
// the model, so the two numbers mean the same thing.
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureSilhouette } from './silhouette.mjs';

const ca = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath = ca.find((p) => existsSync(p));

function ratios(label, cols) {
  const x0 = cols[0][0], x1 = cols[cols.length - 1][0], T = x1 - x0;
  const h = new Map(cols.map(([x, t, b]) => [x, b - t]));
  // peduncle: narrowest between 60% and 92%
  let px = -1, pw = 1e9;
  for (let x = Math.round(x0 + T * 0.60); x <= Math.round(x0 + T * 0.92); x++) {
    const w = h.get(x); if (w === undefined) continue;
    if (w < pw) { pw = w; px = x; }
  }
  const BL = px - x0;
  let dmax = 0, dx = x0;
  for (const q of cols) if (q[2] - q[1] > dmax) { dmax = q[2] - q[1]; dx = q[0]; }
  console.log(`${label.padEnd(22)} total ${T}px  peduncle@${(px - x0) / T > 0 ? ((px - x0) / T).toFixed(3) : '?'}  body ${BL}px`);
  console.log(`${''.padEnd(22)} depth/body = ${(dmax / BL).toFixed(3)}   deepest at ${((dx - x0) / BL).toFixed(3)} of body`);
}

// photo
const b = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox','--use-angle=default'] });
const p = await b.newPage();
const b64 = readFileSync(resolve('pic/ref-goldfish.jpg')).toString('base64');
const pc = await p.evaluate(async (url) => {
  const im = new Image();
  await new Promise((s, j) => { im.onload = s; im.onerror = j; im.src = url; });
  const W = im.naturalWidth, H = im.naturalHeight;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const cx = c.getContext('2d'); cx.drawImage(im, 0, 0);
  const d = cx.getImageData(0, 0, W, H).data;
  const sat = (i) => { const r0=d[i],g0=d[i+1],b0=d[i+2]; return Math.max(r0,g0,b0)-Math.min(r0,g0,b0); };
  const lum = (i) => 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
  const ok = (i) => sat(i) > 40 && lum(i) > 30 && lum(i) < 236;
  const top = new Int32Array(W).fill(-1), bot = new Int32Array(W).fill(-1);
  let x0 = W, x1 = 0;
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) if (ok((y*W+x)*4)) { top[x]=y; break; }
    for (let y = H-1; y >= 0; y--) if (ok((y*W+x)*4)) { bot[x]=y; break; }
    if (top[x]>=0) { if (x<x0) x0=x; if (x>x1) x1=x; }
  }
  const cols = [];
  for (let x = x0; x <= x1; x++) if (top[x] >= 0) cols.push([x, top[x], bot[x]]);
  return cols;
}, `data:image/jpeg;base64,${b64}`);
await b.close();

ratios('PHOTO (sat>40)', pc);
const sil = await captureSilhouette('http://localhost:5173', 'koi', { all: false });
ratios('MODEL (body mesh)', sil.cols);
