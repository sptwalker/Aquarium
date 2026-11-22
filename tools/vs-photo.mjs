// Puts a render and a photo side by side, each scaled to the same body length,
// so proportions can be judged directly. Handles a white-background photo.
// usage: node tools/vs-photo.mjs <render> <photo> <out>
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const [rIn, pIn, out] = process.argv.slice(2);
const ca = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath = ca.find((p) => existsSync(p));
const b = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
const p = await b.newPage();
await p.setViewport({ width: 1500, height: 620, deviceScaleFactor: 2 });
const png = await p.evaluate(async (a, c) => {
  const load = async (u) => {
    const im = new Image();
    await new Promise((s, j) => { im.onload = s; im.onerror = j; im.src = u; });
    const cv = document.createElement('canvas');
    cv.width = im.naturalWidth; cv.height = im.naturalHeight;
    cv.getContext('2d').drawImage(im, 0, 0);
    return cv;
  };
  const bbox = (cv, mode) => {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let x0 = cv.width, x1 = 0, y0 = cv.height, y1 = 0;
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
      const i = (y * cv.width + x) * 4;
      const r = d[i], g = d[i + 1], bl = d[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * bl;
      const sat = Math.max(r, g, bl) - Math.min(r, g, bl);
      const on = mode === 'dark'
        ? (r - bl > 14 || lum > 105)          // render: fish is warmer than its backdrop
        : (sat > 40 || lum < 200);            // photo: fish is coloured, paper is not
      if (on) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0 };
  };
  const R = await load(a), P = await load(c);
  const rb = bbox(R, 'dark'), pb = bbox(P, 'photo');
  const W = 1500, H = 620;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, H);
  const colW = W / 2;
  const sR = (colW * 0.88) / rb.w, sP = (colW * 0.88) / pb.w;
  cx.drawImage(R, rb.x0, rb.y0, rb.w, rb.h, (colW - rb.w * sR) / 2, (H - rb.h * sR) / 2, rb.w * sR, rb.h * sR);
  cx.drawImage(P, pb.x0, pb.y0, pb.w, pb.h, colW + (colW - pb.w * sP) / 2, (H - pb.h * sP) / 2, pb.w * sP, pb.h * sP);
  cx.strokeStyle = '#d5dae2'; cx.lineWidth = 1;
  cx.beginPath(); cx.moveTo(colW, 0); cx.lineTo(colW, H); cx.stroke();
  cx.fillStyle = '#24292f';
  cx.font = '600 16px system-ui,sans-serif';
  cx.fillText('MODEL', 20, 30);
  cx.fillText('REFERENCE PHOTO', colW + 20, 30);
  return cv.toDataURL('image/png');
}, 'data:image/png;base64,' + readFileSync(resolve(rIn)).toString('base64'),
   'data:image/jpeg;base64,' + readFileSync(resolve(pIn)).toString('base64'));
await b.close();
writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
console.log('wrote ' + out);
