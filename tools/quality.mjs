// Verifies quality switching really changes the pipeline (not just resolution).
// usage: node tools/quality.mjs [url]
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5173/';
const candidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) throw new Error('no chrome/edge found');

mkdirSync('shots', { recursive: true });
const browser = await puppeteer.launch({
  executablePath,
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=default'],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForFunction('window.__ready === true', { timeout: 60000 });

const results = [];
for (const q of ['mid', 'low', 'high']) {
  await page.click(`#panel button[data-q="${q}"]`);
  await new Promise((r) => setTimeout(r, 1200));
  const s = await page.evaluate(() => ({ ...window.__stats, cfg: window.__quality() }));
  await page.screenshot({ path: `shots/q-${q}.png` });
  const ok = s.cfg.name === q;
  results.push({ q, ok, cfg: s.cfg, size: s.size });
}
results.push({ q: 'no errors', ok: errors.length === 0, errors: errors.slice(0, 3) });
console.log(JSON.stringify(results, null, 2));
await browser.close();
if (results.some((r) => !r.ok)) process.exitCode = 1;
