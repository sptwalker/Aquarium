// Captures the koi in DEFAULT (animated) mode, matching what the user sees.
//
// Every previous capture paused the showcase first (setPlaying(false)), which
// straightens the body and settles the cloth. The user is looking at the live
// page, so the two views were never the same thing to compare.
// usage: node tools/koi-live.mjs [baseUrl] [outPrefix]
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';

const base = process.argv[2] || 'http://localhost:5173';
const out = process.argv[3] || 'shots/live-side.png';
const ca = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath = ca.find((p) => existsSync(p));
const browser = await puppeteer.launch({
  executablePath, headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=default'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`${base}/showcase.html?species=koi`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__ready === true', { timeout: 60000 });
// NO setPlaying(false): leave it animated, exactly like the page the user opens.
await new Promise((r) => setTimeout(r, 1500));

await page.evaluate(() => {
  const { camera, controls } = window.__camera;
  const a = Math.PI / 2;
  controls.target.set(0, 0, 0);
  camera.position.set(Math.sin(a) * 2.6, 0.10, Math.cos(a) * 2.6);
  controls.update();
});
await new Promise((r) => setTimeout(r, 800));
mkdirSync('shots', { recursive: true });
await page.screenshot({ path: out });
console.log(JSON.stringify({ out, errors }, null, 2));
await browser.close();
