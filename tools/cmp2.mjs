// Crops the same relative region from two images and puts them side by side at
// equal scale, for direct visual comparison.
// usage: node tools/cmp2.mjs <a> <b> <out> <x0> <y0> <x1> <y1>   (fractions)
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const [a, b, out, fx0, fy0, fx1, fy1] = process.argv.slice(2);
const ca = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath = ca.find((p) => existsSync(p));
const br = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
const pg = await br.newPage();
await pg.setViewport({ width: 1400, height: 760, deviceScaleFactor: 2 });
const png = await pg.evaluate(async (ua, ub, x0, y0, x1, y1) => {
  const load = async (u) => {
    const im = new Image();
    await new Promise((s, j) => { im.onload = s; im.onerror = j; im.src = u; });
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    c.getContext('2d').drawImage(im, 0, 0);
    return c;
  };
  const A = await load(ua), B = await load(ub);
  const W = 1400, H = 760;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, H);
  const draw = (src, dx) => {
    const sx = src.width * x0, sy = src.height * y0;
    const sw = src.width * (x1 - x0), sh = src.height * (y1 - y0);
    const scale = Math.min((W / 2 - 40) / sw, (H - 80) / sh);
    cx.drawImage(src, sx, sy, sw, sh, dx + 10, 60, sw * scale, sh * scale);
  };
  draw(A, 0); draw(B, W / 2);
  cx.fillStyle = '#24292f';
  cx.font = '600 16px ui-sans-serif, system-ui, sans-serif';
  cx.fillText('A', 20, 34); cx.fillText('B', W / 2 + 20, 34);
  return cv.toDataURL('image/png');
}, 'data:image/jpeg;base64,' + readFileSync(resolve(a)).toString('base64'),
   'data:image/jpeg;base64,' + readFileSync(resolve(b)).toString('base64'),
   +fx0, +fy0, +fx1, +fy1);
await br.close();
writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
console.log('wrote ' + out);
