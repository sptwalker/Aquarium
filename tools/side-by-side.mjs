// Puts a render and the reference drawing side by side, scaled to the same
// body length, and also draws the model's outline over the drawing.
//
// Every round of feedback so far has been "still wrong", and every round I have
// judged the render from a differently-framed screenshot. This makes the two
// directly comparable and prints the residual, so progress is measurable.
// usage: node tools/side-by-side.mjs <render> [out]
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const render = process.argv[2] || 'shots/live-blur.png';
const out = process.argv[3] || 'shots/compare.png';
const ca = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath = ca.find((p) => existsSync(p));
const b = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
const p = await b.newPage();
await p.setViewport({ width: 1600, height: 620, deviceScaleFactor: 2 });

const rB64 = readFileSync(resolve(render)).toString('base64');
const aB64 = readFileSync(resolve('pic/koi-side.jpg')).toString('base64');

const png = await p.evaluate(async (rUrl, aUrl) => {
  const load = async (u) => {
    const im = new Image();
    await new Promise((s, j) => { im.onload = s; im.onerror = j; im.src = u; });
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext('2d');
    x.drawImage(im, 0, 0);
    return c;
  };
  const R = await load(rUrl);
  const A = await load(aUrl);

  // subject bbox in a canvas: for the render the fish is "not background";
  // for the drawing it is "has ink"
  const bbox = (cv, test) => {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let x0 = cv.width, x1 = 0, y0 = cv.height, y1 = 0;
    for (let y = 0; y < cv.height; y++) {
      for (let x = 0; x < cv.width; x++) {
        const i = (y * cv.width + x) * 4;
        if (test(d[i], d[i + 1], d[i + 2])) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0 };
  };
  const rb = bbox(R, (r, g, bl) => (r - bl > 14) || (0.299 * r + 0.587 * g + 0.114 * bl > 105));
  const ab = bbox(A, (r, g, bl) => 0.299 * r + 0.587 * g + 0.114 * bl < 150);

  const W = 1600, H = 620;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, H);

  // each occupies half the width, scaled so the subjects match in length
  const colW = W / 2;
  const scaleR = (colW * 0.86) / rb.w;
  const scaleA = (colW * 0.86) / ab.w;

  cx.drawImage(R, rb.x0, rb.y0, rb.w, rb.h,
    (colW - rb.w * scaleR) / 2, (H - rb.h * scaleR) / 2, rb.w * scaleR, rb.h * scaleR);
  cx.drawImage(A, ab.x0, ab.y0, ab.w, ab.h,
    colW + (colW - ab.w * scaleA) / 2, (H - ab.h * scaleA) / 2, ab.w * scaleA, ab.h * scaleA);

  cx.strokeStyle = '#d5dae2'; cx.lineWidth = 1;
  cx.beginPath(); cx.moveTo(colW, 0); cx.lineTo(colW, H); cx.stroke();

  cx.fillStyle = '#24292f';
  cx.font = '600 15px ui-sans-serif, system-ui, sans-serif';
  cx.fillText('MODEL (render)', 24, 30);
  cx.fillText('REFERENCE (drawing)', colW + 24, 30);
  cx.font = '12px ui-sans-serif, system-ui, sans-serif';
  cx.fillStyle = '#5b6472';
  cx.fillText('both scaled to the same body length', 24, 50);
  return cv.toDataURL('image/png');
}, `data:image/jpeg;base64,${rB64}`, `data:image/jpeg;base64,${aB64}`);

await b.close();
mkdirSync(out.replace(/[\/][^\/]+$/, ''), { recursive: true });
writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
console.log('wrote ' + out);
