import * as THREE from 'three';
import type { Quality } from './config';

/** Fullscreen-quad pass helper. */
export class FullPass {
  readonly scene = new THREE.Scene();
  readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly mat: THREE.ShaderMaterial;

  constructor(frag: string, uniforms: Record<string, THREE.IUniform>) {
    this.mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: frag,
      depthTest: false,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
  }

  get u() {
    return this.mat.uniforms;
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null) {
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.cam);
  }

  dispose() {
    this.mat.dispose();
  }
}

function hdrTarget(w: number, h: number) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
}

// NaN/Inf guard: half-float chains go black forever once one leaks in.
const SANITIZE = /* glsl */ `
vec3 sane(vec3 c){
  if (any(isnan(c)) || any(isinf(c))) return vec3(0.0);
  return clamp(c, vec3(0.0), vec3(64.0));
}
`;

const COPY = /* glsl */ `
uniform sampler2D tSrc;
varying vec2 vUv;
void main(){ gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, 1.0); }
`;

const BRIGHT = /* glsl */ `
${SANITIZE}
uniform sampler2D tSrc;
uniform vec2 uLight;
uniform float uThreshold;
varying vec2 vUv;
void main(){
  vec3 c = sane(texture2D(tSrc, vUv).rgb);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float m = smoothstep(uThreshold, uThreshold * 2.2, l);
  float d = distance(vUv, uLight);
  float fall = exp(-d * d * 3.2);
  gl_FragColor = vec4(c * m * fall, 1.0);
}
`;

const RADIAL = /* glsl */ `
${SANITIZE}
uniform sampler2D tSrc;
uniform vec2 uLight;
uniform float uStrength;
varying vec2 vUv;
void main(){
  const int N = 20;
  vec2 dir = (uLight - vUv) * uStrength / float(N);
  vec2 uv = vUv;
  vec3 acc = vec3(0.0);
  float w = 1.0, wsum = 0.0;
  for (int i = 0; i < N; i++){
    acc += sane(texture2D(tSrc, uv).rgb) * w;
    wsum += w;
    uv += dir;
    w *= 0.93;
  }
  gl_FragColor = vec4(acc / wsum, 1.0);
}
`;

const BLUR = /* glsl */ `
${SANITIZE}
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main(){
  vec3 c = sane(texture2D(tSrc, vUv).rgb) * 0.227027;
  c += sane(texture2D(tSrc, vUv + uDir * 1.384615).rgb) * 0.316216;
  c += sane(texture2D(tSrc, vUv - uDir * 1.384615).rgb) * 0.316216;
  c += sane(texture2D(tSrc, vUv + uDir * 3.230769).rgb) * 0.070270;
  c += sane(texture2D(tSrc, vUv - uDir * 3.230769).rgb) * 0.070270;
  gl_FragColor = vec4(c, 1.0);
}
`;

const DOF = /* glsl */ `
${SANITIZE}
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uFocus;
uniform float uRange;
uniform float uMaxBlur;
uniform float uNear;
uniform float uFar;
varying vec2 vUv;

// depth buffer is non-linear; convert to view-space distance before blurring
float linearDepth(float d){
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

void main(){
  float dist = linearDepth(texture2D(tDepth, vUv).x);
  float c = clamp(abs(dist - uFocus) / uRange, 0.0, 1.0);
  vec3 base = sane(texture2D(tColor, vUv).rgb);
  if (c < 0.02){ gl_FragColor = vec4(base, 1.0); return; }
  vec3 acc = base;
  float wsum = 1.0;
  for (int i = 0; i < 16; i++){
    float a = float(i) * 2.39996;
    float r = sqrt(float(i) + 0.5) * 0.25;
    vec2 off = vec2(cos(a), sin(a)) * r * uMaxBlur * c * uTexel;
    float dd = linearDepth(texture2D(tDepth, vUv + off).x);
    // don't smear foreground subjects over the far background
    float w = 1.0 - clamp(abs(dd - dist) * 1.2, 0.0, 1.0) * 0.7;
    acc += sane(texture2D(tColor, vUv + off).rgb) * w;
    wsum += w;
  }
  gl_FragColor = vec4(acc / wsum, 1.0);
}
`;

