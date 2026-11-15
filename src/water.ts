import * as THREE from 'three';
import { NOISE, ENV } from './glsl';
import { TANK, WATER_Y, SAND_TOP } from './config';
import { FullPass } from './post';
import type { Shared } from './scene';

// ---------------------------------------------------------------------------
// Ripples: a tiny CPU wave field the surface shader samples via a texture.
// ---------------------------------------------------------------------------
const RIPPLE_W = 128;
const RIPPLE_H = 64;

export class RippleField {
  readonly texture: THREE.DataTexture;
  private data = new Float32Array(RIPPLE_W * RIPPLE_H * 4);
  private px = new Float32Array(RIPPLE_W * RIPPLE_H);
  private pv = new Float32Array(RIPPLE_W * RIPPLE_H);

  constructor() {
    this.texture = new THREE.DataTexture(this.data, RIPPLE_W, RIPPLE_H, THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
  }

  /** world x,z in tank space */
  stir(x: number, z: number, strength: number) {
    const cx = Math.round(((x / (TANK.hw * 2 - 0.12)) + 0.5) * (RIPPLE_W - 1));
    const cz = Math.round(((z / (TANK.hd * 2 - 0.12)) + 0.5) * (RIPPLE_H - 1));
    this.pv[cz * RIPPLE_W + cx] += strength;
  }

  update(dt: number, t: number) {
    const p = this.px, v = this.pv;
    const damp = 0.985;
    // simple wave equation: laplacian + damping
    const next = new Float32Array(p.length);
    for (let y = 1; y < RIPPLE_H - 1; y++) {
      for (let x = 1; x < RIPPLE_W - 1; x++) {
        const i = y * RIPPLE_W + x;
        const lap = p[i - 1] + p[i + 1] + p[i - RIPPLE_W] + p[i + RIPPLE_W] - 4 * p[i];
        v[i] = (v[i] + lap * 0.72) * damp;
        next[i] = p[i] + v[i] * dt * 26;
      }
    }
    this.px = next;
    // ambient slosh so the surface never looks frozen
    const ax = Math.floor(((Math.sin(t * 0.7) * 0.5 + 0.5) * (RIPPLE_W - 4))) + 2;
    const az = Math.floor(((Math.cos(t * 0.43) * 0.5 + 0.5) * (RIPPLE_H - 4))) + 2;
    this.pv[az * RIPPLE_W + ax] += Math.sin(t * 3.1) * 0.02;

    // pack: normal-ish gradient into rgb so materials get cheap detail
    const d = this.data;
    for (let y = 0; y < RIPPLE_H; y++) {
      for (let x = 0; x < RIPPLE_W; x++) {
        const i = y * RIPPLE_W + x;
        const h = this.px[i];
        const gx = (this.px[i + (x < RIPPLE_W - 1 ? 1 : 0)] - this.px[i - (x > 0 ? 1 : 0)]);
        const gz = (this.px[i + (y < RIPPLE_H - 1 ? RIPPLE_W : 0)] - this.px[i - (y > 0 ? RIPPLE_W : 0)]);
        d[i * 4 + 0] = gx * 3.0;
        d[i * 4 + 1] = gz * 3.0;
        d[i * 4 + 2] = h;
        d[i * 4 + 3] = 1;
      }
    }
    this.texture.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Water surface
// ---------------------------------------------------------------------------
export function makeWaterSurface(sh: Shared, ripple: RippleField): THREE.Mesh {
  const W = TANK.hw * 2 - 0.06;
  const D = TANK.hd * 2 - 0.06;
  const g = new THREE.PlaneGeometry(W, D, 160, 80);
  g.rotateX(-Math.PI / 2);

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: sh.uTime,
      uRipple: { value: ripple.texture },
      uSunDir: sh.uSunDir,
      uSunColor: sh.uSunColor,
      uW: { value: W },
      uD: { value: D },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform sampler2D uRipple;
      uniform float uW, uD;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vRip;
      varying vec2 vUv;

      float wave(vec2 p, float t){
        return sin(p.x * 1.9 + t * 0.85) * 0.010
             + sin(p.y * 2.6 - t * 1.05) * 0.0075
             + sin((p.x * 1.3 + p.y * 2.1) * 2.2 + t * 1.5) * 0.0035;
      }
      float height(vec2 p, float t){
        vec2 uv = p / vec2(uW, uD) + 0.5;
        return wave(p, t) + texture2D(uRipple, uv).z * 0.55;
      }
      void main(){
        vec3 p = position;
        float h = height(p.xz, uTime);
        p.y += h;
        float e = 0.05;
        float hx = height(p.xz + vec2(e, 0.0), uTime);
        float hz = height(p.xz + vec2(0.0, e), uTime);
        vec3 n = normalize(vec3(-(hx - h) / e, 1.0, -(hz - h) / e));
        vNormal = n;
        vUv = p.xz / vec2(uW, uD) + 0.5;
        vRip = texture2D(uRipple, vUv).z;
        vWorld = vec3(p.x, ${WATER_Y.toFixed(3)} + p.y, p.z);
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE}
      ${ENV}
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vRip;
      varying vec2 vUv;
      void main(){
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(0.0, dot(N, V)), 5.0);

        vec3 R = reflect(-V, N);
        vec3 sky = envColor(normalize(R), uSunDir);

        // water body seen from above/below
        vec3 deep = vec3(0.030, 0.070, 0.082);
        vec3 shallow = vec3(0.075, 0.155, 0.155);
        vec3 body = mix(deep, shallow, smoothstep(0.0, 0.6, vRip * 2.0 + 0.25));

        // caustic-ish shimmer riding on the ripples
        float shimmer = pow(max(0.0, noise2(vWorld.xz * 7.0 + uTime * 0.3) - 0.45), 2.0) * 1.8;

        vec3 col = mix(body, sky, clamp(fres * 1.9, 0.0, 1.0));
        vec3 H = normalize(uSunDir + V);
        col += uSunColor * pow(max(0.0, dot(N, H)), 380.0) * 2.4;
        col += uSunColor * shimmer * 0.22;

        // thin meniscus line along the glass
        vec2 e = min(vUv, 1.0 - vUv);
        float edge = 1.0 - smoothstep(0.0, 0.018, min(e.x, e.y));
        col += vec3(0.65, 0.9, 0.88) * edge * 0.35;

        float a = mix(0.18, 0.72, fres);
        a = max(a, edge * 0.7);
        gl_FragColor = vec4(col, a);
      }
    `,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 6;
  return mesh;
}

// ---------------------------------------------------------------------------
// Underwater medium pass (screen space, after the scene)
// ---------------------------------------------------------------------------
export function makeMediaPass(): FullPass {
  return new FullPass(
    /* glsl */ `
    uniform sampler2D tColor;
    uniform sampler2D tDepth;
    uniform mat4 uProjInv;
    uniform mat4 uCamWorld;
    uniform vec3 uCamPos;
    uniform float uNear;
    uniform float uFar;
    uniform float uWaterY;
    uniform vec3 uSigma;
    uniform vec3 uInscatter;
    uniform vec3 uSunDir;
    uniform float uTime;
    varying vec2 vUv;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise2(vec2 x){
      vec2 i = floor(x), f = fract(x);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }

    void main(){
      vec3 col = texture2D(tColor, vUv).rgb;
      float d = texture2D(tDepth, vUv).x;

      // background pixels (nothing drawn) must never be fogged, or the fog
      // paints a wall of water across the whole viewport
      if (d >= 0.99999) { gl_FragColor = vec4(col, 1.0); return; }

      // reconstruct the world-space hit point
      vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
      vec4 vp = uProjInv * ndc;
      vp.xyz /= vp.w;
      vec3 viewDir = normalize(vp.xyz);
      vec3 worldDir = normalize(mat3(uCamWorld) * viewDir);
      float z = d * 2.0 - 1.0;
      float linear = (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
      vec3 world = uCamPos + worldDir * linear;
      if (world.y > uWaterY) { gl_FragColor = vec4(col, 1.0); return; }

      // distance from where the ray enters the water down to the hit point
      float enter = 0.0;
      if (uCamPos.y > uWaterY) {
        float denom = worldDir.y;
        enter = denom < -1e-4 ? (uWaterY - uCamPos.y) / denom : linear;
      }
      float waterPath = clamp(linear - enter, 0.02, 30.0);

      vec3 trans = exp(-uSigma * waterPath);
      vec3 fog = uInscatter * (1.0 - exp(-waterPath * 0.16));

      // Volumetric haze only. A per-pixel "dust" term here aliased into a
      // screen-space grain that read as dirt on the glass, so it is gone.
      vec3 c = col * trans + fog;

      gl_FragColor = vec4(c, 1.0);
    }
    `,
    {
      tColor: { value: null },
      tDepth: { value: null },
      uProjInv: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uNear: { value: 0.1 },
      uFar: { value: 100 },
      uWaterY: { value: WATER_Y },
      uSigma: { value: new THREE.Vector3(0.075, 0.022, 0.014) },
      uInscatter: { value: new THREE.Color(0.006, 0.016, 0.021) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uTime: { value: 0 },
    },
  );
}

// ---------------------------------------------------------------------------
// Bubbles
// ---------------------------------------------------------------------------
export class Bubbles {
  readonly mesh: THREE.InstancedMesh;
  private p: Float32Array;
  private seed: Float32Array;
  private n: number;
  private dummy = new THREE.Object3D();

  constructor(count: number) {
    this.n = count;
    this.p = new Float32Array(count * 4);
    this.seed = new Float32Array(count);
    let s = 999;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < count; i++) {
      this.p[i * 4] = (rnd() - 0.5) * (TANK.hw * 1.7);
      this.p[i * 4 + 1] = SAND_TOP + rnd() * (WATER_Y - SAND_TOP);
      this.p[i * 4 + 2] = (rnd() - 0.5) * (TANK.hd * 1.6);
      this.p[i * 4 + 3] = 0.01 + rnd() * 0.035;
      this.seed[i] = rnd() * 100;
    }
    const geo = new THREE.SphereGeometry(1, 8, 6);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3() },
        uSunColor: { value: new THREE.Color() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vW;
        varying float vR;
        void main(){
          mat4 mw = modelMatrix * instanceMatrix;
          vec3 wp = (mw * vec4(position, 1.0)).xyz;
          vW = wp;
          vN = normalize(mat3(mw) * normal);
          vR = length(mw[0].xyz);
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        varying vec3 vN;
        varying vec3 vW;
        varying float vR;
        void main(){
          vec3 N = normalize(vN);
          vec3 V = normalize(cameraPosition - vW);
          float fres = pow(1.0 - abs(dot(N, V)), 2.2);
          float rim = pow(1.0 - abs(dot(N, V)), 5.0);
          vec3 col = vec3(0.55, 0.80, 0.82) * (0.25 + fres * 1.2);
          col += uSunColor * pow(max(0.0, dot(reflect(-uSunDir, N), V)), 220.0) * 1.4;
          col += vec3(1.0) * rim * 0.5;
          gl_FragColor = vec4(col, clamp(0.10 + fres * 0.65, 0.0, 0.85));
        }
      `,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
  }

  /** Live particle budget for quality switches. */
  setCount(n: number) {
    this.mesh.count = Math.min(n, this.mesh.instanceMatrix.count);
  }

  update(dt: number, sh: Shared) {
    (this.mesh.material as THREE.ShaderMaterial).uniforms.uTime.value = sh.uTime.value;
    (this.mesh.material as THREE.ShaderMaterial).uniforms.uSunDir.value.copy(sh.uSunDir.value);
    (this.mesh.material as THREE.ShaderMaterial).uniforms.uSunColor.value.copy(sh.uSunColor.value);
    for (let i = 0; i < this.n; i++) {
      const o = i * 4;
      const spd = 0.18 + this.p[o + 3] * 9;
      this.p[o + 1] += spd * dt;
      const t = sh.uTime.value + this.seed[i];
      this.p[o] += Math.sin(t * 1.7) * 0.0016;
      this.p[o + 2] += Math.cos(t * 1.3) * 0.0016;
      if (this.p[o + 1] > WATER_Y - 0.03) {
        this.p[o + 1] = SAND_TOP + Math.random() * 0.3;
        this.p[o] = (Math.random() - 0.5) * (TANK.hw * 1.7);
        this.p[o + 2] = (Math.random() - 0.5) * (TANK.hd * 1.6);
      }
      const r = this.p[o + 3];
      const wob = 1 + Math.sin(t * 6.0) * 0.12;
      this.dummy.position.set(this.p[o], this.p[o + 1], this.p[o + 2]);
      this.dummy.scale.set(r * wob, r * (1.15 / wob), r * wob);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Floating dust
// ---------------------------------------------------------------------------
export class Dust {
  readonly mesh: THREE.Points;
  private p: Float32Array;
  private seed: Float32Array;

  constructor(count: number) {
    this.p = new Float32Array(count * 3);
    this.seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.p[i * 3] = (Math.random() - 0.5) * TANK.hw * 1.9;
      this.p[i * 3 + 1] = SAND_TOP + Math.random() * (WATER_Y - SAND_TOP);
      this.p[i * 3 + 2] = (Math.random() - 0.5) * TANK.hd * 1.8;
      this.seed[i] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) } },
      vertexShader: /* glsl */ `
        uniform float uTime;
        attribute float aSeed;
        varying float vA;
        void main(){
          vec3 p = position;
          float t = uTime + aSeed;
          p.x += sin(t * 0.14) * 0.16 + sin(t * 0.31) * 0.05;
          p.y += sin(t * 0.19) * 0.10;
          p.z += cos(t * 0.12) * 0.13;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          vA = smoothstep(0.6, 2.5, d) * (1.0 - smoothstep(12.0, 22.0, d));
          gl_PointSize = (0.5 + aSeed * 0.008) * (70.0 / max(1.0, d));
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.05, d) * vA * 0.055;
          gl_FragColor = vec4(vec3(0.75, 0.86, 0.82) * 0.8, a);
        }
      `,
    });
    this.mesh = new THREE.Points(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
  }

  update(t: number) {
    (this.mesh.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
  }

  setCount(n: number) {
    const total = this.mesh.geometry.attributes.position.count;
    this.mesh.geometry.setDrawRange(0, Math.min(n, total));
  }
}
