import * as THREE from 'three';
import { NOISE, SWIM, ENV, CAUSTIC } from './glsl';
import type { Shared } from './scene';
import { FinCloth } from './cloth';

export type FishSpecies = 'fantail' | 'oranda' | 'ryukin' | 'comet';

type FishStyle = {
  length: number;
  girth: number;
  hueA: THREE.Vector3;
  hueB: THREE.Vector3;
  belly: THREE.Vector3;
  finTint: THREE.Vector3;
  wen: number;
};

const STYLES: Record<FishSpecies, FishStyle> = {
  fantail: {
    length: 1.12, girth: 0.33,
    hueA: new THREE.Vector3(1.0, 0.26, 0.020),
    hueB: new THREE.Vector3(0.92, 0.10, 0.014),
    belly: new THREE.Vector3(1.0, 0.92, 0.82),
    finTint: new THREE.Vector3(1.0, 0.42, 0.18),
    wen: 0.0,
  },
  oranda: {
    length: 1.02, girth: 0.37,
    hueA: new THREE.Vector3(0.98, 0.21, 0.018),
    hueB: new THREE.Vector3(0.86, 0.07, 0.012),
    belly: new THREE.Vector3(1.0, 0.90, 0.78),
    finTint: new THREE.Vector3(1.0, 0.50, 0.24),
    wen: 1.0,
  },
  ryukin: {
    length: 0.96, girth: 0.38,
    hueA: new THREE.Vector3(0.97, 0.40, 0.045),
    hueB: new THREE.Vector3(0.88, 0.44, 0.30),
    belly: new THREE.Vector3(1.0, 0.95, 0.88),
    finTint: new THREE.Vector3(1.0, 0.64, 0.38),
    wen: 0.0,
  },
  comet: {
    // roughly 4.5:1 — a slim fish, not a leaf; the old 7.8:1 read as paper
    length: 1.42, girth: 0.31,
    hueA: new THREE.Vector3(1.0, 0.30, 0.020),
    hueB: new THREE.Vector3(0.97, 0.52, 0.030),
    belly: new THREE.Vector3(1.0, 0.95, 0.87),
    finTint: new THREE.Vector3(1.0, 0.46, 0.16),
    wen: 0.0,
  },
};

// Body radius along the axis, as (t, r) control points with t measured
// nose-ward: 0 = caudal peduncle, 1 = mouth.
//
// A piecewise formula had a value jump at t=0.86 (0.455 before the snout
// branch, 0.600 after it), which rendered as a hard ridge ringing the head.
// Interpolating control points keeps the curve C1, so no ledge can appear.
const PROFILE_KEYS: ReadonlyArray<readonly [number, number]> = [
  [0.00, 0.09],
  [0.07, 0.20],
  [0.15, 0.38],   // caudal peduncle (the narrow waist)
  [0.26, 0.60],
  [0.38, 0.80],
  [0.50, 0.93],
  [0.62, 1.00],   // widest point, just behind the gill cover
  [0.72, 0.99],
  [0.80, 0.94],
  [0.86, 0.86],   // behind the eye
  [0.90, 0.78],
];
// Above this the snout becomes a circular cap rather than a taper, so the
// nose is blunt and rounded the way a goldfish's is, not a cone.
const NOSE_T0 = 0.90;

function bodyProfile(z: number): number {
  const t = THREE.MathUtils.clamp(z + 0.5, 0, 1);
  const K = PROFILE_KEYS;
  let i = 0;
  while (i < K.length - 2 && t > K[i + 1][0]) i++;
  const [t1, p1] = K[i];
  const [t2, p2] = K[i + 1];
  const p0 = K[Math.max(0, i - 1)][1];
  const p3 = K[Math.min(K.length - 1, i + 2)][1];
  const s = (t - t1) / Math.max(1e-6, t2 - t1);
  const s2 = s * s, s3 = s2 * s;
  const base = 0.5 * (
    2 * p1 +
    (-p0 + p2) * s +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * s3
  );
  if (t <= NOSE_T0) return base;
  // hemispherical snout
  const k = (t - NOSE_T0) / (1 - NOSE_T0);
  return 0.78 * Math.sqrt(Math.max(0, 1 - k * k));
}

