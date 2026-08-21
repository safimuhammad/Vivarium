/**
 * @fileoverview The Warm Springs terrain field — the ONE source from which both the
 * picture and the walkability mask are derived, so the ground a body cannot enter is
 * exactly the ground drawn as pool, ochre mat, mud, scrub, reed or rock.
 *
 * This is the owner-approved composition **B, "The Great Terrace"**
 * (`.superpowers/sdd/warm-springs-pilot-report.md` §10), promoted from the pilot
 * `qa/warmSpringsPilot/springsScene.ts` with its geometry — vent position, ring radii,
 * flow stretch, outflow control points, rock halo, mineral apron, seeds — carried across
 * UNCHANGED. What the owner approved by eye is what this module builds.
 *
 * Two things changed on the way into production, both structural:
 *
 * 1. **The corridor gate became a protection gate.** The pilot proved plot safety by
 *    admitting blocking materials only inside a hand-declared free-space geometry.
 *    Production does not need to guess that geometry: it can read the REAL mechanics
 *    from the recipe. A corner sample that would be a blocking material is demoted to
 *    walkable sward whenever any of the four tiles touching that corner is protected
 *    (a shelter render footprint, an anchor, a gate, a staging envelope, a door, a path
 *    or soil tile, or an authored scenery placement). Because a tile only blocks at >= 2
 *    blocking corners, a protected tile can then never be blocked — the guarantee is
 *    structural, not a post-hoc repair. This is the rule Nirvana's integration proved
 *    (`.superpowers/sdd/nirvana-live-report.md` §3.1).
 * 2. **Compositions A and C are gone.** Only the approved composition ships.
 *
 * BOARDWALKS keep the pilot's derivation discipline, which is the same one Nirvana's
 * bridges use: a plan names a line and a point known to be in blocked ground; the builder
 * walks outward over the DERIVED tiles and takes the whole contiguous blocked run as the
 * deck. A crossing is therefore always on the banks the water actually has, and can never
 * be drawn over dry ground when the art is retuned. Deck tiles report material `deck`,
 * are WALKABLE, and the pool/mat is still painted underneath them.
 *
 * Terrain reaches movement legality through `navigation/groundTerrain.ts` —
 * `grid.collision` plus the destination-tile check — never through exclusion rects. See
 * that module's header for why the two are different rules, not two approximations of one.
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
} from "./WarmSpringsMaterials";

export const WARM_SPRINGS_COLUMNS = 96;
export const WARM_SPRINGS_ROWS = 96;
export const WARM_SPRINGS_TILE_SIZE = 32;
export const WARM_SPRINGS_WIDTH_PX = WARM_SPRINGS_COLUMNS * WARM_SPRINGS_TILE_SIZE;
export const WARM_SPRINGS_HEIGHT_PX = WARM_SPRINGS_ROWS * WARM_SPRINGS_TILE_SIZE;

/** A walkable pocket smaller than this is sealed rather than boardwalked. */
const MIN_BOARDWALKED_POCKET_TILES = 20;

/**
 * How many times the whole scene may be rebuilt while the connectivity repair carves.
 *
 * Each attempt opens strictly more ground, so this is a safety stop, not a tuning dial.
 */
const MAX_SCENE_ATTEMPTS = 24;

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

/**
 * One built Warm Springs terrain field: the picture (`tiles`, `props`), the mask
 * (`collision`), and the crossings (`boardwalks`) that keep it one component.
 */
