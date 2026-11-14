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
    length: 1.55, girth: 0.42,
    hueA: new THREE.Vector3(1.0, 0.36, 0.055),
    hueB: new THREE.Vector3(0.95, 0.19, 0.035),
    belly: new THREE.Vector3(1.0, 0.94, 0.86),
    finTint: new THREE.Vector3(1.0, 0.52, 0.26),
    wen: 0.0,
  },
  oranda: {
    length: 1.42, girth: 0.50,
    hueA: new THREE.Vector3(0.98, 0.30, 0.05),
    hueB: new THREE.Vector3(0.90, 0.13, 0.03),
    belly: new THREE.Vector3(1.0, 0.93, 0.84),
    finTint: new THREE.Vector3(1.0, 0.60, 0.34),
    wen: 1.0,
  },
  ryukin: {
    length: 1.34, girth: 0.52,
    hueA: new THREE.Vector3(0.98, 0.52, 0.11),
    hueB: new THREE.Vector3(0.93, 0.55, 0.42),
    belly: new THREE.Vector3(1.0, 0.96, 0.90),
    finTint: new THREE.Vector3(1.0, 0.72, 0.50),
    wen: 0.0,
  },
  comet: {
    length: 1.85, girth: 0.29,
    hueA: new THREE.Vector3(1.0, 0.41, 0.06),
    hueB: new THREE.Vector3(0.98, 0.62, 0.10),
    belly: new THREE.Vector3(1.0, 0.96, 0.90),
    finTint: new THREE.Vector3(1.0, 0.55, 0.25),
    wen: 0.0,
  },
};

