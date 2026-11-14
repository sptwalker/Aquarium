import * as THREE from 'three';
import { NOISE, ENV, CAUSTIC } from './glsl';
import { TANK, SAND_TOP, SAND_DEPTH, QUALITY, type Quality } from './config';

export type Shared = {
  uTime: { value: number };
  uCaustic: { value: THREE.Texture | null };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
};

export function makeShared(q: Quality, causticTex: THREE.Texture): Shared {
  void q;
  return {
    uTime: { value: 0 },
    uCaustic: { value: causticTex },
    uSunDir: { value: new THREE.Vector3(-0.28, 0.86, 0.42).normalize() },
    uSunColor: { value: new THREE.Color(1.0, 0.94, 0.82).multiplyScalar(1.25) },
  };
}

/** Shared chunk injected into every tank surface material. */
const TANKCHUNK = /* glsl */ `
${NOISE}
${ENV}
${CAUSTIC}
`;

function stdChunks(sh: Shared) {
  return {
    uTime: sh.uTime,
    uCaustic: sh.uCaustic,
    uSunDir: sh.uSunDir,
    uSunColor: sh.uSunColor,
  };
}

// ---------------------------------------------------------------------------
// Sand bed
// ---------------------------------------------------------------------------
export function makeSand(sh: Shared): THREE.Group {
  const group = new THREE.Group();
  const segX = 180, segZ = 100;
  const g = new THREE.PlaneGeometry(TANK.hw * 2 - 0.2, TANK.hd * 2 - 0.2, segX, segZ);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const dune =
      Math.sin(x * 0.62 + 1.2) * 0.055 +
      Math.sin(z * 0.95 - 0.4) * 0.03 +
      Math.sin((x + z) * 1.7) * 0.014 +
      Math.sin(x * 3.1 - z * 2.3) * 0.008;
    const edge = 1 - Math.pow(Math.min(1, Math.abs(x) / (TANK.hw - 0.4)), 8) * 0.5;
    // mound up toward the back so the bed has a slope, not a sheet of paper
    const back = THREE.MathUtils.smoothstep(z, -TANK.hd, TANK.hd) * 0.10;
    pos.setY(i, SAND_TOP + dune * edge + back);
  }
  g.computeVertexNormals();

  const m = new THREE.ShaderMaterial({
    uniforms: { ...stdChunks(sh) },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vDepth;
      void main(){
        vec3 p = position;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vDepth = wp.z;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${TANKCHUNK}
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vDepth;
      void main(){
        vec2 p = vWorld.xz;
        float grain = fbm3(p * 34.0);
        float grain2 = noise2(p * 128.0);
        vec3 sandA = vec3(0.30, 0.26, 0.19);
        vec3 sandB = vec3(0.44, 0.39, 0.30);
        vec3 sand = mix(sandA, sandB, smoothstep(0.25, 0.85, grain));
        sand *= 0.86 + grain2 * 0.28;

        // scattered pebbles
        vec2 cell = floor(p * 9.0);
        float r = hash21(cell);
        vec2 cp = (fract(p * 9.0) - 0.5) * 2.0;
        float pebble = 0.0;
        if (r > 0.62) {
          float d = length(cp * vec2(1.0, 1.35)) - (0.35 + r * 0.28);
          pebble = smoothstep(0.06, -0.10, d);
        }
        vec3 pebCol = mix(vec3(0.30, 0.29, 0.27), vec3(0.55, 0.50, 0.43), hash21(cell + 3.7));
        sand = mix(sand, pebCol, pebble * 0.85);

        // ripple lines
        float ripple = smoothstep(0.42, 0.5, fbm3(p * 2.2 + 5.0)) * 0.35;
        sand *= 1.0 - ripple * 0.35;

        vec3 N = normalize(vNormal);
        float ndl = max(0.0, dot(N, uSunDir));
        float casc = causticSample(vWorld, uTime);
        float depthBelow = max(0.0, 4.05 - vWorld.y);
        float atten = exp(-depthBelow * 0.13);
        vec3 lit = sand * (uSunColor * ndl * (0.18 + 1.45 * casc) * atten);
        lit += sand * vec3(0.020, 0.032, 0.038);   // ambient
        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(g, m);
  group.add(mesh);

  // front cut face so the bed reads as a deep substrate behind glass.
  // Its own material: layered sediment bands, not the top-surface shader.
  const sideGeo = new THREE.PlaneGeometry(TANK.hw * 2 - 0.2, SAND_DEPTH, 120, 12);
  let topEdge = SAND_TOP;
  {
    const sidePos = sideGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < sidePos.count; i++) {
      const local = sidePos.getY(i);
      const x = sidePos.getX(i);
      const top = SAND_TOP + 0.10 + Math.sin(x * 0.62 + 1.2) * 0.05;
      sidePos.setY(i, top + local - SAND_DEPTH * 0.5);
      if (local > SAND_DEPTH * 0.45) topEdge = Math.max(topEdge, top);
    }
    sideGeo.computeVertexNormals();
  }
  void topEdge;
  const sideMat = new THREE.ShaderMaterial({
    uniforms: { ...stdChunks(sh) },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${TANKCHUNK}
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main(){
        vec3 N = normalize(vNormal);
        float y = vWorld.y;
        // sediment strata: thin bands of slightly different grain
        float band = fbm3(vec2(vWorld.x * 1.4, y * 9.0));
        float fine = noise2(vec2(vWorld.x * 40.0, y * 120.0));
        vec3 c1 = vec3(0.26, 0.22, 0.16);
        vec3 c2 = vec3(0.16, 0.14, 0.11);
        vec3 base = mix(c2, c1, smoothstep(0.35, 0.75, band));
        base *= 0.88 + fine * 0.22;
        // darker with depth into the bed (less light reaches it)
        base *= mix(0.45, 1.0, smoothstep(-1.2, 0.9, y));

        float ndl = max(0.0, abs(dot(N, uSunDir)) * 0.55 + 0.45);
        float atten = exp(-max(0.0, 4.05 - y) * 0.2);
        vec3 lit = base * (uSunColor * ndl * 0.55 * atten + vec3(0.020, 0.030, 0.034));
        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });
  const front = new THREE.Mesh(sideGeo, sideMat);
  front.position.z = TANK.hd - 0.1;
  group.add(front);

  return group;
}

// ---------------------------------------------------------------------------
// Rocks / driftwood
// ---------------------------------------------------------------------------
export function makeRocks(sh: Shared): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...stdChunks(sh) },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${TANKCHUNK}
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main(){
        vec3 N = normalize(vNormal);
        float n = fbm3(vWorld.xz * 6.0 + vWorld.y * 3.0);
        float n2 = noise2(vWorld.xz * 40.0);
        vec3 base = mix(vec3(0.20, 0.20, 0.19), vec3(0.36, 0.34, 0.30), n);
        base *= 0.85 + n2 * 0.3;
        // mossy top
        float moss = smoothstep(0.3, 0.9, N.y) * smoothstep(0.35, 0.75, fbm3(vWorld.xz * 3.0));
        base = mix(base, vec3(0.13, 0.20, 0.11), moss * 0.55);

        float ndl = max(0.0, dot(N, uSunDir));
        float casc = causticSample(vWorld, uTime);
        float depthBelow = max(0.0, 4.05 - vWorld.y);
        float atten = exp(-depthBelow * 0.13);
        vec3 lit = base * (uSunColor * ndl * (0.18 + 1.3 * casc) * atten);
        lit += base * vec3(0.018, 0.030, 0.032);
        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });

  const rockGeo = makeRockGeometry();
  const specs: Array<[number, number, number, number, number]> = [
    [-2.55, 0.0, 0.55, 1.15, 0.8],
    [-1.7, 0.0, -0.9, 0.7, 0.6],
    [2.4, 0.0, 0.2, 1.0, 0.9],
    [1.55, 0.0, 0.95, 0.55, 0.5],
    [0.15, 0.0, -1.25, 0.85, 0.45],
  ];
  for (const [x, y, z, s, sy] of specs) {
    const m = new THREE.Mesh(rockGeo, mat);
    m.position.set(x, SAND_TOP + y - 0.15, z);
    m.scale.set(s, s * sy, s * 0.9);
    m.rotation.y = Math.random() * Math.PI * 2;
    group.add(m);
  }

  // driftwood: a bent tapered tube
  const wood = makeDriftwood(sh);
  group.add(wood);
  return group;
}

function makeRockGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 3);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const disp =
      1 +
      0.24 * Math.sin(n.x * 3.1 + n.y * 2.3) * Math.cos(n.z * 2.7) +
      0.13 * Math.sin(n.x * 7 + n.z * 5.5) +
      0.06 * Math.sin(n.y * 13.0);
    v.multiplyScalar(disp);
    v.y *= 0.72;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function makeDriftwood(sh: Shared): THREE.Mesh {
  // A sweeping branch built from a tube along a curve.
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-2.1, SAND_TOP - 0.1, -0.2),
    new THREE.Vector3(-1.3, SAND_TOP + 0.55, 0.25),
    new THREE.Vector3(-0.4, SAND_TOP + 0.95, -0.15),
    new THREE.Vector3(0.55, SAND_TOP + 1.15, 0.2),
    new THREE.Vector3(1.45, SAND_TOP + 0.85, -0.1),
  ]);
  const g = new THREE.TubeGeometry(curve, 96, 0.14, 12, false);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...stdChunks(sh) },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${TANKCHUNK}
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main(){
        vec3 N = normalize(vNormal);
        float grain = fbm3(vec2(vWorld.z * 5.0, vWorld.y * 26.0));
        vec3 base = mix(vec3(0.16, 0.11, 0.07), vec3(0.34, 0.24, 0.15), grain);
        float ndl = max(0.0, dot(N, uSunDir));
        float casc = causticSample(vWorld, uTime);
        float atten = exp(-max(0.0, 4.05 - vWorld.y) * 0.13);
        vec3 lit = base * (uSunColor * ndl * (0.2 + 1.25 * casc) * atten);
        lit += base * vec3(0.018, 0.030, 0.030);
        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });
  return new THREE.Mesh(g, mat);
}

