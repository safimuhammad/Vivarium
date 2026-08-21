/**
 * Authors the Nirvana East dry-scrub PILOT scene (region 3 of 4). Sibling of
 * `warmSpringsPilot/springsScene.ts` - same discipline: two facts come from
 * ONE source, so the terrain a being cannot enter is exactly the terrain
 * drawn as brine, brinerim, thorn, mesa, scarp, or slot.
 *
 * THE NEW LAW (contract §2): the region is a TORUS. Every field function here
 * is periodic with period (96, 96) BY CONSTRUCTION:
 *  - {@link periodicValueNoise} / {@link periodicFbm} hash a lattice wrapped
 *    modulo a period that DIVIDES 96 (contract §2.1).
 *  - {@link torusDelta} / {@link torusDistance} give the minimal wrapped
 *    delta/distance on every axis (contract §2.2) - used everywhere a
 *    distance is measured, so a feature's nearest instance is always found,
 *    whether it lies at a raw coordinate or one lap around the seam.
 *  - {@link sampleClosedSpline} builds channels that are literally closed
 *    curves on the torus: `periodOffset` is a lattice vector (each component
 *    a multiple of 96), so lap N's point 0 IS lap (N-1)'s point (count)
 *    (contract §2.3).
 *  - Composition C's bands use `phase = 2π(a·col + b·row) / 96` with integer
 *    a, b (contract §2.4).
 *  - The corner field is stored as a 96x96 array with WRAPPED indices
 *    ({@link cornerIndex}), so `cornerAt(96, y) === cornerAt(0, y)` and
 *    `cornerAt(x, 96) === cornerAt(x, 0)` are true by construction, not by
 *    patching - {@link cornerSeamMismatches} proves it (contract §2.5).
 *
 * PLOT SAFETY (all three compositions must reach 0/128 lost) is reached by a
 * single universal gate, {@link blockingAdmitted}: a blocking material may
 * never be painted within a padded ring around any of the 128 shelter-plot
 * footprints, checked TOROIDALLY so a plot near column 0 is protected from a
 * feature approaching via column 95 too. This replaces Warm Springs'
 * margin/gutter corridor gate - that approach cannot work here, because
 * composition C's brine channel is a diagonal that legitimately crosses the
 * district band (contract §8C), so confining blocking material to the
 * margins would tear a continuous "closed curve on the torus" into a dashed
 * line. A direct plot-proximity gate is simpler, correct for every
 * composition regardless of how its geometry is routed, and still leaves
 * composition B's placement-time butte rejection (contract §8B: "reject any
 * butte overlapping a plot rect... do not trim afterwards") as an *extra*,
 * belt-and-braces check on top.
 */

import {
  BLOCKING_NIRVANA_EAST_MATERIALS,
  hasShoreSet,
  isBlockingMaterial,
  isWaterMaterial,
  NIRVANA_EAST_BASE_VARIANTS,
  NIRVANA_EAST_EDGE_VARIANTS,
  NIRVANA_EAST_MATERIAL_PRIORITY,
  type NirvanaEastMaterial,
} from "./eastMaterials";

export const NIRVANA_EAST_COLUMNS = 96;
export const NIRVANA_EAST_ROWS = 96;
export const NIRVANA_EAST_TILE_SIZE = 32;
export const NIRVANA_EAST_WIDTH_PX = NIRVANA_EAST_COLUMNS * NIRVANA_EAST_TILE_SIZE;
export const NIRVANA_EAST_HEIGHT_PX = NIRVANA_EAST_ROWS * NIRVANA_EAST_TILE_SIZE;

/** The torus period, tiles, on both axes (contract §2 - always square, always 96). */
const TORUS = NIRVANA_EAST_COLUMNS;

export type NirvanaEastCompositionId = "a-arroyo-braid" | "b-mesa-field" | "c-salt-pan";

export const NIRVANA_EAST_COMPOSITION_IDS: readonly NirvanaEastCompositionId[] = Object.freeze([
  "a-arroyo-braid",
  "b-mesa-field",
  "c-salt-pan",
]);

/**
 * ROUND 2: landforms are authored illustrated OBJECTS standing on the ground
 * plane (module docstring, "ROUND 2 PROGRESS"), not terrain colour tiers.
 * Three size tiers, matching the authored atlas frames exactly
 * (`s.mesa.0` / `s.butte.0` / `s.outcrop.0`).
 */
export type NirvanaEastLandformTier = "mesa" | "butte" | "outcrop";

export const NIRVANA_EAST_LANDFORM_TIERS: readonly NirvanaEastLandformTier[] = Object.freeze([
  "mesa",
  "butte",
  "outcrop",
]);

/** A walkable pocket smaller than this is sealed rather than crossed. */
const MIN_DECKED_POCKET_TILES = 20;

/** No authored crossing may span more blocked ground than this. */
const MAX_CROSSING_DECK_TILES = 16;

/** Raised when an authored composition cannot be built as specified. */
export class NirvanaEastSceneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NirvanaEastSceneError";
  }
}

export interface NirvanaEastTileOverlay {
  readonly material: NirvanaEastMaterial;
  /** Corner mask, bit 1 = NW, 2 = NE, 4 = SE, 8 = SW - matches the art script. */
  readonly mask: number;
  readonly variant: number;
}

export interface NirvanaEastTileShoreline {
  readonly material: NirvanaEastMaterial;
  readonly mask: number;
  readonly variant: number;
}

export interface NirvanaEastTile {
  readonly column: number;
  readonly row: number;
  readonly base: NirvanaEastMaterial;
  readonly baseVariant: number;
  readonly overlays: readonly NirvanaEastTileOverlay[];
  readonly shorelines: readonly NirvanaEastTileShoreline[];
  readonly material: NirvanaEastMaterial;
  readonly blocked: boolean;
  readonly crossingDeck: boolean;
  readonly deckOver: NirvanaEastMaterial | null;
}

export type NirvanaEastTileRef = Readonly<{ column: number; row: number }>;

export type NirvanaEastCrossingAxis = "east-west" | "north-south";

export interface NirvanaEastCrossing {
  readonly id: string;
  readonly axis: NirvanaEastCrossingAxis;
  readonly deck: readonly NirvanaEastTileRef[];
  readonly abutments: readonly NirvanaEastTileRef[];
}

export interface NirvanaEastProp {
  readonly id: string;
  readonly frameId: string;
  readonly x: number;
  readonly y: number;
  readonly footY: number;
  readonly footX: number;
  readonly blocks: boolean;
  readonly tile: Readonly<{ column: number; row: number }>;
  /**
   * Every tile this ONE prop instance blocks. A single-tile prop (the
   * pre-existing species: thornbush, boulder, hoodoo, ...) always carries
   * `[tile]` here - identical to the old single-tile behaviour. A landform
   * carries its full multi-tile footprint ellipse (see
   * {@link landformFootprintTiles}), toroidally wrapped.
   */
  readonly footprint: readonly NirvanaEastTileRef[];
  /**
   * Non-null only for landform props: the id every prop entry belonging to
   * ONE physical landform placement shares - the anchor (which blocks) and
   * its purely-visual wrapped-edge duplicates (see
   * {@link wrapDuplicateOffsets}) alike. The connectivity repair pass in
   * {@link createNirvanaEastScene} removes a whole group together, never a
   * lone duplicate, so a dropped landform never leaves a floating sprite
   * with mismatched collision.
   */
  readonly landformGroup: string | null;
}

/**
 * One accepted landform placement, pre-plot-safety-checked (contract: "reject
 * BEFORE placing"). `footCol`/`footRow` are the sprite's foot (pivot) in RAW,
 * possibly out-of-[0,96) continuous TILE units - wrapped only at the point of
 * use, exactly like every other periodic field in this module (module
 * docstring, contract §2). `footprint` is the already-wrapped, deduplicated
 * set of blocked tiles.
 */
export interface NirvanaEastLandformPlacement {
  readonly id: string;
  readonly tier: NirvanaEastLandformTier;
  readonly footCol: number;
  readonly footRow: number;
  readonly footprint: readonly NirvanaEastTileRef[];
}

export interface NirvanaEastScene {
  readonly compositionId: NirvanaEastCompositionId;
  readonly columns: number;
  readonly rows: number;
  readonly tileSize: number;
  readonly widthPixels: number;
  readonly heightPixels: number;
  readonly tiles: readonly NirvanaEastTile[];
  readonly collision: Uint8Array;
  readonly props: readonly NirvanaEastProp[];
  readonly crossings: readonly NirvanaEastCrossing[];
  readonly cornerMaterials: readonly NirvanaEastMaterial[];
}

// ---------------------------------------------------------------------------
// deterministic, TOROIDALLY PERIODIC noise (contract §2.1)
// ---------------------------------------------------------------------------

function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 0x27d4_eb2d) ^ Math.imul(y | 0, 0x1656_67b1)
    ^ Math.imul(seed | 0, 0x9e37_79b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85eb_ca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2_ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffff_ffff;
}

/**
 * Value noise whose lattice hash is wrapped modulo `period` BEFORE hashing,
 * so the field is EXACTLY periodic: `noise(x, y) === noise(x + period, y)`.
 * `period` must be a positive integer. Every caller derives it as
 * `TORUS / feature`, so it is only ever an integer when `feature` divides
 * `TORUS` - {@link periodicFbm} enforces that at call time (contract §2.1:
 * "any octave whose period does not divide 96 is a bug").
 */
