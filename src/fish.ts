import * as THREE from 'three';
import { NOISE, SWIM, ENV, CAUSTIC } from './glsl';
import type { Shared } from './scene';
import { FinCloth } from './cloth';
import { makeScaleMaps } from './scaleTexture';

export type FishSpecies = 'fantail' | 'oranda' | 'ryukin' | 'comet' | 'koi';

type FishStyle = {
  length: number;
  /** relative body depth (half-height / length) */
  depth: number;
  /** relative body width (half-width / length) */
  width: number;
  hueA: THREE.Vector3;
  hueB: THREE.Vector3;
  belly: THREE.Vector3;
  finTint: THREE.Vector3;
  wen: number;
  /** koi livery: white ground with red patches */
  koi: number;
  /** 1 = four barbels at the mouth (koi); 0 = none (goldfish) */
  barbels: number;
};

const STYLES: Record<FishSpecies, FishStyle> = {
  fantail: {
    length: 1.10, depth: 0.205, width: 0.125,
    hueA: new THREE.Vector3(1.0, 0.26, 0.020),
    hueB: new THREE.Vector3(0.92, 0.10, 0.014),
    belly: new THREE.Vector3(1.0, 0.92, 0.82),
    finTint: new THREE.Vector3(1.0, 0.42, 0.18),
    wen: 0.0, koi: 0.0, barbels: 0,
  },
  oranda: {
    length: 1.02, depth: 0.215, width: 0.130,
    hueA: new THREE.Vector3(0.98, 0.21, 0.018),
    hueB: new THREE.Vector3(0.86, 0.07, 0.012),
    belly: new THREE.Vector3(1.0, 0.90, 0.78),
    finTint: new THREE.Vector3(1.0, 0.50, 0.24),
    wen: 1.0, koi: 0.0, barbels: 0,
  },
  ryukin: {
    length: 0.94, depth: 0.220, width: 0.135,
    hueA: new THREE.Vector3(0.97, 0.40, 0.045),
    hueB: new THREE.Vector3(0.88, 0.44, 0.30),
    belly: new THREE.Vector3(1.0, 0.95, 0.88),
    finTint: new THREE.Vector3(1.0, 0.64, 0.38),
    wen: 0.0, koi: 0.0, barbels: 0,
  },
  comet: {
    length: 1.38, depth: 0.150, width: 0.095,
    hueA: new THREE.Vector3(1.0, 0.30, 0.020),
    hueB: new THREE.Vector3(0.97, 0.52, 0.030),
    belly: new THREE.Vector3(1.0, 0.95, 0.87),
    finTint: new THREE.Vector3(1.0, 0.46, 0.16),
    wen: 0.0, koi: 0.0, barbels: 0,
  },
  // Kohaku-type koi: white ground with red-orange patches, four barbels, a
  // slimmer body than a fancy goldfish, and a protruding rostrum.
  koi: {
    length: 1.45, depth: 0.170, width: 0.105,
    hueA: new THREE.Vector3(1.0, 0.30, 0.035),   // the red patches
    hueB: new THREE.Vector3(1.0, 0.47, 0.10),
    belly: new THREE.Vector3(0.96, 0.95, 0.92),  // white ground
    finTint: new THREE.Vector3(0.97, 0.90, 0.84),
    wen: 0.0, koi: 1.0, barbels: 1,
  },
};

// ---------------------------------------------------------------------------
// One parametric surface is the single source of truth for the body, the fin
// roots and the eye sockets. Earlier versions computed each of those from a
// separate closed-form approximation, so any geometry tweak left fins floating
// or eyes sunk inside the head. Everything below samples `bodySurface()`.
// ---------------------------------------------------------------------------

/** Relative radius along the axis: 0 = tail tip, 1 = snout. */
const PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.00, 0.030],
  [0.04, 0.090],
  [0.10, 0.200],   // caudal peduncle
  [0.18, 0.400],
  [0.28, 0.660],
  [0.38, 0.860],
  [0.48, 0.960],
  [0.56, 0.990],   // deepest point, behind the gill cover
  [0.64, 0.985],
  [0.71, 0.950],
  [0.78, 0.895],
  [0.85, 0.845],
  [0.89, 0.775],
  [0.925, 0.660],
  [0.955, 0.500],
  [0.978, 0.330],
  [0.992, 0.190],
  [1.00, 0.110],   // narrow snout: the profile converges instead of ending in a ball
];

function smoothProfile(t: number): number {
  const tt = THREE.MathUtils.clamp(t, 0, 1);
  const K = PROFILE;
  let i = 0;
  while (i < K.length - 2 && tt > K[i + 1][0]) i++;
  const [t1, p1] = K[i];
  const [t2, p2] = K[i + 1];
  const p0 = K[Math.max(0, i - 1)][1];
  const p3 = K[Math.min(K.length - 1, i + 2)][1];
  const s = (tt - t1) / Math.max(1e-6, t2 - t1);
  const s2 = s * s;
  const s3 = s2 * s;
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * s +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * s3
  );
}

/**
 * A point on the body surface.
 *
 * @param t     0 at the tail tip, 1 at the snout
 * @param angle 0 = right flank, PI/2 = back, PI = left flank, -PI/2 = belly
 */
