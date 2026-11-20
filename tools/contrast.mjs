// Local-contrast normalisation: divides each pixel by a wide blur of its
// neighbourhood, so broad shading is flattened and subtle local bands stand out.
// usage: node tools/contrast.mjs <img> <out> [radiusFrac]
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const [img, out, rfrac] = process.argv.slice(2);
const ca = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath = ca.find((p) => existsSync(p));
const br = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--use-angle=default'] });
const pg = await br.newPage();
const b64 = readFileSync(resolve(img)).toString('base64');
const png = await pg.evaluate(async (url, rf) => {
  const im = new Image();
  await new Promise((s, j) => { im.onload = s; im.onerror = j; im.src = url; });
  const W = im.naturalWidth, H = im.naturalHeight;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const cx = c.getContext('2d'); cx.drawImage(im, 0, 0);
  const src = cx.getImageData(0, 0, W, H);
  const d = src.data;
  const L = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) L[i] = 0.299 * d[i*4] + 0.587*d[i*4+1] + 0.114*d[i*4+2];
  // integral image for the box blur
  const S = new Float64Array((W+1)*(H+1));
  for (let y=0;y<H;y++){let rs=0;for(let x=0;x<W;x++){rs+=L[y*W+x];S[(y+1)*(W+1)+(x+1)]=S[y*(W+1)+(x+1)]+rs;}}
  const R = Math.max(8, Math.round(Math.min(W,H) * rf));
  const outImg = cx.createImageData(W, H);
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){
    const x0=Math.max(0,x-R),x1=Math.min(W-1,x+R),y0=Math.max(0,y-R),y1=Math.min(H-1,y+R);
    const s=S[(y1+1)*(W+1)+(x1+1)]-S[y0*(W+1)+(x1+1)]-S[(y1+1)*(W+1)+x0]+S[y0*(W+1)+x0];
    const n=(x1-x0+1)*(y1-y0+1);
    const bg=s/n;
    const ratio=bg>4?L[y*W+x]/bg:1;
    // map 0.85..1.15 -> 0..255
    const v=Math.max(0,Math.min(255,Math.round((ratio-0.85)/0.30*255)));
    const o=(y*W+x)*4; outImg.data[o]=outImg.data[o+1]=outImg.data[o+2]=v; outImg.data[o+3]=255;
  }
  const t=document.createElement('canvas'); t.width=W;t.height=H;
  t.getContext('2d').putImageData(outImg,0,0);
  return t.toDataURL('image/png');
}, `data:image/jpeg;base64,${b64}`, +(rfrac||0.05));
await br.close();
writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
console.log('wrote ' + out);