// ---------------------------------------------------------------------------
// Plants (instanced ribbons)
// ---------------------------------------------------------------------------
export function makePlants(sh: Shared): THREE.Mesh {
  const count = 46;
  const segs = 10;
  const gw = 0.09;
  const base = new THREE.PlaneGeometry(gw, 1, 1, segs);
  base.translate(0, 0.5, 0);

  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.attributes.position = base.attributes.position;
  geo.attributes.normal = base.attributes.normal;
  geo.attributes.uv = base.attributes.uv;

  const offsets = new Float32Array(count * 3);
  const params = new Float32Array(count * 4);
  let s = 12345;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < count; i++) {
    const ang = rnd() * Math.PI * 2;
    const rad = 1.4 + rnd() * 2.5;
    offsets[i * 3 + 0] = Math.cos(ang) * rad * 0.85;
    offsets[i * 3 + 1] = SAND_TOP - 0.05 + rnd() * 0.1;
    offsets[i * 3 + 2] = Math.sin(ang) * rad * 0.55;
    params[i * 4 + 0] = 1.1 + rnd() * 2.4;      // height
    params[i * 4 + 1] = rnd() * 6.28;           // phase
    params[i * 4 + 2] = 0.7 + rnd() * 0.9;      // sway
    params[i * 4 + 3] = 0.55 + rnd() * 0.75;    // width
  }
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
  geo.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4));
  geo.instanceCount = count;

  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { ...stdChunks(sh) },
    vertexShader: /* glsl */ `
      ${NOISE}
      attribute vec3 aOffset;
      attribute vec4 aParams;
      uniform float uTime;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vH;
      varying float vSide;
      void main(){
        vec3 p = position;
        float h = aParams.x;
        float phase = aParams.y;
        float sway = aParams.z;
        vH = p.y;

        // ribbon tapers and curves
        float t = p.y;
        p.x *= mix(1.0, 0.35, t);
        p.x += sin(uTime * 0.9 + phase + t * 2.2) * sway * 0.10 * t * t;
        p.z += cos(uTime * 0.7 + phase * 1.3 + t * 1.7) * sway * 0.07 * t * t;
        p.y *= h;

        // twist
        float tw = sin(uTime * 0.55 + phase) * 0.5;
        float cx = cos(tw), sx = sin(tw);
        p.xz = mat2(cx, -sx, sx, cx) * p.xz;

        vec3 wp = p + aOffset;
        vWorld = wp;
        vNormal = normalize(vec3(p.x, 0.35, p.z) * 0.25 + vec3(0.0, 0.2, 0.0));
        vSide = position.x < 0.0 ? 0.0 : 1.0;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${TANKCHUNK}
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vH;
      varying float vSide;
      void main(){
        float vein = smoothstep(0.55, 1.0, noise2(vec2(vSide * 3.0, vH * 26.0)));
        vec3 colA = vec3(0.075, 0.20, 0.075);
        vec3 colB = vec3(0.16, 0.34, 0.11);
        vec3 col = mix(colA, colB, vH * 0.85 + vein * 0.3);
        col *= 0.8 + 0.35 * fbm3(vec2(vSide * 2.0, vH * 9.0));

        vec3 N = normalize(vNormal);
        float ndl = abs(dot(N, uSunDir)) * 0.7 + 0.3;
        float casc = causticSample(vWorld, uTime);
        float atten = exp(-max(0.0, 4.05 - vWorld.y) * 0.13);
        vec3 lit = col * (uSunColor * ndl * (0.2 + 1.3 * casc) * atten);
        lit += col * vec3(0.014, 0.028, 0.028);
        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------------------

export function makeLights(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0x8fb6c8, 0x1a1a14, 0.35));
  const key = new THREE.DirectionalLight(0xfff2dd, 1.4);
  key.position.set(-2.5, 8, 3.2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7fc8e6, 0.45);
  rim.position.set(3, 1.5, -4);
  scene.add(rim);
}

export function qualityTag(q: Quality) {
  return QUALITY[q];
}