const COMPOSITE = /* glsl */ `
${SANITIZE}
uniform sampler2D tColor;
uniform sampler2D tBloom;
uniform sampler2D tRays;
uniform float uTime;
uniform float uExposure;
uniform float uBloom;
uniform float uRays;
uniform vec2 uRes;
uniform float uDebug;
varying vec2 vUv;

vec3 aces(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main(){
  vec2 uv = vUv;
  vec2 d = uv - 0.5;
  float r2 = dot(d, d);
  vec2 ca = d * r2 * 0.0035;

  vec3 col = vec3(
    sane(texture2D(tColor, uv - ca).rgb).r,
    sane(texture2D(tColor, uv).rgb).g,
    sane(texture2D(tColor, uv + ca).rgb).b
  );
  if (uDebug > 0.5 && uDebug < 1.5) { gl_FragColor = vec4(col, 1.0); return; }

  col += sane(texture2D(tBloom, uv).rgb) * uBloom;
  col += sane(texture2D(tRays, uv).rgb) * uRays;
  if (uDebug > 1.5) { gl_FragColor = vec4(col, 1.0); return; }

  col = aces(max(col * uExposure, vec3(0.0)));

  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, col * vec3(0.90, 1.02, 1.06), 0.55);
  col += vec3(0.004, 0.010, 0.013) * (1.0 - smoothstep(0.0, 0.35, l));

  col *= 1.0 - smoothstep(0.10, 0.62, r2) * 0.55;

  // a touch of grain only: heavy noise reads as dirt on the glass
  float g = hash(uv * uRes + fract(uTime) * 91.7);
  col += (g - 0.5) * 0.004;

  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}
`;

export class Post {
  readonly sceneRT: THREE.WebGLRenderTarget;
  readonly depthTex: THREE.DepthTexture;
  private copy: FullPass;
  private bright: FullPass;
  private radial: FullPass;
  private blur: FullPass;
  private dof: FullPass;
  private composite: FullPass;

  private rtCopy: THREE.WebGLRenderTarget;
  private rtMedia: THREE.WebGLRenderTarget;
  private rtBright: THREE.WebGLRenderTarget;
  private rtRayA: THREE.WebGLRenderTarget;
  private rtRayB: THREE.WebGLRenderTarget;
  private rtDof: THREE.WebGLRenderTarget;
  private bloomDown: THREE.WebGLRenderTarget[] = [];
  private bloomUp: THREE.WebGLRenderTarget[] = [];
  private w = 1;
  private h = 1;

  useDof: boolean;
  useBloom: boolean;

