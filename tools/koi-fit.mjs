// Compares the rendered koi silhouette against the NEW side-view trace.
//
// Same normalisation as mesh-vs-lineart.mjs (body length along x, half-depth
// along y), but reading tools/side.json — the reference the user just supplied.
import { readFileSync } from 'node:fs';
import { captureSilhouette, normalise } from './silhouette.mjs';

const DIL = 7;
const side = JSON.parse(readFileSync('tools/side.json', 'utf8'));
const { cols, x0, x1 } = side;
const span = x1 - x0;
const d = DIL / span;

// u = 0 at the peduncle end, 1 at the nose, ascending
const raw = cols.map(([x, t, b]) => ({
  u: (x1 - x) / span,
  top: -(t / span) + d,
  bot: -(b / span) - d,
})).sort((a, b) => a.u - b.u);

const gauss = (v, sig) => {
  const R = Math.ceil(sig * 3), w = [];
  for (let k = -R; k <= R; k++) w.push(Math.exp(-(k * k) / (2 * sig * sig)));
  return v.map((_, i) => {
    let s = 0, ws = 0;
    for (let k = -R; k <= R; k++) {
      const j = i + k;
      if (j < 0 || j >= v.length) continue;
      s += v[j] * w[k + R]; ws += w[k + R];
    }
    return s / ws;
  });
};
const SIG = 19;
const smT = gauss(raw.map((o) => o.top), SIG);
const smB = gauss(raw.map((o) => o.bot), SIG);
const wEnd = raw.map((o) => Math.min(1, Math.max(0, Math.min(o.u, 1 - o.u) / 0.07)));
const top = smT.map((v, i) => v * wEnd[i] + raw[i].top * (1 - wEnd[i]));
const bot = smB.map((v, i) => v * wEnd[i] + raw[i].bot * (1 - wEnd[i]));

const half = top.map((v, i) => (v - bot[i]) / 2);
const mid = top.map((v, i) => (v + bot[i]) / 2);
const rMaxH = Math.max(...half);
const midRef = mid[Math.round(mid.length / 2)];
const refAt = (u) => {
  const x = u * (half.length - 1);
  const i = Math.floor(x), f = x - i, a = i, b = Math.min(half.length - 1, i + 1);
  const h = half[a] * (1 - f) + half[b] * f;
  const m = mid[a] * (1 - f) + mid[b] * f;
  return { top: (m - midRef + h) / rMaxH, bot: (m - midRef - h) / rMaxH };
};

const base = process.argv[2] || 'http://localhost:5173';
const silh = await captureSilhouette(base, 'koi');
const model = normalise(silh.cols);
const mAt = (u) => {
  const x = (1 - u) * (model.length - 1);
  const i = Math.floor(x), f = x - i, a = i, b = Math.min(model.length - 1, i + 1);
  return {
    top: model[a].top * (1 - f) + model[b].top * f,
    bot: model[a].bot * (1 - f) + model[b].bot * f,
  };
};

console.log(`model depth/length ${model[0].depthOverLen.toFixed(4)}   side-view ${(2 * rMaxH).toFixed(4)}`);
console.log('\n u     model top  ref top    d     model bot  ref bot    d');
let sum = 0, n = 0, wt = 0, wtt = 0, wb = 0, wbt = 0;
for (let i = 0; i <= 60; i++) {
  const u = i / 60;
  if (u < 0.05 || u > 0.95) continue;
  const m = mAt(u), r = refAt(u);
  const dt = m.top - r.top, db = m.bot - r.bot;
  sum += Math.abs(dt) + Math.abs(db); n += 2;
  if (Math.abs(dt) > Math.abs(wt)) { wt = dt; wtt = u; }
  if (Math.abs(db) > Math.abs(wb)) { wb = db; wbt = u; }
  const mark = Math.abs(dt) > 0.06 || Math.abs(db) > 0.06 ? '  <--' : '';
  console.log(`${u.toFixed(2)}  ${m.top.toFixed(3).padStart(8)}  ${r.top.toFixed(3).padStart(7)}  ${((dt >= 0 ? '+' : '') + dt.toFixed(3)).padStart(8)}`
    + `  ${m.bot.toFixed(3).padStart(8)}  ${r.bot.toFixed(3).padStart(7)}  ${((db >= 0 ? '+' : '') + db.toFixed(3)).padStart(8)}${mark}`);
}
console.log(`\nmean |error| ${(sum / n).toFixed(4)} half-depths`);
console.log(`worst top    ${wt >= 0 ? '+' : ''}${wt.toFixed(3)} at u=${wtt.toFixed(2)}`);
console.log(`worst bottom ${wb >= 0 ? '+' : ''}${wb.toFixed(3)} at u=${wbt.toFixed(2)}`);
