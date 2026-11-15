// Shared GLSL snippets (GLSL ES 1.00 style; three transpiles for WebGL2).

export const NOISE = /* glsl */ `
float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise2(vec2 x){
  vec2 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm2(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){ v += a * noise2(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}
float fbm3(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++){ v += a * noise2(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}
`;

// Body/lateral swim wave, shared by body and fin shading.
// p.z == 0 at the nose, increasing toward the tail (local space).
export const SWIM = /* glsl */ `
uniform float uTime;
uniform float uSwimPhase;
uniform float uSwimAmp;
uniform float uSwimFreq;
uniform float uLen;

// Lateral curvature of the spine at the given z (body space).
// Two harmonics: the fundamental travelling wave plus a slower head sway.
// tailness deliberately runs past 1 behind the peduncle so the caudal fin
// continues the same wave instead of moving as one rigid plate.
float swimTailness(float z){
  return 1.0 - (z / uLen + 0.5);
}
float swimCurve(float z){
  float tn = max(0.0, swimTailness(z));
  // saturating envelope: grows to 1 at the peduncle and holds, so the wave
  // keeps travelling through the fin without the amplitude blowing up
  float a = 1.0 - exp(-tn * tn * 1.9);
  float w1 = sin(tn * 5.1 - uSwimPhase);
  float w2 = sin(tn * 2.3 - uSwimPhase * 0.5 + 1.7) * 0.30;
  return (w1 + w2) * a * uSwimAmp;
}

// Exact bending: build a tangent frame along the spine and place the
// cross-section in it. A pure lateral offset would shear the body (sections
// stay parallel) and read as stiff; rotating them makes it bend like flesh.
vec3 swimBend(vec3 p){
  float x = swimCurve(p.z);
  float e = 0.015;
  float dx = (swimCurve(p.z + e) - swimCurve(p.z - e)) / (2.0 * e);
  float inv = inversesqrt(1.0 + dx * dx);
  float c = inv;
  float s = dx * inv;
  // N = (c, -s) is the rotated lateral axis of the cross-section
  return vec3(x + p.x * c, p.y, p.z - p.x * s);
}
vec3 swimBendNormal(vec3 p, vec3 n){
  float e = 0.015;
  float dx = (swimCurve(p.z + e) - swimCurve(p.z - e)) / (2.0 * e);
  float inv = inversesqrt(1.0 + dx * dx);
  float c = inv;
  float s = dx * inv;
  return vec3(n.x * c + n.z * s, n.y, -n.x * s + n.z * c);
}
`;

export const CAUSTIC = /* glsl */ `
uniform float uTime;
uniform sampler2D uCaustic;
uniform vec3 uSunDir;
uniform vec3 uSunColor;

float causticSample(vec3 wp, float t){
  vec2 uv = wp.xz * 0.155 + vec2(0.5);
  uv.y += sin(wp.y * 0.6 + t * 0.2) * 0.006;
  float c = texture2D(uCaustic, uv).r;
  // sharpen: the bright filaments are what read as caustics, not the average
  return smoothstep(0.15, 0.95, c) * 1.35;
}
// Light reaching a point, attenuated by the water column above it.
vec3 tankLight(vec3 wp, float t){
  float depthBelow = max(0.0, 4.05 - wp.y);
  float atten = exp(-depthBelow * 0.16);
  float c = causticSample(wp, t);
  float ndl = max(0.0, dot(vec3(0.0, 1.0, 0.0), uSunDir));
  return uSunColor * atten * (0.35 + 1.5 * c);
}
`;

export const ENV = /* glsl */ `
vec3 envColor(vec3 d, vec3 sunDir){
  float y = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 low  = vec3(0.020, 0.028, 0.034);
  vec3 mid  = vec3(0.075, 0.098, 0.112);
  vec3 high = vec3(0.230, 0.285, 0.320);
  vec3 c = mix(low, mid, smoothstep(0.0, 0.55, y));
  c = mix(c, high, smoothstep(0.55, 0.95, y));
  // soft overhead softbox
  float box = smoothstep(0.35, 0.95, d.y) * smoothstep(0.2, 0.68, abs(d.x) < 0.4 ? 0.6 : 0.6);
  c += vec3(0.30, 0.33, 0.36) * pow(max(0.0, dot(d, normalize(vec3(0.15, 1.0, 0.25)))), 6.0) * 0.7;
  c += vec3(0.9, 0.86, 0.78) * pow(max(0.0, dot(d, sunDir)), 220.0) * 2.2;
  return c;
}
`;
