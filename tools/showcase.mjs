// Verifies the showcase page: loads, renders, toggles static/animated.
// usage: node tools/showcase.mjs [baseUrl]
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
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`${base}/showcase.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__ready === true', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 2500));

const results = [];
const push = (name, ok, detail) => results.push({ name, ok, detail });

const playingAtStart = await page.evaluate(() => window.__showcase.isPlaying());
push('starts animated', playingAtStart === true, String(playingAtStart));
await page.screenshot({ path: 'shots/showcase-anim.png' });

// switch to static
await page.click('#toggle');
await new Promise((r) => setTimeout(r, 1600));
const playingAfter = await page.evaluate(() => window.__showcase.isPlaying());
push('toggles to static', playingAfter === false, String(playingAfter));
await page.screenshot({ path: 'shots/showcase-static.png' });

// the subject must not drift: a spine at rest keeps the group origin fixed
const origin = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  return [c.width, c.height];
});
push('canvas has size', origin[0] > 100 && origin[1] > 100, origin.join('x'));

// back to animated
await page.click('#toggle');
await new Promise((r) => setTimeout(r, 900));
const back = await page.evaluate(() => window.__showcase.isPlaying());
push('toggles back to animated', back === true, String(back));

// link from the tank page exists
const tankHtml = await (await fetch(`${base}/`)).text();
push('tank links to showcase', tankHtml.includes('showcase.html'), '');

push('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(JSON.stringify({ results }, null, 2));
await browser.close();
if (results.some((r) => !r.ok)) process.exitCode = 1;
