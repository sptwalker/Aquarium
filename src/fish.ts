import * as THREE from 'three';
import { NOISE, SWIM, ENV, CAUSTIC } from './glsl';
import type { Shared } from './scene';
import { FinCloth } from './cloth';
import { makeScaleMaps } from './scaleTexture';

export type FishSpecies = 'fantail' | 'oranda' | 'ryukin' | 'comet' | 'koi';

type Profile = ReadonlyArray<readonly [number, number]>;

type FishStyle = {
  length: number;
  /** relative body depth (half-height / length) */
  depth: number;
  /** relative body width (half-width / length) */
  width: number;
  /** axial radius curve; koi and goldfish genuinely differ */
  profile: Profile;
  hueA: THREE.Vector3;
  hueB: THREE.Vector3;
  belly: THREE.Vector3;
  finTint: THREE.Vector3;
  wen: number;
  /** koi livery: metallic gold body with a few deeper-orange plates */
  koi: number;
  /** 1 = four barbels at the mouth (koi); 0 = none (goldfish) */
  barbels: number;
};

/**
 * Relative radius along the axis: t = 0 at the tail tip, t = 1 at the snout.
 *
 * Each species carries its own curve. They were sharing one for a long time,
 * which is why the koi kept inheriting a goldfish's rounded head — the two
 * fish have genuinely different outlines and no single set of numbers serves
 * both.
 */
// Fancy goldfish: deep, egg-shaped, with a short blunt head.
const PROFILE_GOLDFISH: Profile = [
  [0.00, 0.030],
  [0.04, 0.090],
  [0.10, 0.200],
  [0.18, 0.400],
  [0.28, 0.660],
  [0.38, 0.860],
  [0.48, 0.960],
  [0.56, 0.990],
  [0.64, 0.985],
  [0.71, 0.950],
  [0.78, 0.895],
  [0.85, 0.845],
  [0.89, 0.775],
  [0.925, 0.660],
  [0.955, 0.500],
  [0.978, 0.330],
  [0.992, 0.190],
  [1.00, 0.110],
];

/**
 * Koi / common carp, traced from the reference line drawing.
 *
 * Two things make the koi silhouette: the deepest point sits near the middle
 * of the body rather than behind the gill, and the head falls away in one
 * continuous sweep to a narrow snout. Any bulge in that sweep reads as a
 * forehead, which is the defect that kept showing up.
 */
/**
 * Koi / common carp, measured off the reference line drawing rather than
 * eyeballed. Fifteen stations were sampled for top and bottom outline and
 * divided by the maximum body depth, so these numbers ARE the drawing.
 *
 * Two things the measurement made obvious:
 *  - the outline is symmetric about a nearly horizontal axis: the body does
 *    not hang below the midline the way a fancy goldfish does. The old curve
 *    added a belly drop on top of an asymmetric profile, which is the bulge
 *    under the head the user kept seeing.
 *  - the caudal peduncle is thick (about 37% of max depth), not a needle.
 */
const PROFILE_KOI: Profile = [
  [0.000, 0.370],   // caudal peduncle
  [0.046, 0.552],
  [0.107, 0.717],
  [0.215, 0.878],
  [0.368, 0.970],
  [0.475, 1.000],   // deepest, just forward of mid-body
  [0.613, 0.996],
  // ---- head. The radius has to keep shrinking through the whole head, with
  // the slope steepening monotonically. Any station that sits at nearly the
  // same radius as its neighbour flatlines the outline and the head reads as a
  // tube with a cap on it, which is exactly what was being reported.
  [0.650, 0.955],
  [0.700, 0.905],
  [0.750, 0.840],
  [0.800, 0.755],
  [0.850, 0.648],
  [0.900, 0.500],
  [0.940, 0.340],
  [0.968, 0.200],
  [0.988, 0.095],
  [1.000, 0.018],   // snout converges to a point
];

const STYLES: Record<FishSpecies, FishStyle> = {
  fantail: {
    length: 1.10, depth: 0.205, width: 0.125, profile: PROFILE_GOLDFISH,
    hueA: new THREE.Vector3(1.0, 0.26, 0.020),
    hueB: new THREE.Vector3(0.92, 0.10, 0.014),
    belly: new THREE.Vector3(1.0, 0.92, 0.82),
    finTint: new THREE.Vector3(1.0, 0.42, 0.18),
    wen: 0.0, koi: 0.0, barbels: 0,
  },
  oranda: {
    length: 1.02, depth: 0.215, width: 0.130, profile: PROFILE_GOLDFISH,
    hueA: new THREE.Vector3(0.98, 0.21, 0.018),
    hueB: new THREE.Vector3(0.86, 0.07, 0.012),
    belly: new THREE.Vector3(1.0, 0.90, 0.78),
    finTint: new THREE.Vector3(1.0, 0.50, 0.24),
    wen: 1.0, koi: 0.0, barbels: 0,
  },
  ryukin: {
    length: 0.94, depth: 0.220, width: 0.135, profile: PROFILE_GOLDFISH,
    hueA: new THREE.Vector3(0.97, 0.40, 0.045),
    hueB: new THREE.Vector3(0.88, 0.44, 0.30),
    belly: new THREE.Vector3(1.0, 0.95, 0.88),
    finTint: new THREE.Vector3(1.0, 0.64, 0.38),
    wen: 0.0, koi: 0.0, barbels: 0,
  },
  comet: {
    length: 1.38, depth: 0.150, width: 0.095, profile: PROFILE_KOI,
    hueA: new THREE.Vector3(1.0, 0.30, 0.020),
    hueB: new THREE.Vector3(0.97, 0.52, 0.030),
    belly: new THREE.Vector3(1.0, 0.95, 0.87),
    finTint: new THREE.Vector3(1.0, 0.46, 0.16),
    wen: 0.0, koi: 0.0, barbels: 0,
  },
  // Metallic gold carp, following the second reference: a warm golden body,
  // slightly deeper orange along the back, pale fins, four barbels.
  koi: {
    length: 1.45, depth: 0.165, width: 0.100, profile: PROFILE_KOI,
    hueA: new THREE.Vector3(1.00, 0.62, 0.06),    // golden ground
    hueB: new THREE.Vector3(0.96, 0.42, 0.03),    // deeper orange on the back
    belly: new THREE.Vector3(1.00, 0.90, 0.62),   // pale gold underside
    finTint: new THREE.Vector3(1.00, 0.72, 0.26),
    wen: 0.0, koi: 1.0, barbels: 1,
  },
};

