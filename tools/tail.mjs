// Verifies the tail cloth actually moves, stays attached, and stays bounded.
// usage: node tools/tail.mjs [url]
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5173/';
const candidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) throw new Error('no chrome/edge found');

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
await page.waitForFunction('window.__tail !== undefined', { timeout: 60000 });

const samples = [];
for (let i = 0; i < 24; i++) {
  await new Promise((r) => setTimeout(r, 150));
  const s = await page.evaluate(() => window.__tail());
  if (s) samples.push(s);
}

const results = [];
const push = (name, ok, detail) => results.push({ name, ok, detail });

// tail must never blow up: local-space extents stay within the fin's scale
const spanX = Math.max(...samples.map((s) => s.max[0] - s.min[0]));
const spanZ = Math.max(...samples.map((s) => s.max[2] - s.min[2]));
push('tail stays bounded', spanX < 2.0 && spanZ < 2.0, `spanX=${spanX.toFixed(3)} spanZ=${spanZ.toFixed(3)}`);

// the tip must actually move over time (cloth is alive, not frozen)
const tips = samples.map((s) => s.tip[1]);
const tipRange = Math.max(...tips) - Math.min(...tips);
push('tail tip oscillates', tipRange > 0.01, `tipY range=${tipRange.toFixed(4)}`);

// ...and it must stay attached near the body, not drift away
const maxAbs = Math.max(...samples.flatMap((s) => s.tip.map(Math.abs)));
push('tail stays attached', maxAbs < 2.5, `max|tip|=${maxAbs.toFixed(3)}`);

push('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(JSON.stringify({ results, first: samples[0], last: samples[samples.length - 1] }, null, 2));
await browser.close();
if (results.some((r) => !r.ok)) process.exitCode = 1;