  constructor(q: Quality) {
    this.useDof = q !== 'low';
    this.useBloom = q !== 'low';

    this.depthTex = new THREE.DepthTexture(1, 1);
    this.depthTex.type = THREE.UnsignedIntType;
    // no MSAA: multisampled depth textures are unreliable across drivers, and
    // we already supersample via pixelRatio.
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      depthTexture: this.depthTex,
    });

    this.rtCopy = hdrTarget(1, 1);
    this.rtMedia = hdrTarget(1, 1);
    this.rtBright = hdrTarget(1, 1);
    this.rtRayA = hdrTarget(1, 1);
    this.rtRayB = hdrTarget(1, 1);
    this.rtDof = hdrTarget(1, 1);

    this.copy = new FullPass(COPY, { tSrc: { value: null } });
    this.bright = new FullPass(BRIGHT, {
      tSrc: { value: null },
      uLight: { value: new THREE.Vector2(0.5, 0.85) },
      uThreshold: { value: 1.15 },
    });
    this.radial = new FullPass(RADIAL, {
      tSrc: { value: null },
      uLight: { value: new THREE.Vector2(0.5, 0.85) },
      uStrength: { value: 0.22 },
    });
    this.blur = new FullPass(BLUR, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.dof = new FullPass(DOF, {
      tColor: { value: null },
      tDepth: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uFocus: { value: 11 },
      uRange: { value: 16 },
      uMaxBlur: { value: 1.6 },
      uNear: { value: 0.1 },
      uFar: { value: 120 },
    });
    this.composite = new FullPass(COMPOSITE, {
      tColor: { value: null },
      tBloom: { value: null },
      tRays: { value: null },
      uTime: { value: 0 },
      uExposure: { value: 0.50 },
      uBloom: { value: 0.10 },
      uRays: { value: 0.20 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uDebug: { value: 0 },
    });
  }

  setSize(w: number, h: number, pr: number) {
    const W = Math.max(2, Math.floor(w * pr));
    const H = Math.max(2, Math.floor(h * pr));
    if (W === this.w && H === this.h) return;
    this.w = W;
    this.h = H;

    this.sceneRT.setSize(W, H);
    this.rtCopy.setSize(W, H);
    this.rtMedia.setSize(W, H);
    this.rtDof.setSize(W, H);

    const hw = Math.max(2, W >> 1), hh = Math.max(2, H >> 1);
    this.rtBright.setSize(hw, hh);
    this.rtRayA.setSize(hw, hh);
    this.rtRayB.setSize(hw, hh);

    for (const t of [...this.bloomDown, ...this.bloomUp]) t.dispose();
    this.bloomDown = [];
    this.bloomUp = [];
    let mw = hw, mh = hh;
    for (let i = 0; i < 5; i++) {
      mw = Math.max(2, mw >> 1);
      mh = Math.max(2, mh >> 1);
      this.bloomDown.push(hdrTarget(mw, mh));
      this.bloomUp.push(hdrTarget(mw, mh));
    }
    this.composite.u.uRes.value.set(W, H);
  }

  /** Switching tiers rebuilds the bloom chain without recreating the renderer. */
  setQuality(q: Quality) {
    this.useDof = q !== 'low';
    this.useBloom = q !== 'low';
    for (const t of [...this.bloomDown, ...this.bloomUp]) t.dispose();
    this.bloomDown = [];
    this.bloomUp = [];
    const hw = Math.max(2, this.w >> 1), hh = Math.max(2, this.h >> 1);
    let mw = hw, mh = hh;
    for (let i = 0; i < (this.useBloom ? 5 : 0); i++) {
      mw = Math.max(2, mw >> 1);
      mh = Math.max(2, mh >> 1);
      this.bloomDown.push(hdrTarget(mw, mh));
      this.bloomUp.push(hdrTarget(mw, mh));
    }
    this.composite.u.uBloom.value = this.useBloom ? 0.50 : 0.0;
  }

  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    lightScreen: THREE.Vector2,
    time: number,
    media: FullPass | null = null,
    glass: { scene: THREE.Scene; uniforms: Record<string, THREE.IUniform> } | null = null,
    opts: { skipDof?: boolean; skipFx?: boolean; debug?: number } = {},
  ) {
    // 1. opaque HDR scene
    renderer.setRenderTarget(this.sceneRT);
    renderer.clear();
    renderer.render(scene, camera);

    // 2. underwater medium
    let lit: THREE.Texture = this.sceneRT.texture;
    if (media) {
      media.u.tColor.value = this.sceneRT.texture;
      media.u.tDepth.value = this.depthTex;
      media.render(renderer, this.rtMedia);
      lit = this.rtMedia.texture;
    }

    // 3. glass overlay, composited over a copy of the lit frame
    if (glass) {
      this.copy.u.tSrc.value = lit;
      this.copy.render(renderer, this.rtCopy);
      glass.uniforms.uScene.value = lit;
      renderer.setRenderTarget(this.rtCopy);
      renderer.render(glass.scene, camera);
      lit = this.rtCopy.texture;
    }

    // 4. depth of field — only the far background is softened. Focusing on the
    //    camera distance blurred the fish themselves, which is why a higher
    //    tier looked worse than a lower one.
    if (this.useDof && !opts.skipDof) {
      this.dof.u.tColor.value = lit;
      this.dof.u.tDepth.value = this.depthTex;
      this.dof.u.uTexel.value.set(1 / this.w, 1 / this.h);
      this.dof.u.uFocus.value = camera.position.distanceTo(new THREE.Vector3(0, 2.3, 0)) + 6.0;
      this.dof.u.uNear.value = camera.near;
      this.dof.u.uFar.value = camera.far;
      this.dof.render(renderer, this.rtDof);
      lit = this.rtDof.texture;
    }

    // 5. god rays + bloom
    let rays: THREE.Texture | null = null;
    let bloom: THREE.Texture | null = null;
    if (this.useBloom && !opts.skipFx) {
      this.bright.u.tSrc.value = lit;
      this.bright.u.uLight.value.copy(lightScreen);
      this.bright.render(renderer, this.rtBright);

      this.radial.u.tSrc.value = this.rtBright.texture;
      this.radial.u.uLight.value.copy(lightScreen);
      this.radial.render(renderer, this.rtRayA);
      this.radial.u.tSrc.value = this.rtRayA.texture;
      this.radial.render(renderer, this.rtRayB);
      this.blur.u.tSrc.value = this.rtRayB.texture;
      this.blur.u.uDir.value.set(1.2 / this.rtRayB.width, 0);
      this.blur.render(renderer, this.rtRayA);
      this.blur.u.tSrc.value = this.rtRayA.texture;
      this.blur.u.uDir.value.set(0, 1.2 / this.rtRayB.height);
      this.blur.render(renderer, this.rtRayB);
      rays = this.rtRayB.texture;

      // downsample
      let src: THREE.Texture = lit;
      for (let i = 0; i < this.bloomDown.length; i++) {
        const t = this.bloomDown[i];
        this.blur.u.tSrc.value = src;
        this.blur.u.uDir.value.set(1.0 / t.width, 0);
        this.blur.render(renderer, t);
        src = t.texture;
      }
      // upsample back
      let up: THREE.Texture = this.bloomDown[this.bloomDown.length - 1].texture;
      for (let i = this.bloomUp.length - 1; i >= 0; i--) {
        const t = this.bloomUp[i];
        this.blur.u.tSrc.value = up;
        this.blur.u.uDir.value.set(1.0 / t.width, 0);
        this.blur.render(renderer, t);
        up = t.texture;
      }
      bloom = this.bloomUp[0].texture;
    }

    // 6. composite to screen
    this.composite.u.tColor.value = lit;
    this.composite.u.tBloom.value = bloom;
    this.composite.u.tRays.value = rays;
    this.composite.u.uTime.value = time;
    this.composite.u.uDebug.value = opts.debug ?? 0;
    this.composite.render(renderer, null);
  }
}
