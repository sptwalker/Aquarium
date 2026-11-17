// Measures the MODEL's fin projections the same way tools/fin-measure.mjs
// measures the drawing's.
//
// Two orthographic captures of the same fish are differenced: the full
// silhouette (all meshes) minus the body-only silhouette. Whatever sticks out
// beyond the body is fin, in body-length units, at the same stations as the
// drawing measurement. That makes the two directly comparable, so the fin sizes
// can be set from data instead of eyeballed.



import { captureSilhouette } from './silhouette.mjs';

const base = process.argv[2] || 'http://localhost:5173';

// Same normalisation as fin-measure: u from the nose, height in body lengths.
const desk = (cols) => {
  const x0 = cols[0][0], x1 = cols[cols.length - 1][0];
  const len = x1 - x0;
  const mid = (() => { const c = cols[Math.floor(cols.length / 2)]; return (c[1] + c[2]) / 2; })();
  return cols.map(([x, t, b]) => ({
    u: (x - x0) / len,
    top: (mid - t) / len,
    bot: (mid - b) / len,
  }));
};

const all = await captureSilhouette(base, 'koi', { all: true });
const body = await captureSilhouette(base, 'koi', { all: false });
const A = desk(all.cols);
const B = desk(body.cols);

// The two renders are framed identically and the fish is the same, so u lines up.
// Resample the body onto the full silhouette's u and take the difference.
const bodyAt = (u) => {
  let best = B[0], bd = 1e9;
  for (const p of B) { const d = Math.abs(p.u - u); if (d < bd) { bd = d; best = p; } }
  return best;
};

const rows = A.map((p) => {
  const q = bodyAt(p.u);
  return { u: p.u, finAbove: p.top - q.top, finBelow: q.bot - p.bot };
});

const runs = (key, thr) => {
  const out = [];
  let cur = null;
  for (const r of rows) {
    if (r[key] > thr) {
      if (!cur) cur = { u0: r.u, u1: r.u, peak: 0, peakU: 0 };
      cur.u1 = r.u;
      if (r[key] > cur.peak) { cur.peak = r[key]; cur.peakU = r.u; }
    } else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.filter((c) => c.u1 - c.u0 > 0.02);
};

console.log('MODEL fin projections (body-length units, u from the nose)');
console.log('');
console.log('above the body:');
for (const c of runs('finAbove', 0.012)) {
  console.log(`  u ${c.u0.toFixed(2)}–${c.u1.toFixed(2)}   peak ${c.peak.toFixed(3)} at u=${c.peakU.toFixed(2)}`);
}
console.log('below the body:');
for (const c of runs('finBelow', 0.012)) {
  console.log(`  u ${c.u0.toFixed(2)}–${c.u1.toFixed(2)}   peak ${c.peak.toFixed(3)} at u=${c.peakU.toFixed(2)}`);
}

let maxD = 0;
for (const p of A) maxD = Math.max(maxD, p.top - p.bot);
console.log('');
console.log(`model full depth/length ${maxD.toFixed(4)}`);

