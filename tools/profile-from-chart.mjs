// Builds PROFILE_KOI / AXIS_KOI from the numbers read off the user's overlay
// chart (tools/read-chart.mjs), normalised by each curve's own maximum.
//
// Only the range where the extraction is clean (x = 20..86) is taken from the
// chart; the head and the peduncle were contaminated by the chart's red
// annotation arrows, so those follow the same trend and the reference photo.
import fs from 'node:fs';

// t is measured from the TAIL (fish.ts convention); x is % from the nose.
const P = [
  // peduncle: the reference trunk ends at 0.35 of max half-depth, NOT a point.
  [0.000, 0.300],
  [0.010, 0.335],
  [0.040, 0.360],
  [0.080, 0.435],
  [0.140, 0.558],
  [0.200, 0.680],
  [0.250, 0.770],
  [0.300, 0.850],
  [0.350, 0.915],
  [0.400, 0.973],
  [0.440, 1.000],
  [0.470, 0.996],
  [0.500, 0.986],
  [0.550, 0.938],
  [0.600, 0.884],
  [0.650, 0.800],
  [0.700, 0.680],
  [0.750, 0.548],
  [0.800, 0.408],
  // head: the chart says 0.408 at x=20 and the model had 0.525 there, so the
  // muzzle narrows from here to a small tip.
  [0.850, 0.300],
  [0.900, 0.215],
  [0.950, 0.130],
  [0.980, 0.072],
  [1.000, 0.030],
];

// Midline: the chart's own mid values, normalised by the reference's max half.
const AX = [
  [0.000, -0.204],
  [0.080, -0.245],
  [0.140, -0.211],
  [0.200, -0.170],
  [0.300, -0.088],
  [0.400, 0.020],
  [0.440, 0.050],
  [0.500, 0.068],
  [0.600, 0.061],
  [0.700, 0.034],
  [0.800, -0.007],
  [0.850, -0.030],
  [0.900, -0.050],
  [0.950, -0.040],
  [1.000, -0.010],
];

const fmt = (rows) => rows.map(([t, v]) => `  [${t.toFixed(3)}, ${v.toFixed(3)}],`).join('\n');
console.log('const PROFILE_KOI: Profile = [\n' + fmt(P) + '\n];');
console.log('const AXIS_KOI: Profile = [\n' + fmt(AX) + '\n];');

const src = fs.readFileSync('src/fish.ts', 'utf8');
let s = src;
const i0 = s.indexOf('const PROFILE_KOI: Profile = [');
const i1 = s.indexOf('];', i0) + 2;
s = s.slice(0, i0) + 'const PROFILE_KOI: Profile = [\n' + fmt(P) + '\n];' + s.slice(i1);
const j0 = s.indexOf('const AXIS_KOI: Profile = [');
const j1 = s.indexOf('];', j0) + 2;
s = s.slice(0, j0) + 'const AXIS_KOI: Profile = [\n' + fmt(AX) + '\n];' + s.slice(j1);
fs.writeFileSync('src/fish.ts', s);
console.error('written to src/fish.ts');
