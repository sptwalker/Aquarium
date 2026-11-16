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
const COLS = 9;   // scales around the body per tile
const ROWS = 11;  // scale rows per tile

/** Signed height in [0,1] for the scale lattice, evaluated at tile uv. */
function heightAt(u: number, v: number): number {
  const gu = u * COLS;
  const gv = v * ROWS;
  let best = 0;

  // Check the 3x3 neighbourhood, wrapping indices so the tile is seamless.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cellX = Math.floor(gu) + dx;
      const cellY = Math.floor(gv) + dy;

      // stagger alternate rows by half a scale
      const shift = ((cellY % 2) + 2) % 2 === 0 ? 0 : 0.5;
      const cx = cellX + 0.5 + shift;
      // the visual centre sits high in the cell so the free edge (bottom of the
      // scale, pointing at the tail) hangs over the row beneath it
      const cy = cellY + 0.40;

      // work in wrapped cell space so the seam matches
      let ddx = gu - cx;
      let ddy = gv - cy;
      // take the shortest wrapped distance
      if (ddx > COLS * 0.5) ddx -= COLS;
      if (ddx < -COLS * 0.5) ddx += COLS;
      if (ddy > ROWS * 0.5) ddy -= ROWS;
      if (ddy < -ROWS * 0.5) ddy += ROWS;

      // Scale is a disc wider than it is tall; radius spans about 1.2 cells so
      // neighbours always overlap and only crescents stay visible.
      const rx = ddx / 1.10;
      const ry = ddy / 1.34;
      const r2 = rx * rx + ry * ry;
      if (r2 < 1) {
        // domed surface: raised in the middle, dropping to zero at the rim
        const h = Math.sqrt(1 - r2);
        if (h > best) best = h;
      }
    }
  }
  return best;
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
