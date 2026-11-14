import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WATER_Y, SAND_TOP, QUALITY, type Quality } from './config';
import { CausticPass } from './caustic';
import { makeShared, makeSand, makeRocks, makePlants, makeLights, type Shared } from './scene';
import { RippleField, makeWaterSurface, makeMediaPass, Bubbles, Dust } from './water';
import { makeFish, STYLES, type FishSpecies } from './fish';
import { makeGlassScene, makeTankShell } from './glass';
import { Post } from './post';
import { School, type Food } from './behavior';
import { Input } from './input';
import { Hud } from './ui';

const canvas = document.getElementById('view') as HTMLCanvasElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.toneMapping = THREE.NoToneMapping;
renderer.autoClear = false;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

let quality: Quality = 'high';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 120);
camera.position.set(0, 3.0, 11.4);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 2.35, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 6.2;
controls.maxDistance = 18;
controls.minPolarAngle = 0.55;
controls.maxPolarAngle = 1.72;
controls.enablePan = false;
controls.rotateSpeed = 0.55;

const caustic = new CausticPass(QUALITY[quality].causticSize);
const shared: Shared = makeShared(quality, caustic.rt.texture);
const post = new Post(quality);

const ripple = new RippleField();

// ---- scene assembly
makeLights(scene);
scene.add(makeSand(shared));
scene.add(makeRocks(shared));
scene.add(makePlants(shared));
scene.add(makeTankShell(shared));
const waterMesh = makeWaterSurface(shared, ripple);
scene.add(waterMesh);

const bubbles = new Bubbles(QUALITY[quality].bubbles);
scene.add(bubbles.mesh);
const dust = new Dust(QUALITY[quality].dust);
scene.add(dust.mesh);

// ---- fish
const school = new School();
const FISH_SETUP: Array<[FishSpecies, number]> = [
  ['fantail', 0.55],
  ['oranda', 0.72],
  ['fantail', 0.35],
  ['ryukin', 0.62],
  ['comet', 0.48],
  ['oranda', 0.30],
  ['comet', 0.66],
];
type FishView = { group: THREE.Group; uniforms: ReturnType<typeof makeFish>['uniforms'] };
const fishViews: FishView[] = [];

for (const [species, hunger] of FISH_SETUP) {
  const style = STYLES[species];
  const built = makeFish(style, shared);
  const s = 0.92 + Math.random() * 0.16;
  built.group.scale.setScalar(s);
  scene.add(built.group);
  school.add(species, hunger);
  fishViews.push({ group: built.group, uniforms: built.uniforms });
}

