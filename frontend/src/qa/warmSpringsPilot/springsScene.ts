/**
 * Authors the Warm Springs geothermal PILOT scene (region 2 of the world
 * revamp). Sibling of `nirvanaValleyPilot/valleyScene.ts` - it is a LAB
 * surface with the same discipline: two facts come from ONE source, so the
 * terrain a being cannot enter is exactly the terrain drawn as pool, ochre
 * mat, mud, scrub, reed, or rock.
 *
 * The new primitive here is {@link terraceField}: a set of nested contour
 * bands (a distance field thresholded into discrete rings - pool, poolrim,
 * sinter apron, travertine step) around either a POINT vent or a SPLINE
 * (for a terraced margin that runs for tiles, like composition A's
 * horseshoe). All three compositions consume it, exactly as the contract
 * requires.
 *
 * BOARDWALKS replace Nirvana's bridges, with the identical derivation
 * discipline: a plan names a line and a point known to be in blocked ground;
 * the builder walks outward over the DERIVED tiles and takes the whole
 * contiguous blocked run as the deck, the first walkable tile past each end
 * as an abutment. Deck tiles report material `deck`, are walkable, and the
 * pool/mat/mud is still painted underneath them.
 *
 * PLOT SAFETY (compositions A and C must reach 0/128 lost) is reached by
 * construction rather than by tuning: every blocking material a channel or
 * terrace ring can produce is gated by a CORRIDOR predicate - the exact
 * free-space geometry from the contract (outer margins, the three vertical
 * gutters, the central horizontal gutter) - evaluated at the CORNER a
 * candidate material would occupy. Because a tile only blocks when at least
 * two of its four corners agree, and every corridor boundary in the contract
 * sits exactly on the district/gutter seam, a corridor-gated material can
 * never produce a blocked tile that overlaps a shelter plot. Composition B
 * intentionally carries no corridor gate: it is the ambitious mass that is
 * allowed to cost plots, measured rather than trimmed.
 */

import {
  BLOCKING_WARM_SPRINGS_MATERIALS,
  GRASS_FAMILY,
  hasShoreSet,
  isBlockingMaterial,
  isWaterMaterial,
  WARM_SPRINGS_BASE_VARIANTS,
  WARM_SPRINGS_EDGE_VARIANTS,
  WARM_SPRINGS_MATERIAL_PRIORITY,
  type WarmSpringsMaterial,
} from "./springsMaterials";

export const SPRINGS_COLUMNS = 96;
export const SPRINGS_ROWS = 96;
export const SPRINGS_TILE_SIZE = 32;
export const SPRINGS_WIDTH_PX = SPRINGS_COLUMNS * SPRINGS_TILE_SIZE;
export const SPRINGS_HEIGHT_PX = SPRINGS_ROWS * SPRINGS_TILE_SIZE;

export type WarmSpringsCompositionId = "a-sinter-rim" | "b-great-terrace" | "c-rift";

export const WARM_SPRINGS_COMPOSITION_IDS: readonly WarmSpringsCompositionId[] = Object.freeze([
  "a-sinter-rim",
  "b-great-terrace",
  "c-rift",
]);

/** A walkable pocket smaller than this is sealed rather than boardwalked. */
const MIN_BOARDWALKED_POCKET_TILES = 20;

/** No authored boardwalk may span more blocked ground than this. */
const MAX_BOARDWALK_DECK_TILES = 14;

/** Raised when an authored composition cannot be built as specified. */
export class WarmSpringsSceneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WarmSpringsSceneError";
  }
}

export interface WarmSpringsTileOverlay {
  readonly material: WarmSpringsMaterial;
  /** Corner mask, bit 1 = NW, 2 = NE, 4 = SE, 8 = SW - matches the art script. */
  readonly mask: number;
  readonly variant: number;
}

export interface WarmSpringsTileShoreline {
  readonly material: WarmSpringsMaterial;
  readonly mask: number;
  readonly variant: number;
}

export interface WarmSpringsTile {
  readonly column: number;
  readonly row: number;
  readonly base: WarmSpringsMaterial;
  readonly baseVariant: number;
  readonly overlays: readonly WarmSpringsTileOverlay[];
  readonly shorelines: readonly WarmSpringsTileShoreline[];
  readonly material: WarmSpringsMaterial;
  readonly blocked: boolean;
  readonly boardwalkDeck: boolean;
  readonly deckOver: WarmSpringsMaterial | null;
}

export type WarmSpringsTileRef = Readonly<{ column: number; row: number }>;

export type WarmSpringsBoardwalkAxis = "east-west" | "north-south";

export interface WarmSpringsBoardwalk {
  readonly id: string;
  readonly axis: WarmSpringsBoardwalkAxis;
  readonly deck: readonly WarmSpringsTileRef[];
  readonly abutments: readonly WarmSpringsTileRef[];
}

export interface WarmSpringsProp {
  readonly id: string;
  readonly frameId: string;
  readonly x: number;
  readonly y: number;
  readonly footY: number;
  readonly footX: number;
  readonly blocks: boolean;
  readonly tile: Readonly<{ column: number; row: number }>;
}

export interface WarmSpringsScene {
  readonly compositionId: WarmSpringsCompositionId;
  readonly columns: number;
  readonly rows: number;
  readonly tileSize: number;
  readonly widthPixels: number;
  readonly heightPixels: number;
  readonly tiles: readonly WarmSpringsTile[];
  readonly collision: Uint8Array;
  readonly props: readonly WarmSpringsProp[];
  readonly boardwalks: readonly WarmSpringsBoardwalk[];
  readonly cornerMaterials: readonly WarmSpringsMaterial[];
}

// ---------------------------------------------------------------------------
// deterministic noise (mirrors the Nirvana pilot so the two lab surfaces agree)
// ---------------------------------------------------------------------------

function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 0x27d4_eb2d) ^ Math.imul(y | 0, 0x1656_67b1)
    ^ Math.imul(seed | 0, 0x9e37_79b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85eb_ca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2_ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffff_ffff;
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let index = 0; index < octaves; index += 1) {
    sum += amplitude * valueNoise(x * frequency, y * frequency, seed + index * 101);
    norm += amplitude;
    frequency *= 2;
    amplitude *= 0.5;
  }
  return sum / norm;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Catmull-Rom through the control points; channels curve rather than step. */