function bodyProfile(z: number): number {
  // z in [-0.5, 0.5]; 0.5 = nose
  const t = THREE.MathUtils.clamp((z + 0.5) / 1.0, 0, 1);
  if (t > 0.72) {
    const k = (t - 0.72) / 0.28;
    return Math.sqrt(Math.max(0, 1 - k * k)) * 0.96 + 0.04;
  }
  if (t > 0.28) {
    const k = (t - 0.28) / 0.44;
    return 0.82 + 0.26 * Math.sin(k * Math.PI * 0.85) - k * 0.16;
  }
  const k = (0.28 - t) / 0.28;
  return Math.max(0.06, 0.66 * Math.sqrt(Math.max(0, 1 - k * k)));
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
      // cross-section: slightly flattened, deeper belly
      let x = ca * prof * 0.92;
      let y = sa * prof;
      // dorsal ridge + belly curve
      y += Math.max(0, sa) * prof * 0.22;
      y -= Math.max(0, -sa) * prof * 0.10;
      // head widens vertically, mouth pinches
      const headK = THREE.MathUtils.smoothstep(t, 0.55, 1.0);
      y *= 1.0 - headK * 0.18;
      x *= 1.0 + headK * 0.06;
      // mouth indentation
      const mouth = THREE.MathUtils.smoothstep(t, 0.9, 1.0);
      y -= mouth * Math.abs(Math.cos(a)) * prof * 0.16;
      z += mouth * prof * 0.10 * Math.cos(a);
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
    const veined = 1 + 0.035 * Math.sin(s * 26.0);
    switch (kind) {
      case 'dorsal': {
        const z = -L * 0.08 - u * L * 0.34;
        const h = (L * 0.26) * Math.sin(Math.min(1, u * 1.12) * Math.PI) * veined;
        return new THREE.Vector3(s * 0.015, style.girth * 0.80 + d * h, z + Math.sin(s * 3) * 0.02);
      }
      case 'caudal': {
        // Two lobes with a notch: the silhouette that reads as "fantail".
        const notch = 1.0 - 0.45 * Math.exp(-s * s * 6.0);
        const z = -L * 0.5 - d * L * 0.40 * veined * notch;
        const y = s * d * L * 0.235 * (1.0 + 0.18 * Math.sin(Math.abs(s) * 2.6));
        const x = s * d * L * 0.055;
        return new THREE.Vector3(x, y, z);
      }
      case 'pectoral': {
        const z = L * 0.14;
        const len = L * 0.40 * veined;
        return new THREE.Vector3(d * len * (0.2 + Math.abs(s)), style.girth * 0.12 + s * d * len * 0.55, z - d * len * 0.55);
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

      // Scale lattice in body-local UV space (u around, v along).
      float scaleMask(vec2 uv, out vec2 cell){
        vec2 g = vec2(uv.x * 22.0, uv.y * 26.0);
        vec2 id = floor(g);
        vec2 f = fract(g) - 0.5;
        float d = length(f * vec2(1.0, 1.15));
        cell = id;
        return smoothstep(0.52, 0.30, d) * smoothstep(0.0, 0.10, d);
      }
      vec3 scaleNormal(vec2 uv){
        vec2 g = vec2(uv.x * 22.0, uv.y * 26.0);
        vec2 f = fract(g) - 0.5;
        float r = length(f * vec2(1.0, 1.15));
        vec2 dir = normalize(f + 1e-5);
        return vec3(dir.x, dir.y, 0.0) * smoothstep(0.5, 0.2, r);
      }

      void main(){
        vec2 uv = vUv;
        vec3 N = normalize(vNormal);

        // ---- base colic gradient
        float along = 1.0 - uv.y;                    // 0 nose .. 1 tail
        float up = vLocalNormal.y;                   // -1 belly .. 1 back
        float blotch = fbm3(vec2(uv.x * 5.0 + 3.0, uv.y * 7.0));
        float blotch2 = fbm3(vec2(uv.x * 11.0, uv.y * 15.0) + 31.0);
        vec3 col = mix(uHueA, uHueB, smoothstep(0.25, 0.85, blotch + blotch2 * 0.35));
        col = mix(col, col * vec3(1.06, 0.92, 0.86), smoothstep(0.5, 0.9, along) * 0.35);

        float bellyMask = smoothstep(0.12, -0.45, up) * smoothstep(0.95, 0.25, along);
        col = mix(col, uBelly, bellyMask * 0.92);

        // ---- scale lattice
        vec2 cell;
        float sm = scaleMask(vec2(uv.x, uv.y * 1.02), cell);
        float scaleHue = hash11(cell.x * 7.31 + cell.y * 3.17);
        col *= 0.9 + 0.16 * sm;
        col = mix(col, col * vec3(1.08, 0.98, 0.86), sm * 0.35 * scaleHue);

        // ---- oranda wen (bumpy growth on head)
        float head = smoothstep(0.62, 0.95, along);
        float wen = uWen * head * (fbm3(vec2(uv.x * 16.0, uv.y * 12.0)) - 0.42);
        col *= 1.0 + wen * 1.4;

        // ---- normal perturbation from scales
        vec3 pert = scaleNormal(vec2(uv.x, uv.y * 1.02));
        // tangent frame: local x should map to around, local y across
        vec3 T = normalize(cross(N, vec3(0.0, 1.0, 0.0)) + 1e-4);
        vec3 B = normalize(cross(N, T));
        N = normalize(N + (T * pert.x + B * pert.y) * 0.32 + normalize(vLocal) * wen * 0.4);

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
        vec3 lit = col * (uSunColor * wrap * (0.30 + 1.7 * casc) * atten + vec3(0.06, 0.10, 0.115));
        lit += sss * 0.9;

        // specular: wet, crisp highlight with iridescence on the rim
        vec3 H = normalize(L + V);
        float gloss = 0.0;
        float f0 = 0.028;
        float nh = max(0.0, dot(N, H));
        gloss = pow(nh, 120.0) * 2.6 + pow(nh, 18.0) * 0.18;
        float fres = pow(1.0 - max(0.0, dot(N, V)), 3.0);
        vec3 irid = 0.5 + 0.5 * cos(vec3(0.0, 2.1, 4.2) + fres * 5.0);
        lit += uSunColor * gloss * (0.85 + 0.45 * (1.0 - sm));
        lit += irid * fres * 0.16;

        // ambient reflection of the tank interior
        vec3 R = reflect(-V, N);
        lit += envColor(R, uSunDir) * fres * 0.5 + f0 * envColor(R, uSunDir) * 0.12;

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
        // radial veins from root (v=0) toward tip
        float veins = smoothstep(0.72, 0.98, sin(uv.x * uFinFreq * 6.28318) * 0.5 + 0.5);
        float v2 = smoothstep(0.6, 0.98, sin(uv.y * 30.0 + uv.x * 12.0) * 0.5 + 0.5);
        float mem = mix(0.55, 1.0, veins * 0.7 + v2 * 0.3);

        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 L = normalize(uSunDir);
        float trans = pow(max(0.0, dot(-V, L)), 2.0) * 1.1;
        float ndl = max(0.0, dot(N, L));
        float fres = pow(1.0 - abs(dot(N, V)), 2.0);
        float casc = causticSample(vWorld, uTime);
        float atten = exp(-max(0.0, 4.05 - vWorld.y) * 0.1);
        vec3 col = uFinTint * (0.35 + 1.9 * casc) * atten * (0.45 + ndl * 0.7 + trans);
        col += uFinTint * fres * 0.28;
        col += vec3(1.0) * pow(max(0.0, dot(reflect(-L, N), V)), 60.0) * 0.25;
        float a = mem * (0.30 + 0.62 * fres + trans * 0.25);
        a *= smoothstep(1.0, 0.86, uv.y);        // fade at the far tip
        a *= smoothstep(0.0, 0.16, uv.y);        // rooted edge is opaque-ish
        gl_FragColor = vec4(col, clamp(a, 0.0, 0.94));
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
    eye.position.set(s * style.girth * 0.72, style.girth * 0.30, style.length * 0.34);
    eye.scale.set(0.7, 1.0, 1.0);
    group.add(eye);
  }

  return { group, uniforms, body };
}

export { STYLES };
export type { FishStyle };
