// Captures the showcase fish from a given azimuth so details can be inspected.
// usage: node tools/angles.mjs [baseUrl]
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

await page.goto(`${base}/showcase.html?species=oranda`, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForFunction('window.__ready === true', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1200));

// freeze the animation so the frames are comparable
await page.evaluate(() => window.__showcase.setPlaying(false));
await new Promise((r) => setTimeout(r, 900));

const views = [
  ['front', 0],
  ['three-quarter', 55],
  ['side', 90],
  ['left', 250],
];
for (const [name, deg] of views) {
  await page.evaluate((d) => {
    const { camera, controls } = window.__camera;
    const r = 2.6;
    const a = (d * Math.PI) / 180;
    camera.position.set(Math.sin(a) * r, 0.30, Math.cos(a) * r);
    controls.update();
  }, deg);
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `shots/angle-${name}.png` });
}
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