// ---------------------------------------------------------------------------
// One parametric surface is the single source of truth for the body, the fin
// roots and the eye sockets. Earlier versions computed each of those from a
// separate closed-form approximation, so any geometry tweak left fins floating
// or eyes sunk inside the head. Everything below samples `bodySurface()`.
// ---------------------------------------------------------------------------

function smoothProfile(profile: Profile, t: number): number {
  const tt = THREE.MathUtils.clamp(t, 0, 1);
  const K = profile;
  let i = 0;
  while (i < K.length - 2 && tt > K[i + 1][0]) i++;
  const [t1, p1] = K[i];
  const [t2, p2] = K[i + 1];
  const p0 = K[Math.max(0, i - 1)][1];
  const p3 = K[Math.min(K.length - 1, i + 2)][1];
  const s = (tt - t1) / Math.max(1e-6, t2 - t1);
  const s2 = s * s;
  const s3 = s2 * s;
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * s +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * s3
  );
}

/**
 * A point on the body surface.
 *
 * @param t     0 at the tail tip, 1 at the snout
 * @param angle 0 = right flank, PI/2 = back, PI = left flank, -PI/2 = belly
 */
function bodySurface(style: FishStyle, t: number, angle: number): THREE.Vector3 {
  const L = style.length;

  // The snout is a dome, not a disc.
  //
  // Closing the body with a flat cap at t = 1 puts a circle facing the camera,
  // which is why the front of the head was never anything but a flat face.
  //
  // The blend window is now confined to the last few percent: the profile
  // itself already tapers to a point, so the dome is only a round-over on the
  // final sliver. The old window started at 0.955 and clamped the cap radius at
  // 22% of the local radius, which left a blunt cork on the end of a taper —
  // exactly the "cylinder with a cap" the head kept reading as.
  const T_DOME = 0.982;
  const BLEND = 0.018;
  const domeW = THREE.MathUtils.smoothstep(t, T_DOME, T_DOME + BLEND);
  const prof = smoothProfile(style.profile, t);

  let r = prof;
  let z = (t - 0.5) * L;

  if (domeW > 0) {
    const k = Math.min(1, Math.max(0, (t - T_DOME) / (1 - T_DOME)));
    const r0 = smoothProfile(style.profile, T_DOME);
    const tipR = 0.10;
    const domeR = r0 * Math.max(tipR, Math.pow(Math.max(0, 1 - Math.pow(k, 2.4)), 1 / 2.4));
    const zTube = (t - 0.5) * L;
    const zDome = (T_DOME - 0.5) * L + r0 * L * 0.055 * k;
    r = THREE.MathUtils.lerp(prof, domeR, domeW);
    z = THREE.MathUtils.lerp(zTube, zDome, domeW);
  }

  // Body axis. The measured outline is symmetric about a near-horizontal line:
  // a carp's belly does not hang below the midline the way a fancy goldfish's
  // does. Keeping a belly drop here on top of an asymmetric profile is what put
  // a bulge under the head.
  //
  // The offset must NOT be proportional to the local radius: multiplying by r
  // pushes the deep mid-body sections down harder than the slim ones, which
  // bows the belly line and is exactly the "bulge underneath" that was reported.
  // A constant shift keeps the two outlines parallel.
  let cy = style.koi > 0.5
    ? -style.depth * L * 0.014
    : -r * style.depth * L * 0.06;

  // The snout dips only slightly, so the mouth sits just below the eye line.
  // The measured drawing has the axis essentially straight right to the tip.
  const snout = Math.exp(-Math.pow((t - 0.93) / 0.045, 2));
  cy -= snout * L * (style.barbels > 0 ? 0.008 : 0.014);

  // The muzzle is a WEDGE, not a cone.
  //
  // A circular cross-section tapering to a point gives a beak, and any mouth
  // painted on it wraps around a curved surface, which is why it never read as
  // a split. Squashing y over the last stretch turns the snout into a
  // horizontally flattened blade: now there is a genuine upper lip and lower
  // jaw with a flat front between them, and the cleft has something to sit in.
  // The squash is gated on the muzzle so the body sections stay round.
  const wedge = THREE.MathUtils.smoothstep(t, 0.87, 0.995) * 0.62;
  const squashY = 1 - wedge;

  // ---- mouth cleft, cut into the surface.
  //
  // Painting a mouth only ever produced a dark patch on a convex muzzle. What
  // makes a mouth read is the silhouette: the tip must actually fork into an
  // upper lip and a lower jaw. This carves a horizontal notch at the midline of
  // the last 8% of the body, pushing the skin back in z and flaring the two
  // lips apart in y. Gated on t so nothing behind the snout is touched.
  const cleftT = THREE.MathUtils.smoothstep(t, 0.925, 0.995);
  const dyN = Math.sin(angle);                     // -1 belly .. +1 back
  const band = 1 - THREE.MathUtils.smoothstep(Math.abs(dyN), 0.10, 0.46);
  const notch = cleftT * band;
  if (notch > 0) {
    // pull the skin back to form the slot
    z -= notch * L * 0.020;
    // and part the lips: up above the slot, down below it
    const lip = Math.sign(dyN) * notch * L * 0.016;
    cy += lip;
  }

  // ---- operculum (gill cover), as GEOMETRY.
  //
  // Painting a plate and a slit onto the skin only ever produced a shading
  // gradient: from any angle the flank stayed smooth, so the gills simply were
  // not there. A real plate needs a real silhouette, and the cheapest way to
  // get one without floating a separate mesh over a curved surface is to
  // displace the shared surface — then `bodyNormal` derives the right normals
  // and the edge catches light exactly like a physical lip of skin.
  //
  // Two features: a broad outward swell over the cover plate, and a narrow
  // inward groove at its rear edge (the gill opening). Both are gated on the
  // flank so they vanish at the dorsal ridge and the belly.
  const flankW = Math.pow(Math.abs(Math.cos(angle)), 1.6);
  if (flankW > 0.02) {
    const plate = THREE.MathUtils.smoothstep(t, 0.748, 0.782)
                * (1 - THREE.MathUtils.smoothstep(t, 0.800, 0.845));
    const groove = Math.exp(-Math.pow((t - 0.742) / 0.0095, 2));
    const out = (plate * 0.011 - groove * 0.030) * L * flankW;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    return new THREE.Vector3(
      ca * r * style.width * L + ca * out,
      cy + sa * r * style.depth * L * squashY + sa * out,
      z,
    );
  }

  return new THREE.Vector3(
    Math.cos(angle) * r * style.width * L,
    cy + Math.sin(angle) * r * style.depth * L * squashY,
    z,
  );
}

