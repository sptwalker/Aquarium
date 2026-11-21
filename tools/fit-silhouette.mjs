// Builds PROFILE_KOI / AXIS_KOI from the traced drawing by fitting the BACK and
// BELLY curves directly, with isotonic regression so neither can wobble.
//
// The previous tables were a half-depth curve and a centreline curve, each
// smoothed on its own. Their sum is the silhouette, and independent smoothing of
// two curves does not keep their sum smooth: small residual wiggles in each add
// up wherever they happen to oppose, which put two dips in the belly.
//
// A fish's silhouette is unimodal — the belly rises steadily from mid-body to
// the snout, the back falls steadily. Any local extremum in the trace is noise
// (a gill stroke, a fin root interrupting the outline). Isotonic regression
// enforces that shape, so the result cannot dip.
//
// usage: node tools/fit-silhouette.mjs
import fs from 'node:fs';

const trace = JSON.parse(fs.readFileSync('tools/side.json', 'utf8'));
const { cols, x0, x1 } = trace;
const DIL = 7;                       // px eaten by the ink dilation

// u from the nose (0) to the peduncle (1); y up, in pixels
const raw = cols.map(([x, t, b]) => ({
  u: (x1 - x) / (x1 - x0),
  top: -(t) + DIL,
  bot: -(b) - DIL,
})).sort((a, b) => a.u - b.u);

// Pool Adjacent Violators: least-squares monotone fit.

// Smooth the two curves that actually define the silhouette, not the two
// derived parameters. The belly is U-shaped over the whole body (deepest near
// mid-body) so isotonic regression would flatten it; a Gaussian of about 4% of
// the length removes the local wiggles while keeping the global shape.
function gauss(vals, sigmaPx) {
  const R = Math.ceil(sigmaPx * 3);
  const w = [];
  for (let k = -R; k <= R; k++) w.push(Math.exp(-(k * k) / (2 * sigmaPx * sigmaPx)));
  return vals.map((_, i) => {
    let s2 = 0, ws = 0;
    for (let k = -R; k <= R; k++) {
      const j = i + k;
      if (j < 0 || j >= vals.length) continue;
      s2 += vals[j] * w[k + R]; ws += w[k + R];
    }
    return s2 / ws;
  });
}
const SIG = 26;   // columns; the trace is ~650 px long, so this is ~4% of length
const belly = gauss(gauss(raw.map((r) => r.bot), SIG), SIG);
const back = gauss(gauss(raw.map((r) => r.top), SIG), SIG);

const at = (arr, u) => {
  const x = u * (arr.length - 1);
  const i = Math.floor(x), f = x - i;
  const a = arr[Math.max(0, Math.min(arr.length - 1, i))];
  const b = arr[Math.max(0, Math.min(arr.length - 1, i + 1))];
  return a * (1 - f) + b * f;
};

// Convert u-from-nose to t-from-tail.
const STATIONS = [
  0.000, 0.030, 0.060, 0.090, 0.120, 0.160, 0.200, 0.250, 0.300,
  0.350, 0.400, 0.450, 0.500, 0.550, 0.600, 0.650, 0.700, 0.750,
  0.790, 0.830, 0.860, 0.890, 0.915, 0.940, 0.960, 0.976, 0.990, 1.000,
];

// Units: pixels for now; normalise so the deepest half-depth is 1.
const samples = STATIONS.map((t) => {
  const u = 1 - t;
  return { t, back: at(back, u), belly: at(belly, u) };
});
const halfAt = (s) => (s.back - s.belly) / 2;
const maxHalf = Math.max(...samples.map(halfAt));

console.log(' t     back     belly    halfH   axis');
const prof = [], axis = [];
for (const s of samples) {
  const half = halfAt(s) / maxHalf;
  const mid = ((s.back + s.belly) / 2 - (samples[0].back + samples[0].belly) / 2) / maxHalf;
  prof.push([s.t, +half.toFixed(3)]);
  axis.push([s.t, +mid.toFixed(3)]);
  console.log(s.t.toFixed(3), s.back.toFixed(0).padStart(8), s.belly.toFixed(0).padStart(8),
    half.toFixed(3).padStart(7), mid.toFixed(3).padStart(7));
}

// verify: the belly must be monotone
let dips = 0, worst = 0;
for (let i = 1; i < samples.length; i++) {
  const d = samples[i].belly - samples[i - 1].belly;
  if (d < 0) { dips++; worst = Math.min(worst, d); }
}
console.log(`\nbelly monotonicity: ${dips} decreasing steps (worst ${worst.toFixed(0)}px)`);

console.log('\nconst PROFILE_KOI: Profile = [');
console.log(prof.map(([t, v]) => `  [${t.toFixed(3)}, ${v.toFixed(3)}],`).join('\n'));
console.log('];');
console.log('\nconst AXIS_KOI: Profile = [');
console.log(axis.map(([t, v]) => `  [${t.toFixed(3)}, ${v.toFixed(3)}],`).join('\n'));
console.log('];');
