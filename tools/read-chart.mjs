// Reads the user's overlay chart as numbers.
//
// Both curves are already normalised to body length and aligned at the nose and
// the body axis, and the chart states each curve's total height (39.6 %L / 38.8
// %L). That gives the vertical scale without needing the axis labels: the red
// curve's own vertical span IS 39.6 %L.
//
// Output: for every station along the body, the target (red) and current (blue)
// top and bottom offsets in %L, plus the half-depth and midline each implies.
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const img = process.argv[2] || 'pic/chart-compare.png';
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
  const isRed = (i) => d[i] > 110 && d[i] - d[i+1] > 45 && d[i] - d[i+2] > 45;
  const isBlue = (i) => d[i+2] > 100 && d[i+2] - d[i] > 40 && d[i+2] - d[i+1] > 20;
  const red = [], blue = [];
  for (let x = 0; x < W; x++) {
    let a = -1, bb = -1, c2 = -1, dd = -1;
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * 4;
      if (isRed(i)) { if (a < 0) a = y; bb = y; }
      if (isBlue(i)) { if (c2 < 0) c2 = y; dd = y; }
    }
    if (a >= 0) red.push([x, a, bb]);
    if (c2 >= 0) blue.push([x, c2, dd]);
  }
  return { W, H, red, blue };
}, `data:image/png;base64,${b64}`);
await b.close();

const { red, blue } = r;
const rx0 = red[0][0], rx1 = red[red.length - 1][0];
const bx0 = blue[0][0], bx1 = blue[blue.length - 1][0];
const redTopMin = Math.min(...red.map((q) => q[1]));
const redBotMax = Math.max(...red.map((q) => q[2]));
const blueTopMin = Math.min(...blue.map((q) => q[1]));
const blueBotMax = Math.max(...blue.map((q) => q[2]));

// vertical scale, %L per pixel, from each curve's stated total height
const ysR = 39.6 / (redBotMax - redTopMin);
const ysB = 38.8 / (blueBotMax - blueTopMin);
console.log(`red  x ${rx0}..${rx1} (${rx1-rx0}px = 100 %L)  y ${redTopMin}..${redBotMax}  scale ${ysR.toFixed(4)} %L/px`);
console.log(`blue x ${bx0}..${bx1} (${bx1-bx0}px = 100 %L)  y ${blueTopMin}..${blueBotMax}  scale ${ysB.toFixed(4)} %L/px`);

const nearest = (arr, x) => {
  let best = arr[0], bd = 1e9;
  for (const q of arr) { const dd = Math.abs(q[0] - x); if (dd < bd) { bd = dd; best = q; } }
  return best;
};

// common vertical origin: the average midline of the red curve (the chart aligns
// both to the body axis, so this is the shared reference)
const midOf = (q, ys) => (q[1] + q[2]) / 2 * ys;
let refSum = 0, refN = 0;
for (let k = 20; k <= 80; k++) { refSum += midOf(nearest(red, rx0 + (k/100)*(rx1-rx0)), ysR); refN++; }
const REF = refSum / refN;

console.log('\n  x%    RED top  RED bot | half  mid   ||  BLUE top BLUE bot | half  mid');
const rows = [];
for (let k = 0; k <= 100; k += 2) {
  const q = nearest(red, rx0 + (k / 100) * (rx1 - rx0));
  const w = nearest(blue, bx0 + (k / 100) * (bx1 - bx0));
  const rt = REF - q[1] * ysR, rb = REF - q[2] * ysR;      // screen y is down
  const bt = REF - w[1] * ysB, bb = REF - w[2] * ysB;
  rows.push({ k, rt, rb, bt, bb });
  console.log(`${String(k).padStart(3)}   ${rt.toFixed(1).padStart(6)} ${rb.toFixed(1).padStart(7)} | ${((rt-rb)/2).toFixed(1).padStart(5)} ${((rt+rb)/2).toFixed(1).padStart(5)}  || ${bt.toFixed(1).padStart(7)} ${bb.toFixed(1).padStart(7)} | ${((bt-bb)/2).toFixed(1).padStart(5)} ${((bt+bb)/2).toFixed(1).padStart(5)}`);
}
const mean = rows.reduce((a, q) => a + Math.abs(q.rt-q.bt) + Math.abs(q.rb-q.bb), 0) / (rows.length*2);
console.log(`\nmean |model - reference| = ${mean.toFixed(2)} %L`);
