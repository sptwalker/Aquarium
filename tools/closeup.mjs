// Close-up capture of a single fish, for judging anatomy and materials.
// usage: node tools/closeup.mjs [url] [out] [dist] [height] [waitMs]
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5173/?debug=base';
const out = process.argv[3] || 'shots/closeup.png';
const dist = Number(process.argv[4] || 3.2);
const height = Number(process.argv[5] || 2.4);
const waitMs = Number(process.argv[6] || 4000);

const candidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) throw new Error('no chrome/edge found');
mkdirSync(out.replace(/[\\/][^\\/]+$/, ''), { recursive: true });

const browser = await puppeteer.launch({
  executablePath,
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=default'],
  defaultViewport: { width: 1400, height: 788, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForFunction('window.__camera !== undefined', { timeout: 60000 });

// frame the largest fish, keeping the camera outside the glass
await page.evaluate((d, h) => {
  const { camera, controls } = window.__camera;
  const probe = window.__probe();
  const f = probe.fish[0];
  controls.target.set(f[0], f[1], f[2]);
  camera.position.set(f[0] + d * 0.55, f[1] + h * 0.25, f[2] + d);
  controls.update();
}, dist, height);

await new Promise((r) => setTimeout(r, waitMs));
await page.screenshot({ path: out });
console.log(JSON.stringify({ out, errors }, null, 2));
await browser.close();
