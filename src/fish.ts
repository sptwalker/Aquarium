import * as THREE from 'three';
import { NOISE, SWIM, ENV, CAUSTIC } from './glsl';
import type { Shared } from './scene';

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
    length: 1.62, girth: 0.35,
    hueA: new THREE.Vector3(1.0, 0.26, 0.020),
    hueB: new THREE.Vector3(0.92, 0.10, 0.014),
    belly: new THREE.Vector3(1.0, 0.92, 0.82),
    finTint: new THREE.Vector3(1.0, 0.42, 0.18),
    wen: 0.0,
  },
  oranda: {
    length: 1.48, girth: 0.40,
    hueA: new THREE.Vector3(0.98, 0.21, 0.018),
    hueB: new THREE.Vector3(0.86, 0.07, 0.012),
    belly: new THREE.Vector3(1.0, 0.90, 0.78),
    finTint: new THREE.Vector3(1.0, 0.50, 0.24),
    wen: 1.0,
  },
  ryukin: {
    length: 1.40, girth: 0.42,
    hueA: new THREE.Vector3(0.97, 0.40, 0.045),
    hueB: new THREE.Vector3(0.88, 0.44, 0.30),
    belly: new THREE.Vector3(1.0, 0.95, 0.88),
    finTint: new THREE.Vector3(1.0, 0.64, 0.38),
    wen: 0.0,
  },
  comet: {
    length: 1.95, girth: 0.25,
    hueA: new THREE.Vector3(1.0, 0.30, 0.020),
    hueB: new THREE.Vector3(0.97, 0.52, 0.030),
    belly: new THREE.Vector3(1.0, 0.95, 0.87),
    finTint: new THREE.Vector3(1.0, 0.46, 0.16),
    wen: 0.0,
  },
};

