import * as THREE from 'three';

/**
 * Procedural shingle-scale maps.
 *
 * Computing a scale height field inside the fragment shader and differentiating
 * it never worked: any lattice that is max'd per cell has a crease on every
 * cell border, and those creases band together into a visible net. Baking the
 * pattern once into a texture removes the problem entirely — the height field
 * is evaluated on the CPU with no derivative in the shader, and the normal map
 * carries the relief.
 *
 * The pattern tiles seamlessly: a scale that hangs over the right edge is drawn
 * again on the left (and likewise in y), so wrapS/wrapT produce no seam.
 */
export type ScaleMaps = {
  normal: THREE.Texture;
  /** raw height, kept for albedo modulation */
  height: THREE.Texture;
};

const TILE = 512;
// Both counts must be EVEN. The lattice staggers alternate rows by half a
// scale, and that parity has to match across the wrap or the pattern steps at
// the tile boundary — an odd count put a hard vertical line down the flank at
// exactly the seam column.
const COLS = 8;   // scales around the body per tile
const ROWS = 12;  // scale rows per tile

/** Half-width / half-height of one scale, in lattice cells. */
const RX = 0.95;
const RY = 0.72;
/** How much a scale narrows toward its buried end (0 = ellipse). */
const FAN = 0.55;

/**
 * Height of the shingle at tile uv, in [0,1].
 *
 * Max-of-domes — the obvious implementation — is exactly what produced the
 * hexagonal honeycomb. The crease where two equal domes meet is their
 * perpendicular bisector, so three mutually adjacent scales bound a hexagon and
 * the net is unavoidable. Real scales never show that line: at the boundary you
 * see the *rim* of the scale lying on top, not an intersection curve.
 *
 * So each point is won by a single scale and takes only that scale's height.
 * The priority is computed from dy/dx relative to the sample's own lattice cell,
 * never from an absolute cell index — an absolute index cannot wrap, and using
 * one put a hard step at the tile seam.
 *
 * Scales are wide relative to their rows (RX > RY) so each one covers most of
 * the row behind it and only a crescent of its free edge shows, which is the
 * shingled look.
 */
function heightAt(u: number, v: number): number {
  const gu = u * COLS;
  const gv = v * ROWS;
  const bx = Math.floor(gu);
  const by = Math.floor(gv);
  let bestPrio = -1e9;
  let bestH = 0;

  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const cellY = by + dy;

      const shift = ((cellY % 2) + 2) % 2 === 0 ? 0 : 0.5;
      const cx = bx + dx + 0.5 + shift;
      const cy = cellY + 0.5;

      let ddx = gu - cx;
      const ddy = gv - cy;
      if (ddx > COLS * 0.5) ddx -= COLS;
      if (ddx < -COLS * 0.5) ddx += COLS;

      // ---- which scale is on top here.
      //
      // Rows still win on dy: a lower row lies over the one behind it. But
      // WITHIN a row the winner must be the scale whose centre is nearest, not
      // "whichever has the larger dx". The old `dy + dx*0.02` always picked the
      // right-hand neighbour of a pair, so the hand-over happened at that
      // neighbour's left rim — where its own height is zero. The surface height
      // therefore stepped from the left scale's crown straight down to nothing,
      // once per column of the lattice: a dark seam running from back to belly,
      // repeated around the body.
      //
      // Nearest-centre moves the hand-over to the midpoint between two scales,
      // where by symmetry both have the same height. The field is continuous
      // there, and the seam disappears.
      const prio = dy * 10 - Math.abs(ddx);
      if (prio <= bestPrio) continue;

      // Fan flares toward -v, i.e. toward the tail once this is laid on the
      // body (uv.y grows toward the snout). The scale is narrow where the row
      // above buries it and wide at the free rim that overhangs the row behind.
      // Getting this backwards made every scale point at the head, which reads
      // as reversed overlapping.
      const along = Math.min(1, Math.max(0, (RY - ddy) / (2 * RY)));
      const width = RX * (1.0 - FAN + FAN * along * along);
      const nx = ddx / width;
      const ny = ddy / RY;
      const r2 = nx * nx + ny * ny;
      if (r2 >= 1) continue;

      bestPrio = prio;
      bestH = Math.sqrt(1 - r2);
    }
  }
  return bestH;
}

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE;
  c.height = TILE;
  return c;
}

let cached: ScaleMaps | null = null;

export function makeScaleMaps(): ScaleMaps {
  if (cached) return cached;

  // ---- height field
  const height = new Float32Array(TILE * TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      height[y * TILE + x] = heightAt((x + 0.5) / TILE, (y + 0.5) / TILE);
    }
  }

  const sample = (x: number, y: number) => {
    const xi = ((x % TILE) + TILE) % TILE;
    const yi = ((y % TILE) + TILE) % TILE;
    return height[yi * TILE + xi];
  };

  // ---- normal map from the height field (central differences)
  const nCanvas = makeCanvas();
  const nCtx = nCanvas.getContext('2d')!;
  const nImg = nCtx.createImageData(TILE, TILE);
  const strength = 6.0;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const hL = sample(x - 1, y);
      const hR = sample(x + 1, y);
      const hD = sample(x, y - 1);
      const hU = sample(x, y + 1);
      // texture y runs opposite to v, keep the sign consistent with the sampling
      let nx = (hL - hR) * strength;
      let ny = (hD - hU) * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len;
      const o = (y * TILE + x) * 4;
      nImg.data[o] = Math.round((nx * 0.5 + 0.5) * 255);
      nImg.data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      nImg.data[o + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255);
      nImg.data[o + 3] = 255;
    }
  }
  nCtx.putImageData(nImg, 0, 0);

  // ---- height as a grayscale texture, for albedo modulation
  const hCanvas = makeCanvas();
  const hCtx = hCanvas.getContext('2d')!;
  const hImg = hCtx.createImageData(TILE, TILE);
  for (let i = 0; i < TILE * TILE; i++) {
    const v = Math.round(height[i] * 255);
    hImg.data[i * 4] = v;
    hImg.data[i * 4 + 1] = v;
    hImg.data[i * 4 + 2] = v;
    hImg.data[i * 4 + 3] = 255;
  }
  hCtx.putImageData(hImg, 0, 0);

  const mkTex = (canvas: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };

  cached = { normal: mkTex(nCanvas), height: mkTex(hCanvas) };
  return cached;
}
