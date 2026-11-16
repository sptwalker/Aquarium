// Prints the koi silhouette radius curve and its first differences, so overshoot
// in the Catmull-Rom interpolation shows up as a number instead of a bump on screen.
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/fish.ts', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('const PROFILE_KOI'), src.indexOf('];', src.indexOf('const PROFILE_KOI')));
const K = [...block.matchAll(/\[([\d.]+),\s*([\d.]+)\]/g)].map(m => [+m[1], +m[2]]);

function smoothProfile(p, t) {
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

const N = 100;
let prev = smoothProfile(K, 0);
let prevD = null;
const rows = [];
for (let i = 1; i <= N; i++) {
  const t = i / N;
  const r = smoothProfile(K, t);
  const d = r - prev;
  const dd = prevD === null ? 0 : d - prevD;
  rows.push({ t: t.toFixed(2), r: r.toFixed(3), d: d.toFixed(4), dd: dd.toFixed(4) });
  prev = r; prevD = d;
}
console.log('t     r      dr     d2r');
for (const x of rows) console.log(`${x.t}  ${x.r}  ${x.d}  ${x.dd}`);
