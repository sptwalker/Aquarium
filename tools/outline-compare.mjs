// Compares the MODEL's outer silhouette against the traced line art.
//
// The render cannot be used for this: perspective foreshortening, the camera's
// distance and the perspective projection all distort the outline, so any
// difference you read off a screenshot is partly the projection. Instead this
// evaluates the exact same profile + axis tables that bodySurface() uses, at
// the side-view extremes (angle = +/-PI/2), and compares the top and bottom
// edges against the traced drawing column by column.
//
// Both are normalised the same way: by body length along x, and by the maximum
// half-depth. Any residual is therefore a genuine shape error, not a scale or
// framing difference.
//
// usage: node tools/outline-compare.mjs [traceJson]
import fs from 'node:fs';

const traceJson = process.argv[2] || 'tools/la-7.json';
const d = JSON.parse(fs.readFileSync(traceJson, 'utf8'));

// ---- model tables, read straight out of the source
const src = fs.readFileSync('src/fish.ts', 'utf8');
const grab = (name) => {
  const i0 = src.indexOf(`const ${name}`);
  const i1 = src.indexOf('];', i0);
  return [...src.slice(i0, i1).matchAll(/\[([-\d.]+),\s*([-\d.]+)\]/g)].map((m) => [+m[1], +m[2]]);
};
const PROF = grab('PROFILE_KOI');
const AX = grab('AXIS_KOI');

// same Catmull-Rom as smoothProfile()
function smooth(K, t) {
  const tt = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < K.length - 2 && tt > K[i + 1][0]) i++;
  const [t1, p1] = K[i];
  const [t2, p2] = K[i + 1];
  const p0 = K[Math.max(0, i - 1)][1];
  const p3 = K[Math.min(K.length - 1, i + 2)][1];
  const s = (tt - t1) / Math.max(1e-6, t2 - t1);
  const s2 = s * s, s3 = s2 * s;
  return 0.5 * (2 * p1 + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2 + (-p0 + 3 * p1 - 3 * p2 + p3) * s3);
}

// Body-space outline: y = cy +/- r*(depth*L), with the muzzle wedge squash.
// Work in units of half-depth, which is what both tables already use.
const squash = (t) => {
  // must mirror fish.ts: the muzzle is not squashed any more
  void t;
  return 1;
};
const modelEdge = (t) => {
  const r = smooth(PROF, t);
  const cy = smooth(AX, t);
  // only the last 1.8% is the round-over cap; stop just before it
  if (t > 0.982) {
    const k = (t - 0.982) / 0.018;
    const r0 = smooth(PROF, 0.982);
    const dome = r0 * Math.max(0.10, Math.pow(Math.max(0, 1 - Math.pow(k, 2.4)), 1 / 2.4));
    const half = dome * squash(t);
    return { top: cy + half, bot: cy - half };
  }
  const half = r * squash(t);
  return { top: cy + half, bot: cy - half };
};

// ---- trace, with the dilation correction and the same normalisation
const DIL = 7 / d.bodyPixels.maxDepth;
const raw = d.stations.map((s) => ({
  t: s.t,
  top: -s.yTop + DIL,
  bot: -s.yBot - DIL,
}));
const sm = (key) => {
  const med = raw.map((_, i) => {
    const w = raw.slice(Math.max(0, i - 2), Math.min(raw.length, i + 3)).map((o) => o[key]).sort((a, b) => a - b);
    return w[Math.floor(w.length / 2)];
  });
  return med.map((_, i) => {
    const w = med.slice(Math.max(0, i - 1), Math.min(med.length, i + 2));
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
};
const sT = sm('top'), sB = sm('bot');
const rMax = Math.max(...sT.map((v, i) => (v - sB[i]) / 2));
const midRef = (sT[Math.round(sT.length / 2)] + sB[Math.round(sB.length / 2)]) / 2;
const traceAt = (t) => {
  const x = t * (sT.length - 1);
  const i = Math.floor(x), f = x - i;
  const a = i, b = Math.min(sT.length - 1, i + 1);
  const top = sT[a] * (1 - f) + sT[b] * f;
  const bot = sB[a] * (1 - f) + sB[b] * f;
  return { top: (top - midRef) / rMax, bot: (bot - midRef) / rMax };
};

// ---- report
let worstTop = 0, worstTopT = 0, worstBot = 0, worstBotT = 0;
let sum = 0, n = 0;
console.log(' t      model top   ref top    d      model bot   ref bot    d');
for (let i = 0; i <= 40; i++) {
  const t = i / 40;
  if (t < 0.04 || t > 0.985) continue;   // both ends are pinned, not measured
  const m = modelEdge(t);
  const r = traceAt(t);
  const dt = m.top - r.top;
  const db = m.bot - r.bot;
  sum += Math.abs(dt) + Math.abs(db); n += 2;
  if (Math.abs(dt) > Math.abs(worstTop)) { worstTop = dt; worstTopT = t; }
  if (Math.abs(db) > Math.abs(worstBot)) { worstBot = db; worstBotT = t; }
  const mark = Math.abs(dt) > 0.03 || Math.abs(db) > 0.03 ? '  <-- ' : '';
  console.log(
    `${t.toFixed(2)}   ${m.top.toFixed(3).padStart(7)}   ${r.top.toFixed(3).padStart(7)}  ${(dt >= 0 ? '+' : '') + dt.toFixed(3)}`
    + `    ${m.bot.toFixed(3).padStart(7)}   ${r.bot.toFixed(3).padStart(7)}  ${(db >= 0 ? '+' : '') + db.toFixed(3)}${mark}`,
  );
}
console.log(`\nmean |error| ${(sum / n).toFixed(4)} half-depths`);
console.log(`worst top     ${worstTop >= 0 ? '+' : ''}${worstTop.toFixed(3)} at t=${worstTopT.toFixed(2)}`);
console.log(`worst bottom  ${worstBot >= 0 ? '+' : ''}${worstBot.toFixed(3)} at t=${worstBotT.toFixed(2)}`);