// ---- food
const FOOD_MAX = 48;
const foodGeo = new THREE.SphereGeometry(1, 10, 8);
const foodMat = new THREE.ShaderMaterial({
  uniforms: { uSunDir: shared.uSunDir, uSunColor: shared.uSunColor },
  vertexShader: /* glsl */ `
    varying vec3 vN; varying vec3 vW;
    void main(){
      vec4 mw = modelMatrix * instanceMatrix * vec4(position, 1.0);
      vec3 wp = mw.xyz;
      vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
      vW = wp;
      gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uSunDir; uniform vec3 uSunColor;
    varying vec3 vN; varying vec3 vW;
    void main(){
      vec3 N = normalize(vN);
      vec3 L = normalize(uSunDir);
      vec3 V = normalize(cameraPosition - vW);
      float ndl = max(0.0, dot(N, L));
      vec3 base = vec3(0.55, 0.30, 0.11);
      vec3 col = base * (uSunColor * ndl * 0.55 + vec3(0.10, 0.14, 0.15));
      col += vec3(0.9, 0.75, 0.5) * pow(max(0.0, dot(reflect(-L, N), V)), 60.0) * 0.35;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});
const foodMesh = new THREE.InstancedMesh(foodGeo, foodMat, FOOD_MAX);
foodMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
foodMesh.frustumCulled = false;
scene.add(foodMesh);
const foods: Food[] = [];
let foodCount = 0;

const dummy = new THREE.Object3D();

// ---- glass overlay
const glass = makeGlassScene(shared);

// ---- media pass
const media = makeMediaPass();

// ---- input / hud
const input = new Input(canvas, camera);
const hud = new Hud((q) => applyQuality(q));

// ---- resize
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post.setSize(w, h, Math.min(window.devicePixelRatio, QUALITY[quality].pixelRatio));
}
window.addEventListener('resize', resize);
resize();

function applyQuality(q: Quality) {
  if (q === quality) return;
  quality = q;
  hud.setQuality(q);
  resize();
}

// ---- stats for the screenshot harness
declare global {
  interface Window {
    __ready?: boolean;
    __stats?: unknown;
    __probe?: () => {
      foodLive: number;
      hungerSum: number;
      focusSum: number;
      fearSum: number;
      fish: number[][];
    };
  }
}

// ---- loop
const clock = new THREE.Clock();
let elapsed = 0;
let frames = 0;
let fpsAccum = 0;
let fps = 0;
let causticTimer = 0;

const obstacles = [
  new THREE.Vector3(-2.55, SAND_TOP + 0.6, 0.55),
  new THREE.Vector3(-1.7, SAND_TOP + 0.3, -0.9),
  new THREE.Vector3(2.4, SAND_TOP + 0.6, 0.2),
  new THREE.Vector3(1.55, SAND_TOP + 0.3, 0.95),
  new THREE.Vector3(0.15, SAND_TOP + 0.3, -1.25),
  new THREE.Vector3(-0.3, SAND_TOP + 1.0, 0.0),
];

const lightScreen = new THREE.Vector2(0.5, 0.85);
const sunScreenPos = new THREE.Vector3();

function spawnFood(at: THREE.Vector3) {
  for (let i = 0; i < 4; i++) {
    if (foods.filter((f) => f.alive).length >= FOOD_MAX) break;
    foods.push({
      pos: new THREE.Vector3(
        at.x + (Math.random() - 0.5) * 0.55,
        WATER_Y - 0.02,
        at.z + (Math.random() - 0.5) * 0.55,
      ),
      vel: new THREE.Vector3((Math.random() - 0.5) * 0.12, -0.05 - Math.random() * 0.05, (Math.random() - 0.5) * 0.12),
      life: 75,
      alive: true,
    });
    ripple.stir(at.x, at.z, 0.75);
    foodCount++;
  }
  hud.setFood(foodCount);
}

function updateFoods(dt: number, t: number) {
  for (const f of foods) {
    if (!f.alive) continue;
    f.life -= dt;
    if (f.life <= 0 || f.pos.y < SAND_TOP + 0.03) {
      if (f.pos.y < SAND_TOP + 0.03) f.life -= dt * 2;
      if (f.life <= 0) { f.alive = false; continue; }
    }
    // sinking with drag, slight lateral drift
    f.vel.y += -0.55 * dt;
    f.vel.multiplyScalar(1 - 1.6 * dt);
    f.vel.y = Math.max(f.vel.y, -0.55);
    f.pos.addScaledVector(f.vel, dt);
    if (f.pos.y < SAND_TOP + 0.04) {
      f.pos.y = SAND_TOP + 0.04;
      f.vel.set(0, 0, 0);
      f.life -= dt * 3;
    }
    f.pos.x += Math.sin(t * 1.7 + f.pos.z * 3.0) * 0.06 * dt;
  }
  // write instances
  let n = 0;
  for (const f of foods) {
    if (!f.alive) continue;
    if (n >= FOOD_MAX) break;
    dummy.position.copy(f.pos);
    const s = 0.045 * (0.85 + 0.3 * Math.sin(f.pos.x * 12.0));
    dummy.scale.set(s, s, s);
    dummy.rotation.set(f.pos.x, f.pos.y * 3, f.pos.z);
    dummy.updateMatrix();
    foodMesh.setMatrixAt(n, dummy.matrix);
    n++;
  }
  foodMesh.count = n;
  foodMesh.instanceMatrix.needsUpdate = true;
  if (foods.length > 120) {
    for (let i = foods.length - 1; i >= 0; i--) if (!foods[i].alive) foods.splice(i, 1);
  }
}

const tmpQuat = new THREE.Quaternion();
const upVec = new THREE.Vector3(0, 1, 0);
const lookTarget = new THREE.Vector3();

function updateFish(dt: number, t: number) {
  school.update(dt, t, foods, obstacles, input.state.mouse3, input.state.mouseSpeed);
  for (let i = 0; i < school.fish.length; i++) {
    const b = school.fish[i];
    const v = fishViews[i];
    v.group.position.copy(b.pos);

    // face along velocity, bank into turns
    if (b.vel.lengthSq() > 1e-5) {
      lookTarget.copy(b.pos).add(b.vel);
      const m = new THREE.Matrix4();
      m.lookAt(b.pos, lookTarget, upVec);
      tmpQuat.setFromRotationMatrix(m);
      // lookAt makes -Z face the target; our fish noses along +Z
      tmpQuat.multiply(new THREE.Quaternion().setFromAxisAngle(upVec, Math.PI));
      v.group.quaternion.slerp(tmpQuat, 1 - Math.exp(-dt * 6));
    }
    // gentle vertical tilt from swimming direction handled by lookAt

    v.uniforms.uTime.value = t;
    v.uniforms.uSwimAmp.value = b.swimAmp;
    v.uniforms.uSwimFreq.value = b.swimFreq;
    v.uniforms.uSwimPhase.value = b.phase;
    v.uniforms.uMouth.value = b.mouth;
    v.uniforms.uHueA.value.copy(STYLES[b.species].hueA);
    v.uniforms.uHueB.value.copy(STYLES[b.species].hueB);
  }
}

function updateLightScreen() {
  sunScreenPos.copy(shared.uSunDir.value).multiplyScalar(40).add(new THREE.Vector3(0, 2, 0));
  sunScreenPos.project(camera);
  lightScreen.set(sunScreenPos.x * 0.5 + 0.5, sunScreenPos.y * 0.5 + 0.5);
  lightScreen.x = THREE.MathUtils.clamp(lightScreen.x, 0.05, 0.95);
  lightScreen.y = THREE.MathUtils.clamp(lightScreen.y, 0.05, 0.95);
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  elapsed += dt;
  const t = elapsed;

  controls.update();
  input.update(t);

  if (input.consumeClick() && input.state.mouse3) {
    spawnFood(input.state.mouse3);
    school.scare(input.state.mouse3, 0.12);
  }

  ripple.update(dt, t);
  updateFoods(dt, t);
  updateFish(dt, t);

  shared.uTime.value = t;
  dust.update(t);
  bubbles.update(dt, shared);

  causticTimer += dt;
  if (causticTimer > (quality === 'low' ? 1 / 20 : 1 / 45)) {
    causticTimer = 0;
    caustic.render(renderer, t);
    shared.uCaustic.value = caustic.rt.texture;
  }

  updateLightScreen();

  media.u.uProjInv.value.copy(camera.projectionMatrixInverse);
  media.u.uCamWorld.value.copy(camera.matrixWorld);
  media.u.uCamPos.value.copy(camera.position);
  media.u.uNear.value = camera.near;
  media.u.uFar.value = camera.far;
  media.u.uTime.value = t;

  const dbg = new URLSearchParams(location.search).get('debug');
  if (dbg === 'plain') {
    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(scene, camera);
  } else if (dbg === 'nofx') {
    post.render(renderer, scene, camera, lightScreen, t, media, glass, { skipFx: true });
  } else if (dbg === 'nodof') {
    post.render(renderer, scene, camera, lightScreen, t, media, glass, { skipDof: true });
  } else if (dbg === 'base') {
    post.render(renderer, scene, camera, lightScreen, t, media, glass, { skipDof: true, skipFx: true });
  } else if (dbg && dbg.startsWith('u')) {
    post.render(renderer, scene, camera, lightScreen, t, media, glass, { debug: Number(dbg.slice(1)) });
  } else {
    post.render(renderer, scene, camera, lightScreen, t, media, glass);
  }

  frames++;
  fpsAccum += dt;
  if (fpsAccum > 1) {
    fps = frames / fpsAccum;
    frames = 0;
    fpsAccum = 0;
  }
}

window.__ready = true;
window.__probe = () => ({
  foodLive: foods.filter((f) => f.alive).length,
  hungerSum: school.fish.reduce((a, f) => a + f.hunger, 0),
  focusSum: school.fish.reduce((a, f) => a + f.focus, 0),
  fearSum: school.fish.reduce((a, f) => a + f.fear, 0),
  fish: school.fish.map((f) => f.pos.toArray().map((v) => +v.toFixed(2))),
});
window.__stats = {
    get fps() { return Math.round(fps); },
    fish: fishViews.length,
    quality,
    get calls() { return renderer.info.render.calls; },
    get tris() { return renderer.info.render.triangles; },
    get cam() { return camera.position.toArray().map((v) => +v.toFixed(2)); },
    get size() { return [renderer.domElement.width, renderer.domElement.height]; },
  };
frame();
