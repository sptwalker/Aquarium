import * as THREE from 'three';

// Render targets for the aquarium: caustic pattern, scene HDR, god-ray volume.

export function makeCausticRT(size: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(size, size, {
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    depthBuffer: false,
  });
}

const causticFrag = /* glsl */ `
uniform float uTime;
vec3 caustic(vec2 uv, float time){
  vec2 p = uv * 6.28318;
  vec2 i = p;
  float c = 1.0;
  for (int n = 0; n < 6; n++){
    float t = time * (1.0 - 3.5 / float(n + 1));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / 0.005), p.y / (cos(i.y + t) / 0.005)));
  }
  c /= 6.0;
  c = 1.17 - pow(c, 1.4);
  return vec3(pow(abs(c), 8.0));
}
void main(){
  vec2 uv = gl_FragCoord.xy / 512.0;
  vec3 c = caustic(uv, uTime * 0.35);
  gl_FragColor = vec4(clamp(c.r * 1.4, 0.0, 4.0), c.g, c.b, 1.0);
}
`;

export class CausticPass {
  readonly rt: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;

  constructor(size: number) {
    this.rt = makeCausticRT(size);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: causticFrag,
      depthTest: false,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
  }

  render(renderer: THREE.WebGLRenderer, t: number) {
    this.mat.uniforms.uTime.value = t;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(prev);
  }

  dispose() {
    this.rt.dispose();
    this.mat.dispose();
  }
}
