// Renders the model silhouette in the browser and returns its outline as
// pixel columns, so it can be compared against the line-art trace directly.
//
// This exists because comparing the profile *tables* against the drawing
// reported a good fit while the rendered body was visibly far too fat. The
// tables are an intermediate representation; the mesh is the thing being
// judged. Everything here works on what actually rasterises.
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const ca = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const executablePath = ca.find((p) => existsSync(p));
if (!executablePath) throw new Error('no chrome/edge found');

export async function captureSilhouette(base, species, { width = 1400, height = 700, all = false } = {}) {
  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=default'],
    defaultViewport: { width, height, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(`${base}/showcase.html?species=${species}&silhouette=${all ? 'all' : '1'}`, {
    waitUntil: 'networkidle0', timeout: 60000,
  });
  await page.waitForFunction('window.__ready === true', { timeout: 60000 });

  // Freeze the swim wave before reading the outline. With the default swim
  // amplitude the body is bent into an S, so the top and bottom edges are not
  // the profile at all — that straight-sided bias would be baked into every
  // comparison.
  await page.evaluate(() => window.__showcase?.setPlaying(false));
  await new Promise((r) => setTimeout(r, 1200));

  const shot = await page.evaluate(() => {
    const cv = document.getElementById('view');
    const W = cv.width, H = cv.height;
    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H;
    const cx = tmp.getContext('2d');
    cx.drawImage(cv, 0, 0);
    const d = cx.getImageData(0, 0, W, H).data;
    const on = (x, y) => {
      const o = (y * W + x) * 4;
      return d[o] > 96 || d[o + 1] > 96 || d[o + 2] > 96;
    };
    const top = new Int32Array(W).fill(-1);
    const bot = new Int32Array(W).fill(-1);
    let minX = W, maxX = -1;
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) if (on(x, y)) { top[x] = y; break; }
      for (let y = H - 1; y >= 0; y--) if (on(x, y)) { bot[x] = y; break; }
      if (top[x] >= 0) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
    }
    const cols = [];
    for (let x = minX; x <= maxX; x++) if (top[x] >= 0) cols.push([x, top[x], bot[x]]);
    return { W, H, cols, minX, maxX };
  });

  await browser.close();
  return { ...shot, errors };
}

// same normalisation the line-art trace uses: body length along x, half-depth
// along y, so the two are directly comparable
export function normalise(cols) {
  const x0 = cols[0][0], x1 = cols[cols.length - 1][0];
  const len = x1 - x0;
  let maxDepth = 0;
  for (const [, t, b] of cols) maxDepth = Math.max(maxDepth, b - t);
  const midY = new Array(cols.length).fill(0);
  cols.forEach(([, t, b], i) => { midY[i] = (t + b) / 2; });
  const midRef = midY[Math.floor(midY.length / 2)];
  // Divide by HALF depth, matching the line-art trace: it reports edges in
  // units of max half-depth, so the silhouette spans about +/-1 there. Using
  // full depth here would make every value half as large and read as the model
  // being half as deep as the drawing.
  const halfRef = maxDepth / 2;
  return cols.map(([x, t, b]) => {
    const u = (x - x0) / len;                 // 0 at one end .. 1 at the other
    return {
      u,
      top: -(t - midRef) / halfRef,
      bot: -(b - midRef) / halfRef,
      depthOverLen: maxDepth / len,
    };
  });
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const base = process.argv[2] || 'http://localhost:5173';
  const species = process.argv[3] || 'koi';
  const r = await captureSilhouette(base, species);
  const n = normalise(r.cols);
  console.log(JSON.stringify({
    px: { len: r.maxX - r.minX, depth: Math.max(...r.cols.map(([, t, b]) => b - t)) },
    depthOverLen: n[0].depthOverLen.toFixed(4),
    errors: r.errors,
  }, null, 2));
}
