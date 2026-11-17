import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CausticPass } from './caustic';
import { makeShared, type Shared } from './scene';
import { makeFish, STYLES, type FishSpecies } from './fish';
import { FullPass } from './post';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const toggle = document.getElementById('toggle') as HTMLButtonElement;

// ---- silhouette mode
//
// `?silhouette=1` renders the body mesh alone, flat white on black, through an
// orthographic side camera with no post-processing. Nothing else can be used to
// judge the outline: a perspective camera foreshortens by depth, the shading
// hides where the surface actually ends, and the fins extend the silhouette
// past the body. This mode exists so tools/silhouette.mjs can compare the exact
// rendered shape against the reference line art, pixel for pixel, instead of
// anyone eying a screenshot.
const silhouetteMode = new URLSearchParams(location.search).has('silhouette');
// `silhouette=all` keeps the fins in the mask. The body-only silhouette is the
// right thing for checking the profile against the drawing, but the user is
// judging the whole animal — and the dorsal, pectoral and pelvic fins add a
// great deal of apparent bulk. Both views are needed.
const silhouetteAll = new URLSearchParams(location.search).get('silhouette') === 'all';

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  // only needed so the silhouette harness can read the framebuffer back
  preserveDrawingBuffer: silhouetteMode,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

const scene = new THREE.Scene();
// The fish shaders emit linear HDR values and expect a tone-mapping pass, so
// this page does its own ACES + gamma composite rather than using Post (which
// also carries DOF, bloom and god rays that make no sense for a studio shot).
scene.background = new THREE.Color(0.012, 0.017, 0.022);

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.05, 60);

const caustic = new CausticPass(256);
const shared: Shared = makeShared('high', caustic.rt.texture);

// ---- subject
const species: FishSpecies = (new URLSearchParams(location.search).get('species') as FishSpecies) || 'oranda';
const style = STYLES[species] ?? STYLES.oranda;
const built = makeFish(style, shared);
scene.add(built.group);

// ---- silhouette mode
//
// `?silhouette=1` renders the body mesh alone, flat white on black, through an
// orthographic side camera with no post-processing. Nothing else can be used to
// judge the outline: a perspective camera foreshortens by depth, the shading
// hides where the surface actually ends, and the fins extend the silhouette
// past the body. This mode exists so tools/silhouette.mjs can compare the exact
// rendered shape against the reference line art, pixel for pixel, instead of
// anyone eying a screenshot.
const bounds = new THREE.Box3().setFromObject(built.group);
const size = bounds.getSize(new THREE.Vector3());
const centre = bounds.getCenter(new THREE.Vector3());
const radius = Math.max(size.x, size.y, size.z);
built.group.position.sub(centre);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.enablePan = false;
controls.minDistance = radius * 1.15;
controls.maxDistance = radius * 6.0;
controls.target.set(0, 0, 0);
camera.position.set(radius * 1.35, radius * 0.35, radius * 1.25);
controls.update();

// ---- silhouette rig: replace the perspective camera with a true orthographic
// side view of the body alone.
let ortho: THREE.OrthographicCamera | null = null;
let silhouetteScene: THREE.Scene | null = null;
if (silhouetteMode) {
  const bodyBox = new THREE.Box3().setFromObject(built.body);
  const bs = bodyBox.getSize(new THREE.Vector3());
  const bc = bodyBox.getCenter(new THREE.Vector3());
  // The fish's long axis is LOCAL Z (z = (t-0.5)*L), and the camera looks down
  // x, so screen-horizontal maps to z. Framing off bs.x (the body's *thickness*)
  // made the box far narrower than the fish and clipped both ends flat.
  const halfW = bs.z * 0.56;
  const aspect = window.innerWidth / window.innerHeight;
  const halfH = halfW / aspect;
  ortho = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.01, 200);
  ortho.position.set(bc.x + 50, bc.y, bc.z);
  ortho.up.set(0, 1, 0);
  ortho.lookAt(bc.x, bc.y, bc.z);

  // flat fill, no lighting at all: this is a mask, not a render
  const silhouetteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  silhouetteScene = new THREE.Scene();
  silhouetteScene.background = new THREE.Color(0, 0, 0);

  if (silhouetteAll) {
    // every mesh in the group, which includes the fins and the cloth tail
    built.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = silhouetteMat;
    });
    silhouetteScene.add(built.group);
  } else {
    built.body.material = silhouetteMat;
    built.body.geometry.clearGroups();
    silhouetteScene.add(built.body);
  }
  built.body.position.set(0, 0, 0);
}

