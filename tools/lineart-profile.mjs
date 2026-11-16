// Emits a PROFILE_KOI table straight from the traced line art.
//
// Nothing here is eyeballed: it reads tools/la-7.json (the traced body
// silhouette) and resamples it at the stations the body mesh needs, with extra
// resolution through the head because that is where the outline curve changes
// fastest.
import fs from 'node:fs';

const json = process.argv[2] || 'tools/la-7.json';
const DILATE = Number(process.argv[3] ?? 7);
const d = JSON.parse(fs.readFileSync(json, 'utf8'));
const S = d.stations;

// Measured outlines in units of max depth, y up (image y grows downward).
//
// The trace dilated the ink to fuse the fin hatching, which ate DILATE pixels
// into the body from both sides — so every half-depth comes out that much too
// small. Add it back; without this the whole fish renders one dilation-width
// thinner than the drawing, uniformly, which is easy to mistake for a profile
// error.
const D = DILATE / d.bodyPixels.maxDepth;
const raw = S.map((s) => ({
  t: s.t,
  top: -s.yTop + D,
  bot: -s.yBot - D,
}));
raw.forEach((p) => {
  p.mid = (p.top + p.bot) / 2;
  p.r = (p.top - p.bot) / 2;
});

const smooth = (key) => {
  const med = raw.map((_, i) => {
    const w = raw.slice(Math.max(0, i - 2), Math.min(raw.length, i + 3)).map((o) => o[key]).sort((a, b) => a - b);
    return w[Math.floor(w.length / 2)];
  });
  return med.map((_, i) => {
    const w = med.slice(Math.max(0, i - 1), Math.min(med.length, i + 2));
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
};
const sTop = smooth('top');
const sBot = smooth('bot');

// half-depth at each station, in the same units as the raw outline
const sR = sTop.map((v, i) => (v - sBot[i]) / 2);
const sMid = sTop.map((v, i) => (v + sBot[i]) / 2);
const rMax = Math.max(...sR);
// The axis reference is the centreline at mid-body; everything else is
// reported as a drift away from it, in half-depths.
const midRef = sMid[Math.round(sMid.length / 2)];
const at = (arr, t) => {
  const x = t * (arr.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = arr[Math.max(0, Math.min(arr.length - 1, i))];
  const b = arr[Math.max(0, Math.min(arr.length - 1, i + 1))];
  return (a * (1 - f) + b * f) / rMax;
};
const midAt = (t) => {
  const x = t * (sTop.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = (sTop[Math.max(0, Math.min(sTop.length - 1, i))] + sBot[Math.max(0, Math.min(sTop.length - 1, i))]) / 2;
  const b = (sTop[Math.max(0, Math.min(sTop.length - 1, i + 1))] + sBot[Math.max(0, Math.min(sTop.length - 1, i + 1))]) / 2;
  return (a * (1 - f) + b * f) / rMax;
};

// Stations: dense through the head, where the outline turns fastest.
const T = [
  0.000, 0.040, 0.080, 0.120, 0.160, 0.200, 0.250, 0.300, 0.350,
  0.400, 0.450, 0.500, 0.550, 0.600, 0.650, 0.700, 0.750, 0.790,
  0.830, 0.860, 0.890, 0.915, 0.940, 0.960, 0.976, 0.990, 1.000,
];

const fmt = (v) => (Math.round(v * 1000) / 1000).toFixed(3);

console.log(`// rMax=${rMax.toFixed(1)}  depth/length=${d.bodyPixels.depthOverLen}  dilationCorrection=${D.toFixed(3)}`);
console.log('const PROFILE_KOI: Profile = [');
for (const t of T) {
  const r = at(sR, t);
  console.log(`  [${t.toFixed(3)}, ${fmt(r)}],`);
}
console.log('];');
console.log('\n// centreline drift of the body axis, in half-depths (+ = above mid-body centre)');
console.log('const AXIS_KOI: ReadonlyArray<readonly [number, number]> = [');
for (const t of T) {
  console.log(`  [${t.toFixed(3)}, ${fmt((at(sMid, t) * rMax - midRef) / rMax)}],`);
}
console.log('];');