function periodicValueNoise(x: number, y: number, seed: number, period: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const wrap = (n: number): number => ((n % period) + period) % period;
  const a = hash2(wrap(xi), wrap(yi), seed);
  const b = hash2(wrap(xi + 1), wrap(yi), seed);
  const c = hash2(wrap(xi), wrap(yi + 1), seed);
  const d = hash2(wrap(xi + 1), wrap(yi + 1), seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/**
 * Periodic fractal-brownian-motion. `features` lists one FEATURE size (tiles
 * spanned by one noise cell) per octave, each of which MUST divide
 * {@link TORUS} - `TORUS / feature` is then an exact integer lattice period,
 * so the whole sum is periodic with period (96, 96) (contract §2.1).
 */
function periodicFbm(column: number, row: number, seed: number, features: readonly number[]): number {
  let sum = 0;
  let amplitude = 0.5;
  let norm = 0;
  features.forEach((feature, index) => {
    if (!Number.isInteger(feature) || feature <= 0 || TORUS % feature !== 0) {
      throw new NirvanaEastSceneError(
        `periodicFbm feature ${feature} does not divide the torus period ${TORUS}.`,
      );
    }
    const period = TORUS / feature;
    const value = periodicValueNoise(column / feature, row / feature, seed + index * 101, period);
    sum += amplitude * value;
    norm += amplitude;
    amplitude *= 0.5;
  });
  return sum / norm;
}

/** Minimal signed toroidal delta between two coordinates on a 96-period axis (contract §2.2). */
function torusDelta(a: number, b: number): number {
  let d = (a - b) % TORUS;
  if (d > TORUS / 2) d -= TORUS;
  else if (d < -TORUS / 2) d += TORUS;
  return d;
}

/** Toroidal Euclidean distance between two points, wrapped per axis (contract §2.2). */
function torusDistance(ax: number, ay: number, bx: number, by: number): number {
  const dx = torusDelta(ax, bx);
  const dy = torusDelta(ay, by);
  return Math.hypot(dx, dy);
}

function wrapCoord(value: number): number {
  return ((value % TORUS) + TORUS) % TORUS;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

// ---------------------------------------------------------------------------
// splines - open (local features) and CLOSED ON THE TORUS (edge-crossing ones)
// ---------------------------------------------------------------------------

function catmullRom(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x)
      + (-p0.x + p2.x) * t
      + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2
      + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y)
      + (-p0.y + p2.y) * t
      + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2
      + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

/** Catmull-Rom through an OPEN polyline; used for local, non-edge-crossing features. */
function sampleSpline(points: readonly Point[], samplesPerSegment: number): Point[] {
  const result: Point[] = [];
  for (let index = 0; index < points.length - 3; index += 1) {
    for (let step = 0; step < samplesPerSegment; step += 1) {
      result.push(catmullRom(
        points[index], points[index + 1], points[index + 2], points[index + 3],
        step / samplesPerSegment,
      ));
    }
  }
  return result;
}

/**
 * Catmull-Rom through a CLOSED loop on the torus (contract §2.3): `points`
 * is one lap (`count` control points), and the loop closes after advancing by
 * exactly `periodOffset` - a lattice vector whose components are each a
 * multiple of {@link TORUS} (e.g. `{x:96,y:0}` wraps east once, `{x:0,y:96}`
 * wraps south once, `{x:96,y:-96}` wraps both in one diagonal lap). `at(i)`
 * indexes the control points modulo `count`, adding `periodOffset` once per
 * whole lap crossed - so `at(-1)` and `at(count)` are REAL neighbouring
 * points (not synthesised), giving genuine tangent continuity at the seam
 * rather than a kink. Samples are left at their raw (possibly negative or
 * >96) coordinates deliberately: every consumer measures distance with
 * {@link torusDelta}, which is exact for any coordinate magnitude, so this is
 * how the wrap is actually proved rather than pre-wrapped away.
 */
function sampleClosedSpline(
  points: readonly Point[],
  periodOffset: Point,
  samplesPerSegment: number,
): Point[] {
  const n = points.length;
  if (n < 3) {
    throw new NirvanaEastSceneError("A closed-loop channel needs at least 3 control points.");
  }
  const at = (i: number): Point => {
    const laps = Math.floor(i / n);
    const index = i - laps * n;
    return { x: points[index].x + laps * periodOffset.x, y: points[index].y + laps * periodOffset.y };
  };
  const result: Point[] = [];
  for (let index = 0; index < n; index += 1) {
    const p0 = at(index - 1);
    const p1 = at(index);
    const p2 = at(index + 1);
    const p3 = at(index + 2);
    for (let step = 0; step < samplesPerSegment; step += 1) {
      result.push(catmullRom(p0, p1, p2, p3, step / samplesPerSegment));
    }
  }
  return result;
}

/** Jitter a hand-authored control polyline so it reads as organic, not ruled. */
function jitterControlPoints(points: readonly Point[], amplitude: number, seed: number): Point[] {
  return points.map((point, index) => ({
    x: point.x + (hash2(index, seed, 4001) - 0.5) * 2 * amplitude,
    y: point.y + (hash2(index, seed, 4051) - 0.5) * 2 * amplitude,
  }));
}

/**
 * `count` control points evenly spaced along the straight run from `origin`
 * to `origin + periodOffset` (NOT including the endpoint - that IS lap 2's
 * point 0), perturbed laterally (perpendicular to the run) by hashed
 * per-point wobble so the loop meanders rather than sitting on a ruler-straight
 * line (contract §7.5). Used for every channel that crosses the whole region.
 */
function loopControlPoints(
  origin: Point,
  periodOffset: Point,
  count: number,
  amplitude: number,
  seed: number,
): Point[] {
  const length = Math.hypot(periodOffset.x, periodOffset.y) || 1;
  const ux = periodOffset.x / length;
  const uy = periodOffset.y / length;
  const px = -uy;
  const py = ux;
  const points: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = index / count;
    const baseX = origin.x + periodOffset.x * t;
    const baseY = origin.y + periodOffset.y * t;
    const broad = hash2(index, seed, 4201) - 0.5;
    const fine = hash2(index + 1, seed, 4297) - 0.5;
    const wobble = (broad * 1.6 + fine * 0.6) * amplitude;
    points.push({ x: baseX + px * wobble, y: baseY + py * wobble });
  }
  return points;
}

/**
 * A width function that pinches to a fissure and swells into a pool along the
 * run - noise-DOMINANT, deliberately not a sine wave (a fixed-period
 * oscillation reads as a repeating bead necklace at 32px, exactly as
 * mechanical as a constant width). `u` spans the WHOLE run (0..1).
 */
function meanderHalfWidth(base: number, swing: number, seed: number): (u: number) => number {
  return (u: number): number => {
    const broad = periodicFbm(u * 96, seed * 0.41, seed + 300, [24, 12]) - 0.5;
    const fine = periodicFbm(u * 96, seed * 1.7, seed + 450, [8, 4]) - 0.5;
    return Math.max(0.25, base + (broad * 1.8 + fine * 0.6) * swing);
  };
}

// ---------------------------------------------------------------------------
// channels
// ---------------------------------------------------------------------------

interface Channel {
  readonly samples: readonly Point[];
  readonly halfWidth: (u: number) => number;
  readonly core: NirvanaEastMaterial;
  readonly fringe: NirvanaEastMaterial | null;
  /**
   * ABSOLUTE tiles of fringe beyond the core edge - deliberately NOT a
   * fraction of `halfWidth`. A fractional fringe (`halfWidth * fraction`)
   * vanishes to near-zero absolute thickness at the run's own pinch points
   * (where `halfWidth` is near its floor), tearing a supposedly continuous
   * cut-bank into isolated 1-tile blobs at every pinch - measured, not
   * theoretical: this was the actual first-pass bug. An absolute thickness
   * stays the contract's "1-2 tiles thick" regardless of how the core pinches.
   */
  readonly fringeThickness: number;
  /** Seeds this channel's own "natural ramp" breaks in the fringe - see {@link channelMaterialAt}. */
  readonly seed: number;
}

function closedLoopChannel(
  origin: Point,
  periodOffset: Point,
  count: number,
  amplitude: number,
  samplesPerSegment: number,
  halfWidth: (u: number) => number,
  core: NirvanaEastMaterial,
  fringe: NirvanaEastMaterial | null,
  fringeThickness: number,
  seed: number,
): Channel {
  const controlPoints = loopControlPoints(origin, periodOffset, count, amplitude, seed);
  return {
    samples: Object.freeze(sampleClosedSpline(controlPoints, periodOffset, samplesPerSegment)),
    halfWidth,
    core,
    fringe,
    fringeThickness,
    seed,
  };
}

/** A short, local (non-edge-crossing) meandering channel - e.g. a slot canyon between two buttes. */
function localChannel(
  from: Point,
  to: Point,
  segments: number,
  amplitude: number,
  baseHalfWidth: number,
  widthSwing: number,
  core: NirvanaEastMaterial,
  fringe: NirvanaEastMaterial | null,
  fringeThickness: number,
  seed: number,
): Channel {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const points: Point[] = [];
  for (let step = -1; step <= segments + 1; step += 1) {
    const t = step / segments;
    const baseX = from.x + dx * t;
    const baseY = from.y + dy * t;
    const wobble = (hash2(step, seed, 71) - 0.5) * 2 * amplitude;
    points.push({ x: baseX + px * wobble, y: baseY + py * wobble });
  }
  return {
    samples: Object.freeze(sampleSpline(points, Math.max(3, Math.ceil(20 / segments)))),
    halfWidth: meanderHalfWidth(baseHalfWidth, widthSwing, seed),
    core,
    fringe,
    fringeThickness,
    seed,
  };
}

const RAMP_GATE_FEATURES: readonly number[] = [8, 4];

/**
 * "Broken by natural ramps" (contract §8A): a periodic gate that suppresses
 * the fringe at intervals along a channel's own run, letting the core spill
 * through where a ramp would be. Independent per channel (seeded from the
 * channel's own seed) so different cut-banks break at different points.
 */
function rampOpen(x: number, y: number, seed: number): boolean {
  return periodicFbm(x, y, seed + 8000, RAMP_GATE_FEATURES) > 0.7;
}

/**
 * Nearest-sample material lookup across every channel, TOROIDALLY (contract
 * §2.2). The nearest CHANNEL is still chosen by normalized distance (a fair
 * comparison across channels of different widths), but core/fringe is then
 * decided from the RAW distance against that channel's local half-width plus
 * its absolute {@link Channel.fringeThickness} - see that field's docstring.
 */
function channelMaterialAt(channels: readonly Channel[], x: number, y: number): NirvanaEastMaterial | null {
  let bestNormalized = Number.POSITIVE_INFINITY;
  let bestChannel: Channel | null = null;
  let bestDistance = 0;
  let bestHalfWidth = 0;
  for (const channel of channels) {
    const { samples } = channel;
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      const dx = torusDelta(x, sample.x);
      const dy = torusDelta(y, sample.y);
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > 400) continue;
      const u = index / Math.max(1, samples.length - 1);
      const halfWidth = channel.halfWidth(u);
      const distance = Math.sqrt(distanceSquared);
      const normalized = distance / halfWidth;
      if (normalized < bestNormalized) {
        bestNormalized = normalized;
        bestChannel = channel;
        bestDistance = distance;
        bestHalfWidth = halfWidth;
      }
    }
  }
  if (bestChannel === null) return null;
  if (bestDistance <= bestHalfWidth) return bestChannel.core;
  if (bestChannel.fringe !== null && bestDistance <= bestHalfWidth + bestChannel.fringeThickness) {
    if (rampOpen(x, y, bestChannel.seed)) return bestChannel.core;
    return bestChannel.fringe;
  }
  return null;
}

// ---------------------------------------------------------------------------
// radial masses (buttes, brine nodes) - contract §2.2 toroidal distance,
// optionally flow-stretched for elongated masses
// ---------------------------------------------------------------------------

export interface MassRing {
  readonly material: NirvanaEastMaterial;
  /** Outer edge of this ring, in tiles from the mass centre. */
  readonly outer: number;
}

interface RadialMass {
  readonly id: string;
  readonly cx: number;
  readonly cy: number;
  readonly flow?: Readonly<{ dx: number; dy: number; stretch: number }>;
  readonly rings: readonly MassRing[];
  readonly seed: number;
  readonly noiseAmount: number;
  /**
   * Direction (radians) of the "sun": the ONE ring at `asymmetricFrom` (the
   * scarp) is genuinely ABSENT within `litArcHalfWidth` of this angle (a
   * bright caprock edge, no ring at all) and gets a small, BOUNDED
   * thickness bonus on the opposite (shadow) side (a talus lip) - a butte
   * seen from above, never a closed ring. `undefined` keeps every ring
   * symmetric.
   *
   * Deliberately NOT a multiplicative distance skew (the first attempt at
   * this): `distance * (1 - skew)` explodes toward infinity as skew
   * approaches 1, because the physical distance needed to reach a fixed
   * threshold is divided by a near-zero factor - measured, not theoretical,
   * this is what turned the scarp ring into an "enormous thick crescent"
   * spanning a quarter of the frame. An ADDITIVE, capped bonus on the ring's
   * own `outer` cannot runaway the same way.
   */
  readonly lightAngle?: number;
  /** Ring index (into `rings`) that gets the light/shadow arc treatment; every other ring stays plain and symmetric. */
  readonly asymmetricFrom?: number;
  /** Tiles the mesa-cap ring's OWN centre is shifted toward `lightAngle` - the caprock overhangs the lit side. */
  readonly capOffset?: number;
  /** Half-angle (radians) of the hard lit arc within which the scarp ring is skipped entirely. */
  readonly litArcHalfWidth?: number;
  /** Extra tiles (bounded, additive) the scarp ring's `outer` grows by at the deepest point of the shadow side. */
  readonly shadowBonus?: number;
}

const MASS_WOBBLE_FEATURES: readonly number[] = [12, 6, 3];

interface MassDistances {
  readonly cap: number;
  readonly plain: number;
  readonly angle: number;
}

/** Signed angular difference `a - b`, wrapped into `(-pi, pi]`. */
function angularDelta(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

function massDistances(mass: RadialMass, x: number, y: number): MassDistances {
  const dx = torusDelta(x, mass.cx);
  const dy = torusDelta(y, mass.cy);
  let base: number;
  if (mass.flow !== undefined) {
    const length = Math.hypot(mass.flow.dx, mass.flow.dy) || 1;
    const fx = mass.flow.dx / length;
    const fy = mass.flow.dy / length;
    const along = (dx * fx + dy * fy) / mass.flow.stretch;
    const perp = -dx * fy + dy * fx;
    base = Math.hypot(along, perp);
  } else {
    base = Math.hypot(dx, dy);
  }
  const wobble = (periodicFbm(x, y, mass.seed, MASS_WOBBLE_FEATURES) - 0.5) * mass.noiseAmount;
  const plain = Math.max(0, base + wobble);
  const angle = Math.atan2(dy, dx);

  let cap = plain;
  if (mass.lightAngle !== undefined && mass.capOffset !== undefined) {
    // The caprock overhangs the LIT side: its own centre shifts toward
    // `lightAngle`, offset from the ring set's true centre.
    const offX = Math.cos(mass.lightAngle) * mass.capOffset;
    const offY = Math.sin(mass.lightAngle) * mass.capOffset;
    cap = Math.hypot(dx - offX, dy - offY);
  }
  return { cap, plain, angle };
}

/**
 * The scarp ring's effective outer radius at this angle: `null` when the
 * point is within the hard lit arc (genuinely absent), otherwise the ring's
 * own `outer` plus a bounded bonus that ramps smoothly from 0 (right at the
 * lit-arc edge) to `shadowBonus` (directly opposite the light).
 */
function scarpEffectiveOuter(mass: RadialMass, ring: MassRing, angle: number): number | null {
  if (mass.lightAngle === undefined) return ring.outer;
  const litHalf = mass.litArcHalfWidth ?? 0;
  const delta = Math.abs(angularDelta(angle, mass.lightAngle));
  if (delta < litHalf) return null;
  const span = Math.max(1e-6, Math.PI - litHalf);
  const t = Math.min(1, (delta - litHalf) / span);
  return ring.outer + (mass.shadowBonus ?? 0) * t;
}

function radialMassMaterialAt(masses: readonly RadialMass[], x: number, y: number): NirvanaEastMaterial | null {
  for (const mass of masses) {
    const distances = massDistances(mass, x, y);
    const asymmetricFrom = mass.asymmetricFrom ?? 1;
    for (let index = 0; index < mass.rings.length; index += 1) {
      const ring = mass.rings[index];
      if (index === asymmetricFrom && mass.lightAngle !== undefined) {
        const effectiveOuter = scarpEffectiveOuter(mass, ring, distances.angle);
        if (effectiveOuter !== null && distances.plain <= effectiveOuter) return ring.material;
        continue;
      }
      const distance = index === 0 ? distances.cap : distances.plain;
      if (distance <= ring.outer) return ring.material;
    }
  }
  return null;
}

function massOuterReach(mass: RadialMass): number {
  return mass.rings.reduce((max, ring) => Math.max(max, ring.outer), 0);
}

// ---------------------------------------------------------------------------
// banding (composition C) - contract §2.4: phase = 2pi(a*col+b*row)/96
// ---------------------------------------------------------------------------

interface BandSpec {
  readonly a: number;
  readonly b: number;
  readonly palette: readonly NirvanaEastMaterial[];
  /** Coarse lobing feature sizes - real swells/pinches, not a small ripple. */
  readonly wobbleFeatures: readonly number[];
  readonly wobbleAmount: number;
  /** Finer irregularity on top, so fronts are fingered rather than one smooth wave. */
  readonly fingerFeatures: readonly number[];
  readonly fingerAmount: number;
  /**
   * A SHARED, very-low-frequency, LARGE-amplitude term applied to every
   * boundary identically - makes the whole band system sweep and bend
   * across the region, not just its edges ripple. Peer-review finding: the
   * per-boundary wobble alone (however large) only varies each band's
   * width; nothing was making the SYSTEM curve, so it still read as
   * parallel ruler-straight stripes. `bendAmount` should be on the order of
   * a full band width (~1/paletteLength), not a fraction of one.
   */
  readonly bendFeatures: readonly number[];
  readonly bendAmount: number;
  readonly seed: number;
}

function wrapUnit(value: number): number {
  return ((value % 1) + 1) % 1;
}

/**
 * Which band a corner falls in - with each boundary wobbling INDEPENDENTLY
 * (a distinct noise seed per boundary), not one shared phase shift applied to
 * the whole field.
 *
 * A single shared wobble (`raw + wobble`, the first-pass approach) moves
 * every boundary together, so each band keeps essentially the same
 * proportional width everywhere - which is exactly why the first plate read
 * as ruler-straight, evenly-spaced stripes despite a wobble term already
 * being present. Perturbing each of the N boundaries with its OWN periodic
 * field lets boundary i and boundary i+1 drift closer (band i pinches, even
 * to nothing) or further apart (band i swells) independently of the other
 * boundaries - real width variation, still exactly periodic on both axes
 * because every noise call uses {@link periodicFbm}.
 */
function bandMaterialAt(spec: BandSpec, column: number, row: number): NirvanaEastMaterial {
  const raw = (spec.a * column + spec.b * row) / TORUS;
  const bend = (periodicFbm(column, row, spec.seed + 9000, spec.bendFeatures) - 0.5) * spec.bendAmount;
  const t = wrapUnit(raw + bend);
  const count = spec.palette.length;
  let bestDelta = Number.POSITIVE_INFINITY;
  let bestIndex = 0;
  for (let index = 0; index < count; index += 1) {
    const nominal = index / count;
    const lobe = periodicFbm(column, row, spec.seed + index * 307, spec.wobbleFeatures) - 0.5;
    const finger = periodicFbm(column, row, spec.seed + index * 307 + 5000, spec.fingerFeatures) - 0.5;
    const boundary = wrapUnit(nominal + lobe * spec.wobbleAmount + finger * spec.fingerAmount);
    const delta = wrapUnit(t - boundary);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = index;
    }
  }
  return spec.palette[bestIndex];
}

