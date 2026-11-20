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
 * Koi / common carp — GENERATED from two reference views.
 *
 *   tools/trace-ref.mjs   traces a drawing into per-column ink extents
 *   tools/koi-tables.mjs  resamples both traces into the three tables below
 *
 * PROFILE is half-DEPTH from the side view, WIDTH is half-WIDTH from the plan
 * view, AXIS is the centreline drift. All are normalised to the body's own
 * maximum, so the mesh scales them by `style.depth` / `style.width` / `L`.
 *
 * The two drawings are not scale-consistent: measured independently, the plan
 * view comes out as wide as the side view is deep (width/depth = 1.02), which
 * no carp is. They are AI reference art, not an orthographic set. So WIDTH is
 * used for its SHAPE only — how the body tapers in plan, wide through the head
 * and pinching at the peduncle — while its absolute scale is set from anatomy
 * (see style.width below). PROFILE is trusted absolutely, since the side view
 * is the view the user is comparing against.
 */
const PROFILE_KOI: Profile = [
  // The trailing stations are NOT the raw trace values.
  //
  // The trace of the drawing bulges between u≈0.045 and u≈0.13 (raw half-depth
  // climbing 0.367 → 0.389 → 0.438) before falling to the tip. That bulge is
  // where the caudal fin's rays converge and the body's outline is interrupted
  // by the fin root — an artefact of separating fin from body, not a shape.
  // Reproducing it verbatim put a swelling on the peduncle: the body narrows,
  // swells again, then necks down at the very end.
  //
  // The taper must also be TIGHT. A slow, rounded shoulder here reads as a knob
  // on the end of the body — the "tail has not narrowed" complaint. A carp's
  // peduncle necks down over roughly the last 8% of the body and then meets the
  // fin; these numbers do that and reach a small cap radius so the end cap
  // tucks inside the caudal root.
  // ---- the body ends AT the peduncle, not at a point.
  //
  // Every earlier table tapered the body to a near-zero radius at t = 0 (0.062
  // of max depth) and then started the caudal fin from a single point. Two
  // near-points meeting produce the blunt knob that kept being reported: the
  // body collapses to a needle just before the fin's origin, and the flat end
  // cap reads as a ball on the end of the fish.
  //
  // A real fish does not do this. The body ends at the peduncle — still about a
  // third of maximum depth — with a vertical cross-section, and the caudal fin
  // attaches across that whole section. buildTailCloth() now spans its root row
  // across the same height, so body and fin meet along a line instead of a dot.
  [0.000, 0.060],
  [0.010, 0.185],
  [0.020, 0.300],
  [0.040, 0.378],
  [0.060, 0.410],
  [0.090, 0.428],
  [0.120, 0.435],
  [0.160, 0.500],
  [0.200, 0.595],
  [0.250, 0.718],
  [0.300, 0.809],
  [0.350, 0.882],
  [0.400, 0.939],
  [0.450, 0.980],
  [0.500, 0.999],
  [0.550, 0.988],
  [0.600, 0.922],
  [0.650, 0.842],
  [0.700, 0.845],
  [0.750, 0.783],
  [0.790, 0.673],
  [0.830, 0.619],
  [0.860, 0.592],
  [0.890, 0.537],
  [0.915, 0.459],
  [0.940, 0.353],
  [0.955, 0.285],
  [0.970, 0.213],
  [0.985, 0.135],
  [1.000, 0.059],
];

/**
 * Plan-view half-width. The head is nearly as wide as the body — that is what
 * gives the muzzle its blunt, broad front, and it is the quantity a single
 * `width` constant could never express.
 */
const WIDTH_KOI: Profile = [
  [0.000, 0.089],
  [0.040, 0.423],
  [0.080, 0.430],
  [0.120, 0.456],
  [0.160, 0.521],
  [0.200, 0.610],
  [0.250, 0.717],
  [0.300, 0.807],
  [0.350, 0.881],
  [0.400, 0.937],
  [0.450, 0.976],
  [0.500, 0.996],
  [0.550, 0.999],
  [0.600, 0.977],
  [0.650, 0.902],
  [0.700, 0.842],
  [0.750, 0.821],
  [0.790, 0.750],
  [0.830, 0.665],
  [0.860, 0.537],
  [0.890, 0.470],
  [0.915, 0.473],
  [0.940, 0.520],
  [0.955, 0.580],
  [0.970, 0.660],
  [0.985, 0.742],
  [1.000, 0.800],
];