function sampleSpline(points: readonly Point[], samplesPerSegment: number): Point[] {
  const result: Point[] = [];
  for (let index = 0; index < points.length - 3; index += 1) {
    const p0 = points[index];
    const p1 = points[index + 1];
    const p2 = points[index + 2];
    const p3 = points[index + 3];
    for (let step = 0; step < samplesPerSegment; step += 1) {
      const t = step / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      result.push({
        x: 0.5 * ((2 * p1.x)
          + (-p0.x + p2.x) * t
          + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2
          + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y)
          + (-p0.y + p2.y) * t
          + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2
          + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// free-space geometry (contract §1) - the corridor gate for compositions A/C
// ---------------------------------------------------------------------------

// A tile blocks when >= 2 of its 4 corners are a blocking material, and a
// tile's corner pair on one edge SHARES a column (or row): tile c's right
// edge is corners (c+1, r) and (c+1, r+1), both at column c+1. So if corner
// column `c+1` is hot for both row instances - true for anything painted
// uniformly along a full-height/width band, and possible even for an organic
// field wherever its boundary runs along that column for 2+ consecutive rows
// - tile c blocks via that ONE shared column alone, with NO help from its
// other two corners. Concretely: a free-space band declared as tile range
// [lo, hi] must therefore admit hot material only at CORNER columns
// [lo + 1, hi] - never at corner column `lo` itself - or the district tile
// at `lo - 1` picks up two hot corners (both instances of column `lo`) and
// blocks. The band's high edge needs no such adjustment: a tile just beyond
// `hi` (at `hi + 1`) is only put at risk by corner columns `hi + 1` or
// `hi + 2`, neither of which this predicate ever admits. This is not a
// heuristic buffer - it is the exact, provably minimal corner range that
// blocks every tile in [lo, hi] while leaving `lo - 1` and `hi + 1` untouched.
function inWestMargin(column: number): boolean {
  return column >= 1 && column <= 17;
}
function inEastMargin(column: number): boolean {
  return column >= 80 && column <= 95;
}
function inNorthMargin(row: number): boolean {
  return row >= 1 && row <= 20;
}
function inSouthMargin(row: number): boolean {
  return row >= 79 && row <= 95;
}
function inOuterMargin(column: number, row: number): boolean {
  return inWestMargin(column) || inEastMargin(column) || inNorthMargin(row) || inSouthMargin(row);
}
function inVerticalGutter(column: number): boolean {
  return (column >= 32 && column <= 33) || (column >= 48 && column <= 49)
    || (column >= 64 && column <= 65);
}
function inHorizontalGutter(row: number): boolean {
  return row >= 47 && row <= 52;
}

/**
 * A corner-level admission gate for BLOCKING materials.
 *
 * Because corners are sampled on the integer lattice and a tile only blocks
 * when at least two of its four corners agree, and every free-space boundary
 * above sits exactly on a district/gutter seam (narrowed by one corner column
 * per the note above), a material this predicate admits can never produce a
 * blocked tile that overlaps a shelter plot's 5x5 footprint. `null`
 * (composition B) means no gate: every candidate is admitted, which is how B
 * is allowed to cost plots.
 */
type CorridorGate = ((column: number, row: number) => boolean) | null;

const SINTER_RIM_CORRIDOR: CorridorGate = (column, row) => (
  inOuterMargin(column, row) || inVerticalGutter(column) || inHorizontalGutter(row)
);

const RIFT_CORRIDOR: CorridorGate = (column, row) => (
  inVerticalGutter(column) || inHorizontalGutter(row)
  || (inEastMargin(column) && inSouthMargin(row))
);

// ---------------------------------------------------------------------------
// channels (warm runnels / hot creeks) - reused across compositions
// ---------------------------------------------------------------------------

interface Channel {
  readonly samples: readonly Point[];
  readonly halfWidth: (u: number) => number;
  readonly core: WarmSpringsMaterial;
  readonly fringe: WarmSpringsMaterial | null;
  readonly fringeWidth: number;
}

function straightChannel(
  from: Point,
  to: Point,
  samples: number,
  halfWidth: number,
  core: WarmSpringsMaterial,
  fringe: WarmSpringsMaterial | null,
  fringeWidth: number,
): Channel {
  const points: Point[] = [];
  for (let step = 0; step <= samples; step += 1) {
    const t = step / samples;
    points.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  }
  return { samples: Object.freeze(points), halfWidth: () => halfWidth, core, fringe, fringeWidth };
}

/**
 * Control points that WANDER laterally around the straight line from `from`
 * to `to`, rather than sitting on it - the fix for channels that otherwise
 * read as ruler-straight lines. Even a narrow (3-tile) corridor lets a 1-2
 * tile channel snake from one side to the other; `amplitude` is the wander's
 * half-range in tiles, and the corridor admission gate in
 * {@link cornerMaterialFor} still clips anything that strays out of bounds,
 * so wandering freely here never risks the plot-safety proof - it only ever
 * makes the shape less straight within ground already deemed safe.
 */
function meanderControlPoints(
  from: Point,
  to: Point,
  segments: number,
  amplitude: number,
  seed: number,
): Point[] {
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
    const wobble = (fbm(step * 0.6, seed * 0.37, seed + 71, 3) - 0.5) * 2 * amplitude;
    points.push({ x: baseX + px * wobble, y: baseY + py * wobble });
  }
  return points;
}

/**
 * A width function that pinches to a fissure and swells into a pool along
 * the run, rather than holding one constant half-width the whole way (the
 * "constant-width racetrack" the channel fix targets). `base` is the resting
 * half-width in tiles; `swing` is how far it pinches/swells either side.
 */
/**
 * Noise-DOMINANT width variation, deliberately not a sine wave: a fixed-period
 * oscillation reads as a repeating bead necklace at 32px (regular pinch,
 * regular swell, regular pinch), which is exactly as mechanical-looking as a
 * constant width. Two octaves of independent fbm - one broad (a handful of
 * real swells and pinches along the whole run), one fine (surface grain) -
 * never repeats with a period, so no two pinches or swells along one channel
 * look alike.
 */
function meanderHalfWidth(base: number, swing: number, seed: number): (u: number) => number {
  return (u: number): number => {
    // `u` spans the WHOLE run (0..1); the noise frequency has to be scaled up
    // enough that several distinct pinches/swells fall inside any one
    // on-screen stretch, or the variation is real but too slow to see - the
    // bug that made the first pass still read as constant-width.
    const broad = fbm(u * 7.5, seed * 0.41, seed + 300, 3) - 0.5;
    const fine = fbm(u * 19, seed * 1.7, seed + 450, 2) - 0.5;
    return Math.max(0.2, base + (broad * 1.8 + fine * 0.6) * swing);
  };
}

function splineChannel(
  controlPoints: readonly Point[],
  samplesPerSegment: number,
  halfWidth: (u: number) => number,
  core: WarmSpringsMaterial,
  fringe: WarmSpringsMaterial | null,
  fringeWidth: number,
): Channel {
  return {
    samples: Object.freeze(sampleSpline(controlPoints, samplesPerSegment)),
    halfWidth,
    core,
    fringe,
    fringeWidth,
  };
}

/**
 * A meandering channel between two points: control points wander laterally
 * (never a straight line) and the half-width pinches/swells along the run
 * (never a constant-width racetrack). The replacement for what would
 * otherwise be a ruler-straight gutter runnel or fissure.
 */
function meanderChannel(
  from: Point,
  to: Point,
  segments: number,
  amplitude: number,
  baseHalfWidth: number,
  widthSwing: number,
  core: WarmSpringsMaterial,
  fringe: WarmSpringsMaterial | null,
  fringeWidth: number,
  seed: number,
): Channel {
  return splineChannel(
    meanderControlPoints(from, to, segments, amplitude, seed),
    Math.max(3, Math.ceil(24 / segments)),
    meanderHalfWidth(baseHalfWidth, widthSwing, seed),
    core,
    fringe,
    fringeWidth,
  );
}

/**
 * Nearest-sample material lookup across every channel. Returns `null` off
 * every channel's reach so callers can fall through to the next layer.
 */
function channelMaterialAt(
  channels: readonly Channel[],
  x: number,
  y: number,
): WarmSpringsMaterial | null {
  let bestNormalized = Number.POSITIVE_INFINITY;
  let bestChannel: Channel | null = null;
  for (const channel of channels) {
    const { samples } = channel;
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      const dx = x - sample.x;
      const dy = y - sample.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > 225) continue;
      const u = index / Math.max(1, samples.length - 1);
      const normalized = Math.sqrt(distanceSquared) / channel.halfWidth(u);
      if (normalized < bestNormalized) {
        bestNormalized = normalized;
        bestChannel = channel;
      }
    }
  }
  if (bestChannel === null) return null;
  if (bestNormalized <= 1.0) return bestChannel.core;
  if (bestChannel.fringe !== null && bestNormalized <= 1.0 + bestChannel.fringeWidth) {
    return bestChannel.fringe;
  }
  return null;
}

// ---------------------------------------------------------------------------
// terraceField() - THE new primitive: nested contour bands around a vent
// ---------------------------------------------------------------------------

export interface TerraceRing {
  readonly material: WarmSpringsMaterial;
  /** Outer edge of this ring, in tiles from the source. */
  readonly outer: number;
}

/**
 * One terrace source: either a POINT vent (radial rings, optionally stretched
 * along a downhill `flow` direction to make an elongated staircase) or a
 * SPLINE (rings follow a curve - a terraced margin that runs for tiles, like
 * composition A's horseshoe).
 */
export interface TerraceSpec {
  readonly id: string;
  readonly kind: "point" | "spline";
  readonly cx?: number;
  readonly cy?: number;
  readonly flow?: Readonly<{ dx: number; dy: number; stretch: number }>;
  readonly samples?: readonly Point[];
  readonly rings: readonly TerraceRing[];
  readonly seed: number;
  readonly noiseAmount: number;
  /**
   * SPLINE kind only: a per-`u` multiplier on the effective distance, so the
   * terrace's rings swell into wide lobes in places and pinch thin in
   * others along the run - never a constant-offset band, which reads as a
   * rounded rectangle/racetrack tracing the curve rather than a lobed,
   * irregular terrace margin.
   */
  readonly widthModulation?: (u: number) => number;
}

function terraceDistance(spec: TerraceSpec, x: number, y: number): number {
  let base: number;
  let modulation = 1;
  if (spec.kind === "point") {
    const dx = x - (spec.cx ?? 0);
    const dy = y - (spec.cy ?? 0);
    if (spec.flow !== undefined) {
      const length = Math.hypot(spec.flow.dx, spec.flow.dy) || 1;
      const fx = spec.flow.dx / length;
      const fy = spec.flow.dy / length;
      const along = (dx * fx + dy * fy) / spec.flow.stretch;
      const perp = -dx * fy + dy * fx;
      base = Math.hypot(along, perp);
    } else {
      base = Math.hypot(dx, dy);
    }
  } else {
    const samples = spec.samples ?? [];
    let bestSquared = Number.POSITIVE_INFINITY;
    let bestIndex = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      const dx = x - sample.x;
      const dy = y - sample.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < bestSquared) {
        bestSquared = distanceSquared;
        bestIndex = index;
      }
    }
    base = Math.sqrt(bestSquared);
    if (spec.widthModulation !== undefined && samples.length > 1) {
      const u = bestIndex / (samples.length - 1);
      modulation = Math.max(0.35, spec.widthModulation(u));
    }
  }
  base /= modulation;
  const wobble = (fbm(x * 0.15, y * 0.15, spec.seed, 3) - 0.5) * spec.noiseAmount;
  return base + wobble;
}

/**
 * The reusable terrace primitive: a distance field to one or more vents,
 * thresholded into nested contour bands. Every composition calls this for
 * its terraced ground - a radial vent, an elongated staircase, or a terraced
 * margin running for tiles - through the SAME ring-lookup rule.
 *
 * @returns The material of the innermost ring whose `outer` bound the point
 *   falls within, or `null` when the point is outside every ring of every spec.
 */
