// Renders the baked scale maps straight to PNG so the pattern can be judged on
// its own, without the fish shading on top of it. Minimal PNG writer on zlib.
import fs from 'node:fs';
import zlib from 'node:zlib';

const TILE = 512, COLS = 8, ROWS = 12;
const MODE = process.argv[2] ?? 'prio';
const SIGN = Number(process.argv[3] ?? 1);
const RXX = Number(process.argv[4] ?? 0.62);
const RYY = Number(process.argv[5] ?? 0.80);
const FAN = Number(process.argv[6] ?? 0.55);

/**
 * Winner-takes-all shingle lattice.
 *
 * Max-of-domes was the hexagonal honeycomb: the crease between two identical
 * domes is the perpendicular bisector, and three of those meeting is a hexagon.
 * Real scales never show that line, because what you see at the boundary is the
 * *rim* of the overlapping scale, not an intersection curve.
 *
 * So each point is assigned to one scale — the one that overlaps it from above —
 * and takes that scale's height. The pick is made by a relative priority
 * (dy, dx from the sample's own cell), never an absolute cell index: an absolute
 * index cannot wrap, and using one puts a hard step at the tile seam.
 */
function heightAt(u, v) {
  const gu = u * COLS, gv = v * ROWS;
  const bx = Math.floor(gu), by = Math.floor(gv);
  let bestPrio = -1e9, bestH = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const cellX = bx + dx;
    const cellY = by + dy;
    const shift = ((cellY % 2) + 2) % 2 === 0 ? 0 : 0.5;
    const cx = cellX + 0.5 + shift;
    const cy = cellY + 0.5;
    let ddx = gu - cx, ddy = gv - cy;
    if (ddx > COLS / 2) ddx -= COLS;
    if (ddx < -COLS / 2) ddx += COLS;

    const prio = SIGN * (dy + dx * 0.02);
    if (prio <= bestPrio) continue;

    // Fan flares toward -v (toward the tail on the fish): narrow where the
    // scale is buried under the row above, wide at its exposed free rim.
    const along = Math.min(1, Math.max(0, (RYY - ddy) / (2 * RYY)));  // 1 at the free rim
    const width = RXX * (1.0 - FAN + FAN * along * along);
    const nx = ddx / width;
    const ny = ddy / RYY;
    const r2 = nx * nx + ny * ny;
    if (r2 >= 1) continue;
    const h = Math.sqrt(1 - r2);
    bestPrio = prio;
    bestH = h;
  }
  return bestH;
}

const H = new Float32Array(TILE * TILE);
for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++)
  H[y * TILE + x] = heightAt((x + 0.5) / TILE, (y + 0.5) / TILE);

function png(w, h, rgb) {
  const crcTable = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cr]);
  };
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// height map, plus a lit preview using the same normal construction as the shader
const sample = (x, y) => H[(((y % TILE) + TILE) % TILE) * TILE + (((x % TILE) + TILE) % TILE)];
const s = 6.0;
const out = Buffer.alloc(TILE * TILE * 3);
for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
  let nx = (sample(x - 1, y) - sample(x + 1, y)) * s;
  let ny = (sample(x, y - 1) - sample(x, y + 1)) * s;
  const nz = 1, len = Math.hypot(nx, ny, nz);
  nx /= len; ny /= len;
  // lambert against a light from upper-left
  const l = Math.max(0, nx * -0.55 + ny * 0.55 + (nz / len) * 0.62);
  const v = Math.round(40 + l * 200);
  const o = (y * TILE + x) * 3;
  out[o] = v; out[o + 1] = v; out[o + 2] = v;
}
fs.writeFileSync(new URL('../shots/scale-preview.png', import.meta.url), png(TILE, TILE, out));
console.log('wrote shots/scale-preview.png');