// ---------------------------------------------------------------------------
// shelter-plot geometry (contract §1 - duplicated here, not imported from
// eastWalkability.ts, to avoid a circular module dependency - that module
// already imports NirvanaEastScene from this one)
// ---------------------------------------------------------------------------

const SHELTER_DISTRICT_ORIGINS: readonly Point[] = Object.freeze([
  { x: 18, y: 18 }, { x: 34, y: 18 }, { x: 50, y: 18 }, { x: 66, y: 18 },
  { x: 66, y: 50 }, { x: 50, y: 50 }, { x: 34, y: 50 }, { x: 18, y: 50 },
]);
const SHELTER_PLOT_OFFSETS: readonly Point[] = Object.freeze([
  { x: 0, y: 3 }, { x: 4, y: 3 }, { x: 8, y: 3 },
  { x: 0, y: 7 }, { x: 4, y: 7 }, { x: 8, y: 7 },
  { x: 0, y: 11 }, { x: 4, y: 11 }, { x: 8, y: 11 },
  { x: 0, y: 15 }, { x: 4, y: 15 }, { x: 8, y: 15 },
  { x: 0, y: 19 }, { x: 4, y: 19 }, { x: 8, y: 19 },
  { x: 4, y: 23 },
]);

/** All 128 shelter-plot anchor tiles, `{x: column, y: row}` - the plot's top-left tile. */
function allShelterPlotAnchors(): readonly Point[] {
  const anchors: Point[] = [];
  for (const origin of SHELTER_DISTRICT_ORIGINS) {
    for (const offset of SHELTER_PLOT_OFFSETS) {
      anchors.push({ x: origin.x + offset.x, y: origin.y + offset.y });
    }
  }
  return anchors;
}

const ALL_PLOT_ANCHORS = allShelterPlotAnchors();

/** Tiles per axis a plot's TRUE 5x5 footprint occupies, from its anchor. */
const PLOT_SPAN = 4;

/**
 * Extra corner-columns of padding denied around every plot footprint. A tile
 * at column T blocks once >=2 of its 4 corners (columns T, T+1) agree, so a
 * plot's own tiles (columns [anchor, anchor+4]) touch corner columns
 * [anchor, anchor+5] - a buffer of 1 already gives a superset of that
 * ([anchor-1, anchor+5]) on both axes. A buffer of 2 was tried first and
 * proved too conservative in practice: with plots flanking a 3-tile gutter
 * from both sides (e.g. a district's rightmost plot ending at column 46, the
 * next district's leftmost plot starting at column 50), padding by 2 denies
 * columns 47-49 from BOTH directions and eats the ENTIRE gutter, not just its
 * edges - which silently starved every crossing hint placed at the gutter's
 * own centre column. 1 is the smallest buffer that stays a safe superset.
 */
const PLOT_GATE_BUFFER = 1;

function inPaddedRangeToroidal(coord: number, lo: number, hi: number): boolean {
  for (const shift of [-TORUS, 0, TORUS]) {
    const shifted = coord + shift;
    if (shifted >= lo && shifted <= hi) return true;
  }
  return false;
}

/**
 * THE UNIVERSAL PLOT-SAFETY GATE. True when a blocking material may be
 * admitted at corner `(column, row)` - i.e. when that corner is not within
 * {@link PLOT_GATE_BUFFER} tiles of any of the 128 shelter-plot footprints,
 * checked toroidally. See the module docstring for why this replaces a
 * margin/gutter corridor gate.
 */