function bodySurface(style: FishStyle, t: number, angle: number): THREE.Vector3 {
  const L = style.length;

  // The snout is a dome, not a disc.
  //
  // Closing the body with a flat cap at t = 1 puts a circle facing the camera,
  // which is why the front of the head was never anything but a flat face. Here
  // the last stretch bends into a hemisphere so the surface curves forward and
  // closes to a point.
  //
  // The two shapes are BLENDED over a window rather than switched at a
  // threshold: a hard switch leaves the radius continuous but its slope not,
  // and that C1 break showed up as a crease ringed around the head.
  const T_DOME = 0.955;
  const BLEND = 0.040;
  const domeW = THREE.MathUtils.smoothstep(t, T_DOME, T_DOME + BLEND);
  const prof = smoothProfile(t);

  let r = prof;
  let z = (t - 0.5) * L;

  if (domeW > 0) {
    const k = Math.min(1, Math.max(0, (t - T_DOME) / (1 - T_DOME)));
    const r0 = smoothProfile(T_DOME);
    // Only the very tip is rounded. The snout itself is a TAPER (see the
    // profile keys): a wide rounded cap made a bulbous nose with no direction,
    // and an almost-pointed tip left nowhere for the mouth to sit. A short
    // taper plus a small round-over reads as a muzzle.
    const tipR = 0.22;
    const domeR = r0 * Math.max(tipR, Math.pow(Math.max(0, 1 - Math.pow(k, 2.2)), 1 / 2.2));
    const zTube = (t - 0.5) * L;
    const zDome = (T_DOME - 0.5) * L + r0 * L * 0.10 * k;
    r = THREE.MathUtils.lerp(prof, domeR, domeW);
    z = THREE.MathUtils.lerp(zTube, zDome, domeW);
  }

  // the lateral midline sits slightly high, so the belly hangs lower than the
  // back rises — a symmetric tube reads as a sausage
  let cy = -r * style.depth * L * 0.06;

  // Snout. The dome above already carries the surface forward and closes it;
  // adding a separate forward push on top of it made the muzzle long and
  // drooping. All that is needed now is a small downward bias so the mouth sits
  // below the eye line rather than dead centre on the nose.
  const snout = Math.exp(-Math.pow((t - 0.90) / 0.055, 2));
  cy -= snout * L * (style.barbels > 0 ? 0.026 : 0.019);

  return new THREE.Vector3(
    Math.cos(angle) * r * style.width * L,
    cy + Math.sin(angle) * r * style.depth * L,
    z,
  );
}

/** Outward unit normal of the body surface, from finite differences. */
function bodyNormal(style: FishStyle, t: number, angle: number): THREE.Vector3 {
  const e = 0.004;
  const dt = bodySurface(style, Math.min(1, t + e), angle)
    .sub(bodySurface(style, Math.max(0, t - e), angle));
  const da = bodySurface(style, t, angle + e).sub(bodySurface(style, t, angle - e));
  const n = new THREE.Vector3().crossVectors(da, dt);
  if (n.lengthSq() < 1e-12) n.set(Math.cos(angle), Math.sin(angle), 0);
  n.normalize();
  // orient outward
  const outward = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
  if (n.dot(outward) < 0) n.negate();
  return n;
}

// ---------------------------------------------------------------------------
// Body mesh
// ---------------------------------------------------------------------------

function buildBodyGeometry(style: FishStyle, segs = 64, radial = 32): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const rows = segs + 1;
  const cols = radial + 1;
  const p = new THREE.Vector3();

  for (let i = 0; i < rows; i++) {
    const t = i / segs;
    for (let j = 0; j < cols; j++) {
      const angle = (j / radial) * Math.PI * 2;
      p.copy(bodySurface(style, t, angle));
      positions.push(p.x, p.y, p.z);

      // Analytic normals straight from the surface function. computeVertexNormals
      // averages the faces that share each vertex, and the seam column (j=0 and
      // j=radial are the same point) belongs to two disconnected fans, so it got
      // two averaged normals and showed up as a hard line down the flank.
      const n = bodyNormal(style, t, angle);
      normals.push(n.x, n.y, n.z);

      uvs.push(j / radial, t);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * cols + j;
      const b = a + cols;
      // Counter-clockwise when seen from outside. The previous order (a, b, a+1)
      // produced inward-facing normals, so the front faces were culled and the
      // far side of the body was visible through it — the model looked
      // transparent, and eyes/tail showed through from the far side.
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }

  // Close both ends. The body is built as an open tube; without these caps the
  // snout and the caudal peduncle are holes, and back-face culling lets you see
  // straight into the fish from the front. That was the last source of the
  // "see the tail through the head" artifact.
  const addCap = (t: number, pointForward: boolean) => {
    const centreIndex = positions.length / 3;
    const c = bodySurface(style, t, 0);
    // collapse the cap centre onto the axis
    const r = smoothProfile(t);
    positions.push(0, -r * style.depth * style.length * 0.06, c.z);
    const n = new THREE.Vector3(0, 0, pointForward ? 1 : -1);
    normals.push(n.x, n.y, n.z);
    uvs.push(0.5, t);

    const rowBase = pointForward ? segs * cols : 0;
    for (let j = 0; j < radial; j++) {
      const v0 = rowBase + j;
      const v1 = rowBase + j + 1;
      // Winding: seen from outside the snout (+z) the ring runs counter-
      // clockwise, so (centre, v0, v1) faces +z. The reverse order faces into
      // the body and gets culled, which is what left a hole at the nose.
      if (pointForward) indices.push(centreIndex, v0, v1);
      else indices.push(centreIndex, v1, v0);
    }
  };
  addCap(1, true);    // snout
  addCap(0, false);   // caudal peduncle

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  return g;
}

// ---------------------------------------------------------------------------
// Fins
// ---------------------------------------------------------------------------

type FinAxis = 'dorsal' | 'anal' | 'pectoral' | 'pelvic';

/**
 * Builds a fin as a grid whose v = 0 row is sampled from the body surface, so
 * the root is always exactly on the skin regardless of how the body changes.
 */