export interface WarmSpringsScene {
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
// channels (warm runnels / hot creeks) - reused across compositions
// ---------------------------------------------------------------------------

interface Channel {
  readonly samples: readonly Point[];
  readonly halfWidth: (u: number) => number;
  readonly core: WarmSpringsMaterial;
  readonly fringe: WarmSpringsMaterial | null;
  readonly fringeWidth: number;
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
  readonly cornerSeed: number;
  readonly rockHalo: RockHalo | null;
  readonly ventLandmarks: readonly Point[];
  readonly boardwalkPlans: readonly BoardwalkPlan[];
  /** Real feature points the mineral apron fans out from. */
  readonly mineralAnchors: readonly Point[];
  /** Typical apron reach in tiles before lobing. */
  readonly mineralReach: number;
  /** Apron density right at an anchor, fading to 0 at its edge. */
  readonly mineralDensity: number;
}

function cornerMaterialFor(
  geometry: CompositionGeometry,
  protection: WarmSpringsProtection,
  x: number,
  y: number,
): WarmSpringsMaterial {
  const admits = (material: WarmSpringsMaterial): boolean => (
    !isBlockingMaterial(material) || !cornerTouchesProtectedTile(protection, x, y)
  );

  // The recipe's authored springs come first: they are the one feature this field does
  // not invent, and they are already blocked, so nothing downstream may paint over them.
  if (admits("pool") && cornerIsRecipeWater(protection, x, y)) return "pool";

  const channelMaterial = channelMaterialAt(geometry.channels, x, y);
  if (channelMaterial !== null && admits(channelMaterial)) return channelMaterial;

  const terraceMaterial = terraceField(geometry.terraces, x, y);
  if (terraceMaterial !== null && admits(terraceMaterial)) return terraceMaterial;

  if (geometry.rockHalo !== null && withinRockHalo(geometry.rockHalo, x, y)) {
    const rock = rockMarginAt(x, y, geometry.cornerSeed);
    if (rock !== null && admits(rock)) return rock;
  }

  // Non-blocking, so the protection gate never applies - the mineral apron can
  // spread anywhere, including across districts and shelter plots, at zero
  // walkability cost. This is what carries the region's identity to ground level
  // where beings actually live, which the pilot measured as 128/128 households
  // with a spring in view.
  const stain = mineralApronAt(
    x, y, geometry.cornerSeed, geometry.mineralAnchors, geometry.mineralReach, geometry.mineralDensity,
  );
  if (stain !== null) return stain;

  // Last, so it only ever shows where the ground would have been plain sward.
  if (cornerIsRecipePath(protection, x, y)) return "sinter";

  return backgroundMaterialAt(x, y, geometry.cornerSeed);
}

function cornerIndex(column: number, row: number): number {
  return row * (WARM_SPRINGS_COLUMNS + 1) + column;
}

function buildCornerField(
  geometry: CompositionGeometry,
  protection: WarmSpringsProtection,
): WarmSpringsMaterial[] {
  const corners: WarmSpringsMaterial[] = new Array((WARM_SPRINGS_COLUMNS + 1) * (WARM_SPRINGS_ROWS + 1));
  for (let row = 0; row <= WARM_SPRINGS_ROWS; row += 1) {
    for (let column = 0; column <= WARM_SPRINGS_COLUMNS; column += 1) {
      corners[cornerIndex(column, row)] = cornerMaterialFor(geometry, protection, column, row);
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
        if (column < 0 || row < 0 || column > WARM_SPRINGS_COLUMNS || row > WARM_SPRINGS_ROWS) continue;
        const jitter = (fbm(column * 0.7, row * 0.7, seed, 2) - 0.5) * 0.55;
        if (Math.hypot(column - cx, row - cy) > halfWidth + jitter) continue;
        corners[cornerIndex(column, row)] = material;
        touched.push({ column, row });
      }
    }
  }
  return touched;
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
  const tiles: WarmSpringsTile[] = new Array(WARM_SPRINGS_COLUMNS * WARM_SPRINGS_ROWS);
  for (let row = 0; row < WARM_SPRINGS_ROWS; row += 1) {
    for (let column = 0; column < WARM_SPRINGS_COLUMNS; column += 1) {
      tiles[row * WARM_SPRINGS_COLUMNS + column] = deriveTile(corners, column, row);
    }
  }
  return tiles;
}

