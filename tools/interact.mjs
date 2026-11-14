// Interaction smoke test: click the tank, expect food to spawn, then expect a
// fish to eat it (hunger drops). Fails loudly if the loop is broken.
// usage: node tools/interact.mjs [url]
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
await page.waitForFunction('window.__ready === true', { timeout: 60000 });
await page.waitForFunction('window.__probe !== undefined', { timeout: 60000 }).catch(() => {});

const before = await page.evaluate(() => window.__probe());
// click near the middle of the tank: that ray hits the water surface
await page.mouse.click(640, 330);
await new Promise((r) => setTimeout(r, 400));
const afterClick = await page.evaluate(() => window.__probe());

const results = [];
const push = (name, ok, detail) => results.push({ name, ok, detail });

push('food spawns on click', afterClick.foodLive > before.foodLive, `${before.foodLive} -> ${afterClick.foodLive}`);

// let fish hunt
let fed = false;
let hungerAfter = 0;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 250));
  const s = await page.evaluate(() => window.__probe());
  hungerAfter = s.hungerSum;
  if (s.foodLive === 0 || s.hungerSum < before.hungerSum - 0.05) { fed = true; break; }
}
push('a fish eats the food', fed, `hunger ${before.hungerSum.toFixed(2)} -> ${hungerAfter.toFixed(2)}`);

// moving the mouse should make fish curious (focus rises for at least one)
await page.mouse.move(500, 300);
await page.mouse.move(700, 320, { steps: 25 });
await new Promise((r) => setTimeout(r, 900));
const curious = await page.evaluate(() => window.__probe());
push('fish react to the cursor', curious.focusSum > 0.01, `focus ${curious.focusSum.toFixed(3)}`);

push('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(JSON.stringify({ results, final: curious }, null, 2));
await browser.close();
if (results.some((r) => !r.ok)) process.exitCode = 1;
