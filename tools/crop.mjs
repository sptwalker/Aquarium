// Crops and upscales a region of an image so a defect can be inspected closely.
// usage: node tools/crop.mjs <img> <out> <x> <y> <w> <h> [scale]
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [img, out, x, y, w, h, sc] = process.argv.slice(2);
const ca = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath = ca.find((p) => existsSync(p));
const b = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
const p = await b.newPage();
const b64 = readFileSync(resolve(img)).toString('base64');
const png = await p.evaluate(async (url, rx, ry, rw, rh, scale) => {
  const im = new Image();
  await new Promise((r, j) => { im.onload = r; im.onerror = j; im.src = url; });
  const cv = document.createElement('canvas');
  cv.width = rw * scale; cv.height = rh * scale;
  const cx = cv.getContext('2d');
  cx.imageSmoothingEnabled = false;
  cx.drawImage(im, rx, ry, rw, rh, 0, 0, rw * scale, rh * scale);
  return cv.toDataURL('image/png');
}, `data:image/jpeg;base64,${b64}`, +x, +y, +w, +h, +(sc || 3));
await b.close();
writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
console.log('wrote ' + out);
