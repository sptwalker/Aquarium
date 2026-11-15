// Captures the koi model from several angles for anatomy review.
// usage: node tools/koi.mjs [baseUrl]
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';

const base = process.argv[2] || 'http://localhost:5173';
const ca = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const executablePath = ca.find((p) => existsSync(p));
if (!executablePath) throw new Error('no chrome/edge found');
mkdirSync('shots', { recursive: true });

const browser = await puppeteer.launch({
  executablePath,
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=default'],
  defaultViewport: { width: 1100, height: 720, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`${base}/showcase.html?species=koi`, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForFunction('window.__ready === true', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(() => window.__showcase.setPlaying(false));
await new Promise((r) => setTimeout(r, 900));

const views = [
  ['kyo-side', 90, 2.6, 0.10],
  ['kyo-head', 30, 1.15, 0.06],
  ['kyo-front', 0, 1.15, 0.06],
  ['kyo-below', 110, 2.0, -1.45],
];
for (const [name, deg, r, y] of views) {
  await page.evaluate((d, rr, yy) => {
    const { camera, controls } = window.__camera;
    const a = (d * Math.PI) / 180;
    controls.target.set(0, 0, 0);
    camera.position.set(Math.sin(a) * rr, yy, Math.cos(a) * rr);
    controls.update();
  }, deg, r, y);
  await new Promise((res) => setTimeout(res, 700));
  await page.screenshot({ path: `shots/${name}.png` });
}
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
