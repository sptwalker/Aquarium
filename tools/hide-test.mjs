// Hides parts of the fish and screenshots, to attribute a defect to an object.
// usage: node tools/hide-test.mjs <mode> <out>   mode: keep|nofins|notail|bodyonly
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
const mode = process.argv[2] || 'keep';
const out = process.argv[3] || 'shots/hide.png';
const ca=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const executablePath=ca.find(p=>existsSync(p));
const b=await puppeteer.launch({executablePath,headless:'new',args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=default'],defaultViewport:{width:1600,height:900}});
const p=await b.newPage();
await p.goto('http://localhost:5173/showcase.html?species=koi',{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForFunction('window.__ready===true',{timeout:60000});
await new Promise(r=>setTimeout(r,800));
const info = await p.evaluate((mode)=>{
  const s = window.__showcase;
  if (!s || !s.group) return {err:'no handle'};
  const body = s.body;
  let hidden = 0, shown = 0;
  s.group.children.forEach((c)=>{
    if (!c.isMesh) return;
    if (c === body) return;
    // fins and the caudal cloth are everything else
    if (mode === 'nofins') { c.visible = false; hidden++; }
    if (mode === 'bodyonly') { c.visible = false; hidden++; }
  });
  if (mode === 'bodyonly') { /* body stays visible */ }
  return {children: s.group.children.length, hidden};
}, mode);
await p.evaluate(()=>{
  const {camera,controls}=window.__camera;
  controls.target.set(0,0,0);
  camera.position.set(2.6, 0.1, 0.0);
  controls.update();
});
await new Promise(r=>setTimeout(r,600));
await p.screenshot({path:out});
console.log(JSON.stringify({out,info}));
await b.close();