function buildFin(
  style: FishStyle,
  kind: FinAxis,
  side: number,
  segsU = 20,
  segsV = 12,
): THREE.BufferGeometry {
  const L = style.length;
  const rows = segsU + 1;
  const cols = segsV + 1;
  const positions: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];

  // Span along the body axis, in t (0 tail tip .. 1 snout).
  // Pelvic fins sit behind and below the pectorals — a pair on the belly that
  // the model was missing entirely.
  const tSpan: [number, number] =
    kind === 'dorsal' ? [0.30, 0.66]
    : kind === 'anal' ? [0.24, 0.44]
    : kind === 'pectoral' ? [0.60, 0.73]
    : [0.44, 0.56];

  // how tall the fin grows relative to body length
  const maxH =
    kind === 'dorsal' ? L * 0.095
    : kind === 'anal' ? L * 0.065
    : kind === 'pectoral' ? L * 0.058
    : L * 0.050;

  // Root angle on the cross-section. Pectorals and pelvics sit on the flank /
  // ventral flank, mirrored to opposite sides.
  const angle =
    kind === 'dorsal' ? Math.PI / 2
    : kind === 'anal' ? -Math.PI / 2
    : kind === 'pectoral' ? (side > 0 ? -0.42 : Math.PI + 0.42)
    : (side > 0 ? -0.95 : Math.PI + 0.95);

  for (let i = 0; i < rows; i++) {
    const u = i / segsU;
    const t = THREE.MathUtils.lerp(tSpan[0], tSpan[1], u);
    const root = bodySurface(style, t, angle);
    const nrm = bodyNormal(style, t, angle);

    // The fin is a membrane with real width: one in-plane axis runs along the
    // body (the "chord"), the other is how far it extends. A single direction
    // per fin collapsed it to a sliver when seen edge-on.
    let spanDir: THREE.Vector3;
    let chordDir: THREE.Vector3;
    if (kind === 'pectoral') {
      // sweeps back and outward from low on the flank
      spanDir = new THREE.Vector3(side * 0.70, -0.34, -0.62).normalize();
      chordDir = new THREE.Vector3(0, 0, 1);
    } else if (kind === 'pelvic') {
      // hangs down and back, closer to the body than a pectoral
      spanDir = new THREE.Vector3(side * 0.42, -0.80, -0.44).normalize();
      chordDir = new THREE.Vector3(0, 0, 1);
    } else {
      spanDir = nrm.clone();
      chordDir = new THREE.Vector3(0, 0, 1);
    }

    // Blend the span direction toward the surface normal as it leaves the
    // body, so the fin leaves the skin tangentially instead of sticking out
    // of it like a plate, and hugs the flank near the root.
    const rootBlend = nrm.clone().multiplyScalar(0.55).addScaledVector(spanDir, 0.45);

    for (let j = 0; j < cols; j++) {
      const d = j / segsV;                      // 0 root .. 1 tip

      // taper to nothing at both ends of the span so the outline meets the body
      const arc = Math.sin(Math.min(1, Math.max(0, (u - 0.02) / 0.96)) * Math.PI);
      const env = Math.pow(arc, 0.55);

      // Chord width starts at *zero* at the root. That is what welds the fin to
      // the body: at d = 0 every column collapses onto the single sampled skin
      // point, so the root is a line lying on the surface instead of a floating
      // straight edge hovering over a curved flank.
      const chord = maxH * env * Math.pow(d, 0.72) * 1.15;
      const sweepBack = d * d * maxH * 0.55;

      const across = (u - 0.5) * chord;
      const ripple = 1 + 0.05 * Math.sin(u * 23.0) * d;

      // blend the outward direction so the base leaves the skin tangentially
      const dir = new THREE.Vector3()
        .copy(rootBlend)
        .multiplyScalar(1 - d)
        .addScaledVector(spanDir, d)
        .normalize();

      const p = root.clone()
        .addScaledVector(dir, d * maxH * env * ripple)
        .addScaledVector(chordDir, across - sweepBack);

      positions.push(p.x, p.y, p.z);
      uvs.push(u, d);
    }
  }
  for (let i = 0; i < segsU; i++) {
    for (let j = 0; j < segsV; j++) {
      const a = i * cols + j;
      const b = a + cols;
      // same winding correction as the body: outward-facing, so lighting and
      // any back-face culling behave
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildTailCloth(style: FishStyle): FinCloth {
  const L = style.length;
  const cols = 26;
  const rows = 16;
  const span = L * (style.width < 0.11 ? 0.34 : 0.26);
  const rest = new Float32Array(cols * rows * 3);

  for (let i = 0; i < cols; i++) {
    const u = i / (cols - 1);
    const s = u * 2 - 1;
    for (let j = 0; j < rows; j++) {
      const d = j / (rows - 1);
      // fork: the middle of the fan is shallower than the lobes
      const notch = 1 - 0.34 * Math.exp(-s * s * 6.5);
      const z = -L * 0.5 + L * 0.04 - d * span * notch;
      const y = s * Math.pow(d, 0.80) * L * 0.20 * (1 + 0.12 * Math.sin(Math.abs(s) * 2.4));
      const x = s * d * L * 0.070 + d * d * Math.cos(s * 1.9) * L * 0.040;
      const o = (i * rows + j) * 3;
      rest[o] = x;
      rest[o + 1] = y;
      rest[o + 2] = z;
    }
  }
  return new FinCloth(cols, rows, rest, 1, {
    span,
    flutterFreq: 2.6,
    flutterPhase: Math.random() * 6.28,
    flutterAmp: 0.26,
  });
}

// ---------------------------------------------------------------------------

export type FishUniforms = {
  uTime: { value: number };
  uSwimPhase: { value: number };
  uSwimAmp: { value: number };
  uSwimFreq: { value: number };
  uLen: { value: number };
  uCaustic: { value: THREE.Texture | null };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uHueA: { value: THREE.Vector3 };
  uHueB: { value: THREE.Vector3 };
  uBelly: { value: THREE.Vector3 };
  uFinTint: { value: THREE.Vector3 };
  uFinFreq: { value: number };
  uWen: { value: number };
  uKoi: { value: number };
  uMouth: { value: number };
  uScaleNormal: { value: THREE.Texture | null };
  uScaleHeight: { value: THREE.Texture | null };
  uScaleTiling: { value: THREE.Vector2 };
  uTipY: { value: number };
  uTipZ: { value: number };
  uTipRadius: { value: number };
};

export function makeFish(style: FishStyle, shared: Shared): {
  group: THREE.Group;
  uniforms: FishUniforms;
  body: THREE.Mesh;
  tail: FinCloth;
  updateTail: (dt: number, time: number, flow: THREE.Vector3) => void;
} {
  const scaleMaps = makeScaleMaps();
  const uniforms: FishUniforms = {
    uTime: shared.uTime,
    uSwimPhase: { value: Math.random() * 10 },
    uSwimAmp: { value: 0.05 },
    uSwimFreq: { value: 3.0 },
    uLen: { value: style.length },
    uCaustic: shared.uCaustic,
    uSunDir: shared.uSunDir,
    uSunColor: shared.uSunColor,
    uHueA: { value: style.hueA.clone() },
    uHueB: { value: style.hueB.clone() },
    uBelly: { value: style.belly.clone() },
    uFinTint: { value: style.finTint.clone() },
    uFinFreq: { value: 26 },
    uWen: { value: style.wen },
    uKoi: { value: style.koi },
    uMouth: { value: 0 },
    uScaleNormal: { value: scaleMaps.normal },
    uScaleHeight: { value: scaleMaps.height },
    // around, along: enough tiles to give ~30 scale rows on a 1.1-1.45 body
    uScaleTiling: { value: new THREE.Vector2(2, 5) },
    // local y of the snout tip: the mouth is placed relative to this, because
    // the muzzle droops and an absolute y put the cleft on the cheek
    uTipY: { value: bodySurface(style, 1.0, 0).y },
    uTipZ: { value: bodySurface(style, 1.0, 0).z },
    // radius of the snout cap: everything about the mouth is scaled by this,
    // because the cap is tiny and absolute units made the mouth far too big
    uTipRadius: { value: Math.max(1e-3, smoothProfile(1.0) * style.width * style.length) },
  };

  // ---- body
  const bodyMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${NOISE}
      ${SWIM}
      uniform float uMouth;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vLocal;
      varying vec3 vLocalNormal;
      varying vec2 vUv;
      void main(){
        // No mouth geometry: indenting the snout in the mesh produced a ring
        // around the mouth. The gape is painted in the fragment shader.
        vec3 p = swimBend(position);
        vec3 n = swimBendNormal(position, normal);
        vLocal = position;
        vLocalNormal = normal;
        vUv = uv;
        vWorld = (modelMatrix * vec4(p, 1.0)).xyz;
        vNormal = normalize(mat3(modelMatrix) * n);
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE}
      ${ENV}
      ${CAUSTIC}
      uniform vec3 uHueA;
      uniform vec3 uHueB;
      uniform vec3 uBelly;
      uniform float uWen;
      uniform float uKoi;
      uniform float uMouth;
      uniform float uTipY;
      uniform float uTipZ;
      uniform float uTipRadius;
      uniform float uLen;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vLocal;
      varying vec3 vLocalNormal;
      varying vec2 vUv;

      uniform sampler2D uScaleNormal;
      uniform sampler2D uScaleHeight;
      uniform vec2 uScaleTiling;   // (around, along) in tiles

      // Scales come from a baked texture, not from maths in the shader.
      //
      // Four attempts to build the lattice here all failed the same way: a
      // per-cell height field has a crease wherever the cells meet, and
      // differentiating it in the shader turns those creases into a visible
      // hexagonal net (or, once the lattice was shortened to avoid that, into
      // horizontal stripes). The pattern itself is fine — the problem is
      // evaluating and differentiating it per pixel. So it is baked once on the
      // CPU into a normal map and a height map, and this shader just samples.
      vec2 scaleUV(vec3 lp){
        float ang = atan(lp.y, lp.x) / 6.28318 + 0.5;
        float axis = lp.z / max(1e-4, uLen) + 0.5;
        return vec2(ang, axis) * uScaleTiling;
      }

      // Perturb the shading normal using the baked relief, in a tangent frame.
      // The map's +x runs around the body and +y along it, so the two sampled
      // components map straight onto those axes.
      vec3 applyScaleNormal(vec3 N, vec3 lp, float strength, out float hgt){
        vec3 tn = texture2D(uScaleNormal, scaleUV(lp)).xyz * 2.0 - 1.0;
        hgt = texture2D(uScaleHeight, scaleUV(lp)).r;
        vec3 hint = abs(N.y) > 0.92 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
        vec3 T = normalize(cross(N, hint) + 1e-4);   // around the body
        vec3 B = normalize(cross(N, T));             // along the body
        return normalize(N + (T * tn.x + B * tn.y) * strength);
      }

      void main(){
        vec2 uv = vUv;
        vec3 N = normalize(vNormal);
        float along = uv.y;              // 0 tail .. 1 snout
        float up = vLocal.y;             // negative = belly

        // ---- base colour: mottled orange over a pale belly.
        // Sample noise from the 3D position, not uv: uv.x wraps at the flank,
        // and the mismatch showed up as a hard dark patch on the back.
        vec3 lp = vLocal;
        float m1 = fbm3(vec2(lp.x * 3.5 + lp.z * 2.0, lp.y * 6.0 + lp.z * 4.0));
        float m2 = fbm3(vec2(lp.x * 8.0 + lp.z * 5.0, lp.y * 11.0) + 19.0);
        vec3 col = mix(uHueA, uHueB, smoothstep(0.30, 0.80, m1 + m2 * 0.4));
        // slight paling toward the caudal peduncle
        col = mix(col, col * vec3(1.04, 0.95, 0.92), smoothstep(0.55, 0.12, along) * 0.35);

        // ---- koi livery (kohaku): white ground with a few large red patches.
        // Big soft blotches read as koi; the dense noise above reads as a
        // gradient, which is why the koi was coming out plain orange.
        if (uKoi > 0.5) {
          // two octaves at very low frequency: blobs several body-lengths wide
          float b1 = fbm3(vec2(lp.z * 2.6 + 11.0, lp.y * 3.4));
          float b2 = fbm3(vec2(lp.z * 5.1 + 3.0, lp.y * 6.2) + 41.0);
          // "patch" is a reserved word in GLSL
          float blotch = b1 * 0.72 + b2 * 0.28;
          // hard-ish edge: koi patches have crisp menpo borders
          float red = smoothstep(0.46, 0.53, blotch);
          // the back carries the colour; the belly stays white
          red *= smoothstep(-0.35, 0.15, lp.y / max(0.001, uLen * 0.10));
          red *= smoothstep(0.92, 0.80, along);       // white face, red body
          col = mix(vec3(0.95, 0.94, 0.90), uHueA * vec3(1.05, 0.86, 0.80), red);
        }

        // belly: a low, narrow band; gated on height so it cannot climb the
        // head where the surface normals point sideways
        float belly = smoothstep(0.30, 0.92, -up / max(0.001, uLen * 0.20))
                    * smoothstep(0.80, 0.30, along);
        col = mix(col, uBelly, belly * 0.80 * (1.0 - uKoi * 0.55));

        // ---- oranda wen
        // A multiplicative term driven by noise was darkening whole patches of
        // the head (down to 0.46x). Real wen is fleshy growth, so it should
        // read as a gentle bump with a lighter, waxy tone.
        float head = smoothstep(0.78, 0.98, along) * smoothstep(0.95, 0.70, abs(uv.x - 0.5) * 2.0);
        float wenN = uWen * head * fbm3(vec2(lp.z * 12.0, lp.y * 9.0));
        col = mix(col, mix(col, vec3(0.92, 0.55, 0.30), 0.45), wenN * 0.55);

        // ---- shingled scales, sampled from the baked map.
        // no scales on the snout; they run back over the peduncle
        float scaleZone = smoothstep(0.06, 0.20, along) * smoothstep(0.86, 0.72, along);

        float scaleH;                       // filled in by applyScaleNormal
        // The height map darkens the trough where one scale slips under the next;
        // that occlusion is what makes the shingles read as layered.
        {
          float th = texture2D(uScaleHeight, scaleUV(lp)).r;
          col *= mix(0.90, 1.04, th * scaleZone + (1.0 - scaleZone));
        }

        // ---- mouth, painted on the muzzle.
        //
        // Sizing this in absolute units was the whole bug: the mouth ellipse
        // was ~5x the radius of the snout tip, so its "inside" test wrapped
        // around the whole cap and appeared on both cheeks. Everything here is
        // measured in units of the tip radius, and gated on being near the
        // front face in z.
        {
          float tipR = max(0.001, uTipRadius);
          float dx = lp.x / tipR;
          float dy = (lp.y - uTipY) / tipR;
          float dz = (uTipZ - lp.z) / tipR;

          // only the forward-facing cap
          float front = smoothstep(1.10, 0.25, abs(dz));

          // horizontal cleft, wide across, thin vertically, parts with uMouth
          float halfW = 0.80;
          float halfH = 0.085 + uMouth * 0.55;
          float open = smoothstep(halfW, halfW * 0.86, abs(dx))
                     * smoothstep(halfH, halfH * 0.80, abs(dy))
                     * front;

          // Upper lip: a fat roll above the cleft; lower jaw set slightly back.
          float lipY = dy - (halfH + 0.16);
          float upperLip = smoothstep(halfW * 1.05, halfW * 0.70, abs(dx))
                         * smoothstep(0.15, 0.0, abs(lipY)) * step(lipY, 0.0)
                         * front;
          float lipY2 = dy + (halfH + 0.20);
          float lowerJaw = smoothstep(halfW * 0.92, halfW * 0.60, abs(dx))
                         * smoothstep(0.13, 0.0, abs(lipY2)) * step(0.0, lipY2)
                         * front;

          col = mix(col, col * 0.82, upperLip * 0.45);
          col = mix(col, col * 0.90, lowerJaw * 0.28);

          // wet throat: darkest at the centre of the slit
          float depth = smoothstep(1.0, 0.05, length(vec2(dx / halfW, dy / max(0.02, halfH))));
          col = mix(col, mix(vec3(0.060, 0.020, 0.014), vec3(0.006, 0.002, 0.001), depth),
                    open * 0.97);
        }

        // ---- operculum (gill cover).
        //
        // Three things make a gill cover read: the plate itself is a raised
        // crescent, its trailing edge casts a dark slit, and the leading edge
        // catches a highlight. The previous version had a 0.7%-of-body slit,
        // which is sub-pixel at normal viewing distance — effectively invisible.
        {
          // ay: -1 at the belly, +1 at the back
          float ay = lp.y / max(0.001, uLen * 0.135);
          // The edge sweeps forward as it climbs, and curves harder near the
          // belly. A straight stroke reads as a scratch on the paint.
          float gillLine = 0.762 - 0.060 * ay * ay - 0.030 * ay;
          float d = along - gillLine;

          // present across the flank, fading before the dorsal ridge and belly
          float onFlank = smoothstep(1.10, 0.30, abs(ay));

          // the slit: widened to ~2.5% of body length so it survives at
          // distance, and darkest in its middle
          float slit = smoothstep(0.013, 0.0, abs(d)) * onFlank;
          // the cover plate: raised skin forward of the slit
          float plate = smoothstep(0.115, 0.006, d) * smoothstep(-0.012, 0.008, d) * onFlank;
          // a lit ridge where the plate lifts off the body
          float ridge = smoothstep(0.022, 0.002, abs(d + 0.092)) * onFlank;

          col = mix(col, col * 1.12, plate * 0.70);
          col += vec3(0.13, 0.098, 0.078) * ridge * 0.62;
          col = mix(col, vec3(0.055, 0.016, 0.013), slit * 0.92);
        }

        // ---- scale relief, from the baked normal map. Nothing is
        // differentiated per pixel, so no lattice border can spike.
        {
          N = applyScaleNormal(N, lp, 0.75 * scaleZone, scaleH);
        }

        // ---- lighting
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 L = normalize(uSunDir);
        float casc = causticSample(vWorld, uTime);
        float atten = exp(-max(0.0, 4.05 - vWorld.y) * 0.10);

        float ndl = dot(N, L);
        float wrap = clamp((ndl + 0.55) / 1.55, 0.0, 1.0);
        vec3 lit = col * (uSunColor * wrap * (0.14 + 1.35 * casc) * atten
                        + vec3(0.022, 0.036, 0.042));
        // subsurface: flesh glows warm where light passes through
        lit += uHueA * vec3(1.0, 0.30, 0.20)
             * pow(clamp(ndl * 0.5 + 0.5, 0.0, 1.0), 3.0) * 0.30;

        // wet specular: a tight highlight plus a soft sheen
        vec3 H = normalize(L + V);
        float nh = max(0.0, dot(N, H));
        float fres = pow(1.0 - max(0.0, dot(N, V)), 4.0);
        lit += uSunColor * (pow(nh, 190.0) * 1.4 + pow(nh, 26.0) * 0.10);
        vec3 R = reflect(-V, N);
        lit += envColor(R, uSunDir) * fres * 0.30;
        lit += (0.5 + 0.5 * cos(vec3(0.0, 2.1, 4.2) + fres * 4.0)) * fres * 0.06;

        // ---- snout shading: the mouth itself is real geometry, this only
        // darkens the skin immediately around it
        vec2 mp = vec2((uv.x - 0.5) * 2.0, (uv.y - 0.995) * 34.0);
        float mouthHalo = smoothstep(0.55, 0.12, length(vec2(mp.x, mp.y * 1.5)));
        lit *= 1.0 - mouthHalo * 0.35;

        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });

  // ---- fins
  const finMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms,
    vertexShader: /* glsl */ `
      ${SWIM}
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main(){
        vec3 p = swimBend(position);
        vec3 n = swimBendNormal(position, normal);
        vUv = uv;
        vWorld = (modelMatrix * vec4(p, 1.0)).xyz;
        vNormal = normalize(mat3(modelMatrix) * n);
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE}
      ${ENV}
      ${CAUSTIC}
      uniform vec3 uFinTint;
      uniform vec3 uHueA;
      uniform vec3 uHueB;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main(){
        // rays run root -> tip; they give the membrane its structure
        float rays = 0.5 + 0.5 * sin(vUv.x * 150.0);
        rays = mix(0.65, 1.0, rays);
        // the membrane thins toward the trailing edge
        float thin = smoothstep(0.05, 0.95, vUv.y);

        // Root weld: near vUv.y = 0 the fin takes the body's own colour, so the
        // silhouette edge disappears and the fin appears to grow out of the
        // skin instead of being a card laid against it.
        vec3 bodyCol = mix(uHueA, uHueB, 0.45);
        float rootBlend = 1.0 - smoothstep(0.0, 0.28, vUv.y);
        vec3 base = mix(uFinTint, bodyCol, rootBlend * 0.85);
        base *= (0.55 + 0.45 * rays) * (1.0 - 0.22 * thin);

        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 L = normalize(uSunDir);
        float casc = causticSample(vWorld, uTime);
        float atten = exp(-max(0.0, 4.05 - vWorld.y) * 0.10);
        float ndl = abs(dot(N, L));
        float back = pow(max(0.0, dot(-V, L)), 2.0);

        vec3 col = base * (uSunColor * atten * (0.20 + 0.85 * casc) * (0.55 + ndl * 0.65 + back * 0.5));
        col += base * vec3(0.030, 0.045, 0.050);

        // The root is in contact with the body, so it must not pick up the
        // thin-membrane backlight that the free edge does.
        col = mix(col, bodyCol * (uSunColor * atten * (0.18 + 0.8 * casc) * 0.8
                     + vec3(0.024, 0.034, 0.038)), rootBlend);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  // ---- mouth is painted on the body shader (see the `mouth` block there).
  // Separate lip meshes were tried three ways (cone, torus pair, slit quad) and
  // every one of them read as a ring floating in front of the snout, because the
  // snout is a curved surface and the pieces were rigid. Painted on the surface,
  // it cannot detach.

  const group = new THREE.Group();

  const body = new THREE.Mesh(buildBodyGeometry(style), bodyMat);
  body.frustumCulled = false;
  group.add(body);

  // ---- mouth: a real slit on the snout face.
  //
  // Painting it in the body shader kept failing because it had to be located
  // in curved local space and kept wrapping onto the cheeks. A small quad laid
  // just proud of the tip, facing forward, is deterministic: it cannot drift,
  // and it opens with uMouth.
  {
    const tip = bodySurface(style, 1.0, 0);
    // Size the mouth from the snout's own width a little behind the tip, not
    // from the tip cap: the cap is deliberately narrow, so scaling from it made
    // the mouth a dash.
    const snoutR = Math.max(
      1e-3,
      smoothProfile(0.955) * style.width * style.length,
    );
    // a horizontal lens, wider than it is tall
    const halfW = snoutR * 1.15;
    const halfH = snoutR * 0.26;
    const mGeo = new THREE.PlaneGeometry(halfW * 2, halfH * 2, 12, 6);
    const mMat = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uMouth: uniforms.uMouth },
      vertexShader: /* glsl */ `
        uniform float uMouth;
        varying vec2 vUv;
        varying vec3 vW;
        void main(){
          vUv = uv;
          vec3 p = position;
          // part vertically as the jaw drops
          p.y *= 0.55 + uMouth * 1.6;
          vW = (modelMatrix * vec4(p, 1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vW;
        void main(){
          // round the ends of the slit, darken toward the middle
          vec2 c = vUv * 2.0 - 1.0;
          float shape = 1.0 - length(vec2(c.x, c.y * 1.15));
          if (shape < 0.0) discard;
          vec3 col = mix(vec3(0.075, 0.026, 0.020), vec3(0.004, 0.001, 0.001),
                         smoothstep(0.85, 0.05, shape));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.DoubleSide,
    });
    const mouth = new THREE.Mesh(mGeo, mMat);
    // The snout ends in a forward-facing cap, so this quad lies ON that cap,
    // a hair proud of it. Sinking it behind the tip (an earlier attempt) buried
    // the mouth inside the head and left only a sliver visible.
    mouth.position.set(0, tip.y, tip.z + style.length * 0.0015);
    mouth.frustumCulled = false;
    group.add(mouth);
  }

  // caudal fin (cloth-driven)
  const tail = buildTailCloth(style);
  const tailMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main(){
        vUv = uv;
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: finMat.fragmentShader,
  });
  const tailMesh = new THREE.Mesh(tail.geometry, tailMat);
  tailMesh.frustumCulled = false;
  group.add(tailMesh);

  // dorsal, anal, and a pectoral pair
  // Seven fin positions, as a koi actually has: dorsal, caudal, anal, and the
  // pectoral and pelvic pairs. (The pelvic pair was missing entirely.)
  const finSpecs: Array<[FinAxis, number]> = [
    ['dorsal', 0],
    ['anal', 0],
    ['pectoral', 1],
    ['pectoral', -1],
    ['pelvic', 1],
    ['pelvic', -1],
  ];
  for (const [kind, side] of finSpecs) {
    const g = buildFin(style, kind, side || 1);
    const m = new THREE.Mesh(g, finMat);
    m.frustumCulled = false;
    group.add(m);
  }

  // ---- barbels. Koi have FOUR: a long pair at the corners of the upper jaw
  // and a shorter pair under the lower lip. (Six is not a number any cyprinid
  // has; and goldfish varieties carry none at all, which is how you tell them
  // apart, so this only appears when style.barbels is set.)
  if (style.barbels > 0) {
    const barbelMat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vW;
        void main(){
          vN = normalize(mat3(modelMatrix) * normal);
          vW = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${CAUSTIC}
        uniform vec3 uHueA;
        varying vec3 vN; varying vec3 vW;
        void main(){
          vec3 N = normalize(vN);
          vec3 L = normalize(uSunDir);
          float casc = causticSample(vW, uTime);
          float atten = exp(-max(0.0, 4.05 - vW.y) * 0.10);
          float ndl = max(0.0, dot(N, L));
          // Barbels are skin, not bone: tint them from the body colour. A pale
          // mix made them read as wires hanging off the mouth.
          vec3 col = uHueA * vec3(0.95, 0.90, 0.86)
                   * (uSunColor * atten * (0.18 + 0.95 * casc) * (0.40 + ndl * 0.9)
                      + vec3(0.028, 0.034, 0.036));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    // Four barbels: a long pair at the upper-jaw corners, a short pair under the
    // lower lip. They must start *inside* the skin and taper to a point, or they
    // read as orange marks floating on the muzzle.
    // Four barbels: a long pair at the corners of the upper jaw and a short pair
    // under the lower lip. Angle 0 is the flank and -PI/2 is the belly, so the
    // mouth sits at a NEGATIVE angle; using positive values pushed the barbels
    // up onto the cheek at eye level. Each pair is mirrored with PI - a.
    const upA = -0.30, loA = -0.78;
    const barbels: Array<{ t: number; ang: number; len: number; drop: number; out: number }> = [
      { t: 0.972, ang: upA, len: 0.042, drop: -0.35, out: 0.60 },
      { t: 0.972, ang: Math.PI - upA, len: 0.042, drop: -0.35, out: 0.60 },
      { t: 0.980, ang: loA, len: 0.028, drop: -0.65, out: 0.50 },
      { t: 0.980, ang: Math.PI - loA, len: 0.028, drop: -0.65, out: 0.50 },
    ];
    for (const b of barbels) {
      const rootP = bodySurface(style, b.t, b.ang);
      const nrm = bodyNormal(style, b.t, b.ang);
      const L = style.length;
      // Start a little under the surface so the base is buried, then arc out,
      // down and slightly back — the resting pose of a koi barbel.
      const p0 = rootP.clone().addScaledVector(nrm, -L * 0.004);
      const p1 = rootP.clone()
        .addScaledVector(nrm, L * b.out * b.len * 0.55)
        .add(new THREE.Vector3(0, L * b.drop * b.len * 0.35, L * b.len * 0.15));
      const p2 = rootP.clone()
        .addScaledVector(nrm, L * b.out * b.len * 0.95)
        .add(new THREE.Vector3(0, L * b.drop * b.len * 1.25, -L * b.len * 0.30));
      const curve = new THREE.CatmullRomCurve3([p0, p1, p2]);
      // Tapered: radius 1 -> 0.15 along the length, so the tip tapers to a point.
      const segs = 8;
      const radius = L * 0.0042;
      const geo = new THREE.TubeGeometry(curve, segs, radius, 5, false);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        // TubeGeometry lays out segments along u; shrink each ring toward the tip
        const seg = Math.floor(i / 6) / segs;
        const k = 1 - 0.85 * seg;
        const c = curve.getPointAt(Math.min(1, seg));
        pos.setXYZ(i,
          c.x + (pos.getX(i) - c.x) * k,
          c.y + (pos.getY(i) - c.y) * k,
          c.z + (pos.getZ(i) - c.z) * k);
      }
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, barbelMat);
      mesh.frustumCulled = false;
      group.add(mesh);
    }
  }

  // ---- eyes: seated on the surface normal so only the lens cap protrudes
  const eyeT = 0.855;
  const eyeAngle = Math.PI * 0.13;
  // Real goldfish eyes are prominent — roughly 6-7% of body length across.
  // The 0.021 value read as beads, so this is closer to life.
  const eyeR = style.length * 0.036;
  const eyeGeo = new THREE.SphereGeometry(eyeR, 24, 18);
  // Each eye gets its own material so it can carry its outward gaze direction.
  // The old shader derived the pupil direction from sign(N.x) of the sphere's
  // own normal, which flips across the ball and left most of it reading as a
  // flat grey marble.
  const makeEyeMat = (outward: THREE.Vector3) =>
    new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uEyeDir: { value: outward.clone() } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vW;
        void main(){
          vN = normalize(mat3(modelMatrix) * normal);
          vW = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${ENV}
        uniform vec3 uSunDir;
        uniform vec3 uEyeDir;
        varying vec3 vN; varying vec3 vW;
        void main(){
          vec3 N = normalize(vN);
          vec3 V = normalize(cameraPosition - vW);
          vec3 R = reflect(-V, N);

          // how far this point is from the eye's outward axis
          float facing = dot(N, normalize(uEyeDir));
          // big amber iris, smaller dark pupil, thin dark limbal ring
          float iris = smoothstep(0.28, 0.55, facing);
          float pupil = smoothstep(0.86, 0.95, facing);
          float ring = smoothstep(0.30, 0.40, facing) * smoothstep(0.52, 0.44, facing);

          vec3 sclera = vec3(0.80, 0.76, 0.68);
          vec3 irisCol = mix(vec3(0.55, 0.30, 0.05), vec3(0.86, 0.62, 0.16), facing);
          vec3 c = mix(sclera, irisCol, iris);
          c = mix(c, vec3(0.006, 0.005, 0.004), pupil);
          c = mix(c, c * 0.35, ring * 0.85);

          // wet cornea: environment reflection plus a tight key highlight
          c += envColor(R, uSunDir) * 0.30;
          c += vec3(1.0, 0.98, 0.92) * pow(max(0.0, dot(R, uSunDir)), 260.0) * 1.6;
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });

  const eyeNodes: Array<{ mesh: THREE.Mesh; base: THREE.Vector3 }> = [];
  for (const s of [1, -1]) {
    const t = eyeT;
    const ang = s > 0 ? eyeAngle : Math.PI - eyeAngle;
    const surf = bodySurface(style, t, ang);
    const nrm = bodyNormal(style, t, ang);
    // Bury most of the sphere. The head curves away sharply here, so a
    // nominally half-buried ball still shows more than half.
    const centre = surf.clone().addScaledVector(nrm, -eyeR * 0.62);
    const eye = new THREE.Mesh(eyeGeo, makeEyeMat(nrm));
    eye.frustumCulled = false;
    eye.position.copy(centre);
    group.add(eye);
    eyeNodes.push({ mesh: eye, base: centre.clone() });
  }

  // ---- operculum (gill cover) is painted in the body shader, not built as a
  // separate plate. A lifted mesh always showed a seam and read as a strap
  // bolted to the flank; painting it on the shared surface blends perfectly and
  // needs no extra draw call.

  // ---- spine bend (mirrors the GLSL so the cloth and eyes agree)
  const curveAt = (z: number) => {
    const tn = Math.max(0, 1 - (z / uniforms.uLen.value + 0.5));
    const a = 1 - Math.exp(-tn * tn * 1.9);
    const w1 = Math.sin(tn * 5.1 - uniforms.uSwimPhase.value);
    const w2 = Math.sin(tn * 2.3 - uniforms.uSwimPhase.value * 0.5 + 1.7) * 0.30;
    return (w1 + w2) * a * uniforms.uSwimAmp.value;
  };
  const bend = (x: number, z: number): [number, number] => {
    const e = 0.015;
    const dx = (curveAt(z + e) - curveAt(z - e)) / (2 * e);
    const inv = 1 / Math.sqrt(1 + dx * dx);
    return [curveAt(z) + x * inv, z - x * dx * inv];
  };

  const updateTail = (dt: number, time: number, flow: THREE.Vector3) => {
    tail.update(dt, time, bend, flow);
    for (const e of eyeNodes) {
      const [bx, bz] = bend(e.base.x, e.base.z);
      e.mesh.position.set(bx, e.base.y, bz);
    }
  };

  return { group, uniforms, body, tail, updateTail };
}

export { STYLES };
export type { FishStyle };
