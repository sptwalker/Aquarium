import * as THREE from 'three';
import { NOISE, SWIM, ENV, CAUSTIC } from './glsl';
import type { Shared } from './scene';
import { FinCloth } from './cloth';

export type FishSpecies = 'fantail' | 'oranda' | 'ryukin' | 'comet';

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
};

const STYLES: Record<FishSpecies, FishStyle> = {
  fantail: {
    length: 1.10, depth: 0.205, width: 0.125,
    hueA: new THREE.Vector3(1.0, 0.26, 0.020),
    hueB: new THREE.Vector3(0.92, 0.10, 0.014),
    belly: new THREE.Vector3(1.0, 0.92, 0.82),
    finTint: new THREE.Vector3(1.0, 0.42, 0.18),
    wen: 0.0,
  },
  oranda: {
    length: 1.02, depth: 0.215, width: 0.130,
    hueA: new THREE.Vector3(0.98, 0.21, 0.018),
    hueB: new THREE.Vector3(0.86, 0.07, 0.012),
    belly: new THREE.Vector3(1.0, 0.90, 0.78),
    finTint: new THREE.Vector3(1.0, 0.50, 0.24),
    wen: 1.0,
  },
  ryukin: {
    length: 0.94, depth: 0.220, width: 0.135,
    hueA: new THREE.Vector3(0.97, 0.40, 0.045),
    hueB: new THREE.Vector3(0.88, 0.44, 0.30),
    belly: new THREE.Vector3(1.0, 0.95, 0.88),
    finTint: new THREE.Vector3(1.0, 0.64, 0.38),
    wen: 0.0,
  },
  comet: {
    length: 1.38, depth: 0.150, width: 0.095,
    hueA: new THREE.Vector3(1.0, 0.30, 0.020),
    hueB: new THREE.Vector3(0.97, 0.52, 0.030),
    belly: new THREE.Vector3(1.0, 0.95, 0.87),
    finTint: new THREE.Vector3(1.0, 0.46, 0.16),
    wen: 0.0,
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
  [0.48, 0.965],
  [0.56, 1.000],   // deepest point, behind the gill cover
  [0.64, 0.995],
  [0.71, 0.950],
  [0.78, 0.865],
  [0.85, 0.735],
  [0.91, 0.580],
  [0.96, 0.380],
  [1.00, 0.075],   // blunt snout
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
  let r = smoothProfile(t);
  const z = (t - 0.5) * L;
  // the lateral midline sits slightly high, so the belly hangs lower than the
  // back rises — a symmetric tube reads as a sausage
  let cy = -r * style.depth * L * 0.06;

  // Mouth: a smooth radial depression at the very tip. Doing it here, in the
  // one surface function, means the surrounding skin stays watertight — an
  // earlier version indented only the lower half of the snout in the mesh and
  // left a raised ring around the mouth.
  const mouthK = THREE.MathUtils.smoothstep(t, 0.93, 1.0);
  if (mouthK > 0) {
    // narrow toward the angle pointing forward-ish; deepest at the tip
    const funnel = mouthK * mouthK * (0.55 + 0.45 * Math.max(0, Math.cos(angle)));
    r *= 1 - funnel * 0.55;
    cy += funnel * style.depth * L * 0.05;
  }

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
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Fins
// ---------------------------------------------------------------------------

type FinAxis = 'dorsal' | 'anal' | 'pectoral';

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

  // span of the fin along the body axis, in t
  const tSpan: [number, number] =
    kind === 'dorsal' ? [0.30, 0.66] : kind === 'anal' ? [0.24, 0.44] : [0.60, 0.73];

  // how tall the fin grows relative to body length
  const maxH = kind === 'dorsal' ? L * 0.095 : kind === 'anal' ? L * 0.065 : L * 0.058;

  // Root angle. Pectorals sit low on the flank, just behind the gill cover;
  // at the midline they ended up drawn across the cheek and the eye.
  const angle =
    kind === 'dorsal' ? Math.PI / 2
    : kind === 'anal' ? -Math.PI / 2
    : side > 0 ? -0.42 : Math.PI + 0.42;

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
  uMouth: { value: number };
};

export function makeFish(style: FishStyle, shared: Shared): {
  group: THREE.Group;
  uniforms: FishUniforms;
  body: THREE.Mesh;
  tail: FinCloth;
  updateTail: (dt: number, time: number, flow: THREE.Vector3) => void;
} {
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
    uMouth: { value: 0 },
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
      varying vec2 vUv;
      void main(){
        // No mouth geometry: indenting the snout in the mesh produced a ring
        // around the mouth. The gape is painted in the fragment shader.
        vec3 p = swimBend(position);
        vec3 n = swimBendNormal(position, normal);
        vLocal = position;
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
      uniform float uMouth;
      uniform float uLen;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vLocal;
      varying vec2 vUv;

      // Scalloped scale cells on a cylindrical lattice. The angle is derived
      // from the local position rather than the UV, so the pattern is
      // continuous where the UV wraps — sampling it in uv space left a seam
      // running down the flank.
      float scaleSheen(vec3 lp, out float cellRand){
        float ang = atan(lp.y, lp.x) / 6.28318 + 0.5;
        vec2 g = vec2(ang * 34.0, lp.z * 30.0);
        g.x += step(1.0, mod(floor(g.y), 2.0)) * 0.5;
        float row = floor(g.y);
        // wrap the column count so the last cell meets the first
        float col = mod(floor(g.x), 34.0);
        vec2 f = fract(g) - 0.5;
        float d = length(vec2(f.x * 1.15, f.y));
        cellRand = fract(sin(dot(vec2(col, row), vec2(12.9898, 78.233))) * 43758.5453);
        return smoothstep(0.55, 0.20, d);
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

        // belly: a low, narrow band; gated on height so it cannot climb the
        // head where the surface normals point sideways
        float belly = smoothstep(0.30, 0.92, -up / max(0.001, uLen * 0.20))
                    * smoothstep(0.80, 0.30, along);
        col = mix(col, uBelly, belly * 0.80);

        // ---- oranda wen
        // A multiplicative term driven by noise was darkening whole patches of
        // the head (down to 0.46x). Real wen is fleshy growth, so it should
        // read as a gentle bump with a lighter, waxy tone.
        float head = smoothstep(0.78, 0.98, along) * smoothstep(0.95, 0.70, abs(uv.x - 0.5) * 2.0);
        float wenN = uWen * head * fbm3(vec2(lp.z * 12.0, lp.y * 9.0));
        col = mix(col, mix(col, vec3(0.92, 0.55, 0.30), 0.45), wenN * 0.55);

        // ---- faint scale sheen (very low contrast; the relief is in the normal)
        float cellRand;
        float sm = scaleSheen(vLocal, cellRand);
        sm *= smoothstep(0.10, 0.28, along) * smoothstep(0.94, 0.72, along);
        col *= 0.982 + 0.030 * sm;
        col = mix(col, col * vec3(1.02, 1.0, 0.98), sm * 0.14 * cellRand);

        // ---- normal relief, same cylindrical lattice
        {
          float ang = atan(vLocal.y, vLocal.x) / 6.28318 + 0.5;
          vec2 g = vec2(ang * 34.0, vLocal.z * 30.0);
          g.x += step(1.0, mod(floor(g.y), 2.0)) * 0.5;
          vec2 f = fract(g) - 0.5;
          float d = length(vec2(f.x * 1.15, f.y));
          vec2 dir = normalize(f + 1e-5);
          float amp = smoothstep(0.50, 0.18, d) * 0.14 * sm;
          // Stable tangent frame: cross(N, up) degenerates to zero where N is
          // parallel to up (the very top of the back), which spiked the normals
          // into dark blotches. Fall back to a second axis near the pole.
          vec3 hint = abs(N.y) > 0.92 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
          vec3 T = normalize(cross(N, hint) + 1e-4);
          vec3 B = normalize(cross(N, T));
          N = normalize(N + (T * dir.x + B * dir.y) * amp);
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

  // ---- mouth: two lips meeting at a slit, not a funnel.
  // A cone always reads as a beak; goldfish have a thick upper lip and a
  // slightly receding lower jaw. Each lip is a half-torus arc pressed onto the
  // snout, and uMouth rotates them apart around the slit.
  const lipR = style.length * 0.019;      // arc radius
  const lipThick = style.length * 0.0055; // how fat the lip roll is
  const lipMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      uniform float uMouth;
      varying vec3 vN;
      varying vec3 vW;
      varying float vSide;
      void main(){
        vec3 p = position;
        // local y > 0 is the upper lip; open by pushing each away from the slit
        float sign_ = p.y >= 0.0 ? 1.0 : -1.0;
        p.y += sign_ * uMouth * 0.020;
        vSide = sign_;
        vN = normalize(mat3(modelMatrix) * normal);
        vW = (modelMatrix * vec4(p, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE}
      ${CAUSTIC}
      uniform vec3 uHueA;
      uniform vec3 uHueB;
      uniform float uMouth;
      varying vec3 vN;
      varying vec3 vW;
      varying float vSide;
      void main(){
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vW);
        vec3 L = normalize(uSunDir);
        float casc = causticSample(vW, uTime);
        float atten = exp(-max(0.0, 4.05 - vW.y) * 0.10);
        float ndl = max(0.0, dot(N, L));
        float fres = pow(1.0 - max(0.0, dot(N, V)), 3.0);

        // fleshy lip: same family as the body, only slightly warmer. Mixing
        // toward a pale pink made them read as white blobs stuck on the snout.
        vec3 lipCol = mix(uHueA, uHueB, 0.35) * vec3(1.06, 0.72, 0.62);
        // the inner edge, facing the slit, is dark and wet
        float inner = smoothstep(0.25, 0.85, -vSide * N.y);
        lipCol = mix(lipCol, vec3(0.16, 0.045, 0.035), inner * 0.85);

        vec3 col = lipCol * (uSunColor * (0.14 + 1.1 * casc) * atten * (0.45 + ndl * 0.7)
                          + vec3(0.030, 0.040, 0.044));
        // wet rim highlight
        col += uSunColor * pow(max(0.0, dot(reflect(-L, N), V)), 90.0) * 0.55;
        col += lipCol * fres * 0.20;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const group = new THREE.Group();

  // Build both lips from one arc: a half torus spanning the top, mirrored for
  // the bottom. Each is capped at the corners so the slit closes properly.
  const lipArc = new THREE.TorusGeometry(lipR, lipThick, 10, 26, Math.PI);
  lipArc.rotateZ(Math.PI / 2);   // arc opens toward -y: an upper lip
  const lipArcLower = lipArc.clone();
  lipArcLower.rotateZ(Math.PI);  // mirror to make the lower lip

  const snoutTip = bodySurface(style, 0.995, 0);
  const snoutN = bodyNormal(style, 0.995, 0);

  for (const [arc, up] of [[lipArc, 1], [lipArcLower, -1]] as const) {
    const lip = new THREE.Mesh(arc, lipMat);
    lip.frustumCulled = false;
    // Press the lip onto the snout: the far side of the arc is pushed back into
    // the head, so only the forward-facing roll is visible.
    // Seat the lip so it is mostly embedded in the snout; only the forward
    // roll shows. Sunk deeper than it protrudes, or it reads as a ring glued on.
    lip.position.set(0, snoutTip.y * 0.72, snoutTip.z - style.length * 0.016);
    lip.lookAt(snoutTip.clone().add(snoutN.clone().multiplyScalar(3)));
    lip.rotateY(Math.PI);          // face out of the snout
    lip.position.y += up * lipR * 0.42;
    group.add(lip);
  }

  // Dark slit between the lips, so the closed mouth still reads as a mouth.
  const slitGeo = new THREE.CircleGeometry(lipR * 0.72, 20);
  const slitMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      uniform float uMouth;
      varying vec2 vUv;
      varying vec3 vW;
      void main(){
        vUv = uv;
        // stretch vertically as the jaw opens
        vec3 p = position;
        p.y *= 0.30 + uMouth * 1.5;
        vW = (modelMatrix * vec4(p, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uMouth;
      varying vec2 vUv;
      varying vec3 vW;
      void main(){
        vec2 c = vUv - 0.5;
        float edge = smoothstep(0.5, 0.16, length(vec2(c.x, c.y * 1.3)));
        vec3 col = mix(vec3(0.020, 0.006, 0.005), vec3(0.12, 0.03, 0.02), edge);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const slit = new THREE.Mesh(slitGeo, slitMat);
  slit.position.set(0, snoutTip.y * 0.72, snoutTip.z - style.length * 0.020);
  slit.lookAt(snoutTip.clone().add(snoutN.clone().multiplyScalar(3)));
  slit.rotateY(Math.PI);
  group.add(slit);

  const body = new THREE.Mesh(buildBodyGeometry(style), bodyMat);
  body.frustumCulled = false;
  group.add(body);

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
  const finSpecs: Array<[FinAxis, number]> = [
    ['dorsal', 0],
    ['anal', 0],
    ['pectoral', 1],
    ['pectoral', -1],
  ];
  for (const [kind, side] of finSpecs) {
    const g = buildFin(style, kind, side || 1);
    const m = new THREE.Mesh(g, finMat);
    m.frustumCulled = false;
    group.add(m);
  }

  // ---- eyes: seated on the surface normal so only the lens cap protrudes
  const eyeT = 0.855;
  const eyeAngle = Math.PI * 0.13;
  // small relative to the head: bulbs at the old scale read as googly eyes
  const eyeR = style.length * 0.021;
  const eyeGeo = new THREE.SphereGeometry(eyeR, 20, 16);
  const eyeMat = new THREE.ShaderMaterial({
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
      ${ENV}
      uniform vec3 uSunDir;
      varying vec3 vN; varying vec3 vW;
      void main(){
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vW);
        vec3 R = reflect(-V, N);
        // pupil looks along the outward axis of the eye
        float pupil = smoothstep(0.55, 0.90, dot(N, normalize(vec3(sign(N.x) * 0.98, 0.05, 0.18))));
        vec3 iris = mix(vec3(0.46, 0.24, 0.04), vec3(0.78, 0.52, 0.12), 1.0 - pupil);
        vec3 c = mix(iris, vec3(0.010), pupil);
        c += envColor(R, uSunDir) * 0.45;
        c += vec3(1.0) * pow(max(0.0, dot(R, uSunDir)), 380.0) * 1.8;
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
    // nominally half-buried ball still shows more than half — which is what
    // made the eyes look like beads glued on.
    const centre = surf.clone().addScaledVector(nrm, -eyeR * 0.80);
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.frustumCulled = false;
    eye.position.copy(centre);
    group.add(eye);
    eyeNodes.push({ mesh: eye, base: centre.clone() });
  }

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