function blockingAdmitted(column: number, row: number): boolean {
  for (const anchor of ALL_PLOT_ANCHORS) {
    const inColumn = inPaddedRangeToroidal(
      column, anchor.x - PLOT_GATE_BUFFER, anchor.x + PLOT_SPAN + PLOT_GATE_BUFFER,
    );
    if (!inColumn) continue;
    const inRow = inPaddedRangeToroidal(
      row, anchor.y - PLOT_GATE_BUFFER, anchor.y + PLOT_SPAN + PLOT_GATE_BUFFER,
    );
    if (inRow) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// landform footprint geometry (round 2, contract: illustrated landform
// OBJECTS standing on the ground plane - see the module docstring's "ROUND 2
// PROGRESS" section). A landform's BLOCKING footprint is an ellipse in TILE
// units, DERIVED from the drawn cap plan rather than hardcoded per tier, so a
// re-authored frame recomputes its own footprint automatically:
//
//  - the cap (the lit top plate) is centred at (0.44W, 0.245H) in the
//    sprite's own pixels, with radii (0.34W, 0.205H) - read directly off the
//    authored composition plan, not measured from the raster.
//  - the wall (cliff face) below the cap is 0.30H tall, so the ground the
//    cap's own front edge actually rests on is the cap ellipse projected
//    DOWN by that wall height: centre (0.44W, 0.245H + 0.30H) = (0.44W,
//    0.545H). Offset from the pivot, that is (0.44W - pivotX, 0.545H -
//    pivotY) - the pivots this resolves to were independently verified
//    against `assets/atlas.json` in `eastPainter.ts`'s
//    `assertLandformPivotsAgree` rather than trusted as given.
//  - the footprint actually used for BLOCKING is that ground ellipse shrunk
//    by `LANDFORM_FOOTPRINT_SHRINK` - kept a touch inside the full painted
//    talus edge, the same discipline every other scenery prop's collision
//    footprint already uses relative to its full silhouette (a canopy or a
//    talus fan overhangs walkable ground at its edge; only the solid core
//    blocks).
//
// This formula reproduces the contract's own hand-derived
// halfCols/halfRows/offsetCols/offsetRows table (mesa 5.00/2.26/-0.96/-3.02,
// butte 2.81/1.32/-0.54/-1.76, outcrop 1.56/0.76/-0.30/-1.01) to within 0.02
// tiles on every figure for all three tiers - the residual is rounding in
// the contract's own by-hand arithmetic, not a disagreement in method.
// ---------------------------------------------------------------------------

const LANDFORM_CAP_CENTER_X_FRACTION = 0.44;
const LANDFORM_CAP_CENTER_Y_FRACTION = 0.245;
const LANDFORM_CAP_RADIUS_X_FRACTION = 0.34;
const LANDFORM_CAP_RADIUS_Y_FRACTION = 0.205;
const LANDFORM_WALL_HEIGHT_FRACTION = 0.30;
/** Shrink of the ground-contact ellipse relative to the drawn cap - see the section docstring. */
const LANDFORM_FOOTPRINT_SHRINK = 0.92;

interface LandformFootprintGeometry {
  readonly halfCols: number;
  readonly halfRows: number;
  readonly offsetCols: number;
  readonly offsetRows: number;
}

/** Derive one tier's footprint ellipse from its authored frame geometry alone - see the section docstring. */
function landformFootprintGeometry(
  width: number,
  height: number,
  pivotX: number,
  pivotY: number,
): LandformFootprintGeometry {
  const groundCenterX = LANDFORM_CAP_CENTER_X_FRACTION * width;
  const groundCenterY = LANDFORM_CAP_CENTER_Y_FRACTION * height + LANDFORM_WALL_HEIGHT_FRACTION * height;
  return {
    halfCols: (LANDFORM_CAP_RADIUS_X_FRACTION * width * LANDFORM_FOOTPRINT_SHRINK) / NIRVANA_EAST_TILE_SIZE,
    halfRows: (LANDFORM_CAP_RADIUS_Y_FRACTION * height * LANDFORM_FOOTPRINT_SHRINK) / NIRVANA_EAST_TILE_SIZE,
    offsetCols: (groundCenterX - pivotX) / NIRVANA_EAST_TILE_SIZE,
    offsetRows: (groundCenterY - pivotY) / NIRVANA_EAST_TILE_SIZE,
  };
}

function landformFootprintGeometryFor(tier: NirvanaEastLandformTier): LandformFootprintGeometry {
  const pivot = PROP_PIVOTS[tier];
  if (pivot === undefined) {
    throw new NirvanaEastSceneError(`Nirvana East scene has no pivot entry for landform tier ${tier}.`);
  }
  const [width, height, pivotX, pivotY] = pivot;
  return landformFootprintGeometry(width, height, pivotX, pivotY);
}

/**
 * Every tile whose CENTRE falls inside the footprint ellipse centred at
 * `(centerCol, centerRow)`, given in RAW (possibly out-of-[0,96)) tile
 * coordinates - wrapped to the canonical [0,96) range only at the very end,
 * exactly like every other periodic field in this module (contract §2.1/§2.2).
 */
function landformFootprintTiles(
  centerCol: number,
  centerRow: number,
  halfCols: number,
  halfRows: number,
): NirvanaEastTileRef[] {
  const tiles: NirvanaEastTileRef[] = [];
  const seen = new Set<string>();
  const minColumn = Math.floor(centerCol - halfCols - 1);
  const maxColumn = Math.ceil(centerCol + halfCols + 1);
  const minRow = Math.floor(centerRow - halfRows - 1);
  const maxRow = Math.ceil(centerRow + halfRows + 1);
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      const dx = column + 0.5 - centerCol;
      const dy = row + 0.5 - centerRow;
      if ((dx * dx) / (halfCols * halfCols) + (dy * dy) / (halfRows * halfRows) > 1) continue;
      const wrapped = { column: Math.floor(wrapCoord(column)), row: Math.floor(wrapCoord(row)) };
      const key = `${wrapped.column},${wrapped.row}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tiles.push(wrapped);
    }
  }
  return tiles;
}

/**
 * Attempt one landform placement: compute its footprint, reject it OUTRIGHT
 * (before ever touching `placements`) if any footprint tile is within
 * {@link PLOT_GATE_BUFFER} of any of the 128 shelter plots - the exact same
 * toroidal plot-safety gate every blocking terrain material is already held
 * to ({@link blockingAdmitted}), applied per-tile against the landform's
 * REAL elliptical footprint rather than a circular approximation around its
 * pivot. Returns `true` iff the placement was accepted and pushed.
 */
function tryPlaceLandform(
  placements: NirvanaEastLandformPlacement[],
  tier: NirvanaEastLandformTier,
  footCol: number,
  footRow: number,
  id: string,
): boolean {
  const geometry = landformFootprintGeometryFor(tier);
  const centerCol = footCol + geometry.offsetCols;
  const centerRow = footRow + geometry.offsetRows;
  const footprint = landformFootprintTiles(centerCol, centerRow, geometry.halfCols, geometry.halfRows);
  if (footprint.length === 0) return false;
  for (const tile of footprint) {
    if (!blockingAdmitted(tile.column, tile.row)) return false;
  }
  placements.push(Object.freeze({ id, tier, footCol, footRow, footprint: Object.freeze(footprint) }));
  return true;
}

// ---------------------------------------------------------------------------
// background / identity spread (contract §4, §9, and the map-scale finding
// that this region's margins read mostly as sea: identity materials must
// dominate the CENTRE, not just the edges, so they are the BACKGROUND here,
// not an accent - every corner gets one unless a channel/mass/band overrides it)
// ---------------------------------------------------------------------------

const BACKGROUND_TONE_FEATURES: readonly number[] = [16, 8, 4];
const BACKGROUND_ACCENT_FEATURES: readonly number[] = [8, 4, 2];

/**
 * The baseline desert floor: majority redsand/oxide (both WALKABLE identity
 * materials, contract §9), so the region's iron-oxide-red signature reaches
 * every corner - including every plot centre - regardless of proximity to
 * any channel, mass or band. A minority of secondary desert-floor tones
 * (gravel/hardpan/dustgrass/sand) keeps it from reading as a flat wash.
 */
function backgroundMaterialAt(column: number, row: number, seed: number): NirvanaEastMaterial {
  const tone = periodicFbm(column, row, seed + 10, BACKGROUND_TONE_FEATURES);
  if (tone > 0.6) return "oxide";
  if (tone < 0.4) return "redsand";
  const accent = periodicFbm(column, row, seed + 900, BACKGROUND_ACCENT_FEATURES);
  if (accent > 0.8) return "gravel";
  if (accent > 0.62) return "hardpan";
  if (accent > 0.42) return "dustgrass";
  return "sand";
}

/**
 * Feature sizes for the OPEN FLOOR (composition B only). 32 and 16 tiles per
 * noise cell against the ordinary background's 16/8/4 and the apron's 6/3 -
 * an order of magnitude calmer, and both divide 96 so the torus is untouched.
 */
const OPEN_FLOOR_FEATURES: readonly number[] = [32, 16, 8];
const OPEN_FLOOR_ACCENT_FEATURES: readonly number[] = [16, 8];

/**
 * The open playa floor a butte field stands ON.
 *
 * Composition B's first object-based cut reused the ordinary background plus
 * a dense five-material identity apron across the whole region, and the plate
 * came back as a CAMOUFLAGE MOSAIC: black, red, white and khaki blobs at the
 * same size and the same visual weight as the landforms themselves, so the
 * mesas had nothing to stand out against. Figure and ground were competing,
 * and ground won.
 *
 * The fix is compositional rather than material: B's floor is a PALE, CALM
 * playa - hardpan-dominant, with large bright salt pans and large charcoal
 * gravel / red oxide pavement masses - built from very-low-frequency fields
 * so a patch is tens of tiles across rather than three or four. The RED
 * landform objects are then the only saturated red in the frame and the only
 * thing with relief, which is exactly the figure/ground relationship this
 * composition exists to show. It also sharpens B at island scale: a pale
 * island carrying dark rock marks.
 */
function openFloorMaterialAt(column: number, row: number, seed: number): NirvanaEastMaterial {
  const tone = periodicFbm(column, row, seed + 7000, OPEN_FLOOR_FEATURES);
  const accent = periodicFbm(column, row, seed + 7300, OPEN_FLOOR_ACCENT_FEATURES);
  if (tone > 0.585) return "salt";
  if (tone < 0.395) return accent > 0.56 ? "gravel" : "oxide";
  // Rust veins and stringers threaded through the pale zone. Not decoration:
  // without them a 30-tile-wide calm hardpan zone carries none of the
  // region's identity materials at all, and the measured `inView` metric
  // correctly failed 15 of the 128 households on the first calm cut.
  if (accent > 0.74) return "redsand";
  if (accent < 0.24) return "dustgrass";
  return "hardpan";
}

const APRON_LOBE_FEATURES: readonly number[] = [12, 6, 3];
const APRON_PATCH_FEATURES: readonly number[] = [6, 3];
const APRON_TIER_FEATURES: readonly number[] = [8, 4];

/**
 * A non-blocking identity apron fanning from real feature anchors - old salt
 * pans, mineral-stained ground, ghost outlines of dead pools - at ZERO plot
 * cost and zero connectivity cost. Anchored to actual content rather than a
 * context-free wash, per the Warm Springs lesson.
 *
 * `palette` gives the apron internal structure - lag-gravel stripes, oxide
 * pavement patches, salt pockets - via a SECOND, independent noise field
 * choosing among materials within the same lobed footprint. A single
 * hardcoded material here was the actual first-pass bug: at high density and
 * a wide reach it painted one uniform blob with no landform logic ("a
 * shapeless amoeba"), rather than textured ground.
 */
function identityApronAt(
  x: number,
  y: number,
  seed: number,
  anchors: readonly Point[],
  baseReach: number,
  density: number,
  palette: readonly NirvanaEastMaterial[],
): NirvanaEastMaterial | null {
  let bestSquared = Number.POSITIVE_INFINITY;
  for (const anchor of anchors) {
    const dx = torusDelta(x, anchor.x);
    const dy = torusDelta(y, anchor.y);
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared < bestSquared) bestSquared = distanceSquared;
  }
  const distance = Math.sqrt(bestSquared);
  const lobe = periodicFbm(x, y, seed + 5000, APRON_LOBE_FEATURES);
  const reach = baseReach * (0.45 + lobe * 1.05);
  if (distance >= reach) return null;
  const t = distance / reach;
  const admitProbability = density * (1 - t * t);
  const patch = periodicFbm(x, y, seed + 5100, APRON_PATCH_FEATURES);
  if (patch > admitProbability) return null;
  const tier = periodicFbm(x, y, seed + 5300, APRON_TIER_FEATURES);
  return palette[Math.min(palette.length - 1, Math.floor(tier * palette.length))];
}

// ---------------------------------------------------------------------------
// corner field assembly, per composition
// ---------------------------------------------------------------------------

interface CompositionGeometry {
  readonly channels: readonly Channel[];
  readonly masses: readonly RadialMass[];
  readonly band: BandSpec | null;
  readonly cornerSeed: number;
  readonly identityAnchors: readonly Point[];
  readonly identityReach: number;
  readonly identityDensity: number;
  readonly identityPalette: readonly NirvanaEastMaterial[];
  /**
   * When true the composition replaces the ordinary background + identity
   * apron with {@link openFloorMaterialAt} - a calm, large-scale playa floor
   * for a composition whose subject is the OBJECTS standing on it, not the
   * ground itself. `identityAnchors`/`identityReach`/`identityDensity`/
   * `identityPalette` are then unused (and set inert).
   */
  readonly openFloor: boolean;
  readonly crossingPlans: readonly CrossingPlan[];
  readonly propHints: PropHints;
  readonly landforms: readonly NirvanaEastLandformPlacement[];
}

/** Checked before admitting a BLOCKING candidate; non-blocking material is always admitted. */
function admits(material: NirvanaEastMaterial, column: number, row: number): boolean {
  return !isBlockingMaterial(material) || blockingAdmitted(column, row);
}

function cornerMaterialFor(geometry: CompositionGeometry, x: number, y: number): NirvanaEastMaterial {
  const column = Math.round(x);
  const row = Math.round(y);

  const channelMaterial = channelMaterialAt(geometry.channels, x, y);
  if (channelMaterial !== null && admits(channelMaterial, column, row)) return channelMaterial;

  const massMaterial = radialMassMaterialAt(geometry.masses, x, y);
  if (massMaterial !== null && admits(massMaterial, column, row)) return massMaterial;

  if (geometry.band !== null) {
    const bandMaterial = bandMaterialAt(geometry.band, x, y);
    if (admits(bandMaterial, column, row)) return bandMaterial;
    // Banding covers 100% of the canvas by construction, so a denied band
    // material still needs a walkable fallback rather than falling through
    // to the (also potentially-blocking-free) background - salt is always
    // walkable and is itself one of the band's own palette members.
    return "salt";
  }

  if (geometry.openFloor) return openFloorMaterialAt(x, y, geometry.cornerSeed);

  const apron = identityApronAt(
    x, y, geometry.cornerSeed, geometry.identityAnchors, geometry.identityReach, geometry.identityDensity,
    geometry.identityPalette,
  );
  if (apron !== null) return apron;

  return backgroundMaterialAt(x, y, geometry.cornerSeed);
}

function cornerIndex(column: number, row: number): number {
  const c = ((column % NIRVANA_EAST_COLUMNS) + NIRVANA_EAST_COLUMNS) % NIRVANA_EAST_COLUMNS;
  const r = ((row % NIRVANA_EAST_ROWS) + NIRVANA_EAST_ROWS) % NIRVANA_EAST_ROWS;
  return r * NIRVANA_EAST_COLUMNS + c;
}

/**
 * The torus-invariant accessor: any `(column, row)`, however far outside
 * `[0, 96)`, resolves to the same wrapped cell as its canonical equivalent.
 * This is what makes `cornerAt(96, y) === cornerAt(0, y)` true BY
 * CONSTRUCTION (contract §2.5), not by a separate patch.
 */
export function cornerAt(
  corners: readonly NirvanaEastMaterial[],
  column: number,
  row: number,
): NirvanaEastMaterial {
  return corners[cornerIndex(column, row)];
}

/**
 * The provable torus invariant (contract §2.5): the corner field, sampled on
 * the 96x96 lattice with wrapped indices, must agree at column 96 with
 * column 0 (for all 96 rows) and at row 96 with row 0 (for all 96 columns).
 * Zero mismatches on both axes or the composition is not shippable.
 */
export function cornerSeamMismatches(scene: NirvanaEastScene): { northSouth: number; eastWest: number } {
  let eastWest = 0;
  for (let row = 0; row < NIRVANA_EAST_ROWS; row += 1) {
    if (cornerAt(scene.cornerMaterials, NIRVANA_EAST_COLUMNS, row) !== cornerAt(scene.cornerMaterials, 0, row)) {
      eastWest += 1;
    }
  }
  let northSouth = 0;
  for (let column = 0; column < NIRVANA_EAST_COLUMNS; column += 1) {
    if (cornerAt(scene.cornerMaterials, column, NIRVANA_EAST_ROWS) !== cornerAt(scene.cornerMaterials, column, 0)) {
      northSouth += 1;
    }
  }
  return { northSouth, eastWest };
}

function buildCornerField(geometry: CompositionGeometry): NirvanaEastMaterial[] {
  const corners: NirvanaEastMaterial[] = new Array(NIRVANA_EAST_COLUMNS * NIRVANA_EAST_ROWS);
  for (let row = 0; row < NIRVANA_EAST_ROWS; row += 1) {
    for (let column = 0; column < NIRVANA_EAST_COLUMNS; column += 1) {
      corners[cornerIndex(column, row)] = cornerMaterialFor(geometry, column, row);
    }
  }
  return corners;
}

/** Paint a walkable causeway-safe crossing into the corner field (connectivity repair). */
function carveCrossing(
  corners: NirvanaEastMaterial[],
  from: Point,
  to: Point,
  halfWidth: number,
  material: NirvanaEastMaterial = "salt",
  seed = 0x9f31,
): Array<{ column: number; row: number }> {
  const touched: Array<{ column: number; row: number }> = [];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const steps = Math.max(2, Math.ceil(length * 4));
  const radius = Math.ceil(halfWidth) + 1;
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const cx = from.x + dx * t;
    const cy = from.y + dy * t;
    for (let row = Math.floor(cy - radius); row <= Math.ceil(cy + radius); row += 1) {
      for (let column = Math.floor(cx - radius); column <= Math.ceil(cx + radius); column += 1) {
        const jitter = (hash2(column, row, seed) - 0.5) * 0.55;
        if (Math.hypot(column - cx, row - cy) > halfWidth + jitter) continue;
        corners[cornerIndex(column, row)] = material;
        touched.push({ column: wrapCoord(column), row: wrapCoord(row) });
      }
    }
  }
  return touched;
}

/** Seal a pocket too small to deserve a crossing, so nothing can be stranded. */
function sealPocket(corners: NirvanaEastMaterial[], component: { readonly tiles: readonly number[] }, columns: number): void {
  for (const index of component.tiles) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    for (const [dc, dr] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
      corners[cornerIndex(column + dc, row + dr)] = "thorn";
    }
  }
}

// ---------------------------------------------------------------------------
// tile derivation (identical discipline to the Warm Springs pilot)
// ---------------------------------------------------------------------------

function tileVariant(column: number, row: number, salt: number, count: number): number {
  if (count <= 0) return 0;
  return Math.floor(hash2(column, row, 0x2468 + salt) * count) % count;
}

function deriveTile(corners: readonly NirvanaEastMaterial[], column: number, row: number): NirvanaEastTile {
  const cornerMaterials: readonly NirvanaEastMaterial[] = [
    cornerAt(corners, column, row),
    cornerAt(corners, column + 1, row),
    cornerAt(corners, column + 1, row + 1),
    cornerAt(corners, column, row + 1),
  ];
  const priorities = cornerMaterials.map((material) => NIRVANA_EAST_MATERIAL_PRIORITY[material]);
  const basePriority = Math.min(...priorities);
  const base = cornerMaterials[priorities.indexOf(basePriority)];

  const present = [...new Set(cornerMaterials)]
    .filter((material) => NIRVANA_EAST_MATERIAL_PRIORITY[material] > basePriority)
    .sort((left, right) => (
      NIRVANA_EAST_MATERIAL_PRIORITY[left] - NIRVANA_EAST_MATERIAL_PRIORITY[right]
    ));

  const overlays: NirvanaEastTileOverlay[] = [];
  const shorelines: NirvanaEastTileShoreline[] = [];
  const baseIsWater = isWaterMaterial(base);
  for (const material of present) {
    const threshold = NIRVANA_EAST_MATERIAL_PRIORITY[material];
    let mask = 0;
    for (let corner = 0; corner < 4; corner += 1) {
      if (priorities[corner] >= threshold) mask |= 1 << corner;
    }
    if (mask === 0) continue;
    const salt = NIRVANA_EAST_MATERIAL_PRIORITY[material] * 31 + mask;
    const variant = mask === 15
      ? tileVariant(column, row, salt, NIRVANA_EAST_BASE_VARIANTS)
      : tileVariant(column, row, salt, NIRVANA_EAST_EDGE_VARIANTS[material]);
    overlays.push({ material, mask, variant });
    if (baseIsWater && mask !== 15 && hasShoreSet(material)) {
      shorelines.push({ material, mask, variant });
    }
  }

  const blockingCorners = cornerMaterials.filter((material) => (
    BLOCKING_NIRVANA_EAST_MATERIALS.includes(material)
  )).length;
  const blocked = blockingCorners >= 2;

  const agreeing = cornerMaterials.filter((candidate) => isBlockingMaterial(candidate) === blocked);
  const tally = new Map<NirvanaEastMaterial, number>();
  for (const candidate of agreeing) {
    tally.set(candidate, (tally.get(candidate) ?? 0) + 1);
  }
  let material = agreeing[0];
  let bestCount = -1;
  for (const [candidate, count] of tally) {
    const better = count > bestCount
      || (count === bestCount
        && NIRVANA_EAST_MATERIAL_PRIORITY[candidate] < NIRVANA_EAST_MATERIAL_PRIORITY[material]);
    if (better) {
      material = candidate;
      bestCount = count;
    }
  }

  return Object.freeze({
    column,
    row,
    base,
    baseVariant: tileVariant(column, row, NIRVANA_EAST_MATERIAL_PRIORITY[base], NIRVANA_EAST_BASE_VARIANTS),
    overlays: Object.freeze(overlays),
    shorelines: Object.freeze(shorelines),
    material,
    blocked,
    crossingDeck: false,
    deckOver: null,
  });
}

function deriveTiles(corners: readonly NirvanaEastMaterial[]): NirvanaEastTile[] {
  const tiles: NirvanaEastTile[] = new Array(NIRVANA_EAST_COLUMNS * NIRVANA_EAST_ROWS);
  for (let row = 0; row < NIRVANA_EAST_ROWS; row += 1) {
    for (let column = 0; column < NIRVANA_EAST_COLUMNS; column += 1) {
      tiles[row * NIRVANA_EAST_COLUMNS + column] = deriveTile(corners, column, row);
    }
  }
  return tiles;
}

function collisionFrom(tiles: readonly NirvanaEastTile[]): Uint8Array {
  const collision = new Uint8Array(NIRVANA_EAST_COLUMNS * NIRVANA_EAST_ROWS);
  for (let index = 0; index < tiles.length; index += 1) {
    collision[index] = tiles[index].blocked ? 1 : 0;
  }
  return collision;
}

// ---------------------------------------------------------------------------
// crossings - identical derivation discipline to Warm Springs' boardwalks.
// NOTE: this operates on the BOUNDED [0, limit) domain deliberately, matching
// the real `findNavigationPath` (which does not route across the torus seam)
// - crossings are a LOCAL concept; the seam's own openness is proved
// separately by `wrapOpeningsNS`/`wrapOpeningsEW` in eastWalkability.ts.
// ---------------------------------------------------------------------------

interface CrossingPlan {
  readonly id: string;
  readonly axis: NirvanaEastCrossingAxis;
  /** Row for an east-west span, column for a north-south span. */
  readonly line: number;
  /** A position along the span axis known to be in blocked ground - a HINT, not an assertion. */
  readonly midstream: number;
}

function tileRefAlong(plan: CrossingPlan, position: number): NirvanaEastTileRef {
  return plan.axis === "east-west"
    ? { column: position, row: plan.line }
    : { column: plan.line, row: position };
}

/**
 * Resolve one crossing plan, or `null` if this specific line genuinely has
 * nothing to cross.
 *
 * `plan.midstream` is a HINT, not an assertion (the Warm Springs lesson): the
 * blocking feature's exact position moves whenever the geometry is retuned,
 * so the resolver searches OUTWARD across the ENTIRE line (not a capped
 * radius) for the nearest blocked position. If the whole line is walkable,
 * that is not a broken scene - it means this composition simply does not
 * need a crossing on that particular line, so `null` is returned rather than
 * thrown; `resolveCrossings` drops it. What actually matters (contract §9:
 * "every composition carries at least one east-west AND one north-south
 * crossing") is asserted once, in aggregate, by the caller - a single
 * unresolvable hint must never abort the whole composition.
 */
function resolveCrossing(tiles: readonly NirvanaEastTile[], plan: CrossingPlan): NirvanaEastCrossing | null {
  const limit = plan.axis === "east-west" ? NIRVANA_EAST_COLUMNS : NIRVANA_EAST_ROWS;
  const blockedAt = (position: number): boolean => {
    if (position < 0 || position >= limit) return true;
    const ref = tileRefAlong(plan, position);
    return tiles[ref.row * NIRVANA_EAST_COLUMNS + ref.column].blocked;
  };

  const midstream = ((): number | null => {
    if (blockedAt(plan.midstream)) return plan.midstream;
    for (let offset = 1; offset < limit; offset += 1) {
      for (const candidate of [plan.midstream - offset, plan.midstream + offset]) {
        if (candidate <= 0 || candidate >= limit - 1) continue;
        if (blockedAt(candidate)) return candidate;
      }
    }
    return null;
  })();
  if (midstream === null) return null;

  let first = midstream;
  while (first > 0 && blockedAt(first - 1) && midstream - first < MAX_CROSSING_DECK_TILES) first -= 1;
  let last = midstream;
  while (last < limit - 1 && blockedAt(last + 1) && last - midstream < MAX_CROSSING_DECK_TILES) last += 1;

  // The blocked run is longer than a crossing should reasonably span - not a
  // line to build a deck across at all (this composition's geometry does not
  // want a crossing here), so drop it rather than force an oversized deck.
  if (blockedAt(first - 1) || blockedAt(last + 1)) return null;

  const deck: NirvanaEastTileRef[] = [];
  for (let position = first; position <= last; position += 1) {
    deck.push(Object.freeze(tileRefAlong(plan, position)));
  }
  return Object.freeze({
    id: plan.id,
    axis: plan.axis,
    deck: Object.freeze(deck),
    abutments: Object.freeze([
      Object.freeze(tileRefAlong(plan, first - 1)),
      Object.freeze(tileRefAlong(plan, last + 1)),
    ]),
  });
}

/** Resolve every plan, dropping any whose line has nothing to cross (see {@link resolveCrossing}). */
function resolveCrossings(
  tiles: readonly NirvanaEastTile[],
  plans: readonly CrossingPlan[],
): NirvanaEastCrossing[] {
  const resolved: NirvanaEastCrossing[] = [];
  for (const plan of plans) {
    const crossing = resolveCrossing(tiles, plan);
    if (crossing !== null) resolved.push(crossing);
  }
  return resolved;
}

function applyCrossingDecks(
  tiles: readonly NirvanaEastTile[],
  crossings: readonly NirvanaEastCrossing[],
): NirvanaEastTile[] {
  const decked = [...tiles];
  for (const crossing of crossings) {
    for (const ref of crossing.deck) {
      const index = ref.row * NIRVANA_EAST_COLUMNS + ref.column;
      const tile = decked[index];
      decked[index] = Object.freeze({
        ...tile,
        material: "plank" as NirvanaEastMaterial,
        blocked: false,
        crossingDeck: true,
        deckOver: tile.material,
      });
    }
  }
  return decked;
}

// ---------------------------------------------------------------------------
// connectivity - TOROIDAL by default (contract §2.6)
// ---------------------------------------------------------------------------

export interface NirvanaEastComponent {
  readonly tiles: readonly number[];
}

/** Four-connected walkable components; wraps at both edges when `toroidal` (the default). */
export function walkableComponents(
  collision: Uint8Array,
  columns: number,
  rows: number,
  toroidal = true,
): NirvanaEastComponent[] {
  const seen = new Uint8Array(collision.length);
  const components: NirvanaEastComponent[] = [];
  for (let start = 0; start < collision.length; start += 1) {
    if (collision[start] === 1 || seen[start] === 1) continue;
    const tiles: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const index = stack.pop() as number;
      tiles.push(index);
      const column = index % columns;
      const row = Math.floor(index / columns);
      const neighbourCoords: Array<readonly [number, number]> = toroidal
        ? [
          [(column - 1 + columns) % columns, row],
          [(column + 1) % columns, row],
          [column, (row - 1 + rows) % rows],
          [column, (row + 1) % rows],
        ]
        : [
          [column - 1, row], [column + 1, row], [column, row - 1], [column, row + 1],
        ];
      for (const [nc, nr] of neighbourCoords) {
        if (!toroidal && (nc < 0 || nc >= columns || nr < 0 || nr >= rows)) continue;
        const neighbour = nr * columns + nc;
        if (seen[neighbour] === 1 || collision[neighbour] === 1) continue;
        seen[neighbour] = 1;
        stack.push(neighbour);
      }
    }
    components.push({ tiles });
  }
  components.sort((left, right) => right.tiles.length - left.tiles.length);
  return components;
}

function nearestPair(
  left: NirvanaEastComponent,
  right: NirvanaEastComponent,
  columns: number,
): { from: Point; to: Point } {
  let best = Number.POSITIVE_INFINITY;
  let from: Point = { x: 0, y: 0 };
  let to: Point = { x: 0, y: 0 };
  for (const a of left.tiles) {
    const ax = a % columns;
    const ay = Math.floor(a / columns);
    for (const b of right.tiles) {
      const bx = b % columns;
      const by = Math.floor(b / columns);
      const dx = torusDelta(ax, bx);
      const dy = torusDelta(ay, by);
      const distance = dx * dx + dy * dy;
      if (distance < best) {
        best = distance;
        from = { x: ax, y: ay };
        to = { x: ax + dx, y: ay + dy };
      }
    }
  }
  return { from, to };
}

// ---------------------------------------------------------------------------
// scenery
// ---------------------------------------------------------------------------

interface SpeciesRule {
  readonly id: string;
  readonly variants: number;
  readonly on: readonly NirvanaEastMaterial[];
  readonly blocks: boolean;
  readonly clusters: number;
  readonly spread: number;
  readonly perCluster: number;
  readonly scatter: number;
  readonly seed: number;
}

/**
 * Sprite feet offsets. No art has landed yet (a concurrent agent owns
 * `assets/`), so these are PROVISIONAL placeholder footprints sized to
 * plausible frame dimensions per contract §6 - the same "scene hardcodes what
 * the art authored" discipline `springsScene.ts`'s `PROP_PIVOTS` uses, this
 * table just has nothing measured to hardcode yet. Whoever lands the real
 * atlas must reconcile these against `atlas.json`'s authored pivots.
 */
/**
 * `[width, height, pivotX, pivotY]` per authored species/tier, in sprite
 * pixels. The three landform tiers (`mesa`/`butte`/`outcrop`) are the REAL
 * authored pivots read back out of `assets/atlas.json` (round-1 open item
 * 2 - "PROP_PIVOTS are placeholders" - is closed by this: `eastPainter.ts`'s
 * `assertLandformPivotsAgree` asserts these three entries against the atlas
 * every time it is loaded, rather than trusting them here silently).
 */
export const PROP_PIVOTS: Readonly<Record<string, readonly [number, number, number, number]>> =
  Object.freeze({
    thornbush: [48, 48, 24, 45],
    deadwood: [48, 24, 24, 21],
    mesquite: [64, 80, 32, 76],
    boulder: [48, 48, 24, 45],
    hoodoo: [48, 96, 24, 92],
    saltbush: [32, 32, 16, 29],
    bunchgrass: [32, 32, 16, 29],
    cracks: [32, 32, 16, 30],
    bones: [32, 24, 16, 21],
    saltrime: [32, 24, 16, 21],
    pebbles: [32, 24, 16, 21],
    dustdevil: [64, 96, 32, 88],
    plank: [32, 32, 16, 31],
    mesa: [512, 384, 256, 306],
    butte: [288, 224, 144, 179],
    outcrop: [160, 128, 80, 102],
});

function makeProp(
  id: string,
  frameId: string,
  species: string,
  footX: number,
  footY: number,
  blocks: boolean,
): NirvanaEastProp {
  const pivot = PROP_PIVOTS[species];
  if (pivot === undefined) {
    throw new NirvanaEastSceneError(`Nirvana East scene has no pivot entry for species ${species}.`);
  }
  const [, , pivotX, pivotY] = pivot;
  // Convert PIXELS to TILE units before wrapping, then back - `wrapCoord`'s
  // period is 96 (tiles), not 3072 (pixels); wrapping the raw pixel value
  // directly (the round-1 bug this replaces) silently misplaced every
  // blocking prop's collision tile to something unrelated to where its
  // sprite is actually drawn, for any footX/footY outside roughly [0, 96)
  // pixels. Self-consistent internally (the same wrong tile was used
  // everywhere `prop.tile` was read), which is why it never tripped a gate -
  // but it meant "the prop blocks the tile it is drawn on" was already false
  // before this pass touched the function.
  const tile = Object.freeze({
    column: Math.floor(wrapCoord(footX / NIRVANA_EAST_TILE_SIZE)),
    row: Math.floor(wrapCoord(footY / NIRVANA_EAST_TILE_SIZE)),
  });
  return Object.freeze({
    id,
    frameId,
    x: Math.round(footX - pivotX),
    y: Math.round(footY - pivotY),
    footX: Math.round(footX),
    footY: Math.round(footY),
    blocks,
    tile,
    footprint: Object.freeze([tile]),
    landformGroup: null,
  });
}

// ---------------------------------------------------------------------------
// landform props - visual instances of a `NirvanaEastLandformPlacement`,
// including wrapped duplicates so a placement straddling the canvas edge is
// painted on BOTH sides within the single 3072x3072 render (contract: "the
// wrap plates must show the landform objects continuing across both seams...
// if your placement wraps but your painter does not draw the wrapped copy,
// the wrap plate will show a sliced mesa"). The static plate scripts render
// one pass over one scene's plan at a fixed (0,0) world offset (unlike the
// live viewer, which already achieves wrapping by repeating the whole plan
// at region-pixel offsets) - so for a plate to show a straddling landform
// whole, the SCENE itself must contain the second copy.
// ---------------------------------------------------------------------------

/**
 * Which whole-region pixel offsets a sprite drawn at `(x, y)` sized
 * `(width, height)` needs a duplicate at, so that any part of it that would
 * be clipped by the true canvas edge reappears on the opposite edge within
 * the SAME single-region render. Returns 0-3 offsets (0 for a sprite fully
 * inside the canvas; 3 for one straddling a CORNER, needing right/below/
 * diagonal copies alongside the primary).
 */
function wrapDuplicateOffsets(
  x: number,
  y: number,
  width: number,
  height: number,
): ReadonlyArray<Readonly<{ dx: number; dy: number }>> {
  const dxCandidates = [0];
  if (x < 0) dxCandidates.push(NIRVANA_EAST_WIDTH_PX);
  if (x + width > NIRVANA_EAST_WIDTH_PX) dxCandidates.push(-NIRVANA_EAST_WIDTH_PX);
  const dyCandidates = [0];
  if (y < 0) dyCandidates.push(NIRVANA_EAST_HEIGHT_PX);
  if (y + height > NIRVANA_EAST_HEIGHT_PX) dyCandidates.push(-NIRVANA_EAST_HEIGHT_PX);
  const offsets: Array<{ dx: number; dy: number }> = [];
  for (const dx of dxCandidates) {
    for (const dy of dyCandidates) {
      if (dx === 0 && dy === 0) continue;
      offsets.push({ dx, dy });
    }
  }
  return Object.freeze(offsets);
}

/**
 * One landform placement -> one blocking anchor prop plus 0-3 purely-visual
 * wrapped-edge duplicates (`blocks: false`, empty `footprint` - the anchor
 * alone carries the real, already-toroidally-wrapped footprint, so a
 * duplicate's presence never double-blocks a tile). All entries share
 * `landformGroup` so the connectivity repair pass in
 * {@link createNirvanaEastScene} drops or keeps the whole physical object as
 * one unit.
 */
function propsForLandform(placement: NirvanaEastLandformPlacement): NirvanaEastProp[] {
  const pivot = PROP_PIVOTS[placement.tier];
  if (pivot === undefined) {
    throw new NirvanaEastSceneError(`Nirvana East scene has no pivot entry for landform tier ${placement.tier}.`);
  }
  const [width, height, pivotX, pivotY] = pivot;
  const footX = wrapCoord(placement.footCol) * NIRVANA_EAST_TILE_SIZE;
  const footY = wrapCoord(placement.footRow) * NIRVANA_EAST_TILE_SIZE;
  const baseX = footX - pivotX;
  const baseY = footY - pivotY;
  const anchorTile = Object.freeze({
    column: Math.floor(wrapCoord(placement.footCol)),
    row: Math.floor(wrapCoord(placement.footRow)),
  });

  const build = (id: string, dx: number, dy: number, blocks: boolean): NirvanaEastProp => Object.freeze({
    id,
    frameId: `s.${placement.tier}.0`,
    x: Math.round(baseX + dx),
    y: Math.round(baseY + dy),
    footX: Math.round(footX + dx),
    footY: Math.round(footY + dy),
    blocks,
    tile: anchorTile,
    footprint: blocks ? placement.footprint : Object.freeze([]),
    landformGroup: placement.id,
  });

  const entries: NirvanaEastProp[] = [build(`landform:${placement.id}`, 0, 0, true)];
  wrapDuplicateOffsets(baseX, baseY, width, height).forEach((offset, index) => {
    entries.push(build(`landform:${placement.id}:wrap${index}`, offset.dx, offset.dy, false));
  });
  return entries;
}

function candidatePositions(species: SpeciesRule): Array<{
  column: number; row: number; variant: number; offsetX: number; offsetY: number;
}> {
  const out: Array<{ column: number; row: number; variant: number; offsetX: number; offsetY: number }> = [];
  const push = (x: number, y: number, salt: number): void => {
    const column = Math.floor(wrapCoord(x));
    const row = Math.floor(wrapCoord(y));
    out.push({
      column,
      row,
      variant: Math.floor(hash2(column, row, species.seed + salt) * species.variants) % species.variants,
      offsetX: (hash2(column, row, species.seed + salt + 7) - 0.5) * 22,
      offsetY: (hash2(column, row, species.seed + salt + 13) - 0.5) * 18,
    });
  };
  for (let cluster = 0; cluster < species.clusters; cluster += 1) {
    const cx = hash2(cluster, species.seed, 17) * NIRVANA_EAST_COLUMNS;
    const cy = hash2(cluster, species.seed, 29) * NIRVANA_EAST_ROWS;
    for (let member = 0; member < species.perCluster; member += 1) {
      const angle = hash2(cluster, member, species.seed + 41) * Math.PI * 2;
      const radius = Math.sqrt(hash2(cluster, member, species.seed + 53)) * species.spread;
      push(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, member * 3 + cluster);
    }
  }
  for (let index = 0; index < species.scatter; index += 1) {
    push(
      hash2(index, species.seed, 61) * NIRVANA_EAST_COLUMNS,
      hash2(index, species.seed, 71) * NIRVANA_EAST_ROWS,
      index + 500,
    );
  }
  return out;
}

interface PropHints {
  readonly species: readonly SpeciesRule[];
  /** Extra hand-placed non-scattered props (e.g. plank causeway pieces are separate). */
}

function placeProps(
  tiles: readonly NirvanaEastTile[],
  geometry: CompositionGeometry,
  crossings: readonly NirvanaEastCrossing[],
): NirvanaEastProp[] {
  const props: NirvanaEastProp[] = [];
  const claimed = new Set<string>();

  // A thorn does not grow where a house goes: pre-claim every one of the 128
  // shelter plots' real 5x5 render footprints as prop-free BEFORE placement.
  for (const anchor of ALL_PLOT_ANCHORS) {
    for (let dr = 0; dr <= PLOT_SPAN; dr += 1) {
      for (let dc = 0; dc <= PLOT_SPAN; dc += 1) {
        claimed.add(`block:${wrapCoord(anchor.x + dc)},${wrapCoord(anchor.y + dr)}`);
      }
    }
  }
  for (const crossing of crossings) {
    for (const abutment of crossing.abutments) {
      claimed.add(`block:${abutment.column},${abutment.row}`);
    }
  }
  // Nothing else spawns a blocking prop on ground a landform's own footprint
  // already claims (the ordinary-species pass a few lines below), matching
  // the discipline already applied to plots and crossing abutments above.
  for (const placement of geometry.landforms) {
    for (const tile of placement.footprint) {
      claimed.add(`block:${tile.column},${tile.row}`);
    }
  }

  const tileAt = (column: number, row: number): NirvanaEastTile => {
    const c = wrapCoord(column);
    const r = wrapCoord(row);
    return tiles[r * NIRVANA_EAST_COLUMNS + c];
  };

  for (const species of geometry.propHints.species) {
    for (const candidate of candidatePositions(species)) {
      const tile = tileAt(candidate.column, candidate.row);
      if (!species.on.includes(tile.material)) continue;
      const key = `${species.id}:${candidate.column},${candidate.row}`;
      if (claimed.has(key)) continue;
      if (species.blocks) {
        const occupancy = `block:${candidate.column},${candidate.row}`;
        if (claimed.has(occupancy) || tile.blocked) continue;
        claimed.add(occupancy);
      }
      claimed.add(key);
      const footX = candidate.column * NIRVANA_EAST_TILE_SIZE + NIRVANA_EAST_TILE_SIZE / 2 + candidate.offsetX;
      const footY = candidate.row * NIRVANA_EAST_TILE_SIZE + NIRVANA_EAST_TILE_SIZE / 2 + candidate.offsetY;
      props.push(makeProp(
        `${species.id}:${candidate.column},${candidate.row}`,
        `s.${species.id}.${candidate.variant}`,
        species.id,
        footX,
        footY,
        species.blocks,
      ));
    }
  }

  // The dust-devil pass - the region's signature element, drawn LAST over
  // everything by the painter (contract §6/§10). Scattered lightly, anywhere
  // walkable, never claimed against (it never blocks).
  for (let index = 0; index < 26; index += 1) {
    const column = Math.floor(hash2(index, 9001, 61) * NIRVANA_EAST_COLUMNS);
    const row = Math.floor(hash2(index, 9001, 71) * NIRVANA_EAST_ROWS);
    if (tileAt(column, row).blocked) continue;
    const variant = Math.floor(hash2(index, 9001, 81) * 2) % 2;
    const footX = column * NIRVANA_EAST_TILE_SIZE + NIRVANA_EAST_TILE_SIZE / 2
      + (hash2(index, 9001, 91) - 0.5) * 20;
    const footY = row * NIRVANA_EAST_TILE_SIZE + NIRVANA_EAST_TILE_SIZE / 2
      + (hash2(index, 9001, 97) - 0.5) * 20;
    props.push(makeProp(`dustdevil:${index}`, `s.dustdevil.${variant}`, "dustdevil", footX, footY, false));
  }

  // Crossings: plank deck run + a ramp/end piece at each abutment. Variant
  // convention (no art yet, documented here so the authoring script can
  // match it): 0-1 = horizontal deck, 2-3 = vertical deck, 4 = horizontal
  // ramp/end, 5 = vertical ramp/end.
  for (const crossing of crossings) {
    const horizontal = crossing.axis === "east-west";
    for (const ref of crossing.deck) {
      const variant = (horizontal ? 0 : 2) + (Math.floor(hash2(ref.column, ref.row, 1511) * 2) % 2);
      props.push(makeProp(
        `plank:${crossing.id}:${ref.column},${ref.row}`,
        `s.plank.${variant}`,
        "plank",
        ref.column * NIRVANA_EAST_TILE_SIZE + NIRVANA_EAST_TILE_SIZE / 2,
        ref.row * NIRVANA_EAST_TILE_SIZE + NIRVANA_EAST_TILE_SIZE - 1,
        false,
      ));
    }
    for (const ref of crossing.abutments) {
      props.push(makeProp(
        `plankend:${crossing.id}:${ref.column},${ref.row}`,
        `s.plank.${horizontal ? 4 : 5}`,
        "plank",
        ref.column * NIRVANA_EAST_TILE_SIZE + NIRVANA_EAST_TILE_SIZE / 2,
        ref.row * NIRVANA_EAST_TILE_SIZE + NIRVANA_EAST_TILE_SIZE - 1,
        false,
      ));
    }
  }

  // Landform objects - one anchor (blocks, real footprint) plus its
  // wrapped-edge visual duplicates, if any (see `propsForLandform`).
  for (const placement of geometry.landforms) {
    props.push(...propsForLandform(placement));
  }

  props.sort((left, right) => left.footY - right.footY
    || left.footX - right.footX
    || left.id.localeCompare(right.id));
  return props;
}

// ---------------------------------------------------------------------------
// composition data
// ---------------------------------------------------------------------------

const SEED_A = 0x81a1;
const SEED_B = 0x81b2;
const SEED_C = 0x81c3;

function districtCenters(): readonly Point[] {
  return SHELTER_DISTRICT_ORIGINS.map((origin) => ({ x: origin.x + 6, y: origin.y + 11 }));
}

/** The local outward-normal direction of a sampled polyline at `index`, unit length. */
function samplePerpendicular(samples: readonly Point[], index: number): Point {
  const a = samples[Math.max(0, index - 1)];
  const b = samples[Math.min(samples.length - 1, index + 1)];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: -dy / length, y: dx / length };
}

/**
 * ROUND 2: rank a channel's own banks with landform objects rather than a
 * painted blocking fringe (contract §1: "Replace the blocking scarp
 * cut-bank terrain with ranks of s.outcrop (and the occasional s.butte)
 * standing along the plateau margins - the cut-bank becomes a line of small
 * rock objects rather than a painted stripe"). Walks the channel's own
 * sample polyline (already periodic on the torus) at `stride`, and on EACH
 * side places one landform - mostly outcrop, `buttePortion` of the time a
 * butte - offset outward from the wash's own local half-width by `margin`
 * (+/- a little jitter) tiles. `tryPlaceLandform` silently drops any
 * candidate that would touch a shelter plot, so no separate margin/gutter
 * bias is needed - the rank simply follows the wash, gaps and all.
 */
function rankChannelMargins(
  placements: NirvanaEastLandformPlacement[],
  channel: Channel,
  stride: number,
  margin: number,
  buttePortion: number,
  seed: number,
): void {
  const { samples, halfWidth } = channel;
  for (let index = 0; index < samples.length; index += stride) {
    const u = index / Math.max(1, samples.length - 1);
    const hw = halfWidth(u);
    const perpendicular = samplePerpendicular(samples, index);
    const sample = samples[index];
    for (const side of [1, -1] as const) {
      const jitter = (hash2(index, side < 0 ? 1 : 0, seed + 601) - 0.5) * 1.4;
      const reach = hw + margin + jitter;
      const footCol = sample.x + perpendicular.x * reach;
      const footRow = sample.y + perpendicular.y * reach;
      const tier: NirvanaEastLandformTier =
        hash2(index, side < 0 ? 1 : 0, seed + 701) < buttePortion ? "butte" : "outcrop";
      tryPlaceLandform(placements, tier, footCol, footRow, `bank:${seed}:${index}:${side}`);
    }
  }
}

// --- A: a-arroyo-braid --------------------------------------------------

/**
 * A DIAGONAL closed-loop wash - deliberately NOT axis-aligned. The first
 * pass ran every channel along the district/gutter grid lines (rows
 * 10/49/86, columns 9/32.5/48.5/64.5/87), and because the WALKABLE core was
 * only ever drawn near those same eight lines, the plate read as the plot
 * grid itself - the exact "square pieces jumbled together" complaint the
 * whole revamp exists to fix. A braid has to cross the districts on the
 * diagonal, splitting and rejoining, or it is not a braid.
 *
 * ROUND 2: no blocking fringe at all (`fringe: null`) - the wash is pure
 * walkable sand core from bank to bank; what used to be a painted `scarp`
 * cut-bank fringe is now a RANK OF ROCK OBJECTS standing along the margin
 * (`rankChannelMargins`, called from `arroyoBraidGeometry` below).
 */
function diagonalWash(
  originY: number,
  periodOffset: Point,
  count: number,
  amplitude: number,
  halfWidthBase: number,
  halfWidthSwing: number,
  seed: number,
): Channel {
  return closedLoopChannel(
    { x: 0, y: originY }, periodOffset, count, amplitude, 5,
    meanderHalfWidth(halfWidthBase, halfWidthSwing, seed),
    "sand", null, 0, seed,
  );
}

function arroyoBraidGeometry(): CompositionGeometry {
  // Three diagonals at DIFFERENT slopes (+1, -1, +0.5 in tile-units), so they
  // are never parallel to each other, to an axis, or to the plot grid, and
  // they genuinely cross the district band (contract: "settlement sits on
  // the stable oxide terraces BETWEEN braids" only means something if the
  // braid actually reaches the districts). Wide wander (amplitude 5-6) lets
  // strands split and rejoin rather than running as parallel corridors.
  const channels: readonly Channel[] = Object.freeze([
    diagonalWash(15, { x: 96, y: 96 }, 40, 6.0, 3.0, 1.3, SEED_A + 1),
    diagonalWash(55, { x: 96, y: -96 }, 40, 5.6, 2.8, 1.2, SEED_A + 2),
    diagonalWash(35, { x: 192, y: 96 }, 48, 5.0, 2.2, 1.0, SEED_A + 3),
  ]);

  // Brine remnants at the braid's real crossing nodes (computed from the
  // three diagonals' own unwrapped line equations: y=15+x, y=55-x, y=35+0.5x
  // - solved pairwise), not at hand-waved margin corners. Water is
  // unambiguous in plan view (the round-1 diagnosis), so these stay ordinary
  // terrain paint, not objects.
  const masses: readonly RadialMass[] = Object.freeze([
    {
      id: "brine-node-1", cx: 20, cy: 35, rings: [
        { material: "brine", outer: 1.0 }, { material: "brinerim", outer: 1.8 },
      ], seed: SEED_A + 21, noiseAmount: 0.6,
    },
    {
      id: "brine-node-2", cx: 40, cy: 55, rings: [
        { material: "brine", outer: 0.9 }, { material: "brinerim", outer: 1.6 },
      ], seed: SEED_A + 22, noiseAmount: 0.6,
    },
    {
      id: "brine-node-3", cx: 73, cy: 88, rings: [
        { material: "brine", outer: 0.9 }, { material: "brinerim", outer: 1.6 },
      ], seed: SEED_A + 23, noiseAmount: 0.6,
    },
  ]);

  // ROUND 2: the cut-bank is a RANK OF ROCK OBJECTS along each wash's own
  // margin (mostly outcrop, the occasional butte), walked along the
  // channel's own sample polyline so the rank follows every meander rather
  // than sitting on a ruled line. These are what a crossing now actually
  // spans, in place of the old painted scarp fringe.
  const landforms: NirvanaEastLandformPlacement[] = [];
  rankChannelMargins(landforms, channels[0], 9, 2.1, 0.18, SEED_A + 801);
  rankChannelMargins(landforms, channels[1], 9, 2.1, 0.18, SEED_A + 802);
  rankChannelMargins(landforms, channels[2], 10, 1.9, 0.15, SEED_A + 803);

  // Axis convention (matches Warm Springs' boardwalks): a barrier blocking a
  // band of ROWS at any column is crossed by a NORTH-SOUTH deck; one
  // blocking a band of COLUMNS at any row is crossed by an EAST-WEST deck.
  // Diagonal washes block BOTH kinds of band depending on where you cut
  // them, so several lines of each axis are offered - `resolveCrossing` now
  // searches the WHOLE line and silently drops any that find nothing
  // (contract lesson: `midstream` is a hint, and "nothing to cross on this
  // exact line" is a valid outcome, not a broken scene). Resolved against a
  // blocking view that now includes the landform ranks above, not terrain
  // alone (see `createNirvanaEastScene`'s `withLandformOverlay`).
  const crossingPlans: readonly CrossingPlan[] = Object.freeze([
    { id: "a-ns-14", axis: "north-south", line: 14, midstream: 30 },
    { id: "a-ns-38", axis: "north-south", line: 38, midstream: 55 },
    { id: "a-ns-62", axis: "north-south", line: 62, midstream: 30 },
    { id: "a-ns-84", axis: "north-south", line: 84, midstream: 60 },
    { id: "a-ew-24", axis: "east-west", line: 24, midstream: 40 },
    { id: "a-ew-45", axis: "east-west", line: 45, midstream: 20 },
    { id: "a-ew-66", axis: "east-west", line: 66, midstream: 55 },
    { id: "a-ew-88", axis: "east-west", line: 88, midstream: 70 },
  ]);

  return {
    channels,
    masses,
    band: null,
    cornerSeed: SEED_A,
    // Un-gated, broad, spread from every district centre AND from points
    // along all three washes - the walkable identity ground (salt/redsand/
    // oxide) reaches everywhere, including straight through the districts,
    // at zero plot cost (contract §8A/§9, and the map-scale finding that
    // this region's margins read mostly as sea - identity must dominate the
    // CENTRE).
    identityAnchors: Object.freeze([...districtCenters(),
      { x: 20, y: 35 }, { x: 40, y: 55 }, { x: 73, y: 88 }, { x: 60, y: 12 }, { x: 15, y: 70 }]),
    identityReach: 20,
    identityDensity: 0.65,
    identityPalette: Object.freeze(["salt", "redsand", "oxide", "hardpan"]),
    openFloor: false,
    crossingPlans,
    landforms: Object.freeze(landforms),
    propHints: {
      species: Object.freeze([
        { id: "thornbush", variants: 4, on: ["sand", "salt", "dustgrass"], blocks: true, clusters: 10, spread: 3.0, perCluster: 4, scatter: 8, seed: SEED_A + 101 },
        { id: "mesquite", variants: 3, on: ["sand", "oxide"], blocks: true, clusters: 6, spread: 2.6, perCluster: 3, scatter: 4, seed: SEED_A + 102 },
        { id: "boulder", variants: 4, on: ["oxide", "redsand", "gravel"], blocks: true, clusters: 8, spread: 2.4, perCluster: 3, scatter: 14, seed: SEED_A + 103 },
        { id: "hoodoo", variants: 3, on: ["oxide", "redsand", "hardpan"], blocks: true, clusters: 6, spread: 2.2, perCluster: 2, scatter: 8, seed: SEED_A + 110 },
        { id: "saltbush", variants: 4, on: ["sand", "salt", "hardpan", "dustgrass"], blocks: false, clusters: 12, spread: 3.2, perCluster: 5, scatter: 40, seed: SEED_A + 104 },
        { id: "bunchgrass", variants: 4, on: ["sand", "redsand", "dustgrass"], blocks: false, clusters: 0, spread: 0, perCluster: 0, scatter: 300, seed: SEED_A + 105 },
        { id: "cracks", variants: 4, on: ["salt", "hardpan"], blocks: false, clusters: 0, spread: 0, perCluster: 0, scatter: 220, seed: SEED_A + 106 },
        { id: "bones", variants: 3, on: ["sand", "redsand", "oxide", "salt"], blocks: false, clusters: 0, spread: 0, perCluster: 0, scatter: 30, seed: SEED_A + 107 },
        { id: "saltrime", variants: 3, on: ["salt", "brinerim"], blocks: false, clusters: 8, spread: 2.0, perCluster: 3, scatter: 20, seed: SEED_A + 108 },
        { id: "pebbles", variants: 4, on: ["gravel", "oxide", "hardpan"], blocks: false, clusters: 0, spread: 0, perCluster: 0, scatter: 260, seed: SEED_A + 109 },
      ]),
    },
  };
}

// --- B: b-mesa-field ------------------------------------------------------

/**
 * ROUND 2 (contract §3): the mesa/scarp radial-mass painting is DELETED
 * entirely - no `butteRings`, no distance-field rings at all. A butte is now
 * an authored illustrated OBJECT standing on open ground, placed on a
 * wrapped jittered lattice spanning the WHOLE region (not margin-biased -
 * `tryPlaceLandform`'s plot rejection already thins the field naturally
 * around the districts). This is exactly why round 1's failure mode - buttes
 * reading as craters, then as huge abstract crescents when the asymmetry fix
 * overshot - cannot recur here: there is no distance field left to mistune.
 */
function mesaFieldGeometry(): CompositionGeometry {
  const landforms: NirvanaEastLandformPlacement[] = [];

  // THE DELIBERATE WALL (contract §3: "Keep the deliberate two-mass wall
  // idea... so the composition still earns real crossings in BOTH axes"),
  // rebuilt from OBJECTS. Two `mesa` placements with their FOOTPRINT centres
  // (not pivots - the tier's own offset is baked in via
  // `landformFootprintGeometryFor`) 9 tiles apart: mesa halfCols is ~5.0, so
  // a 9-tile centre spacing overlaps the two ellipses by a full tile - a
  // solid, gapless seam rather than two objects merely touching. Footprint
  // centre row 8 sits well inside the 18-row-tall north margin, with
  // headroom on both row 0 (below) and the district band at row 18 (above) -
  // the exact same clearance lesson round 1's wall needed two failed
  // placements to learn.
  const mesaGeometry = landformFootprintGeometryFor("mesa");
  const wallFootprintRow = 8;
  const wallFootRow = wallFootprintRow - mesaGeometry.offsetRows;
  const wallFootCol1 = 40 - mesaGeometry.offsetCols;
  const wallFootCol2 = 49 - mesaGeometry.offsetCols;
  tryPlaceLandform(landforms, "mesa", wallFootCol1, wallFootRow, "wall-1");
  tryPlaceLandform(landforms, "mesa", wallFootCol2, wallFootRow, "wall-2");

  // THE FIELD (contract §3: "a field of s.mesa / s.butte / s.outcrop OBJECTS
  // on a wrapped jittered lattice"). Two passes, coarse (mesa/butte-heavy)
  // then fine (outcrop-heavy), each lattice spacing chosen to divide 96
  // exactly so the placement lattice itself is periodic on the torus by
  // construction - the same discipline `periodicFbm` already holds noise
  // lattices to (contract §2.1), just applied to a placement grid instead.
  // Spans the WHOLE region, unlike round 1's margin-biased masses: the
  // districts thin the field on their own via `tryPlaceLandform`'s plot
  // rejection, which reads as a natural clearing rather than a hard rule.
  const coarseSpacing = 16;
  const coarseCells = TORUS / coarseSpacing;
  for (let row = 0; row < coarseCells; row += 1) {
    for (let column = 0; column < coarseCells; column += 1) {
      if (hash2(column, row, SEED_B + 40) >= 0.6) continue;
      const baseX = column * coarseSpacing + coarseSpacing / 2;
      const baseY = row * coarseSpacing + coarseSpacing / 2;
      const jx = (hash2(column, row, SEED_B + 41) - 0.5) * 2 * (coarseSpacing * 0.32);
      const jy = (hash2(column, row, SEED_B + 42) - 0.5) * 2 * (coarseSpacing * 0.32);
      const tierRoll = hash2(column, row, SEED_B + 43);
      const tier: NirvanaEastLandformTier = tierRoll < 0.22 ? "mesa" : tierRoll < 0.62 ? "butte" : "outcrop";
      tryPlaceLandform(landforms, tier, baseX + jx, baseY + jy, `field-coarse:${column},${row}`);
    }
  }

  const fineSpacing = 8;
  const fineCells = TORUS / fineSpacing;
  for (let row = 0; row < fineCells; row += 1) {
    for (let column = 0; column < fineCells; column += 1) {
      if (hash2(column, row, SEED_B + 60) >= 0.4) continue;
      const baseX = column * fineSpacing + fineSpacing / 2;
      const baseY = row * fineSpacing + fineSpacing / 2;
      const jx = (hash2(column, row, SEED_B + 61) - 0.5) * 2 * (fineSpacing * 0.32);
      const jy = (hash2(column, row, SEED_B + 62) - 0.5) * 2 * (fineSpacing * 0.32);
      const tier: NirvanaEastLandformTier = hash2(column, row, SEED_B + 63) < 0.2 ? "butte" : "outcrop";
      tryPlaceLandform(landforms, tier, baseX + jx, baseY + jy, `field-fine:${column},${row}`);
    }
  }

  // Axis convention as in composition A: the wall blocks a band of COLUMNS
  // around footprint columns 35-54 at low rows (needs an east-west deck)
  // AND, through the merged footprint's own vertical extent, a band of ROWS
  // near the overlap column (needs a north-south deck) - one deliberate
  // divider earns both. A handful of additional generic lines give the
  // widely-scattered field itself good odds of resolving real crossings too
  // - resolved against a blocking view that includes every landform's
  // footprint, not terrain alone (`createNirvanaEastScene`'s
  // `withLandformOverlay`); `resolveCrossing` drops anything that finds
  // nothing on its exact line (a hint, not an assertion).
  const crossingPlans: readonly CrossingPlan[] = Object.freeze([
    { id: "b-ew-wall", axis: "east-west", line: wallFootprintRow, midstream: 45 },
    { id: "b-ns-wall", axis: "north-south", line: 45, midstream: wallFootprintRow },
    { id: "b-ns-22", axis: "north-south", line: 22, midstream: 30 },
    { id: "b-ns-70", axis: "north-south", line: 70, midstream: 60 },
    { id: "b-ew-30", axis: "east-west", line: 30, midstream: 20 },
    { id: "b-ew-64", axis: "east-west", line: 64, midstream: 50 },
  ]);

  // The "open patterned floor" (contract §3: "standing on an open patterned
  // floor of salt / oxide / gravel / hardpan / dustgrass"), spread across
  // the WHOLE region now, not just the old district band - the margins are
  // where the field's biggest masses stand, so they need this same textured
  // floor too, or they would fall through to the redsand-heavy background
  // (composition A's identity, not B's pale hardpan/salt one).
  const floorAnchors: Point[] = [...districtCenters()];
  const anchorSpacing = 16;
  const anchorCells = TORUS / anchorSpacing;
  for (let row = 0; row < anchorCells; row += 1) {
    for (let column = 0; column < anchorCells; column += 1) {
      floorAnchors.push({
        x: column * anchorSpacing + anchorSpacing / 2,
        y: row * anchorSpacing + anchorSpacing / 2,
      });
    }
  }

  return {
    channels: Object.freeze([]),
    masses: Object.freeze([]),
    band: null,
    cornerSeed: SEED_B,
    // B uses the OPEN FLOOR instead (see `openFloorMaterialAt`): its subject
    // is the landform objects, so its ground must be calm enough to be a
    // ground. These four are inert here, kept only so every composition
    // satisfies the same geometry shape.
    identityAnchors: Object.freeze(floorAnchors),
    identityReach: 0,
    identityDensity: 0,
    identityPalette: Object.freeze(["hardpan"]),
    openFloor: true,
    crossingPlans,
    landforms: Object.freeze(landforms),
    propHints: {
      species: Object.freeze([
        { id: "boulder", variants: 4, on: ["oxide", "redsand", "gravel", "hardpan"], blocks: true, clusters: 10, spread: 2.6, perCluster: 3, scatter: 16, seed: SEED_B + 301 },
        { id: "hoodoo", variants: 3, on: ["oxide", "redsand", "hardpan"], blocks: true, clusters: 6, spread: 2.2, perCluster: 2, scatter: 6, seed: SEED_B + 302 },
        { id: "thornbush", variants: 4, on: ["sand", "dustgrass"], blocks: true, clusters: 4, spread: 2.6, perCluster: 3, scatter: 4, seed: SEED_B + 303 },
        { id: "deadwood", variants: 3, on: ["hardpan", "sand"], blocks: true, clusters: 3, spread: 2.4, perCluster: 2, scatter: 4, seed: SEED_B + 304 },
        { id: "saltbush", variants: 4, on: ["hardpan", "salt", "sand"], blocks: false, clusters: 10, spread: 3.0, perCluster: 5, scatter: 34, seed: SEED_B + 305 },
        { id: "bunchgrass", variants: 4, on: ["sand", "redsand", "dustgrass"], blocks: false, clusters: 0, spread: 0, perCluster: 0, scatter: 220, seed: SEED_B + 306 },
        { id: "cracks", variants: 4, on: ["hardpan", "salt"], blocks: false, clusters: 0, spread: 0, perCluster: 0, scatter: 260, seed: SEED_B + 307 },
        { id: "pebbles", variants: 4, on: ["gravel", "oxide", "hardpan"], blocks: false, clusters: 0, spread: 0, perCluster: 0, scatter: 340, seed: SEED_B + 308 },
        { id: "bones", variants: 3, on: ["hardpan", "sand", "oxide"], blocks: false, clusters: 0, spread: 0, perCluster: 0, scatter: 24, seed: SEED_B + 309 },
      ]),
    },
  };
}

// --- C: c-salt-pan ----------------------------------------------------

/**
 * The row, at a fixed column, where `band` actually transitions between
 * `materialA` and `materialB` - found by scanning the real (post-wobble,
 * post-bend) classification rather than inverting the band's phase math, so
 * a landform rank tracks the boundary's genuine bends instead of the raw
 * unperturbed line. `null` only if the two materials never neighbour at this
 * column (not expected for two ADJACENT palette entries, since `a=1,b=1`
 * sweeps a full cycle of the palette over any fixed column's 96 rows).
 */
function findBandBoundaryRow(
  band: BandSpec,
  column: number,
  materialA: NirvanaEastMaterial,
  materialB: NirvanaEastMaterial,
): number | null {
  let previous = bandMaterialAt(band, column, 0);
  for (let row = 1; row < NIRVANA_EAST_ROWS; row += 1) {
    const current = bandMaterialAt(band, column, row);
    if ((previous === materialA && current === materialB) || (previous === materialB && current === materialA)) {
      return row;
    }
    previous = current;
  }
  return null;
}

function saltPanGeometry(): CompositionGeometry {
  // Wobble is now genuinely coarse (features 32/16, no fine 6-tile octave -
  // the earlier small ripple was what read as pixel-noise stair-stepping on
  // an otherwise straight line) and MUCH larger in amplitude, and every
  // boundary perturbs independently (see `bandMaterialAt`'s docstring), so
  // bands swell, pinch and occasionally pinch out rather than holding a
  // constant width - "ruler-straight parallel stripes" was the first-pass
  // defect this directly targets.
  const band: BandSpec = {
    a: 1, b: 1, palette: ["salt", "hardpan", "oxide", "gravel"],
    wobbleFeatures: [32, 16], wobbleAmount: 0.3,
    fingerFeatures: [8, 4], fingerAmount: 0.12,
    // Feature 48 -> lattice period 2: only two independent noise cells
    // across the WHOLE 96-tile axis, interpolated smoothly - a single slow
    // sweep, not a ripple. Amplitude 0.5 is two full band-widths (nominal
    // width 1/4 = 0.25), large enough to visibly bend the whole system.
    bendFeatures: [48, 24], bendAmount: 0.5,
    seed: SEED_C,
  };

  // The brine channel follows the band boundary col+row=48 (mod 96): moving
  // with direction (1,-1) leaves col+row invariant, so a loop from (0,48)
  // advancing by periodOffset (96,-96) returns to the same wrapped physical
  // point - the channel and one real band edge are the SAME line. Widened
  // substantially (base half-width 4.0 vs the first pass's 1.5) and given a
  // much thicker brinerim (2.0) - the signature feature was reading as a
  // thin sliver; it should read immediately as a real, obviously-water
  // drying lake with a visible salt-efflorescence shoreline.
  const brine = closedLoopChannel(
    { x: 0, y: 48 }, { x: 96, y: -96 }, 44, 3.6, 5,
    meanderHalfWidth(1.5, 0.7, SEED_C + 1),
    "brine", "brinerim", 0.7, SEED_C + 1,
  );
  // The rimrock scarp marks a second, older boundary (col+row=72) - "the
  // ancient shoreline" - thinner and drier than the live brine channel.
  const rimrock = closedLoopChannel(
    { x: 0, y: 72 }, { x: 96, y: -96 }, 36, 2.2, 5,
    meanderHalfWidth(0.9, 0.4, SEED_C + 2),
    "scarp", null, 0.5, SEED_C + 2,
  );

  const crossingPlans: readonly CrossingPlan[] = Object.freeze([
    { id: "c-ew-brine-20", axis: "east-west", line: 20, midstream: 28 },
    { id: "c-ew-brine-60", axis: "east-west", line: 60, midstream: -12 + 96 },
    { id: "c-ew-brine-40", axis: "east-west", line: 40, midstream: 8 },
    { id: "c-ns-brine-20", axis: "north-south", line: 20, midstream: 28 },
    { id: "c-ns-brine-60", axis: "north-south", line: 60, midstream: -12 + 96 },
    { id: "c-ns-brine-40", axis: "north-south", line: 40, midstream: 8 },
  ]);

  // ROUND 2 (contract §4): "add a sparse rank of landform objects along ONE
  // band boundary for 1:1 interest - sparse, so C stays legible at 64px."
  // The bands and the brine channel are otherwise untouched (they are the
  // map-scale winner and they ARE the ground, not relief). The salt/hardpan
  // boundary (nominal col+row=24) is picked deliberately: it is a full band
  // away from both the live brine channel (col+row=48) and the rimrock
  // "ancient shoreline" (col+row=72), so the rank reads as its own feature
  // rather than crowding either existing line. Candidate columns are spaced
  // 8 tiles apart (a divisor of 96, so the candidate lattice is itself
  // periodic) and roughly half are kept - sparse by construction, not by
  // thinning a dense field down.
  const landforms: NirvanaEastLandformPlacement[] = [];
  for (let column = 0; column < NIRVANA_EAST_COLUMNS; column += 8) {
    if (hash2(column, SEED_C + 900, 11) > 0.55) continue;
    const row = findBandBoundaryRow(band, column, "salt", "hardpan");
    if (row === null) continue;
    const tier: NirvanaEastLandformTier = hash2(column, SEED_C + 900, 23) < 0.2 ? "butte" : "outcrop";
    tryPlaceLandform(landforms, tier, column, row, `band-boundary:${column}`);
  }

  return {
    channels: Object.freeze([brine, rimrock]),
    masses: Object.freeze([]),
    band,
    cornerSeed: SEED_C,
    identityAnchors: Object.freeze(districtCenters()),
    identityReach: 10,
    identityDensity: 0.35,
    // Unused while `band` is set (cornerMaterialFor resolves bands before
    // ever reaching the apron layer) - present only so every composition
    // satisfies the same geometry shape.
    identityPalette: Object.freeze(band.palette),
    openFloor: false,
    crossingPlans,
    landforms: Object.freeze(landforms),
    propHints: {
      species: Object.freeze([
        { id: "saltbush", variants: 4, on: ["salt", "hardpan"], blocks: false, clusters: 14, spread: 3.0, perCluster: 5, scatter: 40, seed: SEED_C + 101 },
        { id: "bunchgrass", variants: 4, on: ["hardpan", "oxide"], blocks: false, clusters: 0, spread: 0, perCluster: 0, scatter: 220, seed: SEED_C + 102 },
        { id: "cracks", variants: 4, on: ["salt", "hardpan"], blocks: false, clusters: 0, spread: 0, perCluster: 0, scatter: 340, seed: SEED_C + 103 },
        { id: "saltrime", variants: 3, on: ["salt", "brinerim", "brine"], blocks: false, clusters: 12, spread: 2.4, perCluster: 4, scatter: 40, seed: SEED_C + 104 },
        { id: "bones", variants: 3, on: ["salt", "hardpan", "oxide"], blocks: false, clusters: 0, spread: 0, perCluster: 0, scatter: 26, seed: SEED_C + 105 },
        { id: "thornbush", variants: 4, on: ["gravel"], blocks: true, clusters: 8, spread: 2.8, perCluster: 3, scatter: 6, seed: SEED_C + 106 },
        { id: "pebbles", variants: 4, on: ["gravel", "oxide"], blocks: false, clusters: 0, spread: 0, perCluster: 0, scatter: 260, seed: SEED_C + 107 },
        { id: "boulder", variants: 4, on: ["gravel", "oxide"], blocks: true, clusters: 7, spread: 2.4, perCluster: 3, scatter: 10, seed: SEED_C + 108 },
        { id: "hoodoo", variants: 3, on: ["oxide", "hardpan"], blocks: true, clusters: 5, spread: 2.2, perCluster: 2, scatter: 6, seed: SEED_C + 109 },
      ]),
    },
  };
}

function geometryFor(compositionId: NirvanaEastCompositionId): CompositionGeometry {
  switch (compositionId) {
    case "a-arroyo-braid": return arroyoBraidGeometry();
    case "b-mesa-field": return mesaFieldGeometry();
    case "c-salt-pan": return saltPanGeometry();
    default: {
      const exhaustive: never = compositionId;
      throw new NirvanaEastSceneError(`Unknown Nirvana East composition ${String(exhaustive)}.`);
    }
  }
}

// ---------------------------------------------------------------------------
// assembly
// ---------------------------------------------------------------------------

/** Author one of the three Nirvana East pilot compositions. */
export function createNirvanaEastScene(compositionId: NirvanaEastCompositionId): NirvanaEastScene {
  const geometry = geometryFor(compositionId);
  const corners = buildCornerField(geometry);

  // Landform footprints are pure composition data - independent of the
  // corner field - computed once, up front, so `resolveCrossings` can see
  // them. This matters: a landform is now what a `RadialMass` (a butte's
  // mesa/scarp rings) used to be architecturally - the load-bearing blocking
  // geometry a crossingPlan is authored to span - so a crossing plan must be
  // resolved against terrain-blocking OR landform-footprint-blocking, not
  // terrain alone, or an authored crossing over a rock rank / the wall pair
  // would never find anything to deck. This OVERLAY is used ONLY to decide
  // where crossings go; it never mutates `corners` or the returned tiles'
  // reported material - landform blocking itself is applied later, exactly
  // like every other prop, via each placement's own footprint.
  const landformBlockedIndices = new Set<number>();
  for (const placement of geometry.landforms) {
    for (const tile of placement.footprint) {
      landformBlockedIndices.add(tile.row * NIRVANA_EAST_COLUMNS + tile.column);
    }
  }
  const withLandformOverlay = (source: readonly NirvanaEastTile[]): readonly NirvanaEastTile[] => {
    if (landformBlockedIndices.size === 0) return source;
    return source.map((tile, index) => (
      landformBlockedIndices.has(index) && !tile.blocked ? { ...tile, blocked: true } : tile
    ));
  };

  let tiles = deriveTiles(corners);
  const crossings = resolveCrossings(withLandformOverlay(tiles), geometry.crossingPlans);
  tiles = applyCrossingDecks(tiles, crossings);
  let collision = collisionFrom(tiles);

  for (let pass = 0; pass < 24; pass += 1) {
    const components = walkableComponents(collision, NIRVANA_EAST_COLUMNS, NIRVANA_EAST_ROWS, true);
    if (components.length <= 1) break;
    const main = components[0];
    const orphan = components[1];
    if (orphan.tiles.length >= MIN_DECKED_POCKET_TILES) {
      const { from, to } = nearestPair(main, orphan, NIRVANA_EAST_COLUMNS);
      carveCrossing(corners, { x: from.x + 0.5, y: from.y + 0.5 }, { x: to.x + 0.5, y: to.y + 0.5 }, 1.3);
    } else {
      sealPocket(corners, orphan, NIRVANA_EAST_COLUMNS);
    }
    tiles = applyCrossingDecks(deriveTiles(corners), crossings);
    collision = collisionFrom(tiles);
  }

  const props = placeProps(tiles, geometry, crossings);

  // Every prop that blocks contributes its FULL footprint (still `[tile]`
  // for an ordinary single-tile species; the real multi-tile ellipse for a
  // landform - see `NirvanaEastProp.footprint`'s docstring). A tile the
  // crossing resolver actually decked (`tile.crossingDeck`) is EXCLUDED even
  // if it also happens to lie inside a landform's footprint - the plank
  // causeway is what makes that specific tile crossable, and it must win
  // over the object standing near/under it, or a deck built to cross a rock
  // rank would be silently re-blocked by the very feature it was built to
  // cross.
  const deckIndices = new Set<number>();
  for (const tile of tiles) {
    if (tile.crossingDeck) deckIndices.add(tile.row * NIRVANA_EAST_COLUMNS + tile.column);
  }
  const withPropFootprints = (keptProps: readonly NirvanaEastProp[]): Uint8Array => {
    const out = Uint8Array.from(collision);
    for (const prop of keptProps) {
      if (!prop.blocks) continue;
      for (const tile of prop.footprint) {
        const index = tile.row * NIRVANA_EAST_COLUMNS + tile.column;
        if (index < 0 || index >= out.length) continue;
        if (deckIndices.has(index)) continue;
        out[index] = 1;
      }
    }
    return out;
  };

  // A landform's anchor and its purely-visual wrapped-edge duplicates
  // (`propsForLandform`) always rise or fall TOGETHER: grouping by
  // `landformGroup` (falling back to the prop's own id, so an ordinary
  // single-tile prop is its own one-member group - identical to the old
  // per-prop behaviour) is what lets the repair pass below drop a whole
  // LANDFORM placement, not one tile of it, per the contract's explicit ask.
  const groupKeyOf = (prop: NirvanaEastProp): string => prop.landformGroup ?? `single:${prop.id}`;

  let keptProps: NirvanaEastProp[] = [...props];
  let withProps = withPropFootprints(keptProps);
  for (let pass = 0; pass < 60; pass += 1) {
    const components = walkableComponents(withProps, NIRVANA_EAST_COLUMNS, NIRVANA_EAST_ROWS, true);
    if (components.length <= 1) break;
    const orphan = components[components.length - 1];
    const orphanTiles = new Set(orphan.tiles);

    const groups = new Map<string, NirvanaEastProp[]>();
    for (const prop of keptProps) {
      const key = groupKeyOf(prop);
      const list = groups.get(key);
      if (list === undefined) groups.set(key, [prop]);
      else list.push(prop);
    }

    let removalKey: string | null = null;
    for (const [key, groupProps] of groups) {
      const blockingMembers = groupProps.filter((prop) => prop.blocks);
      if (blockingMembers.length === 0) continue;
      const footprintTiles = blockingMembers.flatMap((prop) => prop.footprint);
      const touchesOrphan = footprintTiles.some((tile) => {
        const neighbours = [
          ((tile.column - 1 + NIRVANA_EAST_COLUMNS) % NIRVANA_EAST_COLUMNS) + tile.row * NIRVANA_EAST_COLUMNS,
          ((tile.column + 1) % NIRVANA_EAST_COLUMNS) + tile.row * NIRVANA_EAST_COLUMNS,
          tile.column + ((tile.row - 1 + NIRVANA_EAST_ROWS) % NIRVANA_EAST_ROWS) * NIRVANA_EAST_COLUMNS,
          tile.column + ((tile.row + 1) % NIRVANA_EAST_ROWS) * NIRVANA_EAST_COLUMNS,
        ];
        return neighbours.some((neighbour) => orphanTiles.has(neighbour));
      });
      if (!touchesOrphan) continue;
      // Removing this group would change nothing if terrain ALONE already
      // blocks every one of its footprint tiles - skip it, exactly as the
      // single-tile version skipped a prop sitting on terrain that already blocked.
      const allTerrainBlocked = footprintTiles.every((tile) => (
        collision[tile.row * NIRVANA_EAST_COLUMNS + tile.column] === 1
      ));
      if (allTerrainBlocked) continue;
      removalKey = key;
      break;
    }

    if (removalKey === null) {
      for (const index of orphan.tiles) withProps[index] = 1;
      continue;
    }
    keptProps = keptProps.filter((prop) => groupKeyOf(prop) !== removalKey);
    withProps = withPropFootprints(keptProps);
  }

  return Object.freeze({
    compositionId,
    columns: NIRVANA_EAST_COLUMNS,
    rows: NIRVANA_EAST_ROWS,
    tileSize: NIRVANA_EAST_TILE_SIZE,
    widthPixels: NIRVANA_EAST_WIDTH_PX,
    heightPixels: NIRVANA_EAST_HEIGHT_PX,
    tiles: Object.freeze(tiles),
    collision: withProps,
    props: Object.freeze(keptProps),
    crossings: Object.freeze(crossings),
    cornerMaterials: Object.freeze(corners),
  });
}