export function terraceField(
  specs: readonly TerraceSpec[],
  x: number,
  y: number,
): WarmSpringsMaterial | null {
  for (const spec of specs) {
    const distance = terraceDistance(spec, x, y);
    for (const ring of spec.rings) {
      if (distance <= ring.outer) return ring.material;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// background biome (the sward, tonal tiers only - no scattered blockers)
// ---------------------------------------------------------------------------

function backgroundMaterialAt(x: number, y: number, seed: number): WarmSpringsMaterial {
  const shade = fbm(x * 0.11, y * 0.11, seed + 520, 4);
  if (shade > 0.63) return "shadegrass";
  const light = fbm(x * 0.07, y * 0.07, seed + 880, 3);
  if (light > 0.565) return "sungrass";
  if (light < 0.435) return "shadegrass";
  return "grass";
}

/**
 * A halo of scattered rock scree just beyond a terrace's own outer ring -
 * NOT a global background texture. Composition B's rock margin originally
 * used unconstrained noise with no spatial bound, and it scattered `rock`
 * (a blocking material) across the ENTIRE region including district-2, far
 * from the great terrace it was meant to frame. Confining it to a bounded
 * halo around one vent, using the SAME flow-stretched distance metric as
 * {@link terraceField}, is what keeps the texture where the identity mass
 * actually is.
 */
interface RockHalo {
  readonly cx: number;
  readonly cy: number;
  readonly flow?: Readonly<{ dx: number; dy: number; stretch: number }>;
  /** Rock never appears inside this radius - it is the terrace's own rings. */
  readonly inner: number;
  /** Rock never appears beyond this radius. */
  readonly outer: number;
}

function withinRockHalo(halo: RockHalo, x: number, y: number): boolean {
  const dx = x - halo.cx;
  const dy = y - halo.cy;
  let distance: number;
  if (halo.flow !== undefined) {
    const length = Math.hypot(halo.flow.dx, halo.flow.dy) || 1;
    const fx = halo.flow.dx / length;
    const fy = halo.flow.dy / length;
    const along = (dx * fx + dy * fy) / halo.flow.stretch;
    const perp = -dx * fy + dy * fx;
    distance = Math.hypot(along, perp);
  } else {
    distance = Math.hypot(dx, dy);
  }
  return distance >= halo.inner && distance <= halo.outer;
}

/** A modest scattered rock texture, used only within a composition's rock halo. */
function rockMarginAt(x: number, y: number, seed: number): WarmSpringsMaterial | null {
  const field = fbm(x * 0.09, y * 0.09, seed + 260, 4);
  return field > 0.685 ? "rock" : null;
}

/**
 * Broad walkable mineral ground - old dry terraces, mineral-stained aprons,
 * ghost outlines of dead pools - radiating from the region's real vents and
 * channels at ZERO plot cost and zero connectivity cost, because `sinter`
 * and `travertine` never block.
 *
 * This is deliberately an APRON anchored to actual features, not a
 * standalone noise wash: a context-free threshold field stains ground with
 * no relationship to where the identity actually is, and at high coverage
 * turns the whole region into a uniform beige plain with the green sward
 * gone - which loses the sibling relationship to Nirvana (the shared olive
 * green IS what makes them siblings; the mineral colour is the difference)
 * and the contrast that makes the ochre/turquoise sing against it. Radiating
 * from real anchors instead reads as "islands of pale ground fanning out
 * from a spring", the green sward remains the matrix, and it naturally
 * thins out in the district interiors where no anchor sits nearby.
 *
 * @param anchors - Real feature locations (vents, rift nodes, points along a
 *   channel's own path) the apron fans out from.
 * @param baseReach - Typical apron radius in tiles before lobing.
 * @param density - Roughly the admit probability right at an anchor (0..1);
 *   it quadratically fades to 0 at the (lobed) edge, never a hard cutoff.
 */
function mineralApronAt(
  x: number,
  y: number,
  seed: number,
  anchors: readonly Point[],
  baseReach: number,
  density: number,
): WarmSpringsMaterial | null {
  let bestSquared = Number.POSITIVE_INFINITY;
  for (const anchor of anchors) {
    const dx = x - anchor.x;
    const dy = y - anchor.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared < bestSquared) bestSquared = distanceSquared;
  }
  const distance = Math.sqrt(bestSquared);
  // Lobing: the apron's local reach varies with low-frequency noise so it
  // fans out unevenly - thick in places, pinched almost to nothing in
  // others - rather than tracing a uniform disc around each anchor.
  const lobe = fbm(x * 0.05, y * 0.05, seed + 5000, 4);
  const reach = baseReach * (0.45 + lobe * 1.05);
  if (distance >= reach) return null;
  const t = distance / reach;
  const admitProbability = density * (1 - t * t);
  const patch = fbm(x * 0.1, y * 0.1, seed + 5100, 3);
  if (patch > admitProbability) return null;
  const tier = fbm(x * 0.09, y * 0.09, seed + 5200, 3);
  return tier > 0.48 ? "travertine" : "sinter";
}

// ---------------------------------------------------------------------------
// per-composition corner-field assembly
// ---------------------------------------------------------------------------

interface CompositionGeometry {
  readonly channels: readonly Channel[];
  readonly terraces: readonly TerraceSpec[];
  readonly corridor: CorridorGate;
  readonly cornerSeed: number;
  readonly rockHalo: RockHalo | null;
  readonly ventLandmarks: readonly Point[];
  readonly riftNodes: readonly Point[];
  readonly boardwalkPlans: readonly BoardwalkPlan[];
  /** Real feature points the mineral apron fans out from. */
  readonly mineralAnchors: readonly Point[];
  /** Typical apron reach in tiles before lobing. */
  readonly mineralReach: number;
  /** Apron density right at an anchor, fading to 0 at its edge. */
  readonly mineralDensity: number;
}

function cornerMaterialFor(geometry: CompositionGeometry, x: number, y: number): WarmSpringsMaterial {
  const admits = (material: WarmSpringsMaterial): boolean => (
    !isBlockingMaterial(material) || geometry.corridor === null || geometry.corridor(
      Math.round(x),
      Math.round(y),
    )
  );

  const channelMaterial = channelMaterialAt(geometry.channels, x, y);
  if (channelMaterial !== null && admits(channelMaterial)) return channelMaterial;

  const terraceMaterial = terraceField(geometry.terraces, x, y);
  if (terraceMaterial !== null && admits(terraceMaterial)) return terraceMaterial;

  if (geometry.rockHalo !== null && withinRockHalo(geometry.rockHalo, x, y)) {
    const rock = rockMarginAt(x, y, geometry.cornerSeed);
    if (rock !== null && admits(rock)) return rock;
  }

  // Non-blocking, so no corridor gate needed - it can spread anywhere,
  // including over districts and plot tiles, at zero walkability cost.
  const stain = mineralApronAt(
    x, y, geometry.cornerSeed, geometry.mineralAnchors, geometry.mineralReach, geometry.mineralDensity,
  );
  if (stain !== null) return stain;

  return backgroundMaterialAt(x, y, geometry.cornerSeed);
}

function cornerIndex(column: number, row: number): number {
  return row * (SPRINGS_COLUMNS + 1) + column;
}

function buildCornerField(geometry: CompositionGeometry): WarmSpringsMaterial[] {
  const corners: WarmSpringsMaterial[] = new Array((SPRINGS_COLUMNS + 1) * (SPRINGS_ROWS + 1));
  for (let row = 0; row <= SPRINGS_ROWS; row += 1) {
    for (let column = 0; column <= SPRINGS_COLUMNS; column += 1) {
      corners[cornerIndex(column, row)] = cornerMaterialFor(geometry, column, row);
    }
  }
  return corners;
}

/** Paint a walkable sinter causeway into the corner field (connectivity repair). */
function carveCrossing(
  corners: WarmSpringsMaterial[],
  from: Point,
  to: Point,
  halfWidth: number,
  material: WarmSpringsMaterial = "sinter",
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
        if (column < 0 || row < 0 || column > SPRINGS_COLUMNS || row > SPRINGS_ROWS) continue;
        const jitter = (fbm(column * 0.7, row * 0.7, seed, 2) - 0.5) * 0.55;
        if (Math.hypot(column - cx, row - cy) > halfWidth + jitter) continue;
        corners[cornerIndex(column, row)] = material;
        touched.push({ column, row });
      }
    }
  }
  return touched;
}

/** Seal a pocket too small to deserve a boardwalk, so nothing can be stranded. */
function sealPocket(
  corners: WarmSpringsMaterial[],
  component: { readonly tiles: readonly number[] },
  columns: number,
): void {
  for (const index of component.tiles) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    for (const [dc, dr] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
      corners[cornerIndex(column + dc, row + dr)] = "reed";
    }
  }
}

// ---------------------------------------------------------------------------
// tile derivation (identical discipline to the Nirvana pilot)
// ---------------------------------------------------------------------------

function tileVariant(column: number, row: number, salt: number, count: number): number {
  if (count <= 0) return 0;
  return Math.floor(hash2(column, row, 0x2468 + salt) * count) % count;
}

