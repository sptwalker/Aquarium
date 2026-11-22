// Rebuilds PROFILE_KOI so the body is as deep as the reference photo and its
// deepest point sits where the photo's does.
//
// Reference (tools/ref-shape.mjs on pic/ref-goldfish.jpg):
//   depth / body-length = 0.570,  deepest point 69.5% back from the nose
// Model before this: 0.372 and 54.3% back — 35% too shallow, peaked too far
// forward. That is the "body should be wider" note.
//
// A multiplicative warp of the curve was tried first and moved the peak only
// 0.02 because the warp is near-identity where the peak is. Adding a Gaussian
// bulge in the rear half moves the peak without touching the head or the tail.
import fs from 'node:fs';

const src = fs.readFileSync('src/fish.ts', 'utf8');
const i0 = src.indexOf('const PROFILE_KOI');
const i1 = src.indexOf('];', i0);
const P = [...src.slice(i0, i1).matchAll(/\[([-\d.]+),\s*([-\d.]+)\]/g)].map((m) => [+m[1], +m[2]]);

function smooth(K, t) {
  const tt = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < K.length - 2 && tt > K[i + 1][0]) i++;
  const [t1, p1] = K[i], [t2, p2] = K[i + 1];
  const p0 = K[Math.max(0, i - 1)][1], p3 = K[Math.min(K.length - 1, i + 2)][1];
  const s = (tt - t1) / Math.max(1e-6, t2 - t1), s2 = s * s, s3 = s2 * s;
  return 0.5 * (2 * p1 + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * s3);
}

const BUMP_T = 0.44;   // where the bulge is centred (t from the tail)
const BUMP_W = 0.20;   // its width
const BUMP_A = 0.30;   // its height

const STATIONS = [0.000, 0.030, 0.060, 0.090, 0.120, 0.160, 0.200, 0.250, 0.300,
  0.350, 0.400, 0.450, 0.500, 0.550, 0.600, 0.650, 0.700, 0.750, 0.790, 0.830,
  0.860, 0.890, 0.915, 0.940, 0.960, 0.976, 0.990, 1.000];

const rows = STATIONS.map((t) => {
  const base = smooth(P, t);
  const g = Math.exp(-Math.pow((t - BUMP_T) / BUMP_W, 2));
  return [t, base + BUMP_A * g];
});
const peak = Math.max(...rows.map((r) => r[1]));
const norm = rows.map(([t, r]) => [t, +(r / peak).toFixed(3)]);
const peakT = rows.find((r) => r[1] === peak)[0];

console.log(`peak now at t = ${peakT.toFixed(3)}  (target 0.305)`);
console.log('const PROFILE_KOI: Profile = [');
console.log(norm.map(([t, r]) => `  [${t.toFixed(3)}, ${r.toFixed(3)}],`).join('\n'));
console.log('];');
