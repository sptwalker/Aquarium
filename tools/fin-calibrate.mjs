// Sets the fin scale from ONE robust number: total depth / body length.
//
// Per-region fin measurements kept disagreeing with each other between runs and
// between solves, because they depend on where exactly the full silhouette and
// the body silhouette start and end. The total depth of the full silhouette,
// divided by the BODY's length, is stable and is what the eye judges.
//
// usage: node tools/fin-calibrate.mjs [baseUrl]
import { captureSilhouette } from './silhouette.mjs';

const base = process.argv[2] || 'http://localhost:5173';

const bodyCap = await captureSilhouette(base, 'koi', { all: false });
const allCap = await captureSilhouette(base, 'koi', { all: true });

const span = (cols) => cols[cols.length - 1][0] - cols[0][0];
const depth = (cols) => Math.max(...cols.map(([, t, b]) => b - t));

const bodyLen = span(bodyCap.cols);
const fullDepth = depth(allCap.cols);
const fullDepthBodyNorm = fullDepth / bodyLen;

// The drawing, measured the same way: body length from the body trace, depth
// from the ink envelope (fins included).
console.log(`model  : body length ${bodyLen}px, full depth ${fullDepth}px`);
console.log(`         depth / body-length = ${fullDepthBodyNorm.toFixed(4)}`);
console.log(`drawing: depth / body-length = 0.535 (measured by tools/fin-measure.mjs)`);
const k = 0.535 / fullDepthBodyNorm;
console.log(`\nneeded overall scale on the fins: ~${k.toFixed(3)}`);
console.log('(apply by dividing FIN_TRIM by this factor)');