function deriveTile(
  corners: readonly WarmSpringsMaterial[],
  column: number,
  row: number,
): WarmSpringsTile {
  const cornerMaterials: readonly WarmSpringsMaterial[] = [
    corners[cornerIndex(column, row)],
    corners[cornerIndex(column + 1, row)],
    corners[cornerIndex(column + 1, row + 1)],
    corners[cornerIndex(column, row + 1)],
  ];
  const priorities = cornerMaterials.map((material) => WARM_SPRINGS_MATERIAL_PRIORITY[material]);
  const basePriority = Math.min(...priorities);
  const base = cornerMaterials[priorities.indexOf(basePriority)];

  const present = [...new Set(cornerMaterials)]
    .filter((material) => WARM_SPRINGS_MATERIAL_PRIORITY[material] > basePriority)
    .sort((left, right) => (
      WARM_SPRINGS_MATERIAL_PRIORITY[left] - WARM_SPRINGS_MATERIAL_PRIORITY[right]
    ));

  const overlays: WarmSpringsTileOverlay[] = [];
  const shorelines: WarmSpringsTileShoreline[] = [];
  const baseIsWater = isWaterMaterial(base);
  for (const material of present) {
    const threshold = WARM_SPRINGS_MATERIAL_PRIORITY[material];
    let mask = 0;
    for (let corner = 0; corner < 4; corner += 1) {
      if (priorities[corner] >= threshold) mask |= 1 << corner;
    }
    if (mask === 0) continue;
    const salt = WARM_SPRINGS_MATERIAL_PRIORITY[material] * 31 + mask;
    const variant = mask === 15
      ? tileVariant(column, row, salt, WARM_SPRINGS_BASE_VARIANTS)
      : tileVariant(column, row, salt, WARM_SPRINGS_EDGE_VARIANTS[material]);
    overlays.push({ material, mask, variant });
    if (baseIsWater && mask !== 15 && hasShoreSet(material)) {
      shorelines.push({ material, mask, variant });
    }
  }

  const blockingCorners = cornerMaterials.filter((material) => (
    BLOCKING_WARM_SPRINGS_MATERIALS.includes(material)
  )).length;
  const blocked = blockingCorners >= 2;

  const agreeing = cornerMaterials.filter(
    (candidate) => isBlockingMaterial(candidate) === blocked,
  );
  const tally = new Map<WarmSpringsMaterial, number>();
  for (const candidate of agreeing) {
    tally.set(candidate, (tally.get(candidate) ?? 0) + 1);
  }
  let material = agreeing[0];
  let bestCount = -1;
  for (const [candidate, count] of tally) {
    const better = count > bestCount
      || (count === bestCount
        && WARM_SPRINGS_MATERIAL_PRIORITY[candidate] < WARM_SPRINGS_MATERIAL_PRIORITY[material]);
    if (better) {
      material = candidate;
      bestCount = count;
    }
  }

  return Object.freeze({
    column,
    row,
    base,
    baseVariant: tileVariant(
      column,
      row,
      WARM_SPRINGS_MATERIAL_PRIORITY[base],
      WARM_SPRINGS_BASE_VARIANTS,
    ),
    overlays: Object.freeze(overlays),
    shorelines: Object.freeze(shorelines),
    material,
    blocked,
    boardwalkDeck: false,
    deckOver: null,
  });
}

function deriveTiles(corners: readonly WarmSpringsMaterial[]): WarmSpringsTile[] {
  const tiles: WarmSpringsTile[] = new Array(SPRINGS_COLUMNS * SPRINGS_ROWS);
  for (let row = 0; row < SPRINGS_ROWS; row += 1) {
    for (let column = 0; column < SPRINGS_COLUMNS; column += 1) {
      tiles[row * SPRINGS_COLUMNS + column] = deriveTile(corners, column, row);
    }
  }
  return tiles;
}

function collisionFrom(tiles: readonly WarmSpringsTile[]): Uint8Array {
  const collision = new Uint8Array(SPRINGS_COLUMNS * SPRINGS_ROWS);
  for (let index = 0; index < tiles.length; index += 1) {
    collision[index] = tiles[index].blocked ? 1 : 0;
  }
  return collision;
}

// ---------------------------------------------------------------------------
// boardwalks - identical derivation discipline to Nirvana's bridges
// ---------------------------------------------------------------------------

interface BoardwalkPlan {
  readonly id: string;
  readonly axis: WarmSpringsBoardwalkAxis;
  /** Row for an east-west span, column for a north-south span. */
  readonly line: number;
  /** A position along the span axis known to be in blocked ground. */
  readonly midstream: number;
}

function tileRefAlong(plan: BoardwalkPlan, position: number): WarmSpringsTileRef {
  return plan.axis === "east-west"
    ? { column: position, row: plan.line }
    : { column: plan.line, row: position };
}