/** Outward unit normal of the body surface, from finite differences. */
function bodyNormal(style: FishStyle, t: number, angle: number): THREE.Vector3 {
  const e = 0.004;
  const dt = bodySurface(style, Math.min(1, t + e), angle)
    .sub(bodySurface(style, Math.max(0, t - e), angle));
  const da = bodySurface(style, t, angle + e).sub(bodySurface(style, t, angle - e));
  const n = new THREE.Vector3().crossVectors(da, dt);
  if (n.lengthSq() < 1e-12) n.set(Math.cos(angle), Math.sin(angle), 0);
  n.normalize();
  // orient outward
  const outward = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
  if (n.dot(outward) < 0) n.negate();
  return n;
}

// ---------------------------------------------------------------------------
// Body mesh
// ---------------------------------------------------------------------------

function buildBodyGeometry(style: FishStyle, segs = 64, radial = 32): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const rows = segs + 1;
  const cols = radial + 1;
  const p = new THREE.Vector3();

  for (let i = 0; i < rows; i++) {
    const t = i / segs;
    // U must be ARC LENGTH around the section, not the normalized angle.
    // With angle, a degree of arc near the flank covers more skin than a degree
    // near the back, where the body curves away from the viewer — so the scale
    // cells shrank toward the spine and the upper flank turned into a comb of
    // vertical ribs. Cumulative chord length fixes the lattice aspect.
    const ring: THREE.Vector3[] = [];
    for (let j = 0; j <= radial; j++) {
      ring.push(bodySurface(style, t, (j / radial) * Math.PI * 2));
    }
    const arc: number[] = [0];
    for (let j = 1; j <= radial; j++) {
      arc.push(arc[j - 1] + ring[j].distanceTo(ring[j - 1]));
    }
    const perim = Math.max(1e-6, arc[radial]);

    for (let j = 0; j < cols; j++) {
      const angle = (j / radial) * Math.PI * 2;
      p.copy(ring[j]);
      positions.push(p.x, p.y, p.z);

      // Analytic normals straight from the surface function. computeVertexNormals
      // averages the faces that share each vertex, and the seam column (j=0 and
      // j=radial are the same point) belongs to two disconnected fans, so it got
      // two averaged normals and showed up as a hard line down the flank.
      const n = bodyNormal(style, t, angle);
      normals.push(n.x, n.y, n.z);

      uvs.push(arc[j] / perim, t);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * cols + j;
      const b = a + cols;
      // Counter-clockwise when seen from outside. The previous order (a, b, a+1)
      // produced inward-facing normals, so the front faces were culled and the
      // far side of the body was visible through it — the model looked
      // transparent, and eyes/tail showed through from the far side.
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }

  // Close both ends. The body is built as an open tube; without these caps the
  // snout and the caudal peduncle are holes, and back-face culling lets you see
  // straight into the fish from the front. That was the last source of the
  // "see the tail through the head" artifact.
  const addCap = (t: number, pointForward: boolean) => {
    const centreIndex = positions.length / 3;
    const c = bodySurface(style, t, 0);
    // collapse the cap centre onto the axis
    const r = smoothProfile(style.profile, t);
    positions.push(0, -r * style.depth * style.length * 0.06, c.z);
    const n = new THREE.Vector3(0, 0, pointForward ? 1 : -1);
    normals.push(n.x, n.y, n.z);
    uvs.push(0.5, t);

    const rowBase = pointForward ? segs * cols : 0;
    for (let j = 0; j < radial; j++) {
      const v0 = rowBase + j;
      const v1 = rowBase + j + 1;
      // Winding: seen from outside the snout (+z) the ring runs counter-
      // clockwise, so (centre, v0, v1) faces +z. The reverse order faces into
      // the body and gets culled, which is what left a hole at the nose.
      if (pointForward) indices.push(centreIndex, v0, v1);
      else indices.push(centreIndex, v1, v0);
    }
  };
  addCap(1, true);    // snout
  addCap(0, false);   // caudal peduncle

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  return g;
}

// ---------------------------------------------------------------------------
// Fins
// ---------------------------------------------------------------------------

type FinAxis = 'dorsal' | 'anal' | 'pectoral' | 'pelvic';

/**
 * Builds a fin as a grid whose v = 0 row is sampled from the body surface, so
 * the root is always exactly on the skin regardless of how the body changes.
 */
