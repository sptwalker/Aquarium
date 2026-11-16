// Turns the traced line-art outline into a profile table for fish.ts, and
// prints the residual against the profile currently in the source.
//
// The raw trace is noisy at the ends (peduncle cap, where the body meets the
// caudal fin, and where the pelvic fin is folded against the belly), so the
// series is smoothed and only monotone-ish, interior stations are emitted.
import fs from 'node:fs';

const json = process.argv[2] || 'tools/la-7.json';
const d = JSON.parse(fs.readFileSync(json, 'utf8'));
const S = d.stations;

// radius + centreline in units of max depth, y up
const raw = S.map((s) => {
  const top = -s.yTop;      // flip: image y grows downward
  const bot = -s.yBot;
  return { t: s.t, top, bot, mid: (top + bot) / 2, r: (top - bot) / 2 };
});

// median-5 then mean-3, to kill the single-column jumps
const med5 = (arr, k) => arr.map((_, i) => {
  const w = arr.slice(Math.max(0, i - k), Math.min(arr.length, i + k + 1)).map(o => o.r).sort((a, b) => a - b);
  return w[Math.floor(w.length / 2)];
});
const rMed = med5(raw, 2);
const rSm = rMed.map((_, i) => {
  const w = rMed.slice(Math.max(0, i - 1), Math.min(rMed.length, i + 2));
  return w.reduce((a, b) => a + b, 0) / w.length;
});

// normalise by the largest radius of the smoothed series
const rMax = Math.max(...rSm.map(Math.abs));
const prof = raw.map((p, i) => ({ t: p.t, r: rSm[i] / rMax, mid: p.mid }));

// the mid-line: a carp's axis is nearly straight; report its drift
const midTail = prof[3].mid, midHead = prof[prof.length - 4].mid;

console.log(`rMax=${rMax.toFixed(2)}px  depth/len=${d.bodyPixels.depthOverLen}`);
console.log(`centreline drift tail->head: ${(midHead - midTail).toFixed(1)}px over ${d.bodyPixels.bodyLen}px length`);
console.log('\n t      r      (r as fraction of max radius)');

// emit stations at a spacing that resolves the head
const wanted = [
  0.00, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40,
  0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.78, 0.81,
  0.84, 0.87, 0.90, 0.93, 0.96, 0.98, 1.00,
];
const out = [];
for (const t of wanted) {
  let i = Math.round(t * (raw.length - 1));
  i = Math.max(0, Math.min(prof.length - 1, i));
  const r = prof[i].r;
  out.push([t, +r.toFixed(3)]);
  console.log(`${t.toFixed(2)}   ${r.toFixed(3)}`);
}

console.log('\n// ---- generated stations, paste into PROFILE_KOI');
console.log('const PROFILE_KOI_TRACED: Profile = [');
for (const [t, r] of out) console.log(`  [${t.toFixed(3)}, ${r.toFixed(3)}],`);
console.log('];');

// ---- residual against the shipped profile
const src = fs.readFileSync('src/fish.ts', 'utf8');
const block = src.slice(src.indexOf('const PROFILE_KOI'), src.indexOf('];', src.indexOf('const PROFILE_KOI')));
const K = [...block.matchAll(/\[([\d.]+),\s*([\d.]+)\]/g)].map((m) => [+m[1], +m[2]]);

function smooth2(p, t) {
  const tt = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < p.length - 2 && tt > p[i + 1][0]) i++;
  const [t1, p1] = p[i];
  const [t2, p2] = p[i + 1];
  const p0 = p[Math.max(0, i - 1)][1];
  const p3 = p[Math.min(p.length - 1, i + 2)][1];
  const s = (tt - t1) / Math.max(1e-6, t2 - t1);
  const s2 = s * s, s3 = s2 * s;
  return 0.5 * (2 * p1 + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2 + (-p0 + 3 * p1 - 3 * p2 + p3) * s3);
}

let worst = 0, worstT = 0;
console.log('\n t     traced  shipped  diff');
for (const [t, r] of out) {
  if (t <= 0.03 || t >= 0.99) continue;
  const sh = smooth2(K, t);
  const dd = sh - r;
  if (Math.abs(dd) > Math.abs(worst)) { worst = dd; worstT = t; }
  console.log(`${t.toFixed(2)}  ${r.toFixed(3)}   ${sh.toFixed(3)}   ${dd >= 0 ? '+' : ''}${dd.toFixed(3)}`);
}
console.log(`\nworst residual: ${worst >= 0 ? '+' : ''}${worst.toFixed(3)} at t=${worstT}`);