function resolveBoardwalk(
  tiles: readonly WarmSpringsTile[],
  plan: BoardwalkPlan,
): WarmSpringsBoardwalk {
  const limit = plan.axis === "east-west" ? SPRINGS_COLUMNS : SPRINGS_ROWS;
  const blockedAt = (position: number): boolean => {
    if (position < 0 || position >= limit) return true;
    const ref = tileRefAlong(plan, position);
    return tiles[ref.row * SPRINGS_COLUMNS + ref.column].blocked;
  };

  // `plan.midstream` is a HINT, not an assertion. A channel is a meander whose
  // exact position moves whenever it is retuned, so a boardwalk anchored to a
  // hardcoded coordinate breaks every time the art is adjusted - which is
  // exactly what happened here once the ruler-straight fissures were replaced
  // with meanders. So: search outward from the hint for the nearest blocked
  // tile on this line, and span THAT. The crossing is then derived from the
  // same material field the art is derived from, so it always lands on the
  // banks the channel actually has and can never be drawn over dry ground.
  // This is the discipline the Nirvana pilot's bridge spans used.
  const midstream = ((): number => {
    if (blockedAt(plan.midstream)) return plan.midstream;
    for (let offset = 1; offset <= MAX_BOARDWALK_DECK_TILES; offset += 1) {
      for (const candidate of [plan.midstream - offset, plan.midstream + offset]) {
        if (candidate <= 0 || candidate >= limit - 1) continue;
        if (blockedAt(candidate)) return candidate;
      }
    }
    throw new WarmSpringsSceneError(
      `Boardwalk ${plan.id}: no blocked ground within ${MAX_BOARDWALK_DECK_TILES} tiles of `
      + `midstream hint ${plan.midstream} on line ${plan.line} - there is nothing here to cross.`,
    );
  })();

  let first = midstream;
  while (
    first > 0
    && blockedAt(first - 1)
    && midstream - first < MAX_BOARDWALK_DECK_TILES
  ) first -= 1;
  let last = midstream;
  while (
    last < limit - 1
    && blockedAt(last + 1)
    && last - midstream < MAX_BOARDWALK_DECK_TILES
  ) last += 1;

  if (blockedAt(first - 1) || blockedAt(last + 1)) {
    throw new WarmSpringsSceneError(
      `Boardwalk ${plan.id}: the blocked run from ${first} to ${last} does not reach walkable `
      + `ground at both ends within ${MAX_BOARDWALK_DECK_TILES} tiles.`,
    );
  }

  const deck: WarmSpringsTileRef[] = [];
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

function resolveBoardwalks(
  tiles: readonly WarmSpringsTile[],
  plans: readonly BoardwalkPlan[],
): WarmSpringsBoardwalk[] {
  return plans.map((plan) => resolveBoardwalk(tiles, plan));
}

/** Worn sinter approach tracks fanning inland from each boardwalk abutment. */
function carveBoardwalkApproaches(
  corners: WarmSpringsMaterial[],
  boardwalks: readonly WarmSpringsBoardwalk[],
): void {
  for (const boardwalk of boardwalks) {
    for (const abutment of boardwalk.abutments) {
      const nearestDeck = boardwalk.deck.reduce((best, candidate) => {
        const bestDistance = Math.hypot(best.column - abutment.column, best.row - abutment.row);
        const distance = Math.hypot(
          candidate.column - abutment.column,
          candidate.row - abutment.row,
        );
        return distance < bestDistance ? candidate : best;
      });
      const dx = abutment.column - nearestDeck.column;
      const dy = abutment.row - nearestDeck.row;
      const length = Math.max(1e-6, Math.hypot(dx, dy));
      const inlandX = dx / length;
      const inlandY = dy / length;
      const origin = {
        x: abutment.column + 0.5 + inlandX * 0.35,
        y: abutment.row + 0.5 + inlandY * 0.35,
      };
      const branches: readonly Readonly<{ angle: number; reach: number }>[] = [
        { angle: 0.55, reach: 2.4 },
        { angle: -0.48, reach: 3.0 },
      ];
      for (const branch of branches) {
        const cos = Math.cos(branch.angle);
        const sin = Math.sin(branch.angle);
        carveCrossing(
          corners,
          origin,
          {
            x: origin.x + (inlandX * cos - inlandY * sin) * branch.reach,
            y: origin.y + (inlandX * sin + inlandY * cos) * branch.reach,
          },
          0.5,
          "sinter",
        );
      }
    }
  }
}

function applyBoardwalkDecks(
  tiles: readonly WarmSpringsTile[],
  boardwalks: readonly WarmSpringsBoardwalk[],
): WarmSpringsTile[] {
  const decked = [...tiles];
  for (const boardwalk of boardwalks) {
    for (const ref of boardwalk.deck) {
      const index = ref.row * SPRINGS_COLUMNS + ref.column;
      const tile = decked[index];
      decked[index] = Object.freeze({
        ...tile,
        material: "deck" as WarmSpringsMaterial,
        blocked: false,
        boardwalkDeck: true,
        deckOver: tile.material,
      });
    }
  }
  return decked;
}

// ---------------------------------------------------------------------------
// connectivity
// ---------------------------------------------------------------------------

export interface WarmSpringsComponent {
  readonly tiles: readonly number[];
}

/** Four-connected walkable components over a row-major collision mask. */
export function walkableComponents(
  collision: Uint8Array,
  columns: number,
  rows: number,
): WarmSpringsComponent[] {
  const seen = new Uint8Array(collision.length);
  const components: WarmSpringsComponent[] = [];
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
      const neighbours = [
        column > 0 ? index - 1 : -1,
        column < columns - 1 ? index + 1 : -1,
        row > 0 ? index - columns : -1,
        row < rows - 1 ? index + columns : -1,
      ];
      for (const neighbour of neighbours) {
        if (neighbour < 0 || seen[neighbour] === 1 || collision[neighbour] === 1) continue;
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
  left: WarmSpringsComponent,
  right: WarmSpringsComponent,
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
      const distance = (ax - bx) ** 2 + (ay - by) ** 2;
      if (distance < best) {
        best = distance;
        from = { x: ax, y: ay };
        to = { x: bx, y: by };
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
  readonly on: readonly WarmSpringsMaterial[];
  readonly blocks: boolean;
  readonly clusters: number;
  readonly spread: number;
  readonly perCluster: number;
  readonly scatter: number;
  readonly seed: number;
}

const ON_SWARD: readonly WarmSpringsMaterial[] = GRASS_FAMILY;

const SPECIES: readonly SpeciesRule[] = Object.freeze([
  {
    id: "conifer", variants: 3, on: ON_SWARD, blocks: true,
    clusters: 7, spread: 2.6, perCluster: 4, scatter: 6, seed: 211,
  },
  {
    id: "broadleaf", variants: 3, on: ON_SWARD, blocks: true,
    clusters: 9, spread: 3.0, perCluster: 5, scatter: 8, seed: 307,
  },
  {
    id: "shrub", variants: 3, on: ON_SWARD, blocks: false,
    clusters: 14, spread: 3.2, perCluster: 6, scatter: 60, seed: 401,
  },
  {
    id: "boulder", variants: 3, on: [...ON_SWARD, "rock", "travertine"], blocks: true,
    clusters: 8, spread: 2.2, perCluster: 3, scatter: 14, seed: 503,
  },
  {
    id: "tussock", variants: 4, on: [...ON_SWARD, "sinter", "travertine"], blocks: false,
    clusters: 0, spread: 0, perCluster: 0, scatter: 380, seed: 601,
  },
  {
    id: "flowerdrift", variants: 3, on: ["sungrass", "grass"], blocks: false,
    clusters: 14, spread: 2.6, perCluster: 5, scatter: 30, seed: 701,
  },
  {
    id: "reedclump", variants: 3, on: ["reed"], blocks: false,
    clusters: 0, spread: 0, perCluster: 0, scatter: 420, seed: 809,
  },
  {
    id: "crustring", variants: 3, on: ["sinter", "travertine"], blocks: false,
    clusters: 0, spread: 0, perCluster: 0, scatter: 260, seed: 907,
  },
  {
    id: "sinterstep", variants: 3, on: ["sinter", "travertine"], blocks: false,
    clusters: 0, spread: 0, perCluster: 0, scatter: 140, seed: 1009,
  },
]);

/**
 * Sprite feet offsets, kept in step with the SHIPPED atlas's own authored
 * pivots (`assets/atlas.json` sceneryFrames), read once by hand and pinned
 * here as a plain constant - the same "scene hardcodes what the art
 * authored" discipline `valleyScene.ts`'s `PROP_PIVOTS` uses, so a prop's
 * foot lands exactly where the art was drawn to be anchored.
 */
const PROP_PIVOTS: Readonly<Record<string, readonly [number, number, number, number]>> =
  Object.freeze({
    sintercone: [96, 112, 48, 104],
    steam: [96, 96, 48, 88],
    steamsmall: [48, 48, 24, 44],
    rimface: [32, 48, 16, 40],
    rimcornerin: [32, 48, 16, 40],
    rimcornerout: [32, 48, 16, 40],
    mudpot: [48, 48, 24, 44],
    fumarole: [48, 64, 24, 60],
    boulder: [48, 48, 24, 44],
    crustring: [32, 32, 16, 28],
    tussock: [32, 40, 16, 37],
    shrub: [48, 48, 24, 45],
    conifer: [64, 96, 32, 92],
    broadleaf: [64, 80, 32, 76],
    flowerdrift: [48, 32, 24, 29],
    reedclump: [32, 48, 16, 45],
    reedwater: [32, 48, 16, 45],
    walkh: [32, 32, 16, 31],
    walkv: [32, 32, 16, 31],
    walkpost: [32, 32, 16, 31],
    walkramph: [32, 32, 16, 31],
    walkrampv: [32, 32, 16, 31],
    sinterstep: [32, 32, 16, 29],
    driftlog: [48, 24, 24, 21],
  });

function makeProp(
  id: string,
  frameId: string,
  species: string,
  footX: number,
  footY: number,
  blocks: boolean,
): WarmSpringsProp {
  const pivot = PROP_PIVOTS[species];
  if (pivot === undefined) {
    throw new WarmSpringsSceneError(`Warm Springs scene has no pivot entry for species ${species}.`);
  }
  const [, , pivotX, pivotY] = pivot;
  return Object.freeze({
    id,
    frameId,
    x: Math.round(footX - pivotX),
    y: Math.round(footY - pivotY),
    footX: Math.round(footX),
    footY: Math.round(footY),
    blocks,
    tile: Object.freeze({
      column: Math.floor(footX / SPRINGS_TILE_SIZE),
      row: Math.floor(footY / SPRINGS_TILE_SIZE),
    }),
  });
}

function candidatePositions(species: SpeciesRule): Array<{
  column: number; row: number; variant: number; offsetX: number; offsetY: number;
}> {
  const out: Array<{
    column: number; row: number; variant: number; offsetX: number; offsetY: number;
  }> = [];
  const push = (x: number, y: number, salt: number): void => {
    const column = Math.floor(x);
    const row = Math.floor(y);
    if (column < 1 || row < 1 || column >= SPRINGS_COLUMNS - 1 || row >= SPRINGS_ROWS - 1) return;
    out.push({
      column,
      row,
      variant: Math.floor(hash2(column, row, species.seed + salt) * species.variants)
        % species.variants,
      offsetX: (hash2(column, row, species.seed + salt + 7) - 0.5) * 22,
      offsetY: (hash2(column, row, species.seed + salt + 13) - 0.5) * 18,
    });
  };
  for (let cluster = 0; cluster < species.clusters; cluster += 1) {
    const cx = hash2(cluster, species.seed, 17) * SPRINGS_COLUMNS;
    const cy = hash2(cluster, species.seed, 29) * SPRINGS_ROWS;
    for (let member = 0; member < species.perCluster; member += 1) {
      const angle = hash2(cluster, member, species.seed + 41) * Math.PI * 2;
      const radius = Math.sqrt(hash2(cluster, member, species.seed + 53)) * species.spread;
      push(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, member * 3 + cluster);
    }
  }
  for (let index = 0; index < species.scatter; index += 1) {
    push(
      hash2(index, species.seed, 61) * SPRINGS_COLUMNS,
      hash2(index, species.seed, 71) * SPRINGS_ROWS,
      index + 500,
    );
  }
  return out;
}

/**
 * The 8 district origin tiles and the 16 shelter-plot offsets within a
 * district, frozen by contract §1. Duplicated here (rather than imported
 * from `springsWalkability.ts`) to avoid a circular module dependency - that
 * module already imports `WarmSpringsScene` from this one.
 */
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

/** All 128 shelter-plot anchor tiles, `{x: column, y: row}`. */
function allShelterPlotAnchors(): readonly Point[] {
  const anchors: Point[] = [];
  for (const origin of SHELTER_DISTRICT_ORIGINS) {
    for (const offset of SHELTER_PLOT_OFFSETS) {
      anchors.push({ x: origin.x + offset.x, y: origin.y + offset.y });
    }
  }
  return anchors;
}

function placeProps(
  tiles: readonly WarmSpringsTile[],
  geometry: CompositionGeometry,
  boardwalks: readonly WarmSpringsBoardwalk[],
): WarmSpringsProp[] {
  const props: WarmSpringsProp[] = [];
  const claimed = new Set<string>();

  // A tree does not grow where a house goes: every one of the 128 shelter
  // plots' real 5x5 render footprints is pre-claimed as prop-free, so no
  // blocking (or non-blocking) prop can ever be candidate-selected onto
  // ground a shelter will stand on. This runs BEFORE placement, so it only
  // ever removes candidates - it cannot itself sever the walkable graph, and
  // the connectivity repair pass after placement still re-checks regardless.
  for (const anchor of allShelterPlotAnchors()) {
    for (let dr = 0; dr < 5; dr += 1) {
      for (let dc = 0; dc < 5; dc += 1) {
        claimed.add(`block:${anchor.x + dc},${anchor.y + dr}`);
      }
    }
  }

  for (const boardwalk of boardwalks) {
    for (const abutment of boardwalk.abutments) {
      claimed.add(`block:${abutment.column},${abutment.row}`);
    }
  }

  const tileAt = (column: number, row: number): WarmSpringsTile | null => (
    column < 0 || row < 0 || column >= SPRINGS_COLUMNS || row >= SPRINGS_ROWS
      ? null
      : tiles[row * SPRINGS_COLUMNS + column]
  );

  // Rim lips: wherever a pool-family tile meets non-pool ground to its
  // south, the terrace steps down. Decoration only - the tile is already
  // blocked (pool/poolrim), exactly like Nirvana's scarp faces on rock.
  const isPoolFamily = (column: number, row: number): boolean => {
    const material = tileAt(column, row)?.material;
    return material === "poolhot" || material === "pool" || material === "poolrim";
  };
  for (let row = 0; row < SPRINGS_ROWS; row += 1) {
    for (let column = 0; column < SPRINGS_COLUMNS; column += 1) {
      if (!isPoolFamily(column, row) || isPoolFamily(column, row + 1)) continue;
      const westEdge = isPoolFamily(column - 1, row) && !isPoolFamily(column - 1, row + 1);
      const eastEdge = isPoolFamily(column + 1, row) && !isPoolFamily(column + 1, row + 1);
      const westSteps = isPoolFamily(column - 1, row + 1);
      const eastSteps = isPoolFamily(column + 1, row + 1);
      const species = westEdge && eastEdge
        ? "rimface"
        : westSteps || eastSteps ? "rimcornerin" : "rimcornerout";
      const variants = species === "rimface" ? 4 : 2;
      const variant = Math.floor(hash2(column, row, 1301) * variants) % variants;
      props.push(makeProp(
        `rim:${column},${row}`,
        `s.${species}.${variant}`,
        species,
        column * SPRINGS_TILE_SIZE + SPRINGS_TILE_SIZE / 2
          + (hash2(column, row, 1303) - 0.5) * 8,
        row * SPRINGS_TILE_SIZE + SPRINGS_TILE_SIZE + 12,
        false,
      ));
    }
  }

  // Vent landmarks: the hero sintercone plus a signature steam plume above it.
  geometry.ventLandmarks.forEach((vent, index) => {
    const footX = vent.x * SPRINGS_TILE_SIZE;
    const footY = vent.y * SPRINGS_TILE_SIZE;
    const coneVariant = index % 2;
    props.push(makeProp(
      `vent:${index}:cone`,
      `s.sintercone.${coneVariant}`,
      "sintercone",
      footX,
      footY,
      false,
    ));
    const steamVariant = index % 4;
    props.push(makeProp(
      `vent:${index}:steam`,
      `s.steam.${steamVariant}`,
      "steam",
      footX,
      footY - 30,
      false,
    ));
  });

  // Rift nodes (composition C only): mud pots and fumaroles along the fault.
  geometry.riftNodes.forEach((node, index) => {
    const footX = node.x * SPRINGS_TILE_SIZE;
    const footY = node.y * SPRINGS_TILE_SIZE;
    if (index % 2 === 0) {
      const variant = Math.floor(hash2(index, 1, 1601) * 3) % 3;
      props.push(makeProp(`rift:${index}:mud`, `s.mudpot.${variant}`, "mudpot", footX, footY, false));
    } else {
      const variant = Math.floor(hash2(index, 2, 1607) * 2) % 2;
      props.push(makeProp(
        `rift:${index}:fumarole`,
        `s.fumarole.${variant}`,
        "fumarole",
        footX,
        footY,
        false,
      ));
    }
    const steamVariant = (index + 1) % 3;
    props.push(makeProp(
      `rift:${index}:steam`,
      `s.steamsmall.${steamVariant}`,
      "steamsmall",
      footX + 10,
      footY - 14,
      false,
    ));
  });

  for (const species of SPECIES) {
    for (const candidate of candidatePositions(species)) {
      const tile = tileAt(candidate.column, candidate.row);
      if (tile === null) continue;
      if (!species.on.includes(tile.material)) continue;
      const key = `${species.id}:${candidate.column},${candidate.row}`;
      if (claimed.has(key)) continue;
      if (species.blocks) {
        const occupancy = `block:${candidate.column},${candidate.row}`;
        if (claimed.has(occupancy) || tile.blocked) continue;
        claimed.add(occupancy);
      }
      claimed.add(key);
      const footX = candidate.column * SPRINGS_TILE_SIZE + SPRINGS_TILE_SIZE / 2 + candidate.offsetX;
      const footY = candidate.row * SPRINGS_TILE_SIZE + SPRINGS_TILE_SIZE / 2 + candidate.offsetY;
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

  // Boardwalks: deck run, handrail posts every third tile, ramp + post at
  // each abutment. Mirrors the Nirvana bridge prop pass exactly.
  for (const boardwalk of boardwalks) {
    const horizontal = boardwalk.axis === "east-west";
    const suffix = horizontal ? "h" : "v";
    for (const ref of boardwalk.deck) {
      const variant = Math.floor(hash2(ref.column, ref.row, 1511) * 2) % 2;
      props.push(makeProp(
        `walk:${boardwalk.id}:${ref.column},${ref.row}`,
        `s.walk${suffix}.${variant}`,
        `walk${suffix}`,
        ref.column * SPRINGS_TILE_SIZE + SPRINGS_TILE_SIZE / 2,
        ref.row * SPRINGS_TILE_SIZE + SPRINGS_TILE_SIZE - 1,
        false,
      ));
    }
    boardwalk.deck.forEach((ref, index) => {
      if (index % 3 !== 1) return;
      const variant = Math.floor(hash2(ref.column, ref.row, 1543) * 2) % 2;
      props.push(makeProp(
        `walkpost:${boardwalk.id}:${ref.column},${ref.row}`,
        `s.walkpost.${variant}`,
        "walkpost",
        ref.column * SPRINGS_TILE_SIZE + SPRINGS_TILE_SIZE / 2,
        ref.row * SPRINGS_TILE_SIZE + SPRINGS_TILE_SIZE - 1,
        false,
      ));
    });
    for (const ref of boardwalk.abutments) {
      const rampSuffix = horizontal ? "h" : "v";
      props.push(makeProp(
        `walkramp:${boardwalk.id}:${ref.column},${ref.row}`,
        `s.walkramp${rampSuffix}.0`,
        `walkramp${rampSuffix}`,
        ref.column * SPRINGS_TILE_SIZE + SPRINGS_TILE_SIZE / 2,
        ref.row * SPRINGS_TILE_SIZE + SPRINGS_TILE_SIZE - 1,
        false,
      ));
    }
  }

  props.sort((left, right) => left.footY - right.footY
    || left.footX - right.footX
    || left.id.localeCompare(right.id));
  return props;
}

// ---------------------------------------------------------------------------
// composition data
// ---------------------------------------------------------------------------

const RING_SEED_A = 0x77a1;
const RING_SEED_B = 0x77b2;
const RING_SEED_C = 0x77c3;

/** Jitter a hand-authored control polyline so it reads as organic, not ruled. */
function jitterControlPoints(
  points: readonly Point[],
  amplitude: number,
  seed: number,
): Point[] {
  return points.map((point, index) => ({
    x: point.x + (hash2(index, seed, 4001) - 0.5) * 2 * amplitude,
    y: point.y + (hash2(index, seed, 4051) - 0.5) * 2 * amplitude,
  }));
}

/** Wide lobes and thin reaches along a terraced margin - never one constant offset. */
/**
 * Noise-dominant lobing, same reasoning as {@link meanderHalfWidth}: no sine
 * wave, so no repeating period. A broad octave produces a handful of real
 * lobes and pinches around the whole margin (occasionally thin enough to
 * nearly close, per the "nearly pinched out in others" note), a finer octave
 * roughens each lobe's edge so it does not read as a smoothed offset curve.
 */
function lobedWidthModulation(seed: number): (u: number) => number {
  return (u: number): number => {
    // `u` spans the horseshoe's WHOLE ~300-tile perimeter; a "broad" feature
    // at low frequency here still means one lobe every 100+ tiles - far
    // too slow to read as anything but a constant width at any one viewing
    // distance. Scaled so a real lobe or pinch falls roughly every 15-20
    // tiles instead.
    const broad = fbm(u * 16, seed * 0.37, seed + 900, 3) - 0.5;
    const fine = fbm(u * 38, seed * 0.83, seed + 1200, 3) - 0.5;
    return Math.max(0.2, 1 + broad * 1.4 + fine * 0.55);
  };
}

function sinterRimGeometry(): CompositionGeometry {
  const horseshoeControl: readonly Point[] = jitterControlPoints(Object.freeze([
    { x: 9, y: 93 }, { x: 9, y: 84 }, { x: 9, y: 60 }, { x: 9, y: 36 },
    { x: 9, y: 14 }, { x: 30, y: 9 }, { x: 48, y: 8 }, { x: 66, y: 9 },
    { x: 87, y: 14 }, { x: 87, y: 36 }, { x: 87, y: 60 }, { x: 87, y: 84 },
    { x: 87, y: 93 },
  ]), 1.6, RING_SEED_A);
  const lagoonControl: readonly Point[] = jitterControlPoints(Object.freeze([
    { x: 4, y: 87 }, { x: 20, y: 88 }, { x: 40, y: 89 }, { x: 56, y: 89 },
    { x: 72, y: 88 }, { x: 92, y: 87 },
  ]), 1.4, RING_SEED_A + 1);
  const terraces: readonly TerraceSpec[] = Object.freeze([
    {
      id: "horseshoe", kind: "spline", samples: sampleSpline(horseshoeControl, 24),
      rings: [
        { material: "poolhot", outer: 0.7 }, { material: "pool", outer: 1.5 },
        { material: "poolrim", outer: 2.1 }, { material: "sinter", outer: 3.4 },
        { material: "travertine", outer: 5.0 },
      ],
      seed: RING_SEED_A, noiseAmount: 0.85,
      widthModulation: lobedWidthModulation(RING_SEED_A),
    },
    {
      id: "lagoon", kind: "spline", samples: sampleSpline(lagoonControl, 20),
      rings: [
        { material: "poolhot", outer: 1.0 }, { material: "pool", outer: 2.0 },
        { material: "poolrim", outer: 2.8 }, { material: "sinter", outer: 4.3 },
        { material: "travertine", outer: 6.2 },
      ],
      seed: RING_SEED_A + 1, noiseAmount: 1.0,
      widthModulation: lobedWidthModulation(RING_SEED_A + 1),
    },
  ]);
  // Every gutter runnel MEANDERS from side to side within its 3-tile-wide
  // corridor and pinches/swells along its run, rather than sitting dead
  // straight on the centreline - the corridor admission gate still clips
  // anything that strays past the district seam, so wandering inside it is
  // free of any plot-safety risk.
  const gutterChannel = (
    axis: "vertical" | "horizontal",
    line: number,
    seed: number,
  ): Channel => {
    const from = axis === "vertical" ? { x: line, y: 0 } : { x: 0, y: line };
    const to = axis === "vertical" ? { x: line, y: 96 } : { x: 96, y: line };
    return meanderChannel(from, to, 14, 0.9, 0.6, 0.35, "pool", "ochre", 0.65, seed);
  };
  const channels: readonly Channel[] = Object.freeze([
    gutterChannel("vertical", 32, RING_SEED_A + 10),
    gutterChannel("vertical", 48, RING_SEED_A + 20),
    gutterChannel("vertical", 64, RING_SEED_A + 30),
    gutterChannel("horizontal", 49, RING_SEED_A + 40),
  ]);
  const boardwalkPlans: readonly BoardwalkPlan[] = Object.freeze([
    { id: "a-ew-north-32", axis: "east-west", line: 30, midstream: 32 },
    { id: "a-ew-south-48", axis: "east-west", line: 65, midstream: 48 },
    { id: "a-ew-north-64", axis: "east-west", line: 60, midstream: 64 },
    { id: "a-ns-street-24", axis: "north-south", line: 36, midstream: 49 },
    { id: "a-ns-street-72", axis: "north-south", line: 73, midstream: 49 },
  ]);
  return {
    channels,
    terraces,
    corridor: SINTER_RIM_CORRIDOR,
    cornerSeed: RING_SEED_A,
    rockHalo: null,
    ventLandmarks: Object.freeze([{ x: 9, y: 20 }, { x: 9, y: 50 }, { x: 9, y: 80 }]),
    riftNodes: Object.freeze([]),
    boardwalkPlans,
    // Aprons fan out from the horseshoe/lagoon path and the runnel lines -
    // never a standalone wash - so the green sward stays the matrix and the
    // district interiors (far from every anchor) stay predominantly green.
    mineralAnchors: Object.freeze([
      ...horseshoeControl, ...lagoonControl,
      { x: 32, y: 24 }, { x: 32, y: 60 }, { x: 48, y: 24 }, { x: 48, y: 60 },
      { x: 64, y: 24 }, { x: 64, y: 60 }, { x: 24, y: 49 }, { x: 72, y: 49 },
    ]),
    mineralReach: 5.0,
    mineralDensity: 0.5,
  };
}

function greatTerraceGeometry(): CompositionGeometry {
  const terraces: readonly TerraceSpec[] = Object.freeze([
    {
      // A genuinely DOMINANT mass, not a corner feature: rings nearly double
      // the pilot's first pass, which measured honest but read as "occupies
      // maybe a tenth of the frame" once rendered. B is the one composition
      // the contract explicitly allows to cost plots for exactly this reason
      // - the toe reaching into district-0 is the idea, not an accident.
      // The blocking core (poolhot/pool/poolrim) stays where it was measured
      // safe; only the WALKABLE outer rings grow further, since travertine
      // and sinter cost nothing - this is how the mass reaches "half the
      // island" scale without touching a single additional plot beyond what
      // was already measured.
      id: "great-terrace", kind: "point", cx: 7, cy: 6,
      flow: { dx: 0.68, dy: 0.74, stretch: 1.9 },
      rings: [
        { material: "poolhot", outer: 1.9 }, { material: "pool", outer: 3.7 },
        { material: "poolrim", outer: 5.2 }, { material: "travertine", outer: 10.0 },
        { material: "sinter", outer: 15.0 }, { material: "travertine", outer: 21.0 },
        { material: "sinter", outer: 28.0 }, { material: "travertine", outer: 36.0 },
      ],
      seed: RING_SEED_B, noiseAmount: 2.6,
    },
    {
      id: "se-lagoon", kind: "point", cx: 89, cy: 90,
      rings: [
        { material: "poolhot", outer: 1.0 }, { material: "pool", outer: 2.2 },
        { material: "poolrim", outer: 3.0 }, { material: "sinter", outer: 4.6 },
        { material: "travertine", outer: 6.4 },
      ],
      seed: RING_SEED_B + 1, noiseAmount: 0.9,
    },
  ]);
  // The outflow WANDERS the whole way rather than tracing a straight L: the
  // control points are jittered off the nominal margin line, and the width
  // pinches to a narrow fissure and swells into pools along the run.
  const outflowControl: readonly Point[] = jitterControlPoints(Object.freeze([
    { x: 18, y: 9 }, { x: 34, y: 8 }, { x: 46, y: 10 }, { x: 55, y: 7 },
    { x: 65, y: 10 }, { x: 74, y: 9 }, { x: 87, y: 12 }, { x: 88, y: 22 },
    { x: 87, y: 30 }, { x: 89, y: 42 }, { x: 88, y: 55 }, { x: 87, y: 67 },
    { x: 88, y: 78 }, { x: 89, y: 88 },
  ]), 1.8, RING_SEED_B + 5);
  const channels: readonly Channel[] = Object.freeze([
    splineChannel(outflowControl, 16, meanderHalfWidth(0.85, 0.5, RING_SEED_B), "pool", "ochre", 0.7),
  ]);
  const boardwalkPlans: readonly BoardwalkPlan[] = Object.freeze([
    { id: "b-ns-north-outflow", axis: "north-south", line: 40, midstream: 9 },
    { id: "b-ew-east-outflow", axis: "east-west", line: 42, midstream: 88 },
  ]);
  return {
    channels,
    terraces,
    corridor: null,
    cornerSeed: RING_SEED_B,
    // A modest scree halo just beyond the great terrace's own outer ring
    // (12.4) - NOT a global texture. Bounded so it stays well short of
    // district-2 (Chebyshev/flow-distance ~31 from the vent), which is what
    // "re-seated into the north-west" means in practice: the identity mass
    // and its texture both stay near (7,6), nowhere else.
    // Kept close to the vent, independent of how far the (non-blocking)
    // travertine/sinter rings now reach: rock is the one blocking texture
    // here, and letting its band track the enlarged terrace outward is
    // exactly what marched it into a different district last time. A modest
    // halo just past the terrace's own BLOCKING rings (poolrim ends at D=5.2,
    // physical ~9.9 tiles) is enough scree texture without the risk.
    rockHalo: {
      cx: 7, cy: 6, flow: { dx: 0.68, dy: 0.74, stretch: 1.9 }, inner: 6.5, outer: 9.5,
    },
    ventLandmarks: Object.freeze([{ x: 7, y: 6 }]),
    riftNodes: Object.freeze([]),
    boardwalkPlans,
    // The most generous apron of the three: B has the smallest concentrated
    // feature, so broad dry-terrace ground fanning out along the outflow's
    // whole course - not just around the vent - is what keeps the rest of
    // the region from reading as empty meadow with one corner of interest.
    mineralAnchors: Object.freeze([{ x: 7, y: 6 }, { x: 89, y: 90 }, ...outflowControl]),
    mineralReach: 11,
    mineralDensity: 0.82,
  };
}

function riftGeometry(): CompositionGeometry {
  // The fault line itself: a real meander (+/-3 tiles, not the old +/-0.6)
  // that pinches to a narrow fissure and swells into pools along its run,
  // never a constant-width bar spanning the region edge to edge.
  const riftControl: readonly Point[] = jitterControlPoints(Object.freeze([
    { x: -4, y: 49 }, { x: 6, y: 47 }, { x: 16, y: 51 }, { x: 24, y: 48 },
    { x: 32, y: 50.5 }, { x: 40, y: 47.5 }, { x: 48, y: 50 }, { x: 56, y: 47.5 },
    { x: 64, y: 50.5 }, { x: 72, y: 48 }, { x: 80, y: 50.5 }, { x: 88, y: 48 },
    { x: 100, y: 49.5 },
  ]), 3.0, RING_SEED_C + 500);
  const channels: readonly Channel[] = Object.freeze([
    splineChannel(
      riftControl, 16, meanderHalfWidth(1.4, 1.3, RING_SEED_C), "pool", "ochre", 0.85,
    ),
    // The tributary fissures. These were `straightChannel` and the plate showed
    // exactly why that could not ship: six ruler-perfect lines from edge to
    // edge, so the region read as a circuit board and a viewer could infer the
    // district grid straight off the terrain. Each is now a meander with a
    // ~1.1-tile lateral amplitude (visible at 32px, where the old +/-0.5 tile
    // wobble was not) and a pinching/swelling width, so no run is a
    // constant-width band. Per-fissure seeds stop the six wandering in unison.
    meanderChannel({ x: 32, y: 0 }, { x: 32, y: 46 }, 6, 1.1, 0.75, 0.35, "pool", "ochre", 0.65, 0x51a3),
    meanderChannel({ x: 32, y: 52 }, { x: 32, y: 96 }, 6, 1.1, 0.75, 0.35, "pool", "ochre", 0.65, 0x51b7),
    meanderChannel({ x: 48, y: 0 }, { x: 48, y: 46 }, 6, 1.1, 0.75, 0.35, "pool", "ochre", 0.65, 0x52c1),
    meanderChannel({ x: 48, y: 52 }, { x: 48, y: 96 }, 6, 1.1, 0.75, 0.35, "pool", "ochre", 0.65, 0x52d9),
    meanderChannel({ x: 64, y: 0 }, { x: 64, y: 46 }, 6, 1.1, 0.75, 0.35, "pool", "ochre", 0.65, 0x53e5),
    meanderChannel({ x: 64, y: 52 }, { x: 64, y: 96 }, 6, 1.1, 0.75, 0.35, "pool", "ochre", 0.65, 0x53f3),
  ]);
  const riftNodeColumns = [10, 25, 40, 56, 72, 88];
  const terraces: readonly TerraceSpec[] = Object.freeze([
    ...riftNodeColumns.map((column, index): TerraceSpec => ({
      id: `rift-node-${index}`, kind: "point", cx: column, cy: 49,
      rings: [
        { material: "poolhot", outer: 0.8 }, { material: "pool", outer: 1.6 },
        { material: "poolrim", outer: 2.2 }, { material: "sinter", outer: 3.2 },
        { material: "travertine", outer: 4.5 },
      ],
      seed: RING_SEED_C + index, noiseAmount: 0.75,
    })),
    {
      id: "se-lagoon", kind: "point", cx: 90, cy: 90,
      rings: [
        { material: "poolhot", outer: 1.0 }, { material: "pool", outer: 2.2 },
        { material: "poolrim", outer: 3.0 }, { material: "sinter", outer: 4.8 },
        { material: "travertine", outer: 6.8 },
      ],
      seed: RING_SEED_C + 100, noiseAmount: 0.9,
    },
  ]);
  const boardwalkPlans: readonly BoardwalkPlan[] = Object.freeze([
    { id: "c-ns-gap-24", axis: "north-south", line: 24, midstream: 49 },
    { id: "c-ns-gap-40", axis: "north-south", line: 40, midstream: 49 },
    { id: "c-ns-gap-56", axis: "north-south", line: 56, midstream: 49 },
    { id: "c-ns-gap-72", axis: "north-south", line: 72, midstream: 49 },
    { id: "c-ew-fissure-32", axis: "east-west", line: 30, midstream: 32 },
    { id: "c-ew-fissure-64", axis: "east-west", line: 65, midstream: 64 },
  ]);
  return {
    channels,
    terraces,
    corridor: RIFT_CORRIDOR,
    cornerSeed: RING_SEED_C,
    rockHalo: null,
    ventLandmarks: Object.freeze([]),
    riftNodes: Object.freeze(riftNodeColumns.map((column) => ({ x: column, y: 49 }))),
    boardwalkPlans,
    // Aprons fan from the rift line and its nodes/lagoon - the district
    // interiors north and south of the fault, far from any anchor, stay
    // predominantly green.
    mineralAnchors: Object.freeze([
      ...riftControl,
      ...riftNodeColumns.map((column) => ({ x: column, y: 49 })),
      { x: 90, y: 90 },
    ]),
    mineralReach: 12.5,
    mineralDensity: 0.76,
  };
}

function geometryFor(compositionId: WarmSpringsCompositionId): CompositionGeometry {
  switch (compositionId) {
    case "a-sinter-rim": return sinterRimGeometry();
    case "b-great-terrace": return greatTerraceGeometry();
    case "c-rift": return riftGeometry();
    default: {
      const exhaustive: never = compositionId;
      throw new WarmSpringsSceneError(`Unknown Warm Springs composition ${String(exhaustive)}.`);
    }
  }
}

// ---------------------------------------------------------------------------
// assembly
// ---------------------------------------------------------------------------

/** Author one of the three Warm Springs pilot compositions. */
export function createWarmSpringsScene(compositionId: WarmSpringsCompositionId): WarmSpringsScene {
  const geometry = geometryFor(compositionId);
  const corners = buildCornerField(geometry);

  let tiles = deriveTiles(corners);
  carveBoardwalkApproaches(corners, resolveBoardwalks(tiles, geometry.boardwalkPlans));
  tiles = deriveTiles(corners);
  const boardwalks = resolveBoardwalks(tiles, geometry.boardwalkPlans);

  tiles = applyBoardwalkDecks(tiles, boardwalks);
  let collision = collisionFrom(tiles);

  for (let pass = 0; pass < 24; pass += 1) {
    const components = walkableComponents(collision, SPRINGS_COLUMNS, SPRINGS_ROWS);
    if (components.length <= 1) break;
    const main = components[0];
    const orphan = components[1];
    if (orphan.tiles.length >= MIN_BOARDWALKED_POCKET_TILES) {
      const { from, to } = nearestPair(main, orphan, SPRINGS_COLUMNS);
      carveCrossing(
        corners,
        { x: from.x + 0.5, y: from.y + 0.5 },
        { x: to.x + 0.5, y: to.y + 0.5 },
        1.2,
      );
    } else {
      sealPocket(corners, orphan, SPRINGS_COLUMNS);
    }
    tiles = applyBoardwalkDecks(deriveTiles(corners), boardwalks);
    collision = collisionFrom(tiles);
  }

  const props = placeProps(tiles, geometry, boardwalks);

  const withProps = Uint8Array.from(collision);
  for (const prop of props) {
    if (!prop.blocks) continue;
    const index = prop.tile.row * SPRINGS_COLUMNS + prop.tile.column;
    if (index >= 0 && index < withProps.length) withProps[index] = 1;
  }

  const keptProps: WarmSpringsProp[] = [...props];
  for (let pass = 0; pass < 40; pass += 1) {
    const components = walkableComponents(withProps, SPRINGS_COLUMNS, SPRINGS_ROWS);
    if (components.length <= 1) break;
    const orphan = components[components.length - 1];
    const orphanTiles = new Set(orphan.tiles);
    let removedIndex = -1;
    for (let index = 0; index < keptProps.length; index += 1) {
      const prop = keptProps[index];
      if (!prop.blocks) continue;
      const propIndex = prop.tile.row * SPRINGS_COLUMNS + prop.tile.column;
      const column = propIndex % SPRINGS_COLUMNS;
      const row = Math.floor(propIndex / SPRINGS_COLUMNS);
      const neighbours = [
        column > 0 ? propIndex - 1 : -1,
        column < SPRINGS_COLUMNS - 1 ? propIndex + 1 : -1,
        row > 0 ? propIndex - SPRINGS_COLUMNS : -1,
        row < SPRINGS_ROWS - 1 ? propIndex + SPRINGS_COLUMNS : -1,
      ];
      if (!neighbours.some((neighbour) => neighbour >= 0 && orphanTiles.has(neighbour))) continue;
      if (collision[propIndex] === 1) continue;
      removedIndex = index;
      break;
    }
    if (removedIndex < 0) {
      for (const index of orphan.tiles) withProps[index] = 1;
      continue;
    }
    const [removed] = keptProps.splice(removedIndex, 1);
    withProps[removed.tile.row * SPRINGS_COLUMNS + removed.tile.column] = 0;
  }

  return Object.freeze({
    compositionId,
    columns: SPRINGS_COLUMNS,
    rows: SPRINGS_ROWS,
    tileSize: SPRINGS_TILE_SIZE,
    widthPixels: SPRINGS_WIDTH_PX,
    heightPixels: SPRINGS_HEIGHT_PX,
    tiles: Object.freeze(tiles),
    collision: withProps,
    props: Object.freeze(keptProps),
    boardwalks: Object.freeze(boardwalks),
    cornerMaterials: Object.freeze(corners),
  });
}
