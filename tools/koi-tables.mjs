// Builds the koi body tables from BOTH reference views.
//
// The side view gives half-depth along the body and the centreline drift. The
// top view gives half-width. Previously width was a single constant guess —
// `width: 0.072` — which is why the fish still read as too round or too flat
// depending on the angle. A fish's plan view is not a scaled copy of its side
// view: the head stays wide while the body narrows toward the tail, and the
// muzzle is broader than it is deep.
//
// Both drawings are normalised by their own body length, so the two can be
// combined even though they were drawn at different scales.
//
// usage: node tools/koi-tables.mjs [sideJson] [topJson] [dilate]
import fs from 'node:fs';

const sideJson = process.argv[2] || 'tools/side.json';
const topJson = process.argv[3] || 'tools/top.json';
const DIL = Number(process.argv[4] ?? 7);

const load = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

// Gaussian smoothing along u, with weights renormalised at the ends.
//
// The measured series has two kinds of narrow contamination: strokes that cut
// INTO the body (the gill cover line, the eye ring) show up as notches, and
// fins that touch the body (the pectoral root) show up as bumps. Both are only
// a few percent of body length wide, so a Gaussian several times wider than
// them removes them while leaving the genuine curvature alone. Median-of-5 was
// tried first and does nothing here: these artefacts are wider than 2 columns.
//
// Renormalising at the ends instead of clamping keeps the snout converging to
// its real value rather than being dragged up by its neighbours.
function gauss(vals, sigma) {
  const R = Math.ceil(sigma * 3);
  const w = [];
  for (let k = -R; k <= R; k++) w.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  return vals.map((_, i) => {
    let s = 0, ws = 0;
    for (let k = -R; k <= R; k++) {
      const j = i + k;
      if (j < 0 || j >= vals.length) continue;
      s += vals[j] * w[k + R];
      ws += w[k + R];
    }
    return s / ws;
  });
}

// The dilation ate `DIL` px into the body from both sides, so every measured
// half-extent is that much too small. Units: fraction of body length.
function profile(j, sigma) {
  const { cols, x0, x1 } = j;
  const span = x1 - x0;
  const d = DIL / span;
  const raw = cols.map(([x, t, b]) => ({
    u: (x1 - x) / span,               // 0 at the tail end, 1 at the nose
    top: -(t / span) + d,             // image y grows downward, so flip
    bot: -(b / span) - d,
  }))
    // `cols` runs left to right, i.e. NOSE first, so u comes out DESCENDING.
    // `at()` below indexes as if the series were ascending in u, so without
    // this sort every table is mirrored end-for-end — which is exactly what
    // made the muzzle blunt and the mid-body fat at the same time.
    .sort((a, b) => a.u - b.u);
  const top = gauss(raw.map((o) => o.top), sigma);
  const bot = gauss(raw.map((o) => o.bot), sigma);

  // Blend the smoothed series back toward the raw one at both ends.
  //
  // A Gaussian wide enough to erase a gill stroke or a pectoral root (about 3%
  // of body length) also rounds off the snout and the peduncle, which change
  // faster than that. But those ends are exactly where the drawing is reliable
  // — a muzzle converging to a point and a peduncle meeting the tail are not
  // stroke artefacts. So the smoothing is faded out over the first and last 7%,
  // leaving the middle clean and the ends exact.
  const wEnd = raw.map((o) => {
    const e = Math.min(o.u, 1 - o.u);
    return Math.min(1, Math.max(0, e / 0.07));
  });
  const blend = (sm, key) => sm.map((v, i) => v * wEnd[i] + raw[i][key] * (1 - wEnd[i]));
  const topB = blend(top, 'top');
  const botB = blend(bot, 'bot');
  const half = topB.map((v, i) => (v - botB[i]) / 2);
  // The centreline needs its own smoothing: near the tip a column is a single
  // pixel, so mid == that pixel and the axis jumps. Its fade is much shorter
  // (2%) because unlike the half-depth there is nothing to preserve there.
  const rawMid = raw.map((o) => (o.top + o.bot) / 2);
  const midSm = gauss(rawMid, sigma);
  const wEndMid = raw.map((o) => {
    const e = Math.min(o.u, 1 - o.u);
    return Math.min(1, Math.max(0, e / 0.02));
  });
  const mid = midSm.map((v, i) => v * wEndMid[i] + rawMid[i] * (1 - wEndMid[i]));
  const us = raw.map((o) => o.u);
  const at = (arr, u) => {
    const x = u * (us.length - 1);
    const i = Math.floor(x), f = x - i;
    const a = arr[Math.max(0, Math.min(arr.length - 1, i))];
    const b = arr[Math.max(0, Math.min(arr.length - 1, i + 1))];
    return a * (1 - f) + b * f;
  };
  return { at, half, mid, span, d };
}

// sigma in columns; the traces are ~630-650 px long, so 0.030 of the body is
// about 19 columns
const SIGMA = 19;
const S = profile(load(sideJson), SIGMA);
const T = profile(load(topJson), SIGMA);

// reference scale: max half-depth (side) and max half-width (top), in body lengths
const iMaxS = S.half.indexOf(Math.max(...S.half));
const iMaxT = T.half.indexOf(Math.max(...T.half));
const HMAX = S.half[iMaxS];
const WMAX = T.half[iMaxT];

// Centre the axial origin on the mid-body centreline of the side view.
const MID0 = S.at(S.mid, 0.5);

const stations = [
  0.000, 0.040, 0.080, 0.120, 0.160, 0.200, 0.250, 0.300, 0.350,
  0.400, 0.450, 0.500, 0.550, 0.600, 0.650, 0.700, 0.750, 0.790,
  0.830, 0.860, 0.890, 0.915, 0.940, 0.955, 0.970, 0.985, 1.000,
];

const f = (v) => (Math.round(v * 1000) / 1000).toFixed(3);

console.log(`side: span=${S.span}px  maxHalfDepth=${HMAX.toFixed(4)} of body length`);
console.log(`top : span=${T.span}px  maxHalfWidth=${WMAX.toFixed(4)} of body length`);
console.log(`depth/length = ${(2 * HMAX).toFixed(4)}   width/length = ${(2 * WMAX).toFixed(4)}   width/depth = ${(WMAX / HMAX).toFixed(3)}`);
console.log('');

// ---- depth profile (normalised to max half-depth = 1)
console.log('const PROFILE_KOI: Profile = [');
for (const t of stations) console.log(`  [${t.toFixed(3)}, ${f(S.at(S.half, t) / HMAX)}],`);
console.log('];\n');

// ---- width profile (normalised to max half-width = 1)
console.log('const WIDTH_KOI: Profile = [');
for (const t of stations) console.log(`  [${t.toFixed(3)}, ${f(T.at(T.half, t) / WMAX)}],`);
console.log('];\n');

// ---- centreline drift, in half-depths
console.log('const AXIS_KOI: Profile = [');
for (const t of stations) console.log(`  [${t.toFixed(3)}, ${f((S.at(S.mid, t) - MID0) / HMAX)}],`);
console.log('];');
