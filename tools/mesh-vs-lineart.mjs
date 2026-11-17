// Compares the RENDERED model silhouette against the traced line art.
//
// This is the only comparison that cannot lie. The previous tool evaluated the
// profile tables and reported a 0.005 mean residual while the rendered body was
// visibly far too fat — because the tables are an input, and the mesh applies
// its own scaling on top of them. Here both sides are pixel outlines of the
// same kind: one from the drawing, one from an orthographic render of the mesh.
//
// Both are normalised by body length and maximum half-depth, so the numbers are
// shape differences only, with scale and framing divided out.
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync } from 'node:fs';
import { captureSilhouette, normalise } from './silhouette.mjs';

const trace = JSON.parse(readFileSync('tools/lineart.json', 'utf8'));
const DIL = 7 / trace.bodyPixels.maxDepth;
const ref = trace.stations.map((s) => ({
  u: 1 - s.t,                      // trace t: 0 at tail .. 1 at nose
  top: -s.yTop + DIL,
  bot: -s.yBot - DIL,
}));
const sm = (key) => {
  const med = ref.map((_, i) => {
    const w = ref.slice(Math.max(0, i - 2), Math.min(ref.length, i + 3)).map((o) => o[key]).sort((a, b) => a - b);
    return w[Math.floor(w.length / 2)];
  });
  return med.map((_, i) => {
    const w = med.slice(Math.max(0, i - 1), Math.min(med.length, i + 2));
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
};
const rT = sm('top'), rB = sm('bot');
const rMax = Math.max(...rT.map((v, i) => (v - rB[i]) / 2));
const rMid = (rT[Math.round(rT.length / 2)] + rB[Math.round(rB.length / 2)]) / 2;
const refAt = (u) => {
  const x = u * (rT.length - 1);
  const i = Math.floor(x), f = x - i, a = i, b = Math.min(rT.length - 1, i + 1);
  return {
    top: ((rT[a] * (1 - f) + rT[b] * f) - rMid) / rMax,
    bot: ((rB[a] * (1 - f) + rB[b] * f) - rMid) / rMax,
  };
};

const base = process.argv[2] || 'http://localhost:5173';
const species = process.argv[3] || 'koi';
const silh = await captureSilhouette(base, species);
const model = normalise(silh.cols);
// the render faces -x; flip so u = 0 at the tail like the trace
const mAt = (u) => {
  const x = (1 - u) * (model.length - 1);
  const i = Math.floor(x), f = x - i, a = i, b = Math.min(model.length - 1, i + 1);
  return {
    top: model[a].top * (1 - f) + model[b].top * f,
    bot: model[a].bot * (1 - f) + model[b].bot * f,
  };
};

console.log(`rendered depth/length = ${model[0].depthOverLen.toFixed(4)}   line art = ${trace.bodyPixels.depthOverLen}`);
console.log('\n u     model top  ref top    d     model bot  ref bot    d');
let sum = 0, n = 0, wt = 0, wtt = 0, wb = 0, wbt = 0;
for (let i = 0; i <= 60; i++) {
  const u = i / 60;
  if (u < 0.05 || u > 0.95) continue;
  const m = mAt(u), r = refAt(u);
  const dt = m.top - r.top, db = m.bot - r.bot;
  sum += Math.abs(dt) + Math.abs(db); n += 2;
  if (Math.abs(dt) > Math.abs(wt)) { wt = dt; wtt = u; }
  if (Math.abs(db) > Math.abs(wb)) { wb = db; wbt = u; }
  const mark = Math.abs(dt) > 0.08 || Math.abs(db) > 0.08 ? '  <--' : '';
  console.log(`${u.toFixed(2)}  ${m.top.toFixed(3).padStart(8)}  ${r.top.toFixed(3).padStart(7)}  ${((dt >= 0 ? '+' : '') + dt.toFixed(3)).padStart(8)}`
    + `  ${m.bot.toFixed(3).padStart(8)}  ${r.bot.toFixed(3).padStart(7)}  ${((db >= 0 ? '+' : '') + db.toFixed(3)).padStart(8)}${mark}`);
}
console.log(`\nmean |error| ${(sum / n).toFixed(4)}  half-depths`);
console.log(`worst top    ${wt >= 0 ? '+' : ''}${wt.toFixed(3)} at u=${wtt.toFixed(2)}`);
console.log(`worst bottom ${wb >= 0 ? '+' : ''}${wb.toFixed(3)} at u=${wbt.toFixed(2)}`);
if (silh.errors.length) console.log('errors:', silh.errors);