const AXIS_KOI: Profile = [
  [0.000, 0.040],
  [0.040, -0.035],
  [0.080, -0.039],
  [0.120, -0.063],
  [0.160, -0.089],
  [0.200, -0.106],
  [0.250, -0.107],
  [0.300, -0.086],
  [0.350, -0.063],
  [0.400, -0.042],
  [0.450, -0.021],
  [0.500, 0.000],
  [0.550, 0.030],
  [0.600, 0.092],
  [0.650, 0.151],
  [0.700, 0.105],
  [0.750, 0.098],
  [0.790, 0.133],
  [0.830, 0.093],
  [0.860, 0.043],
  [0.890, 0.017],
  [0.915, 0.026],
  [0.940, 0.058],
  [0.955, 0.080],
  [0.970, 0.096],
  [0.985, 0.111],
  [1.000, 0.124],
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
    length: 1.45, depth: 0.165, width: 0.072, profile: PROFILE_KOI,
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

  // Body axis.
  //
  // For the koi this is NOT a constant offset: it is the measured centreline
  // of the drawing (AXIS_KOI). The line art genuinely has the axis rise through
  // the head and dip slightly behind the gill, and reproducing the outline
  // without that drift is impossible — a straight axis with a symmetric profile
  // can only produce a fish that is top-bottom symmetric, which the drawing is
  // not.
  //
  // For the goldfish species (no measured curve) the old constant-below-flank
  // offset stays, so they are unchanged.
  let cy: number;
  if (style.koi > 0.5) {
    // half-depth in the same units the axis table uses
    cy = smoothProfile(AXIS_KOI, t) * style.depth * L;
  } else {
    cy = -r * style.depth * L * 0.06;
  }

  // The snout dips only slightly, so the mouth sits just below the eye line.
  const snout = Math.exp(-Math.pow((t - 0.93) / 0.045, 2));
  if (style.koi <= 0.5) cy -= snout * L * 0.014;

  // The muzzle does NOT get squashed.
  //
  // An earlier version flattened y over the last stretch to make a "wedge", on
  // the theory that a circular cone reads as a beak. It does — but the line-art
  // silhouette IS the side view, so its height curve is exactly the height the
  // muzzle must have. Squashing it made the model thinner than the drawing by
  // 0.25 half-depths at the tip, which `tools/outline-compare.mjs` reports as
  // the worst residual in the whole outline. The muzzle is left round and the
  // lips are formed by the cleft below instead.
  const squashY = 1;

  // ---- mouth, cut into the surface (koi only; goldfish keep the old muzzle).
  //
  // Kept because a mouth has to be visible in SILHOUETTE, which no amount of
  // shading can do. Everything else that used to deform the body here has been
  // removed — see the note at the top of this function.
  if (style.koi > 0.5) {
    const cleftT = THREE.MathUtils.smoothstep(t, 0.930, 0.992);
    const dyN = Math.sin(angle);                     // -1 belly .. +1 back
    const ady = Math.abs(dyN);
    const notch = cleftT * (1 - THREE.MathUtils.smoothstep(ady, 0.04, 0.26));
    if (notch > 0) {
      z -= notch * L * 0.013;
      cy += Math.sign(dyN) * notch * L * 0.005;
    }
  }

  // ---- width along the body.
  //
  // Two things here, both about avoiding slope breaks:
  //
  // 1. `sqrt(r*r + f*f)` instead of `Math.max(r*widthMul, floor)`. The max()
  //    was C0 but not C1 — the arguments cross at one t, and across that point
  //    the surface's slope changes abruptly. bodyNormal() differentiates the
  //    surface, so the break became a bright/dark ring encircling the body: a
  //    vertical band in side view. The square-root form is smooth everywhere
  //    and still keeps the muzzle broad.
  //
  // 2. WIDTH_KOI is notched near the tip so the plan view stays wide there
  //    without needing an exception.
  const widthMul = style.koi > 0.5 ? smoothProfile(WIDTH_KOI, t) : 1;
  const tipFloor = 0.20 * THREE.MathUtils.smoothstep(t, 0.93, 1.0);
  const rX = Math.sqrt(r * r + tipFloor * tipFloor) * widthMul;

  return new THREE.Vector3(
    Math.cos(angle) * rX * style.width * L,
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

            // Shift the UV so the wrap seam lands on the DORSAL ridge instead of
      // the flank. With one tile (uScaleTiling = 1,1) the texture's wrap is the
      // only seam left, and at 0.75 it falls on the back where it cannot be
      // seen from either side.
      uvs.push(arc[j] / perim + 0.75, t);
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
  // Span along the body axis, in t (0 tail tip .. 1 snout).
  //
  // Measured from the drawing by tools/fin-measure.mjs, which subtracts the
  // traced body outline from the full ink envelope: the difference IS the fin.
  // Those numbers were in u-from-the-nose, so t = 1 - u here.
  //
  // The spans are pulled apart slightly from the raw measurement. In the
  // drawing the fins are drawn as separate shapes hanging off the flank; on the
  // model each is a swept surface, and when two adjacent spans overlap the two
  // membranes merge into one slab under the belly. Tucking the rear end of the
  // pectoral forward and the front end of the pelvic back keeps them distinct.
  //   dorsal     u 0.39–0.73   (t 0.27–0.61)
  //   pectoral   u 0.24–0.39   (t 0.61–0.76)
  //   pelvic     u 0.44–0.58   (t 0.42–0.56)
  //   anal       u 0.63–0.75   (t 0.25–0.37)
  const tSpan: [number, number] =
    kind === 'dorsal' ? [0.27, 0.61]
    : kind === 'anal' ? [0.25, 0.37]
    : kind === 'pectoral' ? [0.62, 0.75]
    : [0.42, 0.56];

  // How far the fin projects past the skin, in body-length units.
  //
  // These are the drawing's own measurements from tools/fin-measure.mjs, used
  // directly. An earlier version scaled them by per-fin multipliers produced by
  // tools/fin-solve.mjs — but those multipliers were computed from a model whose
  // fins pointed sideways and so projected almost nothing, and applying them
  // made the pectoral 35% of body length against the drawing's 14%. The
  // measured projections are the target; FIN_TRIM corrects the small residual
  // overshoot that appears once a swept membrane is actually projected.
  const FIN_TRIM = 0.88;
  const maxH =
    kind === 'dorsal' ? L * 0.175 * FIN_TRIM
    : kind === 'anal' ? L * 0.126 * FIN_TRIM
    : kind === 'pectoral' ? L * 0.144 * FIN_TRIM
    : L * 0.153 * FIN_TRIM;

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
      // Sweeps BACK AND DOWN, almost in the side plane.
      //
      // It used to point mainly outward (+x), so in a side view it projected to
      // almost nothing — measuring the model showed only 0.056 of body length
      // against the drawing's 0.143, a 2.6x shortfall that no amount of scale
      // would fix. The fin has to lie against the flank to be seen from the
      // side, which is also how a resting carp holds it.
      spanDir = new THREE.Vector3(side * 0.26, -0.62, -0.74).normalize();
      chordDir = new THREE.Vector3(0, 0, 1);
    } else if (kind === 'pelvic') {
      // Hangs down and back, nearly in the side plane as well.
      spanDir = new THREE.Vector3(side * 0.20, -0.88, -0.44).normalize();
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
      //
      // The chord must NOT be a multiple of the fin's height. Tying it to maxH
      // meant that enlarging a fin also made it wider along the body, so the
      // pectoral and pelvic grew until they touched each other and ran past
      // their own spans — one continuous slab under the belly instead of two
      // separate fins. A pectoral is a long narrow paddle; a dorsal nearly
      // spans the body, so its chord is the tall one.
      const chordScale =
        kind === 'dorsal' ? 1.15
        : kind === 'anal' ? 0.55
        : kind === 'pectoral' ? 0.50
        : 0.45;
      const chord = maxH * env * Math.pow(d, 0.72) * chordScale;
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
  // Resolution matters here: the caudal fin is the largest high-contrast edge in
  // the frame, and at 26 columns each quad was about 8 px across, so its
  // trailing edge rendered as a staircase. The cloth cost is one more row of
  // spring constraints, which is negligible.
  const cols = 46;
  const rows = 26;
  const span = L * (style.width < 0.11 ? 0.34 : 0.26);
  const rest = new Float32Array(cols * rows * 3);

  for (let i = 0; i < cols; i++) {
    const u = i / (cols - 1);
    const s = u * 2 - 1;
    const as = Math.abs(s);
    for (let j = 0; j < rows; j++) {
      const d = j / (rows - 1);
      // Fork shape. A carp's tail is forked with a fairly narrow V; the fancy
      // goldfish read better with a deeper, softer fan, so the two get separate
      // numbers rather than one compromise.
      const notch = style.koi > 0.5
        ? 1 - 0.42 * Math.exp(-s * s * 5.0)
        : 1 - 0.55 * Math.exp(-s * s * 3.2);
      // Lobe outline.
      //
      // This must never reach ZERO at the outer column. When it did, the last
      // two columns of the mesh collapsed onto the same line — same y, different
      // z — so the membrane folded back on itself there and rendered as a black
      // slit down the middle of the fin. Stopping at 0.16 keeps a real edge on
      // the last column and the taper still reads as a point.
      const tip = 0.16 + 0.84 * Math.pow(Math.max(0, 1 - Math.pow(as, 3)), 0.45);
      // The fin's root must sit at the body's ACTUAL end, AND span it.
      //
      // Two separate errors used to live here. The root started at z = -0.46L
      // while the body runs to -0.5L, so a stub of body protruded behind the
      // fin. And every d = 0 vertex collapsed onto a single point, so a body
      // ending in a rounded cap met a fin starting from a dot — the blunt knob
      // that kept being reported as "the tail has not narrowed".
      //
      // The root row now spans the peduncle: at d = 0 the fin is a vertical line
      // exactly as tall as the body's end cross-section, so the two meet along a
      // line and the silhouette necks straight into the fin.
      // The root row sits 2% FORWARD of the body's tip, at the station where
      // the body is exactly rootHalf deep, and the body carries on tapering to
      // almost nothing behind it. That last sliver is hidden behind the fin's
      // membrane, so the silhouette reads as body-blending-into-fin instead of
      // body-then-a-vertical-cut.
      const z = -L * (style.koi > 0.5 ? 0.48 : 0.5) - d * span * notch;
      // Koi get a root row that spans the peduncle; goldfish keep the fan that
      // grows from a point, which is what their silhouette actually shows.
      const rootHalf = style.koi > 0.5 ? 0.300 * style.depth * L : 0;
      const lobeHalf = L * 0.278 * tip;
      const y = s * (rootHalf * (1 - d) + lobeHalf * Math.pow(d, 0.88));
      const x = s * d * L * 0.070 * tip + d * d * Math.cos(s * 1.9) * L * 0.040;
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
    uScaleTiling: { value: new THREE.Vector2(1, 1) },
    // local y of the snout tip: the mouth is placed relative to this, because
    // the muzzle droops and an absolute y put the cleft on the cheek
    uTipY: { value: bodySurface(style, 1.0, 0).y },
    uTipZ: { value: bodySurface(style, 1.0, 0).z },
    // Reference radius for the painted mouth. This must NOT be the radius at
    // t=1: the profile now closes to a point there (0.018), so the mouth's
    // inner test collapsed into a dot and the cleft rendered as a vertical
    // pinhole. The muzzle's width just behind the tip is what the mouth is
    // actually sized against.
    uTipRadius: { value: Math.max(1e-3, smoothProfile(style.profile, 0.945) * style.width * style.length) },
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
          // Height modulates the albedo only where the scales are, and the
          // modulation is written so that scaleZone = 0 yields exactly 1.0 —
          // no step when the zone fades out. The previous mix(0.975, 1.012, …)
          // changed the base brightness by 3.7% between inside and outside the
          // zone, which drew its own faint band where the zone faded.
          float th = texture2D(uScaleHeight, scaleUV()).r;
          col *= 1.0 + (th - 0.5) * 0.05 * scaleZone;
        }

        // ---- mouth cleft: the dark inside of the notch cut in bodySurface().
        //
        // The notch itself is geometry (see the mouth block there); all this
        // does is darken the skin inside it so it reads as an opening rather
        // than a dent. Sizing is relative to the MUZZLE width just behind the
        // tip, not the tip radius — the profile closes to a point now, and
        // scaling by that made the mouth a pinhole.
        {
          float R = max(0.001, uTipRadius);
          float mx = lp.x / R;
          float my = (lp.y - uTipY) / R;
          float nearTip = smoothstep(0.90, 0.955, along);

          float halfW = 0.92;
          float halfH = 0.055 + uMouth * 0.30;
          float open = smoothstep(halfW, halfW * 0.80, abs(mx))
                     * smoothstep(halfH, halfH * 0.55, abs(my))
                     * nearTip;

          // lips: a soft pale roll on each side of the cleft
          float lipY = abs(my) - (halfH + 0.10);
          float lip = smoothstep(0.12, 0.02, abs(lipY))
                    * smoothstep(halfW * 1.06, halfW * 0.75, abs(mx)) * nearTip;
          col = mix(col, col * 1.10 + vec3(0.03, 0.02, 0.01), lip * 0.35);

          float depth = smoothstep(1.0, 0.0, length(vec2(mx / halfW, my / max(0.02, halfH))));
          col = mix(col, mix(vec3(0.075, 0.028, 0.020), vec3(0.008, 0.003, 0.002), depth),
                    open * 0.96);
        }

        // ---- operculum (gill cover).
        //
        // ONE soft crescent, and nothing else.
        //
        // The previous version layered four effects into the same few percent of
        // body length: a 0.93 plate, a 0.72 slit drawn with a 1.1%-wide
        // smoothstep (a near-hard line), a 1.10 bright edge, and — separately —
        // a geometric bump and an albedo ramp from the scale zone. Each is a
        // band; stacked they read as the two dark marks that kept being
        // reported. A gill cover should be a soft shading break with no line in
        // it at all, so this is now a single gradient with one weak highlight.
        {
          float ay = lp.y / max(0.001, uLen * 0.135);   // -1 belly .. +1 back
          // Slightly curved edge, softer toward the belly.
          float gillLine = 0.800 - 0.020 * ay * ay;
          float d = along - gillLine;
          float onFlank = smoothstep(1.05, 0.30, abs(ay));

          // A wide, gentle darkening ahead of the opening, fading out over 18%
          // of body length. No narrow term, so there is nothing that can read
          // as a line or a crease.
          float cover = smoothstep(0.18, 0.0, d) * smoothstep(-0.06, 0.02, d);
          col = mix(col, col * 0.955, cover * onFlank * 0.9);

          // The free edge catches a touch of light — a low-contrast ridge, not
          // an outline. Written as x*x because pow() is undefined for a
          // negative base in GLSL ES 1.0, and a shader compile error here makes
          // the whole body disappear.
          float dd = (d - 0.005) / 0.022;
          float rim = exp(-dd * dd) * onFlank;
          col = mix(col, col * 1.035, rim * 0.6);
        }

        // ---- scale relief, from the baked normal map. Nothing is
        // differentiated per pixel, so no lattice border can spike.
        //
        // Strength falls off with viewing angle. Toward the belly and along the
        // silhouette the surface is nearly edge-on, so a fixed-strength tilt is
        // magnified in screen space and the scale troughs smear into long
        // vertical streaks — which is what has been reading as dark bands down
        // the flank. Physically the relief should also be least visible there,
        // since the surface is seen at a grazing angle.
        vec3 V0 = normalize(cameraPosition - vWorld);
        float facing = clamp(dot(normalize(vNormal), V0), 0.0, 1.0);
        {
          N = applyScaleNormal(N, 0.30 * scaleZone * pow(facing, 1.4), scaleH);
        }

        // ---- lighting
        vec3 V = V0;
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
  // Tag it, so debug probes and tools never have to guess which child is the
  // caudal cloth — or, worse, match it by vertex count, which silently breaks
  // the moment the mesh resolution changes.
  tailMesh.name = 'caudal';
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