function collisionFrom(tiles: readonly WarmSpringsTile[]): Uint8Array {
  const collision = new Uint8Array(WARM_SPRINGS_COLUMNS * WARM_SPRINGS_ROWS);
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

/**
 * Derive one crossing from the material field, or `null` when this line has nothing to
 * cross.
 *
 * @throws {WarmSpringsSceneError} If the blocked run it finds does not reach walkable
 *   ground at both ends within {@link MAX_BOARDWALK_DECK_TILES}.
 */
function resolveBoardwalk(
  tiles: readonly WarmSpringsTile[],
  plan: BoardwalkPlan,
): WarmSpringsBoardwalk | null {
  const limit = plan.axis === "east-west" ? WARM_SPRINGS_COLUMNS : WARM_SPRINGS_ROWS;
  const blockedAt = (position: number): boolean => {
    if (position < 0 || position >= limit) return true;
    const ref = tileRefAlong(plan, position);
    return tiles[ref.row * WARM_SPRINGS_COLUMNS + ref.column].blocked;
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
  // The search widens to the WHOLE line rather than stopping at the deck-length budget.
  // Production's protection mask can legitimately erase the channel exactly at the hint —
  // an authored scenery placement standing in the water demotes the blocking material
  // around it — and a crossing that gives up because the water moved twenty tiles is a
  // brittle crossing. Measured: 3 of 400 sampled run seeds failed to build for exactly
  // this reason before the search was widened.
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
  // Nothing blocked anywhere on this line: the ground is already crossable, so there is
  // no crossing to build. A boardwalk over dry ground is worse than no boardwalk.
  if (midstream === null) return null;

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

/** Every authored crossing that the material field actually gives ground to cross. */
function resolveBoardwalks(
  tiles: readonly WarmSpringsTile[],
  plans: readonly BoardwalkPlan[],
): WarmSpringsBoardwalk[] {
  const resolved: WarmSpringsBoardwalk[] = [];
  for (const plan of plans) {
    const boardwalk = resolveBoardwalk(tiles, plan);
    if (boardwalk !== null) resolved.push(boardwalk);
  }
  return resolved;
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
      const index = ref.row * WARM_SPRINGS_COLUMNS + ref.column;
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
      column: Math.floor(footX / WARM_SPRINGS_TILE_SIZE),
      row: Math.floor(footY / WARM_SPRINGS_TILE_SIZE),
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
    if (column < 1 || row < 1 || column >= WARM_SPRINGS_COLUMNS - 1 || row >= WARM_SPRINGS_ROWS - 1) return;
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
    const cx = hash2(cluster, species.seed, 17) * WARM_SPRINGS_COLUMNS;
    const cy = hash2(cluster, species.seed, 29) * WARM_SPRINGS_ROWS;
    for (let member = 0; member < species.perCluster; member += 1) {
      const angle = hash2(cluster, member, species.seed + 41) * Math.PI * 2;
      const radius = Math.sqrt(hash2(cluster, member, species.seed + 53)) * species.spread;
      push(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, member * 3 + cluster);
    }
  }
  for (let index = 0; index < species.scatter; index += 1) {
    push(
      hash2(index, species.seed, 61) * WARM_SPRINGS_COLUMNS,
      hash2(index, species.seed, 71) * WARM_SPRINGS_ROWS,
      index + 500,
    );
  }
  return out;
}

function placeProps(
  tiles: readonly WarmSpringsTile[],
  geometry: CompositionGeometry,
  protection: WarmSpringsProtection,
  boardwalks: readonly WarmSpringsBoardwalk[],
  causeways: ReadonlySet<string>,
): WarmSpringsProp[] {
  const props: WarmSpringsProp[] = [];
  const claimed = new Set<string>();

  // A tree does not grow where a house goes. Every protected tile - the REAL
  // 128x128 shelter render footprints, anchors, gates, doors, staging
  // envelopes, path and soil tiles, and every authored scenery placement - is
  // pre-claimed as prop-free, so no prop can be candidate-selected onto ground
  // the world's mechanics need. This runs BEFORE placement, so it only ever
  // removes candidates; it cannot itself sever the walkable graph, and the
  // connectivity repair pass after placement re-checks regardless.
  //
  // The pilot did this against a hardcoded copy of the 128 plot coordinates.
  // Production reads them from the recipe, which is both narrower (it is the
  // real geometry) and wider (it also covers anchors, staging and scenery the
  // pilot never saw).
  for (let index = 0; index < protection.protected.length; index += 1) {
    if (protection.protected[index] === 0) continue;
    const column = index % WARM_SPRINGS_COLUMNS;
    const row = Math.floor(index / WARM_SPRINGS_COLUMNS);
    claimed.add(`block:${column},${row}`);
  }

  for (const boardwalk of boardwalks) {
    for (const abutment of boardwalk.abutments) {
      claimed.add(`block:${abutment.column},${abutment.row}`);
    }
  }

  // And nothing grows on a causeway the connectivity repair had to carve.
  //
  // This is the fix for a real defect, found by building every chronicle seed rather than
  // one: a protected tile surrounded by blocking terrain is an island, so the terrain
  // repair bridges it with a walkable sinter causeway — and a blocking prop landing on
  // that causeway severed it again. The prop pass could not undo it (the prop was not
  // cardinally adjacent to the pocket), so the field failed closed on 6 of the 20
  // chronicle seeds, including C14's and C15's. A causeway is infrastructure, exactly
  // like a boardwalk abutment, and nothing is allowed to stand on it.
  for (const key of causeways) claimed.add(`block:${key}`);

  const tileAt = (column: number, row: number): WarmSpringsTile | null => (
    column < 0 || row < 0 || column >= WARM_SPRINGS_COLUMNS || row >= WARM_SPRINGS_ROWS
      ? null
      : tiles[row * WARM_SPRINGS_COLUMNS + column]
  );

  // Rim lips: wherever a pool-family tile meets non-pool ground to its
  // south, the terrace steps down. Decoration only - the tile is already
  // blocked (pool/poolrim), exactly like Nirvana's scarp faces on rock.
  const isPoolFamily = (column: number, row: number): boolean => {
    const material = tileAt(column, row)?.material;
    return material === "poolhot" || material === "pool" || material === "poolrim";
  };
  for (let row = 0; row < WARM_SPRINGS_ROWS; row += 1) {
    for (let column = 0; column < WARM_SPRINGS_COLUMNS; column += 1) {
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
        column * WARM_SPRINGS_TILE_SIZE + WARM_SPRINGS_TILE_SIZE / 2
          + (hash2(column, row, 1303) - 0.5) * 8,
        row * WARM_SPRINGS_TILE_SIZE + WARM_SPRINGS_TILE_SIZE + 12,
        false,
      ));
    }
  }

  // Vent landmarks: the hero sintercone plus a signature steam plume above it.
  geometry.ventLandmarks.forEach((vent, index) => {
    const footX = vent.x * WARM_SPRINGS_TILE_SIZE;
    const footY = vent.y * WARM_SPRINGS_TILE_SIZE;
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
      const footX = candidate.column * WARM_SPRINGS_TILE_SIZE + WARM_SPRINGS_TILE_SIZE / 2 + candidate.offsetX;
      const footY = candidate.row * WARM_SPRINGS_TILE_SIZE + WARM_SPRINGS_TILE_SIZE / 2 + candidate.offsetY;
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
        ref.column * WARM_SPRINGS_TILE_SIZE + WARM_SPRINGS_TILE_SIZE / 2,
        ref.row * WARM_SPRINGS_TILE_SIZE + WARM_SPRINGS_TILE_SIZE - 1,
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
        ref.column * WARM_SPRINGS_TILE_SIZE + WARM_SPRINGS_TILE_SIZE / 2,
        ref.row * WARM_SPRINGS_TILE_SIZE + WARM_SPRINGS_TILE_SIZE - 1,
        false,
      ));
    });
    for (const ref of boardwalk.abutments) {
      const rampSuffix = horizontal ? "h" : "v";
      props.push(makeProp(
        `walkramp:${boardwalk.id}:${ref.column},${ref.row}`,
        `s.walkramp${rampSuffix}.0`,
        `walkramp${rampSuffix}`,
        ref.column * WARM_SPRINGS_TILE_SIZE + WARM_SPRINGS_TILE_SIZE / 2,
        ref.row * WARM_SPRINGS_TILE_SIZE + WARM_SPRINGS_TILE_SIZE - 1,
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

// ---------------------------------------------------------------------------
// assembly
// ---------------------------------------------------------------------------

/**
 * The ground production forbids blocking terrain from ever closing.
 *
 * Row-major over the canonical 96x96 grid, `1` = protected. Built by
 * `WarmSpringsRegionMapRecipe.ts` from the REAL recipe — shelter render footprints,
 * anchors, gates, doors, staging envelopes, path and soil tiles, and authored scenery
 * placements — so the field never has to guess the world's mechanics geometry.
 */
export interface WarmSpringsProtection {
  readonly columns: number;
  readonly rows: number;
  readonly protected: Uint8Array;
  /**
   * The recipe's own authored water bodies (`waterVoidMask`), row-major, `1` = water.
   *
   * These tiles are already hard collision in the generic recipe, so if the terrace
   * vocabulary painted sward over them the picture and the mask would disagree — 28
   * tiles of invisible wall. Sampling them as `pool` at corner level instead makes the
   * region's own authored springs part of the composition, with the same transitions and
   * wet lines as every other pool. The protection gate still applies, so a spring can
   * never widen onto ground the world's mechanics need.
   */
  readonly water: Uint8Array;
  /**
   * The recipe's authored route network (`pathMask`), row-major, `1` = route.
   *
   * Sampled as walkable `sinter` — pale wet mineral crust — but only where the ground
   * would otherwise have been plain sward. A worn track reads on grass and is invisible
   * on stone, which is what a route across a travertine terrace actually looks like; it
   * also means the network never cuts a pale stripe through the terrace banding.
   *
   * The first version of this drew the kit's `spring-boardwalk-route` as real planks on
   * every route tile. It was measured against the approved plate and rejected by eye: the
   * authored network is a stepped lattice, so plank art turned the whole settlement into
   * a scatter of disconnected brown fragments that dominated the frame and read as
   * scaffolding, not a place. The design's own two boardwalks — which DO cross water —
   * still carry plank art, from the scene's own props.
   */
  readonly path: Uint8Array;
}

/** True when any of the four tiles touching corner `(x, y)` is protected. */
function cornerTouchesProtectedTile(
  protection: WarmSpringsProtection,
  x: number,
  y: number,
): boolean {
  const column = Math.round(x);
  const row = Math.round(y);
  for (const [dc, dr] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
    const c = column + dc;
    const r = row + dr;
    if (c < 0 || r < 0 || c >= protection.columns || r >= protection.rows) continue;
    if (protection.protected[r * protection.columns + c] === 1) return true;
  }
  return false;
}

/**
 * True when at least two of the four tiles touching corner `(x, y)` are recipe water.
 *
 * Two, not one: a tile blocks at >= 2 blocking corners, so a one-tile rule would make
 * every tile merely ADJACENT to a spring block as well, silently swallowing a ring of
 * walkable ground around each pool. Requiring two keeps the pool's own tiles pool and
 * leaves its neighbours to the bank materials.
 */
function cornerIsRecipeWater(
  protection: WarmSpringsProtection,
  x: number,
  y: number,
): boolean {
  const column = Math.round(x);
  const row = Math.round(y);
  let count = 0;
  for (const [dc, dr] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
    const c = column + dc;
    const r = row + dr;
    if (c < 0 || r < 0 || c >= protection.columns || r >= protection.rows) continue;
    if (protection.water[r * protection.columns + c] === 1) count += 1;
  }
  return count >= 2;
}

/** True when at least two of the four tiles touching corner `(x, y)` are route tiles. */
function cornerIsRecipePath(
  protection: WarmSpringsProtection,
  x: number,
  y: number,
): boolean {
  const column = Math.round(x);
  const row = Math.round(y);
  let count = 0;
  for (const [dc, dr] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
    const c = column + dc;
    const r = row + dr;
    if (c < 0 || r < 0 || c >= protection.columns || r >= protection.rows) continue;
    if (protection.path[r * protection.columns + c] === 1) count += 1;
  }
  return count >= 2;
}

function isProtectedTile(protection: WarmSpringsProtection, index: number): boolean {
  return protection.protected[index] === 1;
}

/**
 * Build the approved Warm Springs terrain field — composition B, "The Great Terrace".
 *
 * Deterministic: given the same protection mask it returns byte-identical tiles,
 * collision, props and boardwalks. Every seed in the composition is a literal, so the
 * only input that can move the picture is the mechanics geometry it is protecting.
 *
 * Order matters and is the pilot's, unchanged:
 * corner field -> tiles -> resolve boardwalks from the DERIVED blocked runs -> carve
 * their approaches -> re-derive -> lay decks -> repair connectivity -> place props ->
 * repair connectivity again against blocking props.
 *
 * @param protection - Tiles that must never end up blocked.
 * @param baseCollision - The region's collision BEFORE this terrain, row-major, `1` =
 *   blocked. Connectivity is repaired against the COMPOSED mask (base union terrain), not
 *   against the terrain alone: the two together are what a body actually walks, and a
 *   pocket that only exists in the union is exactly the kind a terrain-only repair cannot
 *   see. Measured — without this, terrain that is one component on its own left 1-8 tile
 *   orphans on two of four sampled seeds once composed.
 *
 *   The invariant is deliberately RELATIVE, not absolute: the generic Warm Springs region
 *   is already two walkable components (the mechanics guard ring separates the settled
 *   core from the outer margin except at the four gates). Terrain may not SPLIT any of
 *   those components, and may not close protected ground — but demanding one absolute
 *   component would demand this terrain fix a region shape it did not create.
 * @returns One frozen scene: the picture, the mask, the props and the crossings.
 * @throws {WarmSpringsSceneError} If an authored boardwalk cannot be resolved onto real
 *   banks, or spans more blocked ground than {@link MAX_BOARDWALK_DECK_TILES}.
 */
export function createWarmSpringsScene(
  protection: WarmSpringsProtection,
  baseCollision: Uint8Array,
): WarmSpringsScene {
  if (protection.columns !== WARM_SPRINGS_COLUMNS || protection.rows !== WARM_SPRINGS_ROWS
    || protection.protected.length !== WARM_SPRINGS_COLUMNS * WARM_SPRINGS_ROWS
    || protection.water.length !== WARM_SPRINGS_COLUMNS * WARM_SPRINGS_ROWS
    || protection.path.length !== WARM_SPRINGS_COLUMNS * WARM_SPRINGS_ROWS
    || baseCollision.length !== WARM_SPRINGS_COLUMNS * WARM_SPRINGS_ROWS) {
    throw new WarmSpringsSceneError(
      `Warm Springs protection mask must cover the exact ${WARM_SPRINGS_COLUMNS}x${WARM_SPRINGS_ROWS} region.`,
    );
  }
  const geometry = greatTerraceGeometry();
  const corners = buildCornerField(geometry, protection);
  /** The mask a body actually walks: this terrain unioned onto what was already there. */
  const composed = (terrain: Uint8Array): Uint8Array => {
    const union = Uint8Array.from(terrain);
    for (let index = 0; index < union.length; index += 1) {
      if (baseCollision[index] === 1) union[index] = 1;
    }
    return union;
  };
  // Which pre-existing component every open tile belonged to before this terrain existed.
  const baseLabels = new Int32Array(baseCollision.length).fill(-1);
  walkableComponents(baseCollision, WARM_SPRINGS_COLUMNS, WARM_SPRINGS_ROWS)
    .forEach((component, label) => {
      for (const index of component.tiles) baseLabels[index] = label;
    });
  /**
   * The first SIGNIFICANT split this terrain has made in a pre-existing component, or
   * `null` when there is none left.
   *
   * "Significant" is either an orphan holding protected ground — which must never be
   * stranded, at any size — or an orphan big enough to be worth a crossing. Anything
   * smaller is a scrap of open ground nobody needs and is left exactly as it is.
   *
   * Leaving it is deliberate. The first version SEALED such scraps by writing reed into
   * the corner field, and that fought the carve: sealing a scrap beside a protected tile
   * isolated the protected tile, the next pass carved back to it, and the two operations
   * oscillated until the attempt budget ran out — 17 % of sampled run seeds. With sealing
   * removed the repair only ever OPENS ground, so it is monotone and provably terminates.
   * The generic region already carries 1-3 tile unreachable scraps of its own.
   */
  const firstSplit = (terrain: Uint8Array): {
    main: WarmSpringsComponent;
    orphan: WarmSpringsComponent;
  } | null => {
    const grouped = new Map<number, WarmSpringsComponent[]>();
    for (const component of walkableComponents(
      composed(terrain),
      WARM_SPRINGS_COLUMNS,
      WARM_SPRINGS_ROWS,
    )) {
      const label = baseLabels[component.tiles[0]!]!;
      const siblings = grouped.get(label);
      if (siblings === undefined) grouped.set(label, [component]);
      else siblings.push(component);
    }
    for (const siblings of grouped.values()) {
      if (siblings.length <= 1) continue;
      const main = siblings[0]!;
      for (let index = 1; index < siblings.length; index += 1) {
        const orphan = siblings[index]!;
        if (orphan.tiles.every((tile) => unreachableBeforeTerrain.has(tile))) continue;
        const significant = orphan.tiles.length >= MIN_BOARDWALKED_POCKET_TILES
          || orphan.tiles.some((tile) => isProtectedTile(protection, tile));
        if (significant) return { main, orphan };
      }
    }
    return null;
  };

  /** Every tile the connectivity repair had to carve open; nothing may be built on it. */
  const causeways = new Set<string>();
  /**
   * Open tiles the GENERIC recipe had already walled off from their own component (a ring
   * of blocking scenery around a passive placement, typically). They are not this
   * terrain's doing and no carve can reach them, so they are recorded once and skipped.
   */
  const unreachableBeforeTerrain = new Set<number>();
  /**
   * Open a walkable causeway from `orphan` to `main`, following ground the region itself
   * leaves open.
   *
   * The route is a breadth-first path over tiles that are unblocked in `baseCollision`,
   * NOT a straight line. That distinction is the whole function: the first version carved
   * straight between the nearest pair, and when the two components were diagonal
   * neighbours whose 4-connected route ran through ground the GENERIC recipe had already
   * blocked (a ring of blocking scenery, say), the carve opened terrain that the union
   * kept shut and the repair looped until its attempt budget ran out — 17 % of sampled run
   * seeds. Base collision is not this field's to change, so the causeway has to go where
   * the base leaves room.
   *
   * @returns `true` when a causeway was opened, `false` when no base-open route exists —
   *   in which case the orphan was already unreachable before this terrain and is left be.
   */
  const carveBetween = (
    main: WarmSpringsComponent,
    orphan: WarmSpringsComponent,
  ): boolean => {
    const total = WARM_SPRINGS_COLUMNS * WARM_SPRINGS_ROWS;
    const goals = new Set(main.tiles);
    const cameFrom = new Int32Array(total).fill(-1);
    const seen = new Uint8Array(total);
    const queue: number[] = [];
    for (const tile of orphan.tiles) {
      seen[tile] = 1;
      queue.push(tile);
    }
    let reached = -1;
    for (let head = 0; head < queue.length && reached < 0; head += 1) {
      const index = queue[head]!;
      const column = index % WARM_SPRINGS_COLUMNS;
      const row = Math.floor(index / WARM_SPRINGS_COLUMNS);
      for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const c = column + dc;
        const r = row + dr;
        if (c < 0 || r < 0 || c >= WARM_SPRINGS_COLUMNS || r >= WARM_SPRINGS_ROWS) continue;
        const next = r * WARM_SPRINGS_COLUMNS + c;
        if (seen[next] === 1 || baseCollision[next] === 1) continue;
        seen[next] = 1;
        cameFrom[next] = index;
        if (goals.has(next)) {
          reached = next;
          break;
        }
        queue.push(next);
      }
    }
    if (reached < 0) return false;
    for (let index = reached; index >= 0; index = cameFrom[index]!) {
      const column = index % WARM_SPRINGS_COLUMNS;
      const row = Math.floor(index / WARM_SPRINGS_COLUMNS);
      // All four corners, so the tile is unambiguously open however its neighbours fall.
      for (const [dc, dr] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
        corners[cornerIndex(column + dc, row + dr)] = "sinter";
      }
      // Nothing is ever built on a causeway; a blocking prop here would close it again.
      causeways.add(`${column},${row}`);
    }
    return true;
  };

  let tiles: WarmSpringsTile[] = [];
  let boardwalks: WarmSpringsBoardwalk[] = [];
  let collision: Uint8Array = new Uint8Array(WARM_SPRINGS_COLUMNS * WARM_SPRINGS_ROWS);
  let keptProps: WarmSpringsProp[] = [];
  let withProps: Uint8Array = collision;

  // The scene is settled by re-running the whole build whenever the PROP pass turns out to
  // have stranded protected ground. Each attempt carves strictly more open terrain, so it
  // converges; failing closed instead was measured to reject 12 % of run seeds, which is
  // not acceptable in a world that must run forever on any seed.
  let settled = false;
  for (let attempt = 0; attempt < MAX_SCENE_ATTEMPTS && !settled; attempt += 1) {
    tiles = deriveTiles(corners);
    carveBoardwalkApproaches(corners, resolveBoardwalks(tiles, geometry.boardwalkPlans));
    tiles = deriveTiles(corners);
    boardwalks = resolveBoardwalks(tiles, geometry.boardwalkPlans);

    tiles = applyBoardwalkDecks(tiles, boardwalks);
    collision = collisionFrom(tiles);

    for (let pass = 0; pass < 60; pass += 1) {
      const split = firstSplit(collision);
      if (split === null) break;
      carveBetween(split.main, split.orphan);
      tiles = applyBoardwalkDecks(deriveTiles(corners), boardwalks);
      collision = collisionFrom(tiles);
    }

    const props = placeProps(tiles, geometry, protection, boardwalks, causeways);
    withProps = Uint8Array.from(collision);
    for (const prop of props) {
      if (!prop.blocks) continue;
      const index = prop.tile.row * WARM_SPRINGS_COLUMNS + prop.tile.column;
      if (index >= 0 && index < withProps.length) withProps[index] = 1;
    }

    keptProps = [...props];
    // When no prop removal can join a pocket, the pocket is bounded by TERRAIN, so the
    // terrain has to change and the whole scene must be rebuilt from the corner field.
    // Repairing it in the mask alone (the first version of this) silently disagreed with
    // the picture — walkable ground drawn as a pool — and, worse, could seal the ground
    // beside a protected tile and strand it, which is exactly how 12 % of sampled run
    // seeds ended up unbuildable.
    let rebuild = false;
    for (let pass = 0; pass < 80; pass += 1) {
      const split = firstSplit(withProps);
      if (split === null) break;
      const orphan = split.orphan;
      const orphanTiles = new Set(orphan.tiles);
      let removedIndex = -1;
      for (let index = 0; index < keptProps.length; index += 1) {
        const prop = keptProps[index]!;
        if (!prop.blocks) continue;
        const propIndex = prop.tile.row * WARM_SPRINGS_COLUMNS + prop.tile.column;
        const column = propIndex % WARM_SPRINGS_COLUMNS;
        const row = Math.floor(propIndex / WARM_SPRINGS_COLUMNS);
        const neighbours = [
          column > 0 ? propIndex - 1 : -1,
          column < WARM_SPRINGS_COLUMNS - 1 ? propIndex + 1 : -1,
          row > 0 ? propIndex - WARM_SPRINGS_COLUMNS : -1,
          row < WARM_SPRINGS_ROWS - 1 ? propIndex + WARM_SPRINGS_COLUMNS : -1,
        ];
        if (!neighbours.some((neighbour) => neighbour >= 0 && orphanTiles.has(neighbour))) continue;
        if (collision[propIndex] === 1) continue;
        removedIndex = index;
        break;
      }
      if (removedIndex < 0) {
        // Bounded by terrain rather than by props, so the terrain has to give: carve a
        // causeway and rebuild the whole scene, which re-places props with the new
        // causeway claimed as build-free ground.
        if (!carveBetween(split.main, orphan)) {
          for (const tile of orphan.tiles) unreachableBeforeTerrain.add(tile);
        }
        rebuild = true;
        break;
      }
      const [removed] = keptProps.splice(removedIndex, 1);
      withProps[removed!.tile.row * WARM_SPRINGS_COLUMNS + removed!.tile.column] = 0;
    }
    if (!rebuild) settled = true;
  }
  if (!settled) {
    throw new WarmSpringsSceneError(
      `Warm Springs terrain did not settle in ${MAX_SCENE_ATTEMPTS} attempts.`,
    );
  }

  return Object.freeze({
    columns: WARM_SPRINGS_COLUMNS,
    rows: WARM_SPRINGS_ROWS,
    tileSize: WARM_SPRINGS_TILE_SIZE,
    widthPixels: WARM_SPRINGS_WIDTH_PX,
    heightPixels: WARM_SPRINGS_HEIGHT_PX,
    tiles: Object.freeze(tiles),
    collision: withProps,
    props: Object.freeze(keptProps),
    boardwalks: Object.freeze(boardwalks),
    cornerMaterials: Object.freeze(corners),
  });
}

/**
 * A stable eight-hex digest of everything a Warm Springs scene draws and blocks.
 *
 * Carried in the recipe's `presentationProfile.staticSceneHash`, which is what binds a
 * persisted recipe to the exact picture it was built from: a scene that has drifted
 * fails to load rather than rendering different art under the same identity.
 */
export function warmSpringsSceneHash(scene: WarmSpringsScene): string {
  let hash = 2166136261 >>> 0;
  const feed = (text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  };
  for (const tile of scene.tiles) {
    feed(`${tile.base}.${tile.baseVariant}|${tile.material}|${tile.blocked ? 1 : 0}|`);
    for (const overlay of tile.overlays) feed(`e${overlay.material}.${overlay.mask}.${overlay.variant}`);
    for (const shore of tile.shorelines) feed(`w${shore.material}.${shore.mask}.${shore.variant}`);
    feed(";");
  }
  for (const prop of scene.props) feed(`${prop.id}@${prop.frameId}@${prop.x},${prop.y};`);
  for (const boardwalk of scene.boardwalks) {
    feed(`${boardwalk.id}:${boardwalk.axis}:${boardwalk.deck.length};`);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