function buildFin(
  style: FishStyle,
  kind: FinAxis,
  side: number,
  segsU = 20,
  segsV = 12,
): THREE.BufferGeometry {
  const L = style.length;
  const rows = segsU + 1;
  const cols = segsV + 1;
  const positions: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];

  // Span along the body axis, in t (0 tail tip .. 1 snout).
  // Pelvic fins sit behind and below the pectorals — a pair on the belly that
  // the model was missing entirely.
  const tSpan: [number, number] =
    kind === 'dorsal' ? [0.30, 0.66]
    : kind === 'anal' ? [0.24, 0.44]
    : kind === 'pectoral' ? [0.60, 0.73]
    : [0.44, 0.56];

  // how tall the fin grows relative to body length
  const maxH =
    kind === 'dorsal' ? L * 0.095
    : kind === 'anal' ? L * 0.065
    : kind === 'pectoral' ? L * 0.058
    : L * 0.050;

  // Root angle on the cross-section. Pectorals and pelvics sit on the flank /
  // ventral flank, mirrored to opposite sides.
  const angle =
    kind === 'dorsal' ? Math.PI / 2
    : kind === 'anal' ? -Math.PI / 2
    : kind === 'pectoral' ? (side > 0 ? -0.42 : Math.PI + 0.42)
    : (side > 0 ? -0.95 : Math.PI + 0.95);

  for (let i = 0; i < rows; i++) {
    const u = i / segsU;
    const t = THREE.MathUtils.lerp(tSpan[0], tSpan[1], u);
    const root = bodySurface(style, t, angle);
    const nrm = bodyNormal(style, t, angle);

    // The fin is a membrane with real width: one in-plane axis runs along the
    // body (the "chord"), the other is how far it extends. A single direction
    // per fin collapsed it to a sliver when seen edge-on.
    let spanDir: THREE.Vector3;
    let chordDir: THREE.Vector3;
    if (kind === 'pectoral') {
      // sweeps back and outward from low on the flank
      spanDir = new THREE.Vector3(side * 0.70, -0.34, -0.62).normalize();
      chordDir = new THREE.Vector3(0, 0, 1);
    } else if (kind === 'pelvic') {
      // hangs down and back, closer to the body than a pectoral
      spanDir = new THREE.Vector3(side * 0.42, -0.80, -0.44).normalize();
      chordDir = new THREE.Vector3(0, 0, 1);
    } else {
      spanDir = nrm.clone();
      chordDir = new THREE.Vector3(0, 0, 1);
    }

    // Blend the span direction toward the surface normal as it leaves the
    // body, so the fin leaves the skin tangentially instead of sticking out
    // of it like a plate, and hugs the flank near the root.
    const rootBlend = nrm.clone().multiplyScalar(0.55).addScaledVector(spanDir, 0.45);

    for (let j = 0; j < cols; j++) {
      const d = j / segsV;                      // 0 root .. 1 tip

      // taper to nothing at both ends of the span so the outline meets the body
      const arc = Math.sin(Math.min(1, Math.max(0, (u - 0.02) / 0.96)) * Math.PI);
      const env = Math.pow(arc, 0.55);

      // Chord width starts at *zero* at the root. That is what welds the fin to
      // the body: at d = 0 every column collapses onto the single sampled skin
      // point, so the root is a line lying on the surface instead of a floating
      // straight edge hovering over a curved flank.
      const chord = maxH * env * Math.pow(d, 0.72) * 1.15;
      const sweepBack = d * d * maxH * 0.55;

      const across = (u - 0.5) * chord;
      const ripple = 1 + 0.05 * Math.sin(u * 23.0) * d;

      // blend the outward direction so the base leaves the skin tangentially
      const dir = new THREE.Vector3()
        .copy(rootBlend)
        .multiplyScalar(1 - d)
        .addScaledVector(spanDir, d)
        .normalize();

      const p = root.clone()
        .addScaledVector(dir, d * maxH * env * ripple)
        .addScaledVector(chordDir, across - sweepBack);

      positions.push(p.x, p.y, p.z);
      uvs.push(u, d);
    }
  }
  for (let i = 0; i < segsU; i++) {
    for (let j = 0; j < segsV; j++) {
      const a = i * cols + j;
      const b = a + cols;
      // same winding correction as the body: outward-facing, so lighting and
      // any back-face culling behave
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildTailCloth(style: FishStyle): FinCloth {
  const L = style.length;
  const cols = 26;
  const rows = 16;
  const span = L * (style.width < 0.11 ? 0.34 : 0.26);
  const rest = new Float32Array(cols * rows * 3);

  for (let i = 0; i < cols; i++) {
    const u = i / (cols - 1);
    const s = u * 2 - 1;
    for (let j = 0; j < rows; j++) {
      const d = j / (rows - 1);
      // fork: the middle of the fan is shallower than the lobes
      const notch = 1 - 0.34 * Math.exp(-s * s * 6.5);
      const z = -L * 0.5 + L * 0.04 - d * span * notch;
      const y = s * Math.pow(d, 0.80) * L * 0.20 * (1 + 0.12 * Math.sin(Math.abs(s) * 2.4));
      const x = s * d * L * 0.070 + d * d * Math.cos(s * 1.9) * L * 0.040;
      const o = (i * rows + j) * 3;
      rest[o] = x;
      rest[o + 1] = y;
      rest[o + 2] = z;
    }
  }
  return new FinCloth(cols, rows, rest, 1, {
    span,
    flutterFreq: 2.6,
    flutterPhase: Math.random() * 6.28,
    flutterAmp: 0.26,
  });
}

// ---------------------------------------------------------------------------

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
  uKoi: { value: number };
  uMouth: { value: number };
  uScaleNormal: { value: THREE.Texture | null };
  uScaleHeight: { value: THREE.Texture | null };
  uScaleTiling: { value: THREE.Vector2 };
  uTipY: { value: number };
  uTipZ: { value: number };
  uTipRadius: { value: number };
};

export function makeFish(style: FishStyle, shared: Shared): {
  group: THREE.Group;
  uniforms: FishUniforms;
  body: THREE.Mesh;
  tail: FinCloth;
  updateTail: (dt: number, time: number, flow: THREE.Vector3) => void;
} {
  const scaleMaps = makeScaleMaps();
  const uniforms: FishUniforms = {
    uTime: shared.uTime,
    uSwimPhase: { value: Math.random() * 10 },
    uSwimAmp: { value: 0.05 },
    uSwimFreq: { value: 3.0 },
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
    uKoi: { value: style.koi },
    uMouth: { value: 0 },
    uScaleNormal: { value: scaleMaps.normal },
    uScaleHeight: { value: scaleMaps.height },
    // around, along: enough tiles to give ~30 scale rows on a 1.1-1.45 body
    // Tiles around / along. The baked lattice is 9 x 11 scales, so (2, 2)
    // gives ~18 scales around and 22 rows along the body — the density in the
    // reference drawing. (2, 5) was putting 55 rows on the flank, which read
    // as fine grain rather than scales.
    uScaleTiling: { value: new THREE.Vector2(3, 4) },
    // local y of the snout tip: the mouth is placed relative to this, because
    // the muzzle droops and an absolute y put the cleft on the cheek
    uTipY: { value: bodySurface(style, 1.0, 0).y },
    uTipZ: { value: bodySurface(style, 1.0, 0).z },
    // radius of the snout cap: everything about the mouth is scaled by this,
    // because the cap is tiny and absolute units made the mouth far too big
    uTipRadius: { value: Math.max(1e-3, smoothProfile(style.profile, 1.0) * style.width * style.length) },
  };

  // ---- body
  const bodyMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${NOISE}
      ${SWIM}
      uniform float uMouth;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vLocal;
      varying vec3 vLocalNormal;
      varying vec2 vUv;
      void main(){
        // No mouth geometry: indenting the snout in the mesh produced a ring
        // around the mouth. The gape is painted in the fragment shader.
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
      uniform float uKoi;
      uniform float uMouth;
      uniform float uTipY;
      uniform float uTipZ;
      uniform float uTipRadius;
      uniform float uLen;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vLocal;
      varying vec3 vLocalNormal;
      varying vec2 vUv;

      uniform sampler2D uScaleNormal;
      uniform sampler2D uScaleHeight;
      uniform vec2 uScaleTiling;   // (around, along) in tiles

      // Scales come from a baked texture, not from maths in the shader.
      //
      // Four attempts to build the lattice here all failed the same way: a
      // per-cell height field has a crease wherever the cells meet, and
      // differentiating it in the shader turns those creases into a visible
      // hexagonal net (or, once the lattice was shortened to avoid that, into
      // horizontal stripes). The pattern itself is fine — the problem is
      // evaluating and differentiating it per pixel. So it is baked once on the
      // CPU into a normal map and a height map, and this shader just samples.
      // Scale coordinates come from the mesh UV, not from atan().
      //
      // atan wraps at +/-PI, and exactly on that line the UV derivative is
      // discontinuous: the mip level jumps, the sampler picks a different level
      // on either side, and the result is a hard vertical seam down the flank.
      // The body already carries a proper cylindrical UV with duplicated seam
      // vertices, so within every triangle the coordinates are continuous and
      // the wrap is handled by the texture's own repeat mode.
      vec2 scaleUV(){
        return vUv * uScaleTiling;
      }

      // Perturb the shading normal using the baked relief, in a tangent frame.
      // The map's +x runs around the body and +y along it, so the two sampled
      // components map straight onto those axes.
      vec3 applyScaleNormal(vec3 N, float strength, out float hgt){
        vec3 tn = texture2D(uScaleNormal, scaleUV()).xyz * 2.0 - 1.0;
        hgt = texture2D(uScaleHeight, scaleUV()).r;
        vec3 hint = abs(N.y) > 0.92 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
        vec3 T = normalize(cross(N, hint) + 1e-4);   // around the body
        vec3 B = normalize(cross(N, T));             // along the body
        // The baked map's green channel already points along +v; convert to a
        // tilt in the surface tangent frame. Full strength: the previous 0.75
        // was multiplying an already-weak map and left the scales flat.
        return normalize(N + (T * tn.x + B * tn.y) * strength);
      }

      void main(){
        vec2 uv = vUv;
        vec3 N = normalize(vNormal);
        float along = uv.y;              // 0 tail .. 1 snout
        float up = vLocal.y;             // negative = belly

        // ---- base colour: mottled orange over a pale belly.
        // Sample noise from the 3D position, not uv: uv.x wraps at the flank,
        // and the mismatch showed up as a hard dark patch on the back.
        vec3 lp = vLocal;
        float m1 = fbm3(vec2(lp.x * 3.5 + lp.z * 2.0, lp.y * 6.0 + lp.z * 4.0));
        float m2 = fbm3(vec2(lp.x * 8.0 + lp.z * 5.0, lp.y * 11.0) + 19.0);
        vec3 col = mix(uHueA, uHueB, smoothstep(0.30, 0.80, m1 + m2 * 0.4));
        // slight paling toward the caudal peduncle
        col = mix(col, col * vec3(1.04, 0.95, 0.92), smoothstep(0.55, 0.12, along) * 0.35);

        // ---- koi livery (kohaku): white ground with a few large red patches.
        // Big soft blotches read as koi; the dense noise above reads as a
        // gradient, which is why the koi was coming out plain orange.
        if (uKoi > 0.5) {
          // The reference is a single metallic gold carp, not a kohaku. Broad
          // low-frequency warm/cool bands give the body depth without turning
          // it into white-with-red-plates, which is what the previous hard
          // patch mask produced.
          float b1 = fbm3(vec2(lp.z * 2.2 + 11.0, lp.y * 3.0));
          float warm = smoothstep(0.34, 0.70, b1);
          // gold ground, deepening to amber along the back and fading pale
          // toward the belly
          vec3 gold = mix(uHueA, uHueB, warm * 0.55);
          float dorsum = smoothstep(-0.55, 0.85, lp.y / max(0.001, uLen * 0.105));
          gold = mix(gold * 0.96, gold * vec3(0.90, 0.74, 0.52), dorsum);
          col = gold;
        }

        // belly: a low, narrow band; gated on height so it cannot climb the
        // head where the surface normals point sideways
        float belly = smoothstep(0.30, 0.92, -up / max(0.001, uLen * 0.20))
                    * smoothstep(0.80, 0.30, along);
        col = mix(col, uBelly, belly * 0.80 * (1.0 - uKoi * 0.55));

        // ---- oranda wen
        // A multiplicative term driven by noise was darkening whole patches of
        // the head (down to 0.46x). Real wen is fleshy growth, so it should
        // read as a gentle bump with a lighter, waxy tone.
        float head = smoothstep(0.78, 0.98, along) * smoothstep(0.95, 0.70, abs(uv.x - 0.5) * 2.0);
        float wenN = uWen * head * fbm3(vec2(lp.z * 12.0, lp.y * 9.0));
        col = mix(col, mix(col, vec3(0.92, 0.55, 0.30), 0.45), wenN * 0.55);

        // ---- shingled scales, sampled from the baked map.
        // no scales on the snout; they run back over the peduncle
        float scaleZone = smoothstep(0.06, 0.20, along) * smoothstep(0.86, 0.72, along);

        float scaleH;                       // filled in by applyScaleNormal
        // The height map darkens the trough where one scale slips under the next.
        // Kept shallow: the reference has a soft relief, and a strong value step
        // made the flank look like hexagonal tiles.
        {
          // The winner-takes-all lattice has deep troughs where one scale slips
          // under the next, so the same modulation range that was right for the
          // old shallow domes now darkens whole bands of the flank. The normal
          // map carries the relief; albedo only needs a whisper of shading.
          float th = texture2D(uScaleHeight, scaleUV()).r;
          col *= mix(0.975, 1.012, th * scaleZone + (1.0 - scaleZone));
        }

        // ---- mouth, painted on the muzzle.
        //
        // Sizing this in absolute units was the whole bug: the mouth ellipse
        // was ~5x the radius of the snout tip, so its "inside" test wrapped
        // around the whole cap and appeared on both cheeks. Everything here is
        // measured in units of the tip radius, and gated on being near the
        // front face in z.
        {
          float tipR = max(0.001, uTipRadius);
          float dx = lp.x / tipR;
          float dy = (lp.y - uTipY) / tipR;
          float dz = (uTipZ - lp.z) / tipR;

          // only the forward-facing cap
          float front = smoothstep(1.10, 0.25, abs(dz));

          // horizontal cleft, wide across, thin vertically, parts with uMouth
          float halfW = 0.80;
          float halfH = 0.085 + uMouth * 0.55;
          float open = smoothstep(halfW, halfW * 0.86, abs(dx))
                     * smoothstep(halfH, halfH * 0.80, abs(dy))
                     * front;

          // Upper lip: a fat roll above the cleft; lower jaw set slightly back.
          float lipY = dy - (halfH + 0.16);
          float upperLip = smoothstep(halfW * 1.05, halfW * 0.70, abs(dx))
                         * smoothstep(0.15, 0.0, abs(lipY)) * step(lipY, 0.0)
                         * front;
          float lipY2 = dy + (halfH + 0.20);
          float lowerJaw = smoothstep(halfW * 0.92, halfW * 0.60, abs(dx))
                         * smoothstep(0.13, 0.0, abs(lipY2)) * step(0.0, lipY2)
                         * front;

          col = mix(col, col * 0.82, upperLip * 0.45);
          col = mix(col, col * 0.90, lowerJaw * 0.28);

          // wet throat: darkest at the centre of the slit
          float depth = smoothstep(1.0, 0.05, length(vec2(dx / halfW, dy / max(0.02, halfH))));
          col = mix(col, mix(vec3(0.060, 0.020, 0.014), vec3(0.006, 0.002, 0.001), depth),
                    open * 0.97);
        }

        // ---- operculum (gill cover).
        //
        // In the reference this is not a line drawn on the side: it is a broad
        // crescent whose front edge is a soft step in the skin, with a short
        // shadow under its rear edge near the belly. Making the edge a thin
        // straight stroke is what has been reading as a scratch across the
        // body, so the slit is now short, low, and the plate edge is soft.
        {
          float ay = lp.y / max(0.001, uLen * 0.135);   // -1 belly .. +1 back
          // The edge runs almost vertical on the upper flank and curves
          // forward as it descends.
          float gillLine = 0.752 - 0.055 * ay * ay - 0.045 * ay;
          float d = along - gillLine;

          // Only across the flank; gone at the dorsal ridge and the belly.
          float onFlank = smoothstep(1.05, 0.35, abs(ay));

          // The cover plate: soft shading break, wide and gentle.
          float plate = smoothstep(0.150, 0.020, d) * onFlank;
          col = mix(col, col * 0.93, plate * 0.55);

          // A short shadow tucks under the rear edge, strongest low on the
          // flank and fading out before the back — that asymmetry is what
          // stops it looking like a drawn line.
          float slitLow = smoothstep(0.30, -0.55, ay);
          float slit = smoothstep(0.018, 0.002, abs(d)) * onFlank * slitLow;
          col = mix(col, col * 0.72, slit * 0.85);

          // The lip of the plate catches a little light along its front.
          float edge = smoothstep(0.020, 0.004, abs(d + 0.128)) * onFlank;
          col = mix(col, col * 1.06, edge * 0.55);
          col = mix(col, vec3(0.070, 0.024, 0.018), slit * 0.85);
        }

        // ---- scale relief, from the baked normal map. Nothing is
        // differentiated per pixel, so no lattice border can spike.
        {
          N = applyScaleNormal(N, 0.55 * scaleZone, scaleH);
        }

        // ---- lighting
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 L = normalize(uSunDir);
        float casc = causticSample(vWorld, uTime);
        float atten = exp(-max(0.0, 4.05 - vWorld.y) * 0.10);

        float ndl = dot(N, L);
        float wrap = clamp((ndl + 0.55) / 1.55, 0.0, 1.0);
        vec3 lit = col * (uSunColor * wrap * (0.14 + 1.35 * casc) * atten
                        + vec3(0.022, 0.036, 0.042));
        // subsurface: flesh glows warm where light passes through
        lit += uHueA * vec3(1.0, 0.30, 0.20)
             * pow(clamp(ndl * 0.5 + 0.5, 0.0, 1.0), 3.0) * 0.30;

        // wet specular: a tight highlight plus a soft sheen
        vec3 H = normalize(L + V);
        float nh = max(0.0, dot(N, H));
        float fres = pow(1.0 - max(0.0, dot(N, V)), 4.0);
        lit += uSunColor * (pow(nh, 190.0) * 1.4 + pow(nh, 26.0) * 0.10);
        vec3 R = reflect(-V, N);
        lit += envColor(R, uSunDir) * fres * 0.30;
        lit += (0.5 + 0.5 * cos(vec3(0.0, 2.1, 4.2) + fres * 4.0)) * fres * 0.06;

        // ---- snout shading: the mouth itself is real geometry, this only
        // darkens the skin immediately around it
        vec2 mp = vec2((uv.x - 0.5) * 2.0, (uv.y - 0.995) * 34.0);
        float mouthHalo = smoothstep(0.55, 0.12, length(vec2(mp.x, mp.y * 1.5)));
        lit *= 1.0 - mouthHalo * 0.35;

        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });

  // ---- fins
  const finMat = new THREE.ShaderMaterial({
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
      uniform vec3 uHueA;
      uniform vec3 uHueB;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main(){
        // rays run root -> tip; they give the membrane its structure
        float rays = 0.5 + 0.5 * sin(vUv.x * 150.0);
        rays = mix(0.65, 1.0, rays);
        // the membrane thins toward the trailing edge
        float thin = smoothstep(0.05, 0.95, vUv.y);

        // Root weld: near vUv.y = 0 the fin takes the body's own colour, so the
        // silhouette edge disappears and the fin appears to grow out of the
        // skin instead of being a card laid against it.
        vec3 bodyCol = mix(uHueA, uHueB, 0.45);
        float rootBlend = 1.0 - smoothstep(0.0, 0.28, vUv.y);
        vec3 base = mix(uFinTint, bodyCol, rootBlend * 0.85);
        base *= (0.55 + 0.45 * rays) * (1.0 - 0.22 * thin);

        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 L = normalize(uSunDir);
        float casc = causticSample(vWorld, uTime);
        float atten = exp(-max(0.0, 4.05 - vWorld.y) * 0.10);
        float ndl = abs(dot(N, L));
        float back = pow(max(0.0, dot(-V, L)), 2.0);

        vec3 col = base * (uSunColor * atten * (0.20 + 0.85 * casc) * (0.55 + ndl * 0.65 + back * 0.5));
        col += base * vec3(0.030, 0.045, 0.050);

        // The root is in contact with the body, so it must not pick up the
        // thin-membrane backlight that the free edge does.
        col = mix(col, bodyCol * (uSunColor * atten * (0.18 + 0.8 * casc) * 0.8
                     + vec3(0.024, 0.034, 0.038)), rootBlend);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  // ---- mouth is painted on the body shader (see the `mouth` block there).
  // Separate lip meshes were tried three ways (cone, torus pair, slit quad) and
  // every one of them read as a ring floating in front of the snout, because the
  // snout is a curved surface and the pieces were rigid. Painted on the surface,
  // it cannot detach.

  const group = new THREE.Group();

  const body = new THREE.Mesh(buildBodyGeometry(style), bodyMat);
  body.frustumCulled = false;
  group.add(body);

  // ---- the mouth is painted on the body surface itself (see the `mouth`
  // block in the body fragment shader). A separate quad, cone or torus always
  // ends up either floating in front of the snout or clipping through it,
  // because the muzzle is a tight dome and the pieces are rigid. Painted, it
  // conforms exactly and can never protrude as a bar.

  // caudal fin (cloth-driven)
  const tail = buildTailCloth(style);
  const tailMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main(){
        vUv = uv;
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: finMat.fragmentShader,
  });
  const tailMesh = new THREE.Mesh(tail.geometry, tailMat);
  tailMesh.frustumCulled = false;
  group.add(tailMesh);

  // dorsal, anal, and a pectoral pair
  // Seven fin positions, as a koi actually has: dorsal, caudal, anal, and the
  // pectoral and pelvic pairs. (The pelvic pair was missing entirely.)
  const finSpecs: Array<[FinAxis, number]> = [
    ['dorsal', 0],
    ['anal', 0],
    ['pectoral', 1],
    ['pectoral', -1],
    ['pelvic', 1],
    ['pelvic', -1],
  ];
  for (const [kind, side] of finSpecs) {
    const g = buildFin(style, kind, side || 1);
    const m = new THREE.Mesh(g, finMat);
    m.frustumCulled = false;
    group.add(m);
  }

  // ---- barbels. Koi have FOUR: a long pair at the corners of the upper jaw
  // and a shorter pair under the lower lip. (Six is not a number any cyprinid
  // has; and goldfish varieties carry none at all, which is how you tell them
  // apart, so this only appears when style.barbels is set.)
  if (style.barbels > 0) {
    const barbelMat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vW;
        void main(){
          vN = normalize(mat3(modelMatrix) * normal);
          vW = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${CAUSTIC}
        uniform vec3 uHueA;
        varying vec3 vN; varying vec3 vW;
        void main(){
          vec3 N = normalize(vN);
          vec3 L = normalize(uSunDir);
          float casc = causticSample(vW, uTime);
          float atten = exp(-max(0.0, 4.05 - vW.y) * 0.10);
          float ndl = max(0.0, dot(N, L));
          // Barbels are skin, not bone: tint them from the body colour. A pale
          // mix made them read as wires hanging off the mouth.
          vec3 col = uHueA * vec3(0.95, 0.90, 0.86)
                   * (uSunColor * atten * (0.18 + 0.95 * casc) * (0.40 + ndl * 0.9)
                      + vec3(0.028, 0.034, 0.036));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    // Four barbels: a long pair at the upper-jaw corners, a short pair under the
    // lower lip. They must start *inside* the skin and taper to a point, or they
    // read as orange marks floating on the muzzle.
    // Four barbels: a long pair at the corners of the upper jaw and a short pair
    // under the lower lip. Angle 0 is the flank and -PI/2 is the belly, so the
    // mouth sits at a NEGATIVE angle; using positive values pushed the barbels
    // up onto the cheek at eye level. Each pair is mirrored with PI - a.
    const upA = -0.42, loA = -0.95;
    const barbels: Array<{ t: number; ang: number; len: number; drop: number; out: number }> = [
      { t: 0.930, ang: upA, len: 0.050, drop: -0.30, out: 0.55 },
      { t: 0.930, ang: Math.PI - upA, len: 0.050, drop: -0.30, out: 0.55 },
      { t: 0.945, ang: loA, len: 0.032, drop: -0.60, out: 0.48 },
      { t: 0.945, ang: Math.PI - loA, len: 0.032, drop: -0.60, out: 0.48 },
    ];
    for (const b of barbels) {
      const rootP = bodySurface(style, b.t, b.ang);
      const nrm = bodyNormal(style, b.t, b.ang);
      const L = style.length;
      // Start a little under the surface so the base is buried, then arc out,
      // down and slightly back — the resting pose of a koi barbel.
      const p0 = rootP.clone().addScaledVector(nrm, -L * 0.004);
      const p1 = rootP.clone()
        .addScaledVector(nrm, L * b.out * b.len * 0.55)
        .add(new THREE.Vector3(0, L * b.drop * b.len * 0.35, L * b.len * 0.15));
      const p2 = rootP.clone()
        .addScaledVector(nrm, L * b.out * b.len * 0.95)
        .add(new THREE.Vector3(0, L * b.drop * b.len * 1.25, -L * b.len * 0.30));
      const curve = new THREE.CatmullRomCurve3([p0, p1, p2]);
      // Tapered: radius 1 -> 0.15 along the length, so the tip tapers to a point.
      const segs = 8;
      const radius = L * 0.0042;
      const geo = new THREE.TubeGeometry(curve, segs, radius, 5, false);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        // TubeGeometry lays out segments along u; shrink each ring toward the tip
        const seg = Math.floor(i / 6) / segs;
        const k = 1 - 0.85 * seg;
        const c = curve.getPointAt(Math.min(1, seg));
        pos.setXYZ(i,
          c.x + (pos.getX(i) - c.x) * k,
          c.y + (pos.getY(i) - c.y) * k,
          c.z + (pos.getZ(i) - c.z) * k);
      }
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, barbelMat);
      mesh.frustumCulled = false;
      group.add(mesh);
    }
  }

  // ---- eyes: seated on the surface normal so only the lens cap protrudes
  const eyeT = 0.855;
  const eyeAngle = Math.PI * 0.13;
  // Real goldfish eyes are prominent — roughly 6-7% of body length across.
  // The 0.021 value read as beads, so this is closer to life.
  const eyeR = style.length * 0.030;
  const eyeGeo = new THREE.SphereGeometry(eyeR, 24, 18);
  // Each eye gets its own material so it can carry its outward gaze direction.
  // The old shader derived the pupil direction from sign(N.x) of the sphere's
  // own normal, which flips across the ball and left most of it reading as a
  // flat grey marble.
  const makeEyeMat = (outward: THREE.Vector3) =>
    new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uEyeDir: { value: outward.clone() } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vW;
        void main(){
          vN = normalize(mat3(modelMatrix) * normal);
          vW = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${ENV}
        uniform vec3 uSunDir;
        uniform vec3 uEyeDir;
        varying vec3 vN; varying vec3 vW;
        void main(){
          vec3 N = normalize(vN);
          vec3 V = normalize(cameraPosition - vW);
          vec3 R = reflect(-V, N);

          // A carp eye is mostly dark: a large black pupil ringed by a narrow
          // band of gold, with only a sliver of pale sclera at the outer edge.
          // The reference is unmistakable about this — the previous version
          // spent most of its area on white sclera, which read as a beady
          // cartoon eye rather than a fish's.
          float facing = dot(N, normalize(uEyeDir));
          // The pale rim only exists at the very edge of the visible cap. Any
          // wider and it becomes a white almond at the front of the head —
          // the goldfish's dark eye has no visible sclera at all from outside.
          float sclera   = smoothstep(0.02, 0.16, facing);
          float irisBand = smoothstep(0.16, 0.30, facing);   // gold ring
          float pupil    = smoothstep(0.42, 0.56, facing);   // big black disc

          vec3 c = vec3(0.46, 0.36, 0.22);                   // rim, warm not white
          c = mix(c, vec3(0.80, 0.56, 0.12), irisBand);       // iris gold
          c = mix(c, vec3(0.005, 0.004, 0.004), pupil);       // pupil

          // wet cornea: environment reflection plus a tight key highlight
          c += envColor(R, uSunDir) * 0.30;
          c += vec3(1.0, 0.98, 0.92) * pow(max(0.0, dot(R, uSunDir)), 260.0) * 1.6;
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });

  const eyeNodes: Array<{ mesh: THREE.Mesh; base: THREE.Vector3 }> = [];
  for (const s of [1, -1]) {
    const t = eyeT;
    const ang = s > 0 ? eyeAngle : Math.PI - eyeAngle;
    const surf = bodySurface(style, t, ang);
    const nrm = bodyNormal(style, t, ang);
    // Seat the eye so a proper lens shows. At 0.62 of the radius buried, a
    // head viewed from the front showed only a thin sliver of the sphere — it
    // read as a slit rather than an eye. Just over half buried is right for a
    // fish: the ball sits proud of the skin like a bead.
    const centre = surf.clone().addScaledVector(nrm, -eyeR * 0.34);
    const eye = new THREE.Mesh(eyeGeo, makeEyeMat(nrm));
    eye.frustumCulled = false;
    eye.position.copy(centre);
    group.add(eye);
    eyeNodes.push({ mesh: eye, base: centre.clone() });
  }

  // ---- operculum (gill cover) is painted in the body shader, not built as a
  // separate plate. A lifted mesh always showed a seam and read as a strap
  // bolted to the flank; painting it on the shared surface blends perfectly and
  // needs no extra draw call.

  // ---- spine bend (mirrors the GLSL so the cloth and eyes agree)
  const curveAt = (z: number) => {
    const tn = Math.max(0, 1 - (z / uniforms.uLen.value + 0.5));
    const a = 1 - Math.exp(-tn * tn * 1.9);
    const w1 = Math.sin(tn * 5.1 - uniforms.uSwimPhase.value);
    const w2 = Math.sin(tn * 2.3 - uniforms.uSwimPhase.value * 0.5 + 1.7) * 0.30;
    return (w1 + w2) * a * uniforms.uSwimAmp.value;
  };
  const bend = (x: number, z: number): [number, number] => {
    const e = 0.015;
    const dx = (curveAt(z + e) - curveAt(z - e)) / (2 * e);
    const inv = 1 / Math.sqrt(1 + dx * dx);
    return [curveAt(z) + x * inv, z - x * dx * inv];
  };

  const updateTail = (dt: number, time: number, flow: THREE.Vector3) => {
    tail.update(dt, time, bend, flow);
    for (const e of eyeNodes) {
      const [bx, bz] = bend(e.base.x, e.base.z);
      e.mesh.position.set(bx, e.base.y, bz);
    }
  };

  return { group, uniforms, body, tail, updateTail };
}

export { STYLES };
export type { FishStyle };
