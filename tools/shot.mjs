// Headless screenshot harness: proves the scene renders without console errors.
// usage: node tools/shot.mjs [url] [out.png] [width] [height] [waitMs]
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5173/';
const out = process.argv[3] || 'shots/aquarium.png';
const width = Number(process.argv[4] || 1600);
const height = Number(process.argv[5] || 900);
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
  args: [
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-angle=default',
    '--hide-scrollbars',
    `--window-size=${width},${height}`,
  ],
  defaultViewport: { width, height, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__ready === true', { timeout: 60000 }).catch(() => {});
await new Promise((r) => setTimeout(r, waitMs));
await page.screenshot({ path: out });
const stats = await page.evaluate(() => window.__stats || null).catch(() => null);
console.log(JSON.stringify({ out, stats, errors }, null, 2));
await browser.close();
if (errors.length) process.exitCode = 2;
