// Narrows the profile through the head, which the overlay showed is 1.4x too
// deep in the front third while matching at mid-body.
import { execSync } from 'node:child_process';

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

const WARP = 0.09;   // peak shift, as in tools/warp-profile.mjs
const TAPER = 0.38;  // how much to narrow at the very front
const T = [0.000, 0.030, 0.060, 0.090, 0.120, 0.160, 0.200, 0.250, 0.300, 0.350,
  0.400, 0.450, 0.500, 0.550, 0.600, 0.650, 0.700, 0.750, 0.790, 0.830, 0.860,
  0.890, 0.915, 0.940, 0.960, 0.976, 0.990, 1.000];

const rows = T.map((t) => {
  const u = 1 - t;
  const tw = t - WARP * Math.sin(Math.PI * t);
  const m = 1 - TAPER * Math.min(1, Math.max(0, (0.50 - u) / 0.50));
  return [t, sm(P, tw) * m];
});
const pk = Math.max(...rows.map((r) => r[1]));
const norm = rows.map(([t, v]) => [t, +(v / pk).toFixed(3)]);
console.log('const PROFILE_KOI: Profile = [');
console.log(norm.map(([t, v]) => `  [${t.toFixed(3)}, ${v.toFixed(3)}],`).join('\n'));
console.log('];');