// ---- composite: ACES + gamma + a soft studio vignette
const composite = new FullPass(
  /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uRes;
  varying vec2 vUv;

  vec3 aces(vec3 x){
    const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
  }
  void main(){
    vec3 col = texture2D(tSrc, vUv).rgb;
    col = aces(max(col, vec3(0.0)));
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, col * vec3(0.94, 1.01, 1.04), 0.35);
    col += vec3(0.004, 0.008, 0.011) * (1.0 - smoothstep(0.0, 0.30, l));
    vec2 d = vUv - 0.5;
    col *= 1.0 - smoothstep(0.18, 0.75, dot(d, d) * 1.6) * 0.45;
    gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
  }
  `,
  { tSrc: { value: null }, uRes: { value: new THREE.Vector2(1, 1) } },
);

const sceneRT = new THREE.WebGLRenderTarget(1, 1, {
  type: THREE.HalfFloatType,
  format: THREE.RGBAFormat,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
});

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const pr = Math.min(window.devicePixelRatio, 2);
  sceneRT.setSize(Math.floor(w * pr), Math.floor(h * pr));
  composite.u.uRes.value.set(w * pr, h * pr);
}
window.addEventListener('resize', resize);
resize();

// ---- playback state
let playing = true;
let time = 0;
let swimPhase = Math.random() * 6.28;
const flow = new THREE.Vector3();

function setPlaying(v: boolean) {
  playing = v;
  toggle.textContent = v ? '动态' : '静态';
  toggle.classList.toggle('on', v);
  // In static mode the swim amplitude drops to zero and the caudal cloth keeps
  // relaxing with no flow, so the body settles straight and the tail comes to
  // rest instead of freezing mid-stroke.
  built.uniforms.uSwimAmp.value = v ? 0.13 : 0.0;
  built.uniforms.uSwimFreq.value = v ? 3.2 : 0.0;
}

toggle.addEventListener('click', () => setPlaying(!playing));
setPlaying(true);

const clock = new THREE.Clock();

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());

  if (playing) {
    time += dt;
    // same integration the aquarium uses, so the motion matches the tank
    swimPhase += 3.2 * dt;
    built.uniforms.uSwimPhase.value = swimPhase;
    built.uniforms.uMouth.value = 0.10 + 0.08 * Math.sin(time * 0.9);
  } else {
    // hold the pose; the cloth settles on its own
    built.uniforms.uSwimPhase.value = swimPhase;
    built.uniforms.uMouth.value = 0.06;
  }

  shared.uTime.value = time;
  built.updateTail(dt, time, flow);
  caustic.render(renderer, time);

  controls.update();

  renderer.setRenderTarget(null);
  renderer.clear();
  if (silhouetteMode && ortho && silhouetteScene) {
    renderer.render(silhouetteScene, ortho);
  } else {
    renderer.setRenderTarget(sceneRT);
    renderer.clear();
    renderer.render(scene, camera);

    composite.u.tSrc.value = sceneRT.texture;
    composite.render(renderer, null);
  }
}

declare global {
  interface Window {
    __ready?: boolean;
    __showcase?: {
      setPlaying: (v: boolean) => void;
      isPlaying: () => boolean;
    };
  }
}

window.__showcase = { setPlaying, isPlaying: () => playing };
// exposed so the screenshot harness can orbit to a fixed angle
window.__camera = { camera, controls };
window.__ready = true;
frame();
