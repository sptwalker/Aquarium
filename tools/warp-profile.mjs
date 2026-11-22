// Shifts the profile's peak toward the nose with a smooth warp, applied ONCE to
// a clean base table.
//
// Measured with one consistent definition (tools/photo-ratios.mjs):
//   photo   depth/body 0.476, deepest at 0.561 of body from the nose
//   model   depth/body 0.453, deepest at 0.679
// so the peak has to move forward by 0.118 of body length. A warp in u (from
// the nose) of u' = u + A*sin(pi*u) does that while leaving both ends fixed:
// with A = 0.09, u = 0.561 samples u' = 0.650, which is where the current peak
// sits.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const A = 0.09;
const src = execSync('git show HEAD:src/fish.ts', { encoding: 'utf8' });
const i0 = src.indexOf('const PROFILE_KOI');
const i1 = src.indexOf('];', i0);
const P = [...src.slice(i0, i1).matchAll(/\[([-\d.]+),\s*([-\d.]+)\]/g)].map((m) => [+m[1], +m[2]]);

function sm(K, t) {
  const tt = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < K.length - 2 && tt > K[i + 1][0]) i++;
  const [t1, p1] = K[i], [t2, p2] = K[i + 1];
  const p0 = K[Math.max(0, i - 1)][1], p3 = K[Math.min(K.length - 1, i + 2)][1];
  const s = (tt - t1) / Math.max(1e-6, t2 - t1), s2 = s * s, s3 = s2 * s;
  return 0.5 * (2 * p1 + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * s3);
}

const T = [0.000, 0.030, 0.060, 0.090, 0.120, 0.160, 0.200, 0.250, 0.300, 0.350,
  0.400, 0.450, 0.500, 0.550, 0.600, 0.650, 0.700, 0.750, 0.790, 0.830, 0.860,
  0.890, 0.915, 0.940, 0.960, 0.976, 0.990, 1.000];

const rows = T.map((t) => {
  const tw = t - A * Math.sin(Math.PI * t);   // sample further forward
  return [t, sm(P, tw)];
});
const pk = Math.max(...rows.map((r) => r[1]));
const norm = rows.map(([t, v]) => [t, +(v / pk).toFixed(3)]);
const pkT = rows.reduce((b, r) => (r[1] > b[1] ? r : b), rows[0])[0];
console.log(`peak now at t=${pkT.toFixed(3)}  (want 0.439)`);
console.log('const PROFILE_KOI: Profile = [');
console.log(norm.map(([t, v]) => `  [${t.toFixed(3)}, ${v.toFixed(3)}],`).join('\n'));
console.log('];');