function bodyProfile(z: number): number {
  // z in [-0.5, 0.5]; 0.5 = nose. Returns a 0..1 radius multiplier.
  // Egg-shaped goldfish body: deep behind the head, tapering hard into the
  // caudal peduncle, with a short rounded snout.
  const t = THREE.MathUtils.clamp((z + 0.5) / 1.0, 0, 1);
  if (t > 0.86) {
    // snout: quick but smooth taper to a small mouth
    const k = (t - 0.86) / 0.14;
    return Math.sqrt(Math.max(0, 1 - k * k)) * 0.52 + 0.10;
  }
  if (t > 0.16) {
    // widest just behind the gill cover (t≈0.62), gently narrowing forward
    const k = (t - 0.16) / 0.70;
    const peak = Math.sin(Math.pow(k, 0.75) * Math.PI * 0.92);
    return 0.44 + 0.58 * peak;
  }
  // caudal peduncle: thin, then a small flare where the tail root begins
  const k = t / 0.16;
  return 0.10 + 0.34 * k * k;
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
      // cross-section: laterally compressed (tall, narrow), deeper belly
      let x = ca * prof * 0.58;
      let y = sa * prof * 1.02;
      // dorsal ridge + belly curve
      y += Math.max(0, sa) * prof * 0.14;
      y -= Math.max(0, -sa) * prof * 0.18;
      // head narrows toward the snout and rounds off
      const headK = THREE.MathUtils.smoothstep(t, 0.62, 1.0);
      y *= 1.0 - headK * 0.30;
      x *= 1.0 - headK * 0.28;
      // mouth indentation
      const mouth = THREE.MathUtils.smoothstep(t, 0.90, 1.0);
      y -= mouth * Math.abs(Math.cos(a)) * prof * 0.10;
      // subtle asymmetry / organic
      const wob = 1 + 0.02 * Math.sin(a * 5 + u * 22) + 0.012 * Math.sin(a * 9 - u * 13);
      positions.push(x * wob, y * wob, z);
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

/** Fin membrane: a fan of quads with radial veins. Built in local space. */
function makeFinGeometry(
  kind: 'dorsal' | 'caudal' | 'pectoral' | 'anal',
  style: FishStyle,
): THREE.BufferGeometry {
  const L = style.length;
  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const segsU = kind === 'caudal' ? 30 : 16;
  const segsV = 14;

  const shape = (u: number, v: number): THREE.Vector3 => {
    const s = u * 2 - 1; // -1..1 across
    const d = v;        // 0 root .. 1 tip
    const veined = 1 + 0.012 * Math.sin(s * 26.0);
    switch (kind) {
      case 'dorsal': {
        // soft sail along the back: smooth leading edge, notched trailing edge
        const z = -L * 0.06 - u * L * 0.36;
        const arc = Math.max(0, Math.sin(Math.min(1, (u - 0.04) / 0.96) * Math.PI));
        const h = (L * 0.22) * Math.pow(arc, 0.75) * veined;
        return new THREE.Vector3(s * 0.012, style.girth * 0.74 + d * h, z + Math.sin(s * 3) * 0.02);
      }
      case 'caudal': {
        // Rooted fan: starts at the peduncle (d=0) and flares out, so it never
        // reads as a detached shape floating behind the body.
        const notch = 1.0 - 0.40 * Math.exp(-s * s * 7.0);
        const rootZ = -L * 0.46;
        // comets carry a long flowing tail; fancy varieties a shorter fan
        const tailSpan = L * (style.girth < 0.3 ? 0.62 : 0.42);
        const z = rootZ - d * tailSpan * veined * notch;
        const y = s * Math.pow(d, 0.82) * L * 0.30 * (1.0 + 0.10 * Math.sin(Math.abs(s) * 2.6));
        const x = s * d * L * 0.09 + d * d * Math.cos(s * 1.9) * L * 0.05;
        return new THREE.Vector3(x, y + style.girth * 0.02, z);
      }
      case 'pectoral': {
        const z = L * 0.10;
        const len = L * 0.34 * veined;
        return new THREE.Vector3(d * len * (0.25 + Math.abs(s) * 0.8), style.girth * 0.05 + s * d * len * 0.62, z - d * len * 0.5);
      }
      case 'anal': {
        const z = -L * 0.30;
        const h = L * 0.20 * veined;
        return new THREE.Vector3(s * 0.02, -style.girth * 0.72 - d * h, z - u * L * 0.10 - d * 0.05);
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
} {
  const uniforms: FishUniforms = {
    uTime: shared.uTime,
    uSwimPhase: { value: Math.random() * 10 },
    uSwimAmp: { value: 0.05 },
    uSwimFreq: { value: 8.5 },
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
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vLocalNormal;
      varying vec3 vLocal;
      varying vec2 vUv;
      void main(){
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
      uniform float uMouth;
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

        // the white belly is a narrow underside band, not half the fish
        float bellyMask = smoothstep(-0.10, -0.62, up) * smoothstep(0.90, 0.30, along);
        col = mix(col, uBelly, bellyMask * 0.88);

        // ---- scale lattice: very low contrast, it is a sheen not a pattern
        vec2 cell;
        float sm = scaleMask(vec2(uv.x, uv.y * 1.02), cell);
        float scaleHue = hash11(cell.x * 7.31 + cell.y * 3.17);
        col *= 0.965 + 0.055 * sm;
        col = mix(col, col * vec3(1.03, 0.995, 0.955), sm * 0.22 * scaleHue);

        // ---- oranda wen (bumpy growth on head)
        float head = smoothstep(0.62, 0.95, along);
        float wen = uWen * head * (fbm3(vec2(uv.x * 16.0, uv.y * 12.0)) - 0.42);
        col *= 1.0 + wen * 1.4;

        // ---- normal perturbation from scales
        vec3 pert = scaleNormal(vec2(uv.x, uv.y * 1.02));
        // tangent frame: local x should map to around, local y across
        vec3 T = normalize(cross(N, vec3(0.0, 1.0, 0.0)) + 1e-4);
        vec3 B = normalize(cross(N, T));
        N = normalize(N + (T * pert.x + B * pert.y) * 0.11 + normalize(vLocal) * wen * 0.4);

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

  const finMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
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
        float a = mem * (0.30 + 0.30 * fres + trans * 0.12);
        a *= smoothstep(1.0, 0.93, uv.y);        // fade at the far tip
        a *= 0.35 + 0.65 * smoothstep(0.0, 0.28, uv.y);  // rooted edge is solid
        gl_FragColor = vec4(col, clamp(a, 0.0, 0.90));
      }
    `,
  });

  const group = new THREE.Group();
  const body = new THREE.Mesh(buildBodyGeometry(style), bodyMat);
  body.frustumCulled = false;
  group.add(body);

  const finDefs: Array<['dorsal' | 'caudal' | 'pectoral' | 'anal', number, number]> = [
    ['caudal', 0, 0],
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
    if (kind === 'caudal') fm.rotation.x = 0.04;
    group.add(fm);
  }

  // eyes: glossy amber-irised spheres with a pupil
  const eyeGeo = new THREE.SphereGeometry(style.girth * 0.105, 18, 12);
  const pupilGeo = new THREE.SphereGeometry(style.girth * 0.115, 16, 12);
  void pupilGeo;
  const eyeMat = new THREE.ShaderMaterial({
    uniforms,
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
  for (const s of [1, -1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(s * style.girth * 0.44, style.girth * 0.30, style.length * 0.33);
    eye.scale.set(0.55, 1.0, 1.0);
    group.add(eye);
  }

  return { group, uniforms, body };
}

export { STYLES };
export type { FishStyle };
