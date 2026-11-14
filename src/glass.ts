import * as THREE from 'three';
import { NOISE, ENV } from './glsl';
import { TANK, WATER_Y } from './config';
import type { Shared } from './scene';

/**
 * Glass panels drawn as a final overlay: they refract the already-rendered
 * scene (sampled from a copy), so we get real-looking thick glass without
 * paying for transmission sorting.
 */
export function makeGlassScene(sh: Shared): {
  scene: THREE.Scene;
  uniforms: Record<string, THREE.IUniform>;
} {
  const scene = new THREE.Scene();
  const uniforms = {
    uScene: { value: null as THREE.Texture | null },
    uTime: sh.uTime,
    uSunDir: sh.uSunDir,
    uSunColor: sh.uSunColor,
    uWaterY: { value: WATER_Y },
  };

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vViewN;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vViewN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE}
      ${ENV}
      uniform sampler2D uScene;
      uniform vec3 uWaterY;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vViewN;

      // cheap bubble-free glass thickness noise
      float smudge(vec2 p){
        return fbm2(p * 3.5) * 0.4 + fbm2(p * 11.0) * 0.18;
      }

      void main(){
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        // only front-facing panels contribute refraction; back panes just add tint
        float facing = dot(N, V);
        vec3 Nf = facing < 0.0 ? -N : N;

        vec2 uv = gl_FragCoord.xy / vec2(textureSize(uScene, 0));

        // refraction: displace what is behind the glass by the surface slope,
        // scaled by how far the surface tilts away from the viewer.
        vec2 slope = normalize(Nf.xz + vec2(1e-5)) * length(Nf.xz);
        float thick = 0.010 + 0.012 * step(0.5, abs(Nf.x)) + 0.012 * step(0.5, abs(Nf.z));
        vec2 off = slope * thick * smoothstep(0.0, 0.5, abs(facing) < 0.95 ? 0.4 : 0.1);
        off += vec2(smudge(uv * 9.0), smudge(uv * 9.0 + 7.3)) * 0.0006;

        vec3 behind = vec3(
          texture2D(uScene, uv + off).r,
          texture2D(uScene, uv).g,
          texture2D(uScene, uv - off).b
        );

        float fres = pow(1.0 - clamp(abs(dot(Nf, V)), 0.0, 1.0), 4.0);
        vec3 R = reflect(-V, Nf);
        vec3 refl = envColor(R, uSunDir);

        // green-blue glass tint, stronger toward grazing angles
        vec3 tint = vec3(0.66, 0.92, 0.88);
        float pathLen = 1.0 + fres * 2.5;
        vec3 absorbed = exp(-(1.0 - tint) * pathLen * 1.1);
        vec3 col = behind * absorbed;

        col = mix(col, refl, fres * 0.55);

        // specular streaks from the key light and a soft strip reflection
        vec3 L = normalize(uSunDir);
        vec3 H = normalize(L + V);
        col += uSunColor * pow(max(0.0, dot(Nf, H)), 500.0) * 0.9;

        // thin bright edges where the glass breaks
        float edge = smoothstep(0.88, 0.995, 1.0 - abs(facing));
        col += vec3(0.55, 0.78, 0.82) * edge * 0.35;

        float a = clamp(fres * 0.62 + 0.10 + edge * 0.35, 0.0, 1.0);
        gl_FragColor = vec4(col, a);
      }
    `,
  });

  // Four side panes + bottom. Built as individual planes so normals stay flat.
  const addPane = (w: number, h: number, pos: THREE.Vector3, rotY: number) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 24, 24), mat);
    p.position.copy(pos);
    p.rotation.y = rotY;
    scene.add(p);
  };
  addPane(TANK.hw * 2, TANK.hh, new THREE.Vector3(0, TANK.hh * 0.5, TANK.hd), 0);
  addPane(TANK.hw * 2, TANK.hh, new THREE.Vector3(0, TANK.hh * 0.5, -TANK.hd), Math.PI);
  addPane(TANK.hd * 2, TANK.hh, new THREE.Vector3(-TANK.hw, TANK.hh * 0.5, 0), Math.PI / 2);
  addPane(TANK.hd * 2, TANK.hh, new THREE.Vector3(TANK.hw, TANK.hh * 0.5, 0), -Math.PI / 2);

  return { scene, uniforms };
}

/**
 * Tank cabinet: opaque frame around the glass (silicone edges + dark stand),
 * which is what makes the box read as a physical object.
 */
export function makeTankShell(sh: Shared): THREE.Group {
  const g = new THREE.Group();
  const shade = new THREE.ShaderMaterial({
    uniforms: { uSunDir: sh.uSunDir },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      void main(){
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vN;
      void main(){
        float l = 0.035 + 0.10 * max(0.0, dot(normalize(vN), normalize(vec3(-0.3, 0.9, 0.3))));
        gl_FragColor = vec4(vec3(0.012, 0.016, 0.018) + l, 1.0);
      }
    `,
  });

  // silicone beads: thin dark bars along the vertical corners and top rim
  const bar = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), shade);
    m.position.set(x, y, z);
    g.add(m);
  };
  const t = 0.035;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    bar(t * 2, TANK.hh, t * 2, sx * TANK.hw, TANK.hh * 0.5, sz * TANK.hd);
  }
  // top rim frame
  for (const sz of [-1, 1]) bar(TANK.hw * 2 + t * 2, t * 1.6, t * 2, 0, TANK.hh, sz * TANK.hd);
  for (const sx of [-1, 1]) bar(t * 2, t * 1.6, TANK.hd * 2 + t * 2, sx * TANK.hw, TANK.hh, 0);

  // stand
  const stand = new THREE.Mesh(new THREE.BoxGeometry(TANK.hw * 2 + 0.5, 1.35, TANK.hd * 2 + 0.5), shade);
  stand.position.y = -0.68;
  g.add(stand);
  return g;
}
