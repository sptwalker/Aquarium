// Traces fish height/motion over time to diagnose steering regressions.
// usage: node tools/trace.mjs [url]
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5173/';
const ca = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const executablePath = ca.find((p) => existsSync(p));
const browser = await puppeteer.launch({
  executablePath, headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=default'],
  defaultViewport: { width: 1000, height: 600 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForFunction('window.__probe !== undefined', { timeout: 60000 });

const rows = [];
for (let i = 0; i < 20; i++) {
  const s = await page.evaluate(() => window.__probe());
  const ys = s.fish.map((f) => f[1]);
  const zs = s.fish.map((f) => f[2]);
  rows.push({
    t: i * 0.5,
    yMin: +Math.min(...ys).toFixed(2),
    yMax: +Math.max(...ys).toFixed(2),
    zMax: +Math.max(...zs).toFixed(2),
    food: s.foodLive,
    hunger: +s.hungerSum.toFixed(2),
  });
  await new Promise((r) => setTimeout(r, 500));
}
// then click to feed and keep tracing
await page.mouse.click(500, 260);
const after = [];
for (let i = 0; i < 24; i++) {
  const s = await page.evaluate(() => window.__probe());
  const ys = s.fish.map((f) => f[1]);
  after.push({
    t: i * 0.5,
    yMin: +Math.min(...ys).toFixed(2),
    yMax: +Math.max(...ys).toFixed(2),
    food: s.foodLive,
    hunger: +s.hungerSum.toFixed(2),
  });
  await new Promise((r) => setTimeout(r, 500));
}
console.log('--- before click ---');
console.table(rows.filter((_, i) => i % 4 === 0));
console.log('--- after click ---');
console.table(after.filter((_, i) => i % 3 === 0));
await browser.close();
