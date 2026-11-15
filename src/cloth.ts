import * as THREE from 'three';

/**
 * Verlet cloth for fin membranes.
 *
 * Simulated in the fish's local space: the root row is pinned to the body's
 * swim wave and everything else hangs off it. Local space keeps the math
 * cheap and stable, while the body's own wave supplies the inertia that makes
 * the membrane lag and whip. A flow term adds trailing when the fish
 * accelerates or turns.
 */

type ClothOpts = {
  /** distance from root to tip in local units, used to scale flutter */
  span: number;
  flutterFreq: number;
  flutterPhase: number;
  flutterAmp: number;
};

export class FinCloth {
  readonly geometry: THREE.BufferGeometry;

  private n: number;

  private rest: Float32Array;
  private pos: Float32Array;
  private prev: Float32Array;
  private pinned: Uint8Array;
  private reach: Float32Array; // 0 at root .. 1 at tip

  private ca: Int32Array;
  private cb: Int32Array;
  private cl: Float32Array;
  private ck: Float32Array;

  private opts: ClothOpts;

  constructor(cols: number, rows: number, rest: Float32Array, pinnedRows: number, opts: ClothOpts) {
    this.n = cols * rows;
    this.opts = opts;

    this.rest = rest;
    this.pos = Float32Array.from(rest);
    this.prev = Float32Array.from(rest);
    this.pinned = new Uint8Array(this.n);
    this.reach = new Float32Array(this.n);

    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const id = i * rows + j;
        if (j < pinnedRows) this.pinned[id] = 1;
        this.reach[id] = j / (rows - 1);
      }
    }

    // constraints: structural, shear, bend
    const a: number[] = [], b: number[] = [], k: number[] = [];
    const push = (i0: number, j0: number, i1: number, j1: number, stiff: number) => {
      if (i1 < 0 || i1 >= cols || j1 < 0 || j1 >= rows) return;
      a.push(i0 * rows + j0);
      b.push(i1 * rows + j1);
      k.push(stiff);
    };
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        push(i, j, i + 1, j, 0.9);
        push(i, j, i, j + 1, 0.9);
        push(i, j, i + 1, j + 1, 0.45);
        push(i, j, i + 1, j - 1, 0.45);
        push(i, j, i + 2, j, 0.10);
        push(i, j, i, j + 2, 0.10);
      }
    }
    this.ca = Int32Array.from(a);
    this.cb = Int32Array.from(b);
    this.ck = Float32Array.from(k);
    this.cl = new Float32Array(a.length);
    for (let c = 0; c < a.length; c++) {
      const oa = a[c] * 3, ob = b[c] * 3;
      const dx = rest[oa] - rest[ob];
      const dy = rest[oa + 1] - rest[ob + 1];
      const dz = rest[oa + 2] - rest[ob + 2];
      this.cl[c] = Math.hypot(dx, dy, dz);
    }

    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(new Float32Array(rest), 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(cols * rows * 2), 2));
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const id = i * rows + j;
        uv.setXY(id, i / (cols - 1), j / (rows - 1));
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < cols - 1; i++) {
      for (let j = 0; j < rows - 1; j++) {
        const p = i * rows + j;
        const q = p + rows;
        idx.push(p, q, p + 1, q, q + 1, p + 1);
      }
    }
    geo.setIndex(idx);
    this.geometry = geo;
  }

  /**
   * @param rootOffset maps a local z to the body's lateral swim offset
   * @param flow       water velocity in fin-local space (i.e. -fish velocity)
   */
  /**
   * Spring-target cloth: each vertex is pulled toward a moving rest pose that
   * already carries the swim wave, the water's lag and the fin's own flutter.
   * Integrating that as a spring (rather than free Verlet) is what keeps a
   * thin membrane stable at real frame rates while still showing inertia.
   *
   * @param rootOffset maps a local z to the body's lateral swim offset
   * @param flow       water velocity in fin-local space (i.e. -fish velocity)
   */
  update(dt: number, time: number, rootOffset: (z: number) => number, flow: THREE.Vector3) {
    const { pos, prev, rest, pinned, n } = this;
    const damp = Math.exp(-dt * 5.0);
    const stiff = Math.min(1, 9.0 * dt);

    // water pressing on the membrane: the tail trails behind the fish
    const lagX = THREE.MathUtils.clamp(flow.x * 0.22, -0.35, 0.35);
    const lagY = THREE.MathUtils.clamp(flow.y * 0.12, -0.20, 0.20);
    const lagZ = THREE.MathUtils.clamp(flow.z * 0.10, -0.16, 0.16);

    const fAmp = this.opts.flutterAmp;
    const fOmega = this.opts.flutterFreq;
    const fPhase = this.opts.flutterPhase;

    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const r = this.reach[i];

      if (pinned[i]) {
        const px = rest[o] + rootOffset(rest[o + 2]);
        pos[o] = px;
        pos[o + 1] = rest[o + 1];
        pos[o + 2] = rest[o + 2];
        prev[o] = px;
        prev[o + 1] = pos[o + 1];
        prev[o + 2] = pos[o + 2];
        continue;
      }

      // travelling wave down the fin, so the membrane ripples instead of
      // moving as one rigid sheet
      const wave = Math.sin(time * fOmega + fPhase - r * 4.2);
      const tx = rest[o] + rootOffset(rest[o + 2]) + lagX * r + wave * fAmp * r;
      const ty = rest[o + 1] + lagY * r;
      const tz = rest[o + 2] + lagZ * r;

      const vx = (pos[o] - prev[o]) * damp;
      const vy = (pos[o + 1] - prev[o + 1]) * damp;
      const vz = (pos[o + 2] - prev[o + 2]) * damp;

      prev[o] = pos[o];
      prev[o + 1] = pos[o + 1];
      prev[o + 2] = pos[o + 2];

      pos[o] += vx + (tx - pos[o]) * stiff;
      pos[o + 1] += vy + (ty - pos[o + 1]) * stiff;
      pos[o + 2] += vz + (tz - pos[o + 2]) * stiff;
    }

    // relaxation
    for (let it = 0; it < 3; it++) {
      for (let c = 0; c < this.ca.length; c++) {
        const ia = this.ca[c], ib = this.cb[c];
        const oa = ia * 3, ob = ib * 3;
        const dx = pos[ob] - pos[oa];
        const dy = pos[ob + 1] - pos[oa + 1];
        const dz = pos[ob + 2] - pos[oa + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-5;
        const diff = ((d - this.cl[c]) / d) * this.ck[c] * 0.5;
        const mx = dx * diff, my = dy * diff, mz = dz * diff;
        if (!pinned[ia]) {
          pos[oa] += mx; pos[oa + 1] += my; pos[oa + 2] += mz;
        }
        if (!pinned[ib]) {
          pos[ob] -= mx; pos[ob + 1] -= my; pos[ob + 2] -= mz;
        }
      }
    }

    const attr = this.geometry.attributes.position as THREE.BufferAttribute;
    (attr.array as Float32Array).set(pos);
    attr.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}