/**
 * Half-width of the body surface at a given axial position and height.
 * Mirrors the cross-section maths in buildBodyGeometry, so fins and eyes can
 * be planted on the skin instead of at guessed offsets.
 */
function surfaceHalfWidth(style: FishStyle, z: number, y: number): number {
  const u = z / style.length + 0.5;
  const prof = bodyProfile(u - 0.5) * style.girth;
  const rx = prof * 0.70;
  const ry = prof * (y >= 0 ? 0.84 : 1.00);
  const k = THREE.MathUtils.clamp(Math.abs(y) / Math.max(1e-4, ry), 0, 0.999);
  return rx * Math.sqrt(1 - k * k);
}

/** Height of the top of the body at axial position z. */
function surfaceTop(style: FishStyle, z: number): number {
  return bodyProfile(z / style.length) * style.girth * 0.84;
}

/** Height of the underside of the body at axial position z. */
function surfaceBottom(style: FishStyle, z: number): number {
  return -bodyProfile(z / style.length) * style.girth * 1.00;
}

function buildBodyGeometry(style: FishStyle, segs = 46, radial = 22): THREE.BufferGeometry {
  const L = style.length, G = style.girth;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const rows = segs + 1, cols = radial + 1;

  for (let i = 0; i < rows; i++) {
    const u = i / segs;
    let z = (u - 0.5) * L;
    const t = (u - 0.5) * 2; // -1 tail .. 1 nose
    const prof = bodyProfile((u - 0.5)) * G;
    for (let j = 0; j < cols; j++) {
      const a = (j / radial) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      // Cross-section: an ellipse with a taller ventral half, so the belly
      // hangs lower than the back rises. Keeping it a true ellipse (rather
      // than adding ridge offsets) is what lets surfaceHalfWidth invert it
      // exactly, so fins and eyes land on the skin.
      const rx = prof * 0.70;
      const ryUp = prof * 0.84;
      const ryDn = prof * 1.00;
      let x = ca * rx;
      let y = sa * (sa >= 0 ? ryUp : ryDn);
      // mouth indentation
      const mouth = THREE.MathUtils.smoothstep(t, 0.90, 1.0);
      y -= mouth * Math.abs(ca) * prof * 0.08;
      // No per-vertex sinusoidal "organic" wobble here: varying its phase with
      // u carved rings around the body, which is exactly the raised collar the
      // head was showing. Texture and scales supply that detail instead.
      positions.push(x, y, z);
      uvs.push((j / radial), u);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * cols + j;
      const b = a + cols;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** Builds the caudal fin's rest pose as a cloth grid (cols across, rows out). */
function makeTailCloth(style: FishStyle): FinCloth {
  const L = style.length;
  const cols = 26;
  const rows = 16;
  // comets carry a longer flowing tail; fancy varieties a shorter, fuller fan
  const span = L * (style.girth < 0.3 ? 0.58 : 0.40);
  const rootZ = -L * 0.46;
  const rest = new Float32Array(cols * rows * 3);

  for (let i = 0; i < cols; i++) {
    const u = i / (cols - 1);
    const s = u * 2 - 1;
    for (let j = 0; j < rows; j++) {
      const d = j / (rows - 1);
      const notch = 1.0 - 0.40 * Math.exp(-s * s * 7.0);
      const z = rootZ - d * span * notch;
      // vertical spread stays under the body depth so it reads as a fan rather
      // than a kite, but big enough to be the fish's dominant silhouette
      const y = s * Math.pow(d, 0.82) * L * 0.245 * (1 + 0.10 * Math.sin(Math.abs(s) * 2.6));
      const x = s * d * L * 0.075 + d * d * Math.cos(s * 1.9) * L * 0.045;
      const o = (i * rows + j) * 3;
      rest[o] = x;
      rest[o + 1] = y + style.girth * 0.02;
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
function makeFinGeometry(
  kind: 'dorsal' | 'pectoral' | 'anal',
  style: FishStyle,
): THREE.BufferGeometry {
  const L = style.length;
  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const segsU = 16;
  const segsV = 14;

  const shape = (u: number, v: number): THREE.Vector3 => {
    const s = u * 2 - 1; // -1..1 across
    const d = v;        // 0 root .. 1 tip
    const veined = 1 + 0.012 * Math.sin(s * 26.0);
    switch (kind) {
      case 'dorsal': {
        // Sail along the back. Its base follows the body's own curve so it
        // grows out of the spine instead of sitting on it like a flag.
        const z = -L * 0.06 - u * L * 0.34;
        const arc = Math.max(0, Math.sin(Math.min(1, (u - 0.04) / 0.96) * Math.PI));
        const h = (L * 0.14) * Math.pow(arc, 0.75) * veined;
        const baseY = surfaceTop(style, z) - style.girth * 0.03;
        // lean the top of the sail back and curl it slightly
        const leanZ = d * d * h * 0.22;
        const curlX = Math.sin(s * 1.2) * d * h * 0.10;
        return new THREE.Vector3(curlX + s * 0.006, baseY + d * h, z - leanZ);
      }
      case 'anal': {
        // same idea underneath, shorter and leaning back
        const z = -L * 0.28;
        const h = L * 0.12 * veined;
        const baseY = surfaceBottom(style, z) + style.girth * 0.02;
        const leanZ = d * d * h * 0.25;
        return new THREE.Vector3(s * 0.006, baseY - d * h, z - u * L * 0.08 - leanZ);
      }
      case 'pectoral': {
        // A paddle that leaves the flank tangentially. The inner edge is laid
        // along the body ellipse so the root is buried, and the membrane curls
        // outward instead of being a flat triangle pasted to the side.
        const z0 = L * 0.14;
        const len = L * 0.15 * veined;
        const y0 = style.girth * 0.02;
        const rootX = surfaceHalfWidth(style, z0, y0) * 0.98;

        // local frame at the root: outward along +x, back along -z
        const sweep = d * len * 0.95;
        const out = d * len * 0.55;
        // the fan opens as it extends
        const spread = s * d * len * (0.42 + 0.22 * Math.abs(s));
        // curl the tip away from the body so it reads as a fin, not a blade
        const curl = d * d * len * 0.28;

        return new THREE.Vector3(
          rootX + out + curl * 0.4,
          y0 + spread * 0.85 - d * len * 0.06,
          z0 - sweep + curl * 0.3,
        );
      }
    }
  };

  for (let i = 0; i <= segsU; i++) {
    for (let j = 0; j <= segsV; j++) {
      const p = shape(i / segsU, j / segsV);
      pos.push(p.x, p.y, p.z);
      uvs.push(i / segsU, j / segsV);
    }
  }
  for (let i = 0; i < segsU; i++) {
    for (let j = 0; j < segsV; j++) {
      const a = i * (segsV + 1) + j;
      const b = a + segsV + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

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

  const bodyMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${NOISE}
      ${SWIM}
      uniform float uMouth;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vLocalNormal;
      varying vec3 vLocal;
      varying vec2 vUv;
      void main(){
        vec3 p = position;
        // mouth: split the snout locally so it actually opens to gape
        float snout = smoothstep(0.90, 0.995, uv.y);
        float jaw = smoothstep(0.05, -0.05, p.y);
        p.y += jaw * snout * uMouth * uLen * 0.085;
        p.z -= snout * uMouth * 0.03;

        vec3 q = swimBend(p);
        vec3 n = swimBendNormal(p, normal);
        vLocal = p;
        vLocalNormal = normal;
        vUv = uv;
        vWorld = (modelMatrix * vec4(q, 1.0)).xyz;
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
      varying vec3 vLocalNormal;
      varying vec3 vLocal;
      varying vec2 vUv;

      // Scale lattice: staggered diamond cells, each with a soft dome normal.
      // Also returns cell coordinates so the fragment can tint per scale.
      float scaleMask(vec2 uv, out vec2 cell){
        vec2 g = vec2(uv.x * 26.0, uv.y * 34.0);
        g.x += step(1.0, mod(floor(g.y), 2.0)) * 0.5;   // brick offset
        vec2 id = floor(g);
        vec2 f = fract(g) - 0.5;
        float d = abs(f.x) * 1.35 + abs(f.y) * 1.05;     // diamond metric
        cell = id;
        return smoothstep(0.62, 0.34, d);
      }
      vec3 scaleNormal(vec2 uv){
        vec2 g = vec2(uv.x * 26.0, uv.y * 34.0);
        g.x += step(1.0, mod(floor(g.y), 2.0)) * 0.5;
        vec2 f = fract(g) - 0.5;
        float d = abs(f.x) * 1.35 + abs(f.y) * 1.05;
        vec2 dir = sign(f) * vec2(1.35, 1.05);
        return vec3(dir.x, dir.y, 0.0) * smoothstep(0.58, 0.20, d);
      }

      void main(){
        vec2 uv = vUv;
        vec3 N = normalize(vNormal);

        // ---- base color gradient (nose..tail, back..belly)
        float along = 1.0 - uv.y;                    // 0 nose .. 1 tail
        float up = vLocalNormal.y;                   // -1 belly .. 1 back
        float blotch = fbm3(vec2(uv.x * 5.0 + 3.0, uv.y * 7.0));
        float blotch2 = fbm3(vec2(uv.x * 11.0, uv.y * 15.0) + 31.0);
        vec3 col = mix(uHueA, uHueB, smoothstep(0.25, 0.85, blotch + blotch2 * 0.35));
        col = mix(col, col * vec3(1.06, 0.92, 0.86), smoothstep(0.5, 0.9, along) * 0.35);

        // the white belly is an underside band; the normal test alone let it
        // wrap over the top of the head because head normals point sideways
        // there, so it is also gated on being low on the body
        float lowish = smoothstep(0.15, -0.55, vLocal.y / max(0.001, uLen * 0.16));
        float bellyMask = smoothstep(-0.10, -0.62, up) * lowish * smoothstep(0.92, 0.35, along);
        col = mix(col, uBelly, bellyMask * 0.85);

        // ---- scale lattice: a sheen, not a pattern. High-frequency cells at
        // this scale alias into a dot grid, so keep them very low contrast and
        // fade them out on the head.
        vec2 cell;
        float sm = scaleMask(vec2(uv.x, uv.y * 1.02), cell);
        sm *= smoothstep(0.05, 0.30, along);      // no scales on the snout
        float scaleHue = hash11(cell.x * 7.31 + cell.y * 3.17);
        col *= 0.985 + 0.024 * sm;
        col = mix(col, col * vec3(1.015, 1.0, 0.985), sm * 0.12 * scaleHue);

        // ---- oranda wen (bumpy growth on head)
        float head = smoothstep(0.62, 0.95, along);
        float wen = uWen * head * (fbm3(vec2(uv.x * 16.0, uv.y * 12.0)) - 0.42);
        col *= 1.0 + wen * 1.4;

        // ---- normal perturbation from scales
        vec3 pert = scaleNormal(vec2(uv.x, uv.y * 1.02));
        // tangent frame: local x should map to around, local y across
        vec3 T = normalize(cross(N, vec3(0.0, 1.0, 0.0)) + 1e-4);
        vec3 B = normalize(cross(N, T));
        N = normalize(N + (T * pert.x + B * pert.y) * 0.055 + normalize(vLocal) * wen * 0.4);

        // ---- lighting
        vec3 V = normalize(cameraPosition - vWorld);
        float casc = causticSample(vWorld, uTime);
        float depthBelow = max(0.0, 4.05 - vWorld.y);
        float atten = exp(-depthBelow * 0.10);

        vec3 L = normalize(uSunDir);
        float ndl = dot(N, L);
        // wrapped diffuse approximates subsurface scattering in the thin flesh
        float wrap = clamp((ndl + 0.55) / 1.55, 0.0, 1.0);
        vec3 sss = uHueA * vec3(1.0, 0.28, 0.18) * pow(clamp(ndl * 0.5 + 0.5, 0.0, 1.0), 3.0) * 0.5;
        vec3 lit = col * (uSunColor * wrap * (0.10 + 1.25 * casc) * atten + vec3(0.018, 0.028, 0.032));
        lit += sss * 0.9;

        // specular: wet, crisp highlight with iridescence on the rim
        vec3 H = normalize(L + V);
        float gloss = 0.0;
        float f0 = 0.028;
        float nh = max(0.0, dot(N, H));
        gloss = pow(nh, 140.0) * 1.5 + pow(nh, 22.0) * 0.12;
        float fres = pow(1.0 - max(0.0, dot(N, V)), 3.0);
        vec3 irid = 0.5 + 0.5 * cos(vec3(0.0, 2.1, 4.2) + fres * 5.0);
        lit += uSunColor * gloss * (0.85 + 0.45 * (1.0 - sm));
        lit += irid * fres * 0.10;

        // ambient reflection of the tank interior
        vec3 R = reflect(-V, N);
        lit += envColor(R, uSunDir) * fres * 0.28 + f0 * envColor(R, uSunDir) * 0.10;

        // mouth darkening
        float mouth = smoothstep(0.963, 0.995, uv.y) * smoothstep(0.48, 0.62, uv.x) * smoothstep(0.48, 0.38, abs(uv.x - 0.5) * 2.0);
        lit *= 1.0 - mouth * 0.85 * (0.6 + uMouth);

        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });

  // Fins render opaque. As thin transparent sheets they let the far-side fin
  // and the body behind them blend in, which is precisely the "fin visible
  // through the fish" artifact. Being solid also removes all sorting problems
  // (a double-sided translucent sheet blends with itself, doubling alpha).
  const finMat = new THREE.ShaderMaterial({
    transparent: false,
    depthWrite: true,
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
        // extra flutter toward the tip
        float flutter = sin(uTime * 6.0 + uv.y * 9.0 + uSwimPhase) * 0.035 * uv.y * uv.y;
        p += vec3(flutter, flutter * 0.4, 0.0);
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
      uniform float uFinFreq;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main(){
        vec2 uv = vUv;
        // soft rays: broad translucent gradients, no hard stripes
        float veins = smoothstep(0.2, 0.85, sin(uv.x * uFinFreq * 6.28318) * 0.5 + 0.5);
        float cross = smoothstep(0.25, 0.9, sin(uv.y * 16.0 + uv.x * 8.0) * 0.5 + 0.5);
        float mem = mix(0.72, 1.0, veins * 0.6 + cross * 0.4);

        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 L = normalize(uSunDir);
        float trans = pow(max(0.0, dot(-V, L)), 2.0) * 1.1;
        float ndl = max(0.0, dot(N, L));
        float fres = pow(1.0 - abs(dot(N, V)), 2.0);
        float casc = causticSample(vWorld, uTime);
        float atten = exp(-max(0.0, 4.05 - vWorld.y) * 0.1);
        vec3 col = uFinTint * (0.16 + 0.80 * casc) * atten * (0.45 + ndl * 0.7 + trans);
        col += uFinTint * fres * 0.22;
        col += vec3(1.0) * pow(max(0.0, dot(reflect(-L, N), V)), 60.0) * 0.10;
        col = min(col, vec3(1.6));
        // Fins are solid geometry; the outlined shape comes from the mesh, not
        // from alpha. The membrane's thinness is expressed as light through it.
        float thin = smoothstep(0.0, 0.85, uv.y);
        col = mix(col, col * 0.72, thin * 0.35);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const group = new THREE.Group();
  const body = new THREE.Mesh(buildBodyGeometry(style), bodyMat);
  body.frustumCulled = false;
  group.add(body);

  // caudal fin: driven by a Verlet cloth, so its vertices are already final
  // in local space — it must not also get the shader swim wave applied.
  const tail = makeTailCloth(style);
  const tailMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
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
  tailMesh.renderOrder = 3;
  group.add(tailMesh);

  const finDefs: Array<['dorsal' | 'pectoral' | 'anal', number, number]> = [
    ['dorsal', 0, 0],
    ['pectoral', 1, 0],
    ['pectoral', -1, 0],
    ['anal', 1, 0],
    ['anal', -1, 0],
  ];
  for (const [kind, side] of finDefs) {
    const fg = makeFinGeometry(kind, style);
    const fm = new THREE.Mesh(fg, finMat);
    fm.frustumCulled = false;
    fm.renderOrder = 3;
    if (side !== 0) fm.scale.x = side;
    group.add(fm);
  }

  // root motion source: the body's own wave, so the tail lags behind the fish
  // mirror of the GLSL swimCurve/swimBend so the cloth and the shader agree
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
  // eyes: glossy amber-irised spheres with a pupil
  const eyeGeo = new THREE.SphereGeometry(style.girth * 0.105, 18, 12);
  const pupilGeo = new THREE.SphereGeometry(style.girth * 0.115, 16, 12);
  void pupilGeo;
  const eyeMat = new THREE.ShaderMaterial({
    uniforms,
    // No polygon offset here. A negative offset pulls the whole sphere toward
    // the camera in depth space, including the half buried inside the head —
    // that half then wins the depth test against the skull and the eye appears
    // to be visible *through* the fish. The lens is sunk inside the head
    // instead, so only its cap is exposed and no bias is needed.
    vertexShader: 'varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix) * normal); vW = (modelMatrix*vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW,1.0); }',
    fragmentShader: /* glsl */ `
      ${ENV}
      uniform vec3 uSunDir;
      varying vec3 vN; varying vec3 vW;
      void main(){
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vW);
        vec3 R = reflect(-V, N);
        // pupil faces outward along local +X-ish; use the sphere's own normal
        float pupil = smoothstep(0.72, 0.94, dot(N, normalize(vec3(sign(N.x) * 0.95, 0.0, 0.32))));
        vec3 iris = mix(vec3(0.42, 0.20, 0.03), vec3(0.72, 0.42, 0.08), 1.0 - pupil);
        vec3 c = mix(iris, vec3(0.012), pupil);
        c += envColor(R, uSunDir) * 0.55;
        c += vec3(0.9) * pow(max(0.0, dot(R, uSunDir)), 400.0) * 2.0;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  // eyes ride the same spine frame as the body, otherwise the bending head
  // sweeps through them and they appear to poke out of the skin
  const eyeBase = [1, -1].map((s) => {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.scale.set(0.55, 1.0, 1.0);
    eye.frustumCulled = false;
    group.add(eye);
    return {
      mesh: eye,
      // Seat the sphere so its centre is *inside* the head and only a lens
      // cap protrudes: a centre placed on the skin leaves half the ball
      // floating and half buried, which reads as a hole in the body.
      x: s * (surfaceHalfWidth(style, style.length * 0.33, style.girth * 0.26) - style.girth * 0.045),
      y: style.girth * 0.26,
      z: style.length * 0.33,
    };
  });
  const placeEyes = () => {
    for (const e of eyeBase) {
      const [bx, bz] = bend(e.x, e.z);
      e.mesh.position.set(bx, e.y, bz);
    }
  };
  placeEyes();

  const updateTail = (dt: number, time: number, flow: THREE.Vector3) => {
    tail.update(dt, time, bend, flow);
    placeEyes();
  };

  return { group, uniforms, body, tail, updateTail };
}

export { STYLES };
export type { FishStyle };
