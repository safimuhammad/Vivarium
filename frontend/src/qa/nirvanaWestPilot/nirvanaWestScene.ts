/**
 * Authors the Nirvana West design PILOT scene (`ash_waste` archetype).
 * Sibling of `warmSpringsPilot/springsScene.ts` and `nirvanaValleyPilot/valleyScene.ts`:
 * a LAB surface with the same discipline — two facts come from ONE source, so the
 * terrain a being cannot enter is exactly the terrain drawn as ember, brine, clinker,
 * scree, or rime.
 *
 * TWO things make this region's construction different from its siblings, both
 * load-bearing rather than cosmetic:
 *
 * 1. **The region is a torus, by construction.** Every distance, every noise lookup,
 *    every flood-fill neighbour query and every carved repair uses WRAPPED deltas
 *    (`wrapDelta`) or wrapped positions (`wrapPos`). The 97x97 corner lattice's far
 *    edge is never independently authored — corner (96, y) and (x, 96) are always
 *    evaluated with the SAME reduced coordinate as corner (0, y) / (x, 0)
 *    (`buildCornerField` reduces every sample to `column % 96, row % 96` before
 *    calling a composition's material function), and every noise primitive used for
 *    texture (`toroidalFbm`) is genuinely periodic on a lattice whose period divides
 *    96, so the field also tiles smoothly a few tiles either side of the seam, not
 *    just exactly AT it. {@link verifyToroidalSeam} is the headline proof.
 *
 * 2. **Plot safety is reached by DEMOTION, not by a corridor gate.** Warm Springs
 *    gated blocking materials out of free-space corridors before they could ever
 *    reach a corner near a shelter plot. This region's contract instead lets every
 *    composition paint its blocking mass wherever the field wants it, and then
 *    substitutes `demotedMaterial(m)` — the walkable stand-in of the same visual
 *    family — onto exactly the corners the 128 shelter plots' 5x5 footprints touch.
 *    The picture stays continuous; only the collision differs. This demotes the
 *    COLLISION, never the colour: only the ~2,600 corners inside a plot footprint
 *    are ever touched, so the settlement's district interiors keep the composition's
 *    full, undemoted identity coloring. `demotedTiles` (measured against the RAW,
 *    pre-demotion field) reports how many footprint tiles would have been lost
 *    without the substitution — how hard each composition fights the fixed grid.
 *
 * CAUSEWAYS are this region's boardwalk-equivalent: a plan names a line and a
 * position known to be in blocked ground (a HINT, not an assertion — the search
 * walks outward from it), the builder takes the contiguous blocked run as the deck,
 * and the deck reports material `causeway` (never sampled in the corner field,
 * exactly like Warm Springs' `deck`) while the terrain underneath is remembered in
 * `deckOver`. Because the region is a torus, causeway search and the generic
 * connectivity-repair carves both walk in unbounded position space and wrap via
 * `wrapPos`/`wrapDelta` rather than clamping at a rim that does not exist.
 */

import {
  BLOCKING_NIRVANA_WEST_MATERIALS,
  demotedMaterial,
  hasRimSet,
  isBlockingMaterial,
  isVoidMaterial,
  NIRVANA_WEST_BASE_VARIANTS,
  NIRVANA_WEST_EDGE_VARIANTS,
  NIRVANA_WEST_MATERIAL_PRIORITY,
  PLAIN_TIERS,
  type NirvanaWestMaterial,
} from "./nirvanaWestMaterials";

export const NIRVANA_WEST_COLUMNS = 96;
export const NIRVANA_WEST_ROWS = 96;
export const NIRVANA_WEST_TILE_SIZE = 32;
export const NIRVANA_WEST_WIDTH_PX = NIRVANA_WEST_COLUMNS * NIRVANA_WEST_TILE_SIZE;
export const NIRVANA_WEST_HEIGHT_PX = NIRVANA_WEST_ROWS * NIRVANA_WEST_TILE_SIZE;

export type NirvanaWestCompositionId =
  | "a-ashfall-drifts"
  | "b-ember-rift"
  | "c-shattered-pavement";

export const NIRVANA_WEST_COMPOSITION_IDS: readonly NirvanaWestCompositionId[] = Object.freeze([
  "a-ashfall-drifts",
  "b-ember-rift",
  "c-shattered-pavement",
]);

/** A walkable pocket smaller than this is sealed rather than causewayed shut. */
const MIN_REPAIR_POCKET_TILES = 20;

/** Generic orphan-component stitching passes (corner-level carves). */
const MAX_CONNECTIVITY_PASSES = 96;

/** Prop-removal passes that trade a blocking prop for connectivity. */
const MAX_PROP_REPAIR_PASSES = 60;

/** How far a causeway search looks either side of its hint before giving up. */
const MAX_CAUSEWAY_SEARCH = 24;

/** Raised when an authored composition cannot be built as specified. */
export class NirvanaWestSceneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NirvanaWestSceneError";
  }
}

export interface NirvanaWestTileOverlay {
  readonly material: NirvanaWestMaterial;
  /** Corner mask, bit 1 = NW, 2 = NE, 4 = SE, 8 = SW - matches the art script. */
  readonly mask: number;
  readonly variant: number;
}

export interface NirvanaWestTileRim {
  readonly material: NirvanaWestMaterial;
  readonly mask: number;
  readonly variant: number;
}

export interface NirvanaWestTile {
  readonly column: number;
  readonly row: number;
  readonly base: NirvanaWestMaterial;
  readonly baseVariant: number;
  readonly overlays: readonly NirvanaWestTileOverlay[];
  readonly rims: readonly NirvanaWestTileRim[];
  readonly material: NirvanaWestMaterial;
  readonly blocked: boolean;
  readonly causewayDeck: boolean;
  readonly deckOver: NirvanaWestMaterial | null;
}

export type NirvanaWestTileRef = Readonly<{ column: number; row: number }>;

export type NirvanaWestCrossingAxis = "east-west" | "north-south";

export interface NirvanaWestCrossing {
  readonly id: string;
  readonly axis: NirvanaWestCrossingAxis;
  readonly deck: readonly NirvanaWestTileRef[];
  readonly abutments: readonly NirvanaWestTileRef[];
}

export interface NirvanaWestProp {
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
 * Mirrors production's `AnimatedEnvironmentPlacement.kind` vocabulary
 * (`RegionMapRecipe.ts:209-214`) for this region's four fire/smoke/haze roles.
 */
export type NirvanaWestAnimatedKind = "ember" | "ember-vent" | "smoke-anchor" | "heat-haze";

/**
 * One animated environment placement. Deliberately carries no frame/phase
 * state of its own beyond `phaseSeed` - phase is resolved STATELESSLY at draw
 * time from `phaseSeed` and the clock, exactly like production's
 * `EnvironmentSystem.ts` `phaseIndex` (see `nirvanaWestPainter.ts`).
 */
export interface NirvanaWestAnimatedPlacement {
  readonly id: string;
  readonly kind: NirvanaWestAnimatedKind;
  readonly tile: NirvanaWestTileRef;
  /** Non-negative integer; folds into the production phase formula. */
  readonly phaseSeed: number;
}

export interface NirvanaWestScene {
  readonly compositionId: NirvanaWestCompositionId;
  /** Which ruin vocabulary this scene was dressed with. */
  readonly ruinKit: NirvanaWestRuinKit;
  readonly columns: number;
  readonly rows: number;
  readonly tileSize: number;
  readonly widthPixels: number;
  readonly heightPixels: number;
  readonly tiles: readonly NirvanaWestTile[];
  readonly collision: Uint8Array;
  readonly props: readonly NirvanaWestProp[];
  readonly causeways: readonly NirvanaWestCrossing[];
  readonly cornerMaterials: readonly NirvanaWestMaterial[];
  /**
   * Footprint tiles (of the 128 shelter plots' 3,200 tile-instances, deduplicated)
   * whose RAW, pre-demotion material would have been blocking. This is the cost the
   * demotion pass paid on this composition's behalf — how hard it fights the grid.
   */
  readonly demotedTiles: number;
  /** Fire/smoke/heat-haze placements - the animated environment layer (contract §4). */
  readonly animatedEnvironment: readonly NirvanaWestAnimatedPlacement[];
}

export interface ToroidalSeamReport {
  readonly northSouth: boolean;
  readonly eastWest: boolean;
  readonly mismatches: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

// ---------------------------------------------------------------------------
// toroidal primitives
// ---------------------------------------------------------------------------

/** Canonicalize `value` into `[0, extent)`. */
function wrapPos(value: number, extent: number): number {
  return ((value % extent) + extent) % extent;
}

/** The shortest signed displacement from `b` to `a` on a period-`extent` circle. */
function wrapDelta(a: number, b: number, extent: number): number {
  const d = (((a - b) % extent) + extent) % extent;
  return d > extent / 2 ? d - extent : d;
}

/** The fractional part of `value`, always in `[0, 1)`. */
function wrapUnit(value: number): number {
  return ((value % 1) + 1) % 1;
}

function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 0x27d4_eb2d) ^ Math.imul(y | 0, 0x1656_67b1)
    ^ Math.imul(seed | 0, 0x9e37_79b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85eb_ca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2_ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffff_ffff;
}

/** `hash2` over a lattice cell reduced modulo `period` first — the periodic twin. */
function periodicHash2(xi: number, yi: number, seed: number, period: number): number {
  return hash2(wrapPos(xi, period), wrapPos(yi, period), seed);
}

function periodicValueNoise(x: number, y: number, seed: number, period: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = periodicHash2(xi, yi, seed, period);
  const b = periodicHash2(xi + 1, yi, seed, period);
  const c = periodicHash2(xi, yi + 1, seed, period);
  const d = periodicHash2(xi + 1, yi + 1, seed, period);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/**
 * A genuinely toroidal fbm: every octave's lattice period must divide
 * {@link NIRVANA_WEST_COLUMNS} (96), so the whole field — not just its exact
 * boundary samples — tiles seamlessly across both wrap seams. This is the fix for
 * Warm Springs' `fbm`, which is deterministic but NOT spatially periodic: folding
 * its input to `x % 96` would make corner(96) == corner(0) exactly (same call,
 * same result) while leaving the texture either side of the seam uncorrelated —
 * a visible seam line even though the boundary lattice points technically agree.
 */
function toroidalFbm(x: number, y: number, seed: number, periods: readonly number[]): number {
  let sum = 0;
  let amplitude = 0.5;
  let norm = 0;
  for (let index = 0; index < periods.length; index += 1) {
    const period = periods[index];
    if (NIRVANA_WEST_COLUMNS % period !== 0) {
      throw new NirvanaWestSceneError(
        `toroidalFbm period ${period} does not divide ${NIRVANA_WEST_COLUMNS} - the field would `
        + "not tile exactly across the wrap seam.",
      );
    }
    const scale = period / NIRVANA_WEST_COLUMNS;
    sum += amplitude * periodicValueNoise(x * scale, y * scale, seed + index * 101, period);
    norm += amplitude;
    amplitude *= 0.5;
  }
  return sum / norm;
}

/** 1D value noise over a progress parameter `t` (not spatial - no periodicity needed). */
function valueNoise1D(t: number, seed: number): number {
  const ti = Math.floor(t);
  const tf = t - ti;
  const u = tf * tf * (3 - 2 * tf);
  const a = hash2(ti, 0, seed);
  const b = hash2(ti + 1, 0, seed);
  return a * (1 - u) + b * u;
}

function fbm1D(t: number, seed: number, octaves = 3): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let index = 0; index < octaves; index += 1) {
    sum += amplitude * valueNoise1D(t * frequency, seed + index * 97);
    norm += amplitude;
    frequency *= 2;
    amplitude *= 0.5;
  }
  return sum / norm;
}

/** Deterministic seeded PRNG (mulberry32) for structures that need a long draw sequence. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randRange(rng: () => number, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

/** A coarse, smoothly-patchy 50/50 pick between two materials — never per-corner dither. */
function bandPick(
  x: number,
  y: number,
  seed: number,
  a: NirvanaWestMaterial,
  b: NirvanaWestMaterial,
): NirvanaWestMaterial {
  return toroidalFbm(x, y, seed, [12, 24]) > 0.5 ? a : b;
}

// ---------------------------------------------------------------------------
// corner lattice
// ---------------------------------------------------------------------------

function cornerIndex(column: number, row: number): number {
  return row * (NIRVANA_WEST_COLUMNS + 1) + column;
}

/**
 * Builds the 97x97 corner lattice by reducing every sample to `column % 96,
 * row % 96` before calling the composition's material function. Corner column 96
 * therefore issues the IDENTICAL call as corner column 0 (96 % 96 === 0), and
 * likewise for row 96 vs. row 0 - the periodicity the torus requires holds by
 * construction, not by a later patch.
 */
function buildCornerField(
  materialAt: (x: number, y: number) => NirvanaWestMaterial,
): NirvanaWestMaterial[] {
  const corners: NirvanaWestMaterial[] = new Array(
    (NIRVANA_WEST_COLUMNS + 1) * (NIRVANA_WEST_ROWS + 1),
  );
  for (let row = 0; row <= NIRVANA_WEST_ROWS; row += 1) {
    for (let column = 0; column <= NIRVANA_WEST_COLUMNS; column += 1) {
      const cx = column % NIRVANA_WEST_COLUMNS;
      const cy = row % NIRVANA_WEST_ROWS;
      corners[cornerIndex(column, row)] = materialAt(cx, cy);
    }
  }
  return corners;
}

/**
 * Write one corner, mirroring the write to its periodic twin whenever the write
 * lands on column/row 0 or 96. Every POST-build mutation (causeway repair carves,
 * pocket seals, plot demotion) must go through this — a raw `corners[i] = m`
 * write at the rim would silently break the seam invariant {@link
 * verifyToroidalSeam} checks for.
 */
function setCornerMaterial(
  corners: NirvanaWestMaterial[],
  column: number,
  row: number,
  material: NirvanaWestMaterial,
): void {
  const cc = wrapPos(column, NIRVANA_WEST_COLUMNS);
  const cr = wrapPos(row, NIRVANA_WEST_ROWS);
  corners[cornerIndex(cc, cr)] = material;
  if (cc === 0) corners[cornerIndex(NIRVANA_WEST_COLUMNS, cr)] = material;
  if (cr === 0) corners[cornerIndex(cc, NIRVANA_WEST_ROWS)] = material;
  if (cc === 0 && cr === 0) corners[cornerIndex(NIRVANA_WEST_COLUMNS, NIRVANA_WEST_ROWS)] = material;
}

/**
 * Proves the torus holds: corner (96, y) must equal corner (0, y) for every row,
 * and corner (x, 96) must equal corner (x, 0) for every column. Because every tile
 * is derived by directly indexing this SAME 97-wide corner array (no separate
 * wrap-around lookup), this single check is the complete seam-continuity proof -
 * if it holds, every tile derived using a rim corner sees exactly the value its
 * wrapped neighbour across the seam would.
 */
export function verifyToroidalSeam(scene: NirvanaWestScene): ToroidalSeamReport {
  let eastWestMismatches = 0;
  for (let row = 0; row <= NIRVANA_WEST_ROWS; row += 1) {
    if (
      scene.cornerMaterials[cornerIndex(0, row)]
      !== scene.cornerMaterials[cornerIndex(NIRVANA_WEST_COLUMNS, row)]
    ) {
      eastWestMismatches += 1;
    }
  }
  let northSouthMismatches = 0;
  for (let column = 0; column <= NIRVANA_WEST_COLUMNS; column += 1) {
    if (
      scene.cornerMaterials[cornerIndex(column, 0)]
      !== scene.cornerMaterials[cornerIndex(column, NIRVANA_WEST_ROWS)]
    ) {
      northSouthMismatches += 1;
    }
  }
  return {
    eastWest: eastWestMismatches === 0,
    northSouth: northSouthMismatches === 0,
    mismatches: eastWestMismatches + northSouthMismatches,
  };
}

// ---------------------------------------------------------------------------
// tile derivation (identical discipline to the Warm Springs / Nirvana pilots)
// ---------------------------------------------------------------------------

function tileVariant(column: number, row: number, salt: number, count: number): number {
  if (count <= 0) return 0;
  return Math.floor(hash2(column, row, 0x2468 + salt) * count) % count;
}

function deriveTile(
  corners: readonly NirvanaWestMaterial[],
  column: number,
  row: number,
): NirvanaWestTile {
  const cornerMaterials: readonly NirvanaWestMaterial[] = [
    corners[cornerIndex(column, row)],
    corners[cornerIndex(column + 1, row)],
    corners[cornerIndex(column + 1, row + 1)],
    corners[cornerIndex(column, row + 1)],
  ];
  const priorities = cornerMaterials.map((material) => NIRVANA_WEST_MATERIAL_PRIORITY[material]);
  const basePriority = Math.min(...priorities);
  const base = cornerMaterials[priorities.indexOf(basePriority)];

  const present = [...new Set(cornerMaterials)]
    .filter((material) => NIRVANA_WEST_MATERIAL_PRIORITY[material] > basePriority)
    .sort((left, right) => (
      NIRVANA_WEST_MATERIAL_PRIORITY[left] - NIRVANA_WEST_MATERIAL_PRIORITY[right]
    ));

  const overlays: NirvanaWestTileOverlay[] = [];
  const rims: NirvanaWestTileRim[] = [];
  const baseIsVoid = isVoidMaterial(base);
  for (const material of present) {
    const threshold = NIRVANA_WEST_MATERIAL_PRIORITY[material];
    let mask = 0;
    for (let corner = 0; corner < 4; corner += 1) {
      if (priorities[corner] >= threshold) mask |= 1 << corner;
    }
    if (mask === 0) continue;
    const salt = NIRVANA_WEST_MATERIAL_PRIORITY[material] * 31 + mask;
    const variant = mask === 15
      ? tileVariant(column, row, salt, NIRVANA_WEST_BASE_VARIANTS)
      : tileVariant(column, row, salt, NIRVANA_WEST_EDGE_VARIANTS[material]);
    overlays.push({ material, mask, variant });
    if (baseIsVoid && mask !== 15 && hasRimSet(material)) {
      rims.push({ material, mask, variant });
    }
  }

  const blockingCorners = cornerMaterials.filter((material) => (
    BLOCKING_NIRVANA_WEST_MATERIALS.includes(material)
  )).length;
  const blocked = blockingCorners >= 2;

  const agreeing = cornerMaterials.filter(
    (candidate) => isBlockingMaterial(candidate) === blocked,
  );
  const tally = new Map<NirvanaWestMaterial, number>();
  for (const candidate of agreeing) {
    tally.set(candidate, (tally.get(candidate) ?? 0) + 1);
  }
  let material = agreeing[0];
  let bestCount = -1;
  for (const [candidate, count] of tally) {
    const better = count > bestCount
      || (count === bestCount
        && NIRVANA_WEST_MATERIAL_PRIORITY[candidate] < NIRVANA_WEST_MATERIAL_PRIORITY[material]);
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
      NIRVANA_WEST_MATERIAL_PRIORITY[base],
      NIRVANA_WEST_BASE_VARIANTS,
    ),
    overlays: Object.freeze(overlays),
    rims: Object.freeze(rims),
    material,
    blocked,
    causewayDeck: false,
    deckOver: null,
  });
}

function deriveTiles(corners: readonly NirvanaWestMaterial[]): NirvanaWestTile[] {
  const tiles: NirvanaWestTile[] = new Array(NIRVANA_WEST_COLUMNS * NIRVANA_WEST_ROWS);
  for (let row = 0; row < NIRVANA_WEST_ROWS; row += 1) {
    for (let column = 0; column < NIRVANA_WEST_COLUMNS; column += 1) {
      tiles[row * NIRVANA_WEST_COLUMNS + column] = deriveTile(corners, column, row);
    }
  }
  return tiles;
}

function collisionFrom(tiles: readonly NirvanaWestTile[]): Uint8Array {
  const collision = new Uint8Array(NIRVANA_WEST_COLUMNS * NIRVANA_WEST_ROWS);
  for (let index = 0; index < tiles.length; index += 1) {
    collision[index] = tiles[index].blocked ? 1 : 0;
  }
  return collision;
}

// ---------------------------------------------------------------------------
// connectivity - wrapped 4-neighbour flood fill and wrapped repair carves
// ---------------------------------------------------------------------------

export interface NirvanaWestComponent {
  readonly tiles: readonly number[];
}

/** Four-connected walkable components over a row-major collision mask, WRAPPED at every rim. */
export function walkableComponents(
  collision: Uint8Array,
  columns: number,
  rows: number,
): NirvanaWestComponent[] {
  const seen = new Uint8Array(collision.length);
  const components: NirvanaWestComponent[] = [];
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
      const west = row * columns + ((column - 1 + columns) % columns);
      const east = row * columns + ((column + 1) % columns);
      const north = (((row - 1 + rows) % rows) * columns) + column;
      const south = (((row + 1) % rows) * columns) + column;
      for (const neighbour of [west, east, north, south]) {
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
  left: NirvanaWestComponent,
  right: NirvanaWestComponent,
  columns: number,
  rows: number,
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
      const dx = wrapDelta(ax, bx, columns);
      const dy = wrapDelta(ay, by, rows);
      const distance = dx * dx + dy * dy;
      if (distance < best) {
        best = distance;
        from = { x: ax, y: ay };
        to = { x: bx, y: by };
      }
    }
  }
  return { from, to };
}

/** Paint a walkable repair patch into the corner field along the WRAPPED short path from -> to. */
function carveCrossingCorners(
  corners: NirvanaWestMaterial[],
  from: Point,
  to: Point,
  halfWidth: number,
  material: NirvanaWestMaterial = "cinder",
): void {
  const dx = wrapDelta(to.x, from.x, NIRVANA_WEST_COLUMNS);
  const dy = wrapDelta(to.y, from.y, NIRVANA_WEST_ROWS);
  const length = Math.hypot(dx, dy);
  const steps = Math.max(2, Math.ceil(length * 4));
  const radius = Math.ceil(halfWidth) + 1;
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const cx = from.x + dx * t;
    const cy = from.y + dy * t;
    for (let row = Math.floor(cy - radius); row <= Math.ceil(cy + radius); row += 1) {
      for (let column = Math.floor(cx - radius); column <= Math.ceil(cx + radius); column += 1) {
        const jitter = (
          hash2(wrapPos(column, NIRVANA_WEST_COLUMNS), wrapPos(row, NIRVANA_WEST_ROWS), 0x9f31)
          - 0.5
        ) * 0.55;
        if (Math.hypot(column - cx, row - cy) > halfWidth + jitter) continue;
        setCornerMaterial(corners, column, row, material);
      }
    }
  }
}

/** Seal a pocket too small to deserve a causeway, so nothing can be stranded. */
function sealPocket(
  corners: NirvanaWestMaterial[],
  component: { readonly tiles: readonly number[] },
  columns: number,
): void {
  for (const index of component.tiles) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    for (const [dc, dr] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
      setCornerMaterial(corners, column + dc, row + dr, "ashpale");
    }
  }
}

// ---------------------------------------------------------------------------
// causeways - the boardwalk-equivalent derived crossing
// ---------------------------------------------------------------------------

interface CrossingPlan {
  readonly id: string;
  readonly axis: NirvanaWestCrossingAxis;
  /** Row for an east-west span, column for a north-south span. */
  readonly line: number;
  /** A position along the span axis known/expected to be in blocked ground - a HINT. */
  readonly midstream: number;
}

/**
 * A causeway's SEAT is derived from the field, not guessed: try every line in a
 * dense sweep, score each by how close its longest blocked run is to `targetSpan`,
 * and take the best-scoring line. Guessing a fixed `(line, midstream)` proved
 * fragile in practice - a hint can land in the middle of a slab (Voronoi joints
 * move whenever the seeds/warp are touched) or, worse, land dead-centre on a
 * feature and span its full diameter instead of a purposeful crossing (the focal
 * basin's diametric width is ~26 tiles; a real crossing should look like 10-14).
 */
interface CausewaySpec {
  readonly id: string;
  readonly axis: NirvanaWestCrossingAxis;
  /** The blocked-run length this causeway should read as - short and purposeful. */
  readonly targetSpan: number;
  /** Hard ceiling; a run this long or longer never reads as a single crossing. */
  readonly maxSpan: number;
}

/** Every 4th line across the whole axis - dense enough to find any real feature. */
const CAUSEWAY_LINE_CANDIDATES: readonly number[] = Object.freeze(
  Array.from({ length: NIRVANA_WEST_COLUMNS / 4 }, (_, index) => index * 4),
);

function crossingTileRef(plan: CrossingPlan, position: number): NirvanaWestTileRef {
  const p = wrapPos(position, NIRVANA_WEST_COLUMNS);
  return plan.axis === "east-west"
    ? { column: p, row: wrapPos(plan.line, NIRVANA_WEST_ROWS) }
    : { column: wrapPos(plan.line, NIRVANA_WEST_COLUMNS), row: p };
}

function blockedAtPosition(
  tiles: readonly NirvanaWestTile[],
  axis: NirvanaWestCrossingAxis,
  line: number,
  position: number,
): boolean {
  const ref = crossingTileRef({ id: "", axis, line, midstream: 0 }, position);
  return tiles[ref.row * NIRVANA_WEST_COLUMNS + ref.column].blocked;
}

/**
 * The longest contiguous blocked run on one line, wrapped. Rotates the scan to
 * start at a known GAP (an unblocked position) first, so a run that would
 * otherwise straddle the position-0/position-95 seam is walked as one
 * contiguous run rather than being cut in two by the array boundary.
 */
function longestBlockedRun(
  tiles: readonly NirvanaWestTile[],
  axis: NirvanaWestCrossingAxis,
  line: number,
): { readonly center: number; readonly length: number } | null {
  const extent = axis === "east-west" ? NIRVANA_WEST_COLUMNS : NIRVANA_WEST_ROWS;
  const blockedAt = (position: number): boolean => blockedAtPosition(tiles, axis, line, position);

  let gapIndex = -1;
  for (let position = 0; position < extent; position += 1) {
    if (!blockedAt(position)) {
      gapIndex = position;
      break;
    }
  }
  if (gapIndex === -1) return { center: 0, length: extent };

  let bestStart = -1;
  let bestLength = 0;
  let curStart = -1;
  let curLength = 0;
  for (let step = 0; step < extent; step += 1) {
    const position = (gapIndex + step) % extent;
    if (blockedAt(position)) {
      if (curStart === -1) curStart = position;
      curLength += 1;
      if (curLength > bestLength) {
        bestLength = curLength;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLength = 0;
    }
  }
  if (bestStart === -1) return null;
  return { center: bestStart + Math.floor(bestLength / 2), length: bestLength };
}

/**
 * Resolves one causeway plan against the DERIVED tiles. `plan.midstream` is a hint,
 * not an assertion: the search walks outward for the nearest blocked tile on the
 * line and spans it, so a composition's own retuning of its material field can
 * never leave a causeway plan pointing at dry ground. Positions are unbounded
 * (the torus has no rim to clamp against) and only ever canonicalised via
 * {@link crossingTileRef}'s `wrapPos`, so a causeway may legitimately span the seam.
 */
function resolveCrossing(
  tiles: readonly NirvanaWestTile[],
  plan: CrossingPlan,
  maxSpan: number,
): NirvanaWestCrossing {
  const blockedAt = (position: number): boolean => blockedAtPosition(
    tiles, plan.axis, plan.line, position,
  );

  let midstream = plan.midstream;
  if (!blockedAt(midstream)) {
    let found: number | null = null;
    for (let offset = 1; offset <= MAX_CAUSEWAY_SEARCH && found === null; offset += 1) {
      for (const candidate of [midstream - offset, midstream + offset]) {
        if (blockedAt(candidate)) {
          found = candidate;
          break;
        }
      }
    }
    if (found === null) {
      throw new NirvanaWestSceneError(
        `Causeway ${plan.id}: no blocked ground within ${MAX_CAUSEWAY_SEARCH} tiles of `
        + `midstream hint ${plan.midstream} on line ${plan.line} - there is nothing here to cross.`,
      );
    }
    midstream = found;
  }

  let first = midstream;
  while (blockedAt(first - 1) && midstream - first < maxSpan) first -= 1;
  let last = midstream;
  while (blockedAt(last + 1) && last - midstream < maxSpan) last += 1;

  if (blockedAt(first - 1) || blockedAt(last + 1)) {
    throw new NirvanaWestSceneError(
      `Causeway ${plan.id}: the blocked run from ${first} to ${last} does not reach walkable `
      + `ground at both ends within ${maxSpan} tiles.`,
    );
  }

  const deck: NirvanaWestTileRef[] = [];
  for (let position = first; position <= last; position += 1) {
    deck.push(Object.freeze(crossingTileRef(plan, position)));
  }
  return Object.freeze({
    id: plan.id,
    axis: plan.axis,
    deck: Object.freeze(deck),
    abutments: Object.freeze([
      Object.freeze(crossingTileRef(plan, first - 1)),
      Object.freeze(crossingTileRef(plan, last + 1)),
    ]),
  });
}

/** Sweeps every candidate line for `spec.axis`, seats on whichever run best matches `targetSpan`. */
function seatCauseway(tiles: readonly NirvanaWestTile[], spec: CausewaySpec): NirvanaWestCrossing {
  let best: { readonly line: number; readonly center: number; readonly length: number } | null = null;
  for (const line of CAUSEWAY_LINE_CANDIDATES) {
    const run = longestBlockedRun(tiles, spec.axis, line);
    if (run === null) continue;
    const score = Math.abs(run.length - spec.targetSpan);
    const bestScore = best === null ? Number.POSITIVE_INFINITY : Math.abs(best.length - spec.targetSpan);
    if (score < bestScore) best = { line, center: run.center, length: run.length };
  }
  if (best === null) {
    throw new NirvanaWestSceneError(
      `Causeway ${spec.id}: no blocked ground found on any candidate ${spec.axis} line.`,
    );
  }
  const plan: CrossingPlan = {
    id: spec.id, axis: spec.axis, line: best.line, midstream: best.center,
  };
  return resolveCrossing(tiles, plan, spec.maxSpan);
}

function resolveCauseways(
  tiles: readonly NirvanaWestTile[],
  specs: readonly CausewaySpec[],
): NirvanaWestCrossing[] {
  return specs.map((spec) => seatCauseway(tiles, spec));
}

/**
 * Overlay causeway decks onto derived tiles. Like Warm Springs' `deck`, `causeway`
 * is never sampled in the corner field (contract) - it is purely a tile-level
 * report: the underlying material is remembered in `deckOver`, walkability flips.
 */
function applyCrossingDecks(
  tiles: readonly NirvanaWestTile[],
  crossings: readonly NirvanaWestCrossing[],
): NirvanaWestTile[] {
  const decked = [...tiles];
  for (const crossing of crossings) {
    for (const ref of crossing.deck) {
      const index = ref.row * NIRVANA_WEST_COLUMNS + ref.column;
      const tile = decked[index];
      decked[index] = Object.freeze({
        ...tile,
        material: "causeway" as NirvanaWestMaterial,
        blocked: false,
        causewayDeck: true,
        deckOver: tile.material,
      });
    }
  }
  return decked;
}

// ---------------------------------------------------------------------------
// shelter-plot geometry (contract §1) - duplicated to avoid a circular import
// with nirvanaWestWalkability.ts, which imports `NirvanaWestScene` from here.
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

/**
 * Every corner touched by any of the 128 plots' 5x5 tile footprints (a footprint
 * at tile column/row `c, r` touches corner columns `[c, c+5]` and corner rows
 * `[r, r+5]`). None of these ever approach the wrap seam (max reach is column 82,
 * row 78 against a 96-wide grid), so a plain array write is safe here without
 * {@link setCornerMaterial}'s mirroring.
 */
function shelterFootprintCornerIndices(): ReadonlySet<number> {
  const indices = new Set<number>();
  for (const anchor of allShelterPlotAnchors()) {
    for (let dr = 0; dr <= 5; dr += 1) {
      for (let dc = 0; dc <= 5; dc += 1) {
        indices.add(cornerIndex(anchor.x + dc, anchor.y + dr));
      }
    }
  }
  return indices;
}

/** Every tile index (deduplicated) inside any of the 128 plots' 5x5 footprints. */
function shelterFootprintTileIndices(): ReadonlySet<number> {
  const indices = new Set<number>();
  for (const anchor of allShelterPlotAnchors()) {
    for (let dr = 0; dr < 5; dr += 1) {
      for (let dc = 0; dc < 5; dc += 1) {
        indices.add((anchor.y + dr) * NIRVANA_WEST_COLUMNS + (anchor.x + dc));
      }
    }
  }
  return indices;
}

const SHELTER_FOOTPRINT_CORNER_INDICES: ReadonlySet<number> = shelterFootprintCornerIndices();
const SHELTER_FOOTPRINT_TILE_INDICES: ReadonlySet<number> = shelterFootprintTileIndices();

/** Substitutes every blocking corner inside a plot footprint for its walkable demotion. */
function demoteShelterPlotCorners(corners: NirvanaWestMaterial[]): void {
  for (const index of SHELTER_FOOTPRINT_CORNER_INDICES) {
    const material = corners[index];
    if (isBlockingMaterial(material)) {
      corners[index] = demotedMaterial(material);
    }
  }
}

/** How many footprint tiles the RAW (pre-demotion) field would have blocked. */
function countRawBlockedFootprintTiles(rawTiles: readonly NirvanaWestTile[]): number {
  let count = 0;
  for (const index of SHELTER_FOOTPRINT_TILE_INDICES) {
    if (rawTiles[index].blocked) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// scenery
// ---------------------------------------------------------------------------

/**
 * Which ruin vocabulary a composition is dressed with.
 *
 * This is a LORE question, not a rendering one, and it is deliberately a
 * switch rather than a decision: `"ancient"` reads as catastrophic and dead
 * while committing this world to nothing it has not already asserted, and
 * `"industrial"` is unmistakably a nuclear wasteland but imports a
 * technological past the simulation has never claimed. Both are authored; the
 * owner picks.
 */
export type NirvanaWestRuinKit = "ancient" | "industrial";

export const NIRVANA_WEST_RUIN_KITS: readonly NirvanaWestRuinKit[] = Object.freeze([
  "ancient",
  "industrial",
]);

interface SpeciesRule {
  readonly id: string;
  readonly variants: number;
  /** When set, this species is placed only under that ruin kit. */
  readonly ruin?: NirvanaWestRuinKit;
  readonly on: readonly NirvanaWestMaterial[];
  readonly blocks: boolean;
  readonly clusters: number;
  readonly spread: number;
  readonly perCluster: number;
  readonly scatter: number;
  readonly seed: number;
}

const ON_PLAINS: readonly NirvanaWestMaterial[] = PLAIN_TIERS;

const SPECIES: readonly SpeciesRule[] = Object.freeze([
  {
    // Fewer, denser stands rather than singletons scattered evenly: a dozen dead
    // snags together reads as a place, forty singletons read as litter.
    id: "snag", variants: 4, on: ON_PLAINS, blocks: true,
    clusters: 6, spread: 3.4, perCluster: 6, scatter: 2, seed: 2101,
  },
  {
    id: "snagtall", variants: 3, on: ON_PLAINS, blocks: true,
    clusters: 4, spread: 3.0, perCluster: 4, scatter: 1, seed: 2107,
  },
  {
    id: "snagfallen", variants: 3, on: ON_PLAINS, blocks: false,
    clusters: 6, spread: 2.8, perCluster: 3, scatter: 10, seed: 2113,
  },
  {
    id: "stump", variants: 3, on: ON_PLAINS, blocks: false,
    clusters: 6, spread: 2.4, perCluster: 3, scatter: 12, seed: 2129,
  },
  {
    id: "slagrock", variants: 4, on: [...ON_PLAINS, "clinker", "scree"], blocks: true,
    clusters: 6, spread: 3.2, perCluster: 6, scatter: 3, seed: 2137,
  },
  {
    id: "ashpile", variants: 4, on: ["ash", "ashpale", "dust"], blocks: false,
    clusters: 10, spread: 2.8, perCluster: 4, scatter: 30, seed: 2141,
  },
  {
    id: "bonestone", variants: 4, on: [...ON_PLAINS, "rime", "ashpale"], blocks: false,
    clusters: 6, spread: 2.4, perCluster: 2, scatter: 16, seed: 2143,
  },
  {
    id: "ejecta", variants: 3, on: ["clinker", "scree", "cinder"], blocks: true,
    clusters: 5, spread: 3.0, perCluster: 5, scatter: 2, seed: 2153,
  },
  {
    id: "clinkerchunk", variants: 3, on: ["clinker", "scree", "cinder"], blocks: false,
    clusters: 0, spread: 0, perCluster: 0, scatter: 220, seed: 2161,
  },
  {
    id: "rimecluster", variants: 3, on: ["rime", "ashpale", "slatedark"], blocks: false,
    clusters: 5, spread: 2.2, perCluster: 3, scatter: 20, seed: 2179,
  },
  {
    id: "deadbrush", variants: 3, on: ON_PLAINS, blocks: false,
    clusters: 12, spread: 2.8, perCluster: 4, scatter: 40, seed: 2203,
  },
  {
    id: "ashripple", variants: 4, on: ["ash", "ashpale", "dust"], blocks: false,
    clusters: 0, spread: 0, perCluster: 0, scatter: 260, seed: 2213,
  },
  {
    id: "glassshard", variants: 3, on: ["glass", "emberdim", "cinder"], blocks: false,
    clusters: 0, spread: 0, perCluster: 0, scatter: 140, seed: 2221,
  },
  {
    // v2: RETIRED to a handful. This was v1's static heat-shimmer decal and at
    // 1:1 a field of 90 of them read as pale scratches on the ground. The
    // animated `smoke-anchor` / `heat-haze` environment layer does this job
    // properly now, so the prop survives only as an occasional accent.
    id: "emberwisp", variants: 3, on: ["emberdim", "cinder", "glass", "ash"], blocks: false,
    clusters: 0, spread: 0, perCluster: 0, scatter: 10, seed: 2237,
  },
  {
    // A snapped lattice mast is a claim about industry, so it belongs to the
    // industrial kit and not to the ancient one. This is the lore question in
    // miniature: v1 placed it in a world that has never built anything.
    id: "pylon", variants: 2, on: ON_PLAINS, blocks: true,
    clusters: 3, spread: 1.4, perCluster: 1, scatter: 3, seed: 2239,
    ruin: "industrial",
  },
  {
    id: "slabtilt", variants: 3, on: [...ON_PLAINS, "slatedark", "cinder"], blocks: true,
    clusters: 6, spread: 2.4, perCluster: 3, scatter: 14, seed: 2243,
  },
  {
    id: "dunecrest", variants: 3, on: ["ash", "ashpale", "dust"], blocks: false,
    clusters: 7, spread: 3.0, perCluster: 4, scatter: 22, seed: 2251,
  },

  // --- v2 RUINS ----------------------------------------------------------
  // Deliberately RARE. A ruin is a destination and a landmark; forty of them
  // are set dressing. Each is a tall illustrated object with a real cast
  // shadow, so a handful carries the whole "something ended here" reading.
  {
    id: "monolith", variants: 3, on: ON_PLAINS, blocks: true,
    clusters: 3, spread: 2.2, perCluster: 2, scatter: 4, seed: 2311, ruin: "ancient",
  },
  {
    id: "slumpwall", variants: 3, on: ON_PLAINS, blocks: true,
    clusters: 2, spread: 2.0, perCluster: 2, scatter: 3, seed: 2317, ruin: "ancient",
  },
  {
    id: "boneforest", variants: 3, on: ON_PLAINS, blocks: true,
    clusters: 3, spread: 2.4, perCluster: 2, scatter: 4, seed: 2321, ruin: "ancient",
  },
  {
    id: "ashbarrow", variants: 3, on: ["ash", "ashpale", "dust", "cinder"], blocks: true,
    clusters: 4, spread: 2.6, perCluster: 2, scatter: 7, seed: 2333, ruin: "ancient",
  },
  {
    id: "coolingtower", variants: 2, on: ON_PLAINS, blocks: true,
    clusters: 2, spread: 1.6, perCluster: 1, scatter: 3, seed: 2339, ruin: "industrial",
  },
  {
    id: "reactorhusk", variants: 2, on: ON_PLAINS, blocks: true,
    clusters: 2, spread: 1.4, perCluster: 1, scatter: 2, seed: 2341, ruin: "industrial",
  },
  {
    id: "gantry", variants: 3, on: ON_PLAINS, blocks: true,
    clusters: 3, spread: 2.0, perCluster: 2, scatter: 4, seed: 2347, ruin: "industrial",
  },
  {
    id: "stack", variants: 3, on: ON_PLAINS, blocks: true,
    clusters: 3, spread: 2.0, perCluster: 1, scatter: 4, seed: 2351, ruin: "industrial",
  },
]);

/**
 * Sprite feet offsets, `[frameWidth, frameHeight, pivotX, pivotY]`, hand-read
 * from the shipped `assets/atlas.json`'s own authored `sceneryFrames` table -
 * the same "scene hardcodes what the art authored" discipline `springsScene.ts`'s
 * `PROP_PIVOTS` uses, so a prop's foot lands exactly where the art was drawn to
 * be anchored. `causeway` is the deck-piece decal placed on every causeway tile.
 */
const PROP_PIVOTS: Readonly<Record<string, readonly [number, number, number, number]>> =
  Object.freeze({
    snag: [32, 72, 16, 68],
    snagtall: [28, 88, 14, 84],
    snagfallen: [56, 24, 28, 21],
    stump: [24, 20, 12, 18],
    slagrock: [40, 32, 20, 29],
    ashpile: [40, 24, 20, 21],
    bonestone: [24, 44, 12, 41],
    ejecta: [40, 32, 20, 29],
    clinkerchunk: [28, 20, 14, 18],
    rimecluster: [24, 20, 12, 18],
    deadbrush: [32, 28, 16, 26],
    ashripple: [32, 20, 16, 18],
    glassshard: [20, 28, 10, 26],
    emberwisp: [40, 56, 20, 50],
    pylon: [40, 96, 20, 92],
    slabtilt: [28, 36, 14, 33],
    dunecrest: [48, 20, 24, 18],
    causeway: [32, 32, 16, 31],
    // v2 ruins. The frames are much wider and taller than the object they
    // hold: the spare room right of and below the pivot is the cast shadow.
    monolith: [116, 132, 26, 96],
    slumpwall: [148, 96, 44, 74],
    boneforest: [144, 124, 33, 94],
    ashbarrow: [124, 60, 39, 44],
    coolingtower: [184, 176, 50, 132],
    reactorhusk: [184, 136, 52, 106],
    gantry: [164, 120, 22, 88],
    stack: [176, 164, 28, 124],
  });

/** Authored scenery frame variant counts per species, from `assets/atlas.json`. */
const CAUSEWAY_DECK_VARIANTS = 6;

function makeProp(
  id: string,
  frameId: string,
  species: string,
  footX: number,
  footY: number,
  blocks: boolean,
): NirvanaWestProp {
  const pivot = PROP_PIVOTS[species];
  if (pivot === undefined) {
    throw new NirvanaWestSceneError(`Nirvana West scene has no pivot entry for species ${species}.`);
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
      column: wrapPos(Math.floor(footX / NIRVANA_WEST_TILE_SIZE), NIRVANA_WEST_COLUMNS),
      row: wrapPos(Math.floor(footY / NIRVANA_WEST_TILE_SIZE), NIRVANA_WEST_ROWS),
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
    const column = wrapPos(Math.floor(x), NIRVANA_WEST_COLUMNS);
    const row = wrapPos(Math.floor(y), NIRVANA_WEST_ROWS);
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
    const cx = hash2(cluster, species.seed, 17) * NIRVANA_WEST_COLUMNS;
    const cy = hash2(cluster, species.seed, 29) * NIRVANA_WEST_ROWS;
    for (let member = 0; member < species.perCluster; member += 1) {
      const angle = hash2(cluster, member, species.seed + 41) * Math.PI * 2;
      const radius = Math.sqrt(hash2(cluster, member, species.seed + 53)) * species.spread;
      push(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, member * 3 + cluster);
    }
  }
  for (let index = 0; index < species.scatter; index += 1) {
    push(
      hash2(index, species.seed, 61) * NIRVANA_WEST_COLUMNS,
      hash2(index, species.seed, 71) * NIRVANA_WEST_ROWS,
      index + 500,
    );
  }
  return out;
}

function placeProps(
  tiles: readonly NirvanaWestTile[],
  compositionId: NirvanaWestCompositionId,
  causeways: readonly NirvanaWestCrossing[],
  ruinKit: NirvanaWestRuinKit,
): NirvanaWestProp[] {
  const props: NirvanaWestProp[] = [];
  const claimed = new Set<string>();

  // A prop does not grow where a house goes: every one of the 128 shelter plots'
  // real 5x5 footprints is pre-claimed as prop-free, so no candidate can ever be
  // selected onto ground a shelter will stand on.
  for (const anchor of allShelterPlotAnchors()) {
    for (let dr = 0; dr < 5; dr += 1) {
      for (let dc = 0; dc < 5; dc += 1) {
        claimed.add(`block:${anchor.x + dc},${anchor.y + dr}`);
      }
    }
  }
  for (const causeway of causeways) {
    for (const abutment of causeway.abutments) {
      claimed.add(`block:${abutment.column},${abutment.row}`);
    }
  }

  const tileAt = (column: number, row: number): NirvanaWestTile => {
    const c = wrapPos(column, NIRVANA_WEST_COLUMNS);
    const r = wrapPos(row, NIRVANA_WEST_ROWS);
    return tiles[r * NIRVANA_WEST_COLUMNS + c];
  };

  const NEIGHBOUR_OFFSETS = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  const isAdjacentTo = (column: number, row: number, material: NirvanaWestMaterial): boolean => (
    NEIGHBOUR_OFFSETS.some(([dc, dr]) => tileAt(column + dc, row + dr).material === material)
  );

  for (const species of SPECIES) {
    // dunecrest and slabtilt are biased to their signature compositions (contract).
    if (species.id === "dunecrest" && compositionId !== "a-ashfall-drifts") continue;
    if (species.id === "slabtilt" && compositionId !== "c-shattered-pavement") continue;
    if (species.ruin !== undefined && species.ruin !== ruinKit) continue;

    for (const candidate of candidatePositions(species)) {
      const tile = tileAt(candidate.column, candidate.row);
      if (!species.on.includes(tile.material)) continue;
      if (species.id === "emberwisp" && !isAdjacentTo(candidate.column, candidate.row, "ember")) {
        continue;
      }
      if (
        (species.id === "bonestone" || species.id === "rimecluster")
        && !isAdjacentTo(candidate.column, candidate.row, "rime")
      ) {
        continue;
      }
      const key = `${species.id}:${candidate.column},${candidate.row}`;
      if (claimed.has(key)) continue;
      if (species.blocks) {
        const occupancy = `block:${candidate.column},${candidate.row}`;
        if (claimed.has(occupancy) || tile.blocked) continue;
        claimed.add(occupancy);
      }
      claimed.add(key);
      const footX = candidate.column * NIRVANA_WEST_TILE_SIZE + NIRVANA_WEST_TILE_SIZE / 2
        + candidate.offsetX;
      const footY = candidate.row * NIRVANA_WEST_TILE_SIZE + NIRVANA_WEST_TILE_SIZE / 2
        + candidate.offsetY;
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

  // One deck-piece decal per causeway tile - the authored `s.causeway.0-5` frames.
  // Non-blocking (the tile itself already reports `blocked: false`); this is
  // decoration riding on top of the causeway ground, not a second collision layer.
  for (const causeway of causeways) {
    for (const ref of causeway.deck) {
      const variant = Math.floor(hash2(ref.column, ref.row, 0x9a11) * CAUSEWAY_DECK_VARIANTS)
        % CAUSEWAY_DECK_VARIANTS;
      props.push(makeProp(
        `causeway:${causeway.id}:${ref.column},${ref.row}`,
        `s.causeway.${variant}`,
        "causeway",
        ref.column * NIRVANA_WEST_TILE_SIZE + NIRVANA_WEST_TILE_SIZE / 2,
        ref.row * NIRVANA_WEST_TILE_SIZE + NIRVANA_WEST_TILE_SIZE / 2,
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
// animated environment - fire/smoke/heat-haze overlay
//
// Mirrors production's placement CONTRACT (an `AnimatedEnvironmentPlacement`
// is just `{ id, kind, tile, phaseSeed }` - all phase resolution happens later,
// statelessly, at draw time; see `nirvanaWestPainter.ts`'s
// `nirvanaWestAnimationPhase`, which is `EnvironmentSystem.ts`'s `phaseIndex`
// copied verbatim). This function only decides WHERE each of the four roles
// lands, deterministically from the FINAL derived material field (post
// causeway-deck, post connectivity-repair) - never the raw, pre-repair field -
// so an animated ember never sits on ground that turned out to be a causeway
// deck or got carved open for connectivity.
// ---------------------------------------------------------------------------

const MOORE_OFFSETS: readonly Point[] = Object.freeze([
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
  { x: -1, y: 0 }, { x: 1, y: 0 },
  { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 },
]);

const VON_NEUMANN_OFFSETS: readonly Point[] = Object.freeze([
  { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 },
]);

/** `Math.floor(hash2(column, row, 0x0e77) * 0x7fffffff)` - always a non-negative integer. */
function animatedPhaseSeed(column: number, row: number): number {
  return Math.floor(hash2(column, row, 0x0e77) * 0x7fffffff);
}

/**
 * Places the four animated-environment roles onto the FINAL tile field,
 * deterministic and pure. Every neighbour lookup wraps via `tileAt` (built on
 * `wrapPos`), so the toroidal seam is as safe here as everywhere else in this
 * module - a placement is itself always attached to a single, real tile, so
 * seam safety is purely about which tiles COUNT as a placement's neighbours.
 *
 * Evaluation order matters and encodes the contract's priority: `ember-vent`
 * is decided first so it can claim a deep-fissure ember tile before plain
 * `ember` gets a chance to roll for it ("vent wins"); `smoke-anchor` and
 * `heat-haze` are decided last and both respect the single shared `claimed`
 * set, so "at most one placement per tile overall" holds by construction
 * rather than by a later dedupe pass.
 */
function placeAnimatedEnvironment(
  tiles: readonly NirvanaWestTile[],
): NirvanaWestAnimatedPlacement[] {
  const tileAt = (column: number, row: number): NirvanaWestTile => {
    const c = wrapPos(column, NIRVANA_WEST_COLUMNS);
    const r = wrapPos(row, NIRVANA_WEST_ROWS);
    return tiles[r * NIRVANA_WEST_COLUMNS + c];
  };

  const claimed = new Set<number>();
  const placements: NirvanaWestAnimatedPlacement[] = [];

  const place = (column: number, row: number, kind: NirvanaWestAnimatedKind): void => {
    claimed.add(row * NIRVANA_WEST_COLUMNS + column);
    placements.push(Object.freeze({
      id: `anim:${kind}:${column},${row}`,
      kind,
      tile: Object.freeze({ column, row }),
      phaseSeed: animatedPhaseSeed(column, row),
    }));
  };

  // ember-vent - deep-fissure ember tiles (>=4 of 8 wrapped neighbours also
  // ember). Evaluated FIRST so it can claim the tile before plain `ember` does.
  for (let row = 0; row < NIRVANA_WEST_ROWS; row += 1) {
    for (let column = 0; column < NIRVANA_WEST_COLUMNS; column += 1) {
      if (tileAt(column, row).material !== "ember") continue;
      const emberNeighbours = MOORE_OFFSETS.filter(
        (offset) => tileAt(column + offset.x, row + offset.y).material === "ember",
      ).length;
      if (emberNeighbours < 4) continue;
      if (hash2(column, row, 0x0e02) >= 0.22) continue;
      place(column, row, "ember-vent");
    }
  }

  // ember - every remaining (non-vent-claimed) ember tile.
  for (let row = 0; row < NIRVANA_WEST_ROWS; row += 1) {
    for (let column = 0; column < NIRVANA_WEST_COLUMNS; column += 1) {
      if (claimed.has(row * NIRVANA_WEST_COLUMNS + column)) continue;
      if (tileAt(column, row).material !== "ember") continue;
      if (hash2(column, row, 0x0e01) >= 0.74) continue;
      place(column, row, "ember");
    }
  }

  // ember, second pass - the WELDED seam. `emberdim` is `ember`'s walkable twin
  // (the demotion that keeps this region at 0/128 plots lost); the crust there
  // is cooled but the gas below it is not, so where a welded seam touches live
  // crust it still burns. Without this the fire stops dead at exactly the line
  // where a shelter plot begins, which is the one place the seam must NOT be
  // legible as a rule.
  for (let row = 0; row < NIRVANA_WEST_ROWS; row += 1) {
    for (let column = 0; column < NIRVANA_WEST_COLUMNS; column += 1) {
      if (claimed.has(row * NIRVANA_WEST_COLUMNS + column)) continue;
      if (tileAt(column, row).material !== "emberdim") continue;
      const adjacentEmber = VON_NEUMANN_OFFSETS.some(
        (offset) => tileAt(column + offset.x, row + offset.y).material === "ember",
      );
      if (!adjacentEmber) continue;
      if (hash2(column, row, 0x0e05) >= 0.38) continue;
      place(column, row, "ember");
    }
  }

  // smoke-anchor - emberdim/cinder ground immediately (4-neighbour) beside ember.
  for (let row = 0; row < NIRVANA_WEST_ROWS; row += 1) {
    for (let column = 0; column < NIRVANA_WEST_COLUMNS; column += 1) {
      if (claimed.has(row * NIRVANA_WEST_COLUMNS + column)) continue;
      const material = tileAt(column, row).material;
      if (material !== "emberdim" && material !== "cinder") continue;
      const adjacentEmber = VON_NEUMANN_OFFSETS.some(
        (offset) => tileAt(column + offset.x, row + offset.y).material === "ember",
      );
      if (!adjacentEmber) continue;
      if (hash2(column, row, 0x0e03) >= 0.42) continue;
      place(column, row, "smoke-anchor");
    }
  }

  // heat-haze - emberdim/glass/cinder ground within wrapped Chebyshev radius 2
  // of an ember tile. Explicitly skips any tile another role already claimed.
  for (let row = 0; row < NIRVANA_WEST_ROWS; row += 1) {
    for (let column = 0; column < NIRVANA_WEST_COLUMNS; column += 1) {
      if (claimed.has(row * NIRVANA_WEST_COLUMNS + column)) continue;
      const material = tileAt(column, row).material;
      if (material !== "emberdim" && material !== "glass" && material !== "cinder") continue;
      let nearEmber = false;
      for (let dy = -2; dy <= 2 && !nearEmber; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          if (tileAt(column + dx, row + dy).material === "ember") {
            nearEmber = true;
            break;
          }
        }
      }
      if (!nearEmber) continue;
      if (hash2(column, row, 0x0e04) >= 0.16) continue;
      place(column, row, "heat-haze");
    }
  }

  placements.sort((left, right) => left.tile.row - right.tile.row
    || left.tile.column - right.tile.column
    || left.id.localeCompare(right.id));
  return placements;
}

/** Per-kind + total counts - the viewer readout and the plate script's summary. */
export function animatedEnvironmentReport(
  scene: NirvanaWestScene,
): Readonly<Record<NirvanaWestAnimatedKind, number>> & { readonly total: number } {
  const counts: Record<NirvanaWestAnimatedKind, number> = {
    ember: 0,
    "ember-vent": 0,
    "smoke-anchor": 0,
    "heat-haze": 0,
  };
  for (const placement of scene.animatedEnvironment) {
    counts[placement.kind] += 1;
  }
  return Object.freeze({ ...counts, total: scene.animatedEnvironment.length });
}

// ---------------------------------------------------------------------------
// composition A - Ashfall Drifts (aeolian; periodic-linear)
// ---------------------------------------------------------------------------

const SEED_A_WARP = 0xa001;
const SEED_A_MIX_1 = 0xa011;
const SEED_A_MIX_2 = 0xa012;
const SEED_A_MIX_3 = 0xa013;
const SEED_A_REEF = 0xa021;
const SEED_A_BASIN = 0xa031;

/** Period 48 divides 96, so the band phase is exactly periodic in BOTH axes. */
const ASHFALL_BAND_PERIOD = 48;

/** Seated in the toroidal wrap band deliberately - see the module docstring. */
const ASHFALL_BASIN_CENTER: Point = { x: 30, y: 4 };

/**
 * Every tier boundary gets its OWN independent noise offset. Without this, all
 * seven boundaries are parallel copies of the same linear `phase` ramp (offset
 * only by a constant), so every material transition happens along near-parallel
 * iso-lines at once - the field posterises into a topographic-map look instead
 * of reading as a continuous drift. Decorrelating each boundary breaks that.
 */
function boundaryJitter(x: number, y: number, seed: number): number {
  return (toroidalFbm(x, y, seed, [8, 16]) - 0.5) * 0.06;
}

function ashfallBandMaterial(phase: number, x: number, y: number): NirvanaWestMaterial {
  if (phase < 0.10 + boundaryJitter(x, y, SEED_A_MIX_1 + 1)) return "ashpale";
  if (phase < 0.20 + boundaryJitter(x, y, SEED_A_MIX_1 + 2)) return "ash";
  if (phase < 0.30 + boundaryJitter(x, y, SEED_A_MIX_1 + 3)) {
    return bandPick(x, y, SEED_A_MIX_1, "ash", "dust");
  }
  if (phase < 0.44 + boundaryJitter(x, y, SEED_A_MIX_1 + 4)) return "dust";
  if (phase < 0.56 + boundaryJitter(x, y, SEED_A_MIX_1 + 5)) return "slate";
  if (phase < 0.74 + boundaryJitter(x, y, SEED_A_MIX_1 + 6)) {
    return bandPick(x, y, SEED_A_MIX_2, "slate", "slatedark");
  }
  if (phase < 0.88 + boundaryJitter(x, y, SEED_A_MIX_1 + 7)) {
    return bandPick(x, y, SEED_A_MIX_3, "slatedark", "cinder");
  }
  return "cinder";
}

/**
 * The focal scour basin, wrapped: at column 30 the ring reaches only to about row
 * -9..17 (well short of row 96), but nearer the seam the same wrapped distance
 * lets the basin's rings continue smoothly onto rows in the 90s - the visible
 * proof that this feature really is toroidal, not clipped at the rim.
 */
function ashfallBasinMaterial(x: number, y: number): NirvanaWestMaterial | null {
  const dx = wrapDelta(x, ASHFALL_BASIN_CENTER.x, NIRVANA_WEST_COLUMNS);
  const dy = wrapDelta(y, ASHFALL_BASIN_CENTER.y, NIRVANA_WEST_ROWS);
  const perturb = (toroidalFbm(x, y, SEED_A_BASIN, [8, 16]) - 0.5) * 4;
  const r = Math.hypot(dx, dy) + perturb;
  if (r < 9) return "brine";
  if (r < 13) return "rime";
  if (r < 18) return "ashpale";
  return null;
}

function ashfallMaterialAt(x: number, y: number): NirvanaWestMaterial {
  const warp = (toroidalFbm(x, y, SEED_A_WARP, [6, 12, 24]) - 0.5) * 30;
  const phase = wrapUnit((x + 3 * y + warp) / ASHFALL_BAND_PERIOD);
  let material = ashfallBandMaterial(phase, x, y);

  const reefField = toroidalFbm(x, y, SEED_A_REEF, [8, 16, 32]);
  if (phase >= 0.86 && phase < 0.95 && reefField > 0.50) material = "clinker";
  if (phase >= 0.95 && reefField > 0.72) material = "brine";

  const basin = ashfallBasinMaterial(x, y);
  if (basin !== null) material = basin;
  return material;
}

interface CompositionGeometry {
  readonly materialAt: (x: number, y: number) => NirvanaWestMaterial;
  readonly causewaySpecs: readonly CausewaySpec[];
}

function ashfallGeometry(): CompositionGeometry {
  return {
    materialAt: ashfallMaterialAt,
    // Short (target 12, cap 20) rather than the basin's own diametric width
    // (~26 tiles through its centre) - a purposeful crossing over real blocking
    // ground, not a pavement across the whole feature.
    causewaySpecs: Object.freeze([
      { id: "a-ew-basin", axis: "east-west", targetSpan: 12, maxSpan: 20 },
      { id: "a-ns-basin", axis: "north-south", targetSpan: 12, maxSpan: 20 },
    ]),
  };
}

// ---------------------------------------------------------------------------
// composition B - The Ember Rift (dendritic fracture network)
// ---------------------------------------------------------------------------

interface FractureSegment {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly width: number;
}

interface TrunkSpec {
  readonly x: number;
  readonly y: number;
  readonly ang: number;
  readonly width: number;
  readonly steps: number;
  readonly seed: number;
}

// Bearings spread widely (roughly 0.3 / 1.6 / 2.8 / 4.5 rad - each ~1.2-1.7 rad
// from its neighbours) so the four trunks genuinely CROSS rather than running as
// near-parallel slashes on the same bearing. A tight bearing cluster (the
// original 0.55/2.35/1.15) plus a small kink reads as one idea repeated in
// different colours, which defeats presenting three distinct compositions.
const EMBER_TRUNKS: readonly TrunkSpec[] = Object.freeze([
  { x: 6, y: 74, ang: 0.30, width: 3.4, steps: 22, seed: 0xb101 },
  { x: 88, y: 26, ang: 1.60, width: 3.0, steps: 20, seed: 0xb102 },
  { x: 44, y: 92, ang: 2.80, width: 2.6, steps: 18, seed: 0xb103 },
  // 4th trunk, started from grid centre so it runs through the CENTRAL third
  // (cols 30-70, rows 30-70) rather than round a margin - a course correction
  // from the concurrent camera/world-sheet agent: this region projects onto only
  // ~36% land at world-map scale, and the free-margin belt (rows 78-20 on the
  // wrap) is the thinnest-surviving part of that (~8%). A rift confined to the
  // margins would be almost invisible on the island map; one that runs through
  // the settlement's own centre reads.
  { x: 48, y: 50, ang: 4.50, width: 3.0, steps: 20, seed: 0xb104 },
]);

const MAX_FRACTURE_SEGMENTS = 170;

/**
 * Width along one branch's own run: pinches toward a hairline and swells to
 * 2.6-2.8x base (≈ 8-10 tiles for a ~3-tile trunk) using 1D fbm over the
 * branch's own progress fraction - never a constant-width ribbon, which reads
 * as a painted stripe rather than a crack. `widthSeed` is per-branch so no two
 * branches pinch/swell in lockstep.
 */
function fractureWidthFactor(t: number, widthSeed: number): number {
  const n = fbm1D(t * 4.5, widthSeed, 3);
  return 0.18 + n * n * 2.6;
}

function walkFracture(
  rng: () => number,
  startX: number,
  startY: number,
  startAng: number,
  baseWidth: number,
  steps: number,
  depth: number,
  widthSeed: number,
  segments: FractureSegment[],
): void {
  let x = startX;
  let y = startY;
  let ang = startAng;
  for (let i = 0; i < steps; i += 1) {
    if (segments.length >= MAX_FRACTURE_SEGMENTS) return;
    const run = randRange(rng, 3.0, 6.5);
    // Wider per-step kink (was +-0.38) so a trunk visibly wanders off its own
    // launch bearing over a long run, rather than staying a near-straight ray.
    ang += randRange(rng, -0.6, 0.6);
    const nx = x + Math.cos(ang) * run;
    const ny = y + Math.sin(ang) * run;
    const width = baseWidth * fractureWidthFactor(i / steps, widthSeed);
    segments.push({ ax: x, ay: y, bx: nx, by: ny, width });
    if (depth < 2 && rng() < 0.22 && segments.length < MAX_FRACTURE_SEGMENTS) {
      const sign = rng() < 0.5 ? -1 : 1;
      // Wider branch angle (was +-0.75..1.30) so a branch reads as leaving its
      // parent at a clear angle rather than shadowing it.
      const branchAng = ang + sign * randRange(rng, 1.0, 1.6);
      const remainingSteps = Math.max(6, Math.floor((steps - i) * 0.8));
      walkFracture(
        rng, nx, ny, branchAng, baseWidth * 0.58, remainingSteps, depth + 1,
        widthSeed + 4001, segments,
      );
    }
    x = nx;
    y = ny;
  }
}

function buildFractureSegments(): FractureSegment[] {
  const segments: FractureSegment[] = [];
  for (const trunk of EMBER_TRUNKS) {
    const rng = makeRng(trunk.seed);
    walkFracture(rng, trunk.x, trunk.y, trunk.ang, trunk.width, trunk.steps, 0, trunk.seed, segments);
  }
  return segments;
}

function pointSegmentDistance(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0
    ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
    : 0;
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return Math.hypot(px - cx, py - cy);
}

const WRAP_OFFSETS_96: readonly number[] = Object.freeze([-96, 0, 96]);

/** Point-to-segment distance minimised over the segment's 9 periodic images. */
function wrappedSegmentDistance(px: number, py: number, segment: FractureSegment): number {
  let best = Number.POSITIVE_INFINITY;
  for (const ox of WRAP_OFFSETS_96) {
    for (const oy of WRAP_OFFSETS_96) {
      const d = pointSegmentDistance(
        px, py, segment.ax + ox, segment.ay + oy, segment.bx + ox, segment.by + oy,
      );
      if (d < best) best = d;
    }
  }
  return best;
}

/** The segment minimising `d - 3.4*w`, so wide trunks win over hairline branches. */
function nearestFracture(
  x: number,
  y: number,
  segments: readonly FractureSegment[],
): { distance: number; width: number } {
  let bestScore = Number.POSITIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestWidth = 1;
  for (const segment of segments) {
    const distance = wrappedSegmentDistance(x, y, segment);
    const score = distance - 3.4 * segment.width;
    if (score < bestScore) {
      bestScore = score;
      bestDistance = distance;
      bestWidth = segment.width;
    }
  }
  return { distance: bestDistance, width: bestWidth };
}

const SEED_B_GRAIN = 0xb201;
const SEED_B_WELD = 0xb202;
const SEED_B_PLAINS = 0xb203;

/**
 * Dark-dominant by design: this region is dark with bright accents, not bright
 * with dark cracks. `ashpale`/`ash` are DELIBERATELY absent from the plains -
 * they only ever appear in the narrow halo immediately around a fissure - so
 * the two darkest tiers (`cinder` + `slatedark`) plus `slate` clearly dominate
 * the frame away from the rift itself.
 */
function emberRiftPlainsMaterial(x: number, y: number): NirvanaWestMaterial {
  const tier = toroidalFbm(x, y, SEED_B_PLAINS, [8, 16, 32]);
  if (tier > 0.78) return "dust";
  if (tier > 0.48) return "slate";
  if (tier > 0.20) return "slatedark";
  return "cinder";
}

function emberRiftMaterialAt(
  x: number,
  y: number,
  segments: readonly FractureSegment[],
): NirvanaWestMaterial {
  const { distance, width } = nearestFracture(x, y, segments);
  const grain = (toroidalFbm(x, y, SEED_B_GRAIN, [6, 12, 24]) - 0.5) * 1.6;
  const band = (distance + grain) / width;

  // Pale (ash/ashpale) confined to a NARROW halo (band 3.8-4.6) around the
  // fissure; everything beyond band 4.6 falls straight to the dark plains, and
  // everything between the fissure core and the halo is dark-tier transition
  // ground - the fix for ashpale+ash reading as a near-white sheet covering
  // over a third of the region.
  let material: NirvanaWestMaterial;
  if (band < 0.55) material = bandPick(x, y, SEED_B_GRAIN + 1, "ember", "emberdim");
  else if (band < 0.95) material = "glass";
  else if (band < 1.45) material = bandPick(x, y, SEED_B_GRAIN + 2, "clinker", "scree");
  else if (band < 2.10) material = "cinder";
  else if (band < 2.80) material = bandPick(x, y, SEED_B_GRAIN + 3, "cinder", "slatedark");
  else if (band < 3.80) material = bandPick(x, y, SEED_B_GRAIN + 4, "slatedark", "slate");
  else if (band < 4.60) material = bandPick(x, y, SEED_B_GRAIN + 5, "ash", "ashpale");
  else material = emberRiftPlainsMaterial(x, y);

  // Welds: collapsed slabs bridge the fissure wherever this independent field
  // crosses 0.60. These are the natural crossings that keep connectivity sane.
  const weld = toroidalFbm(x, y, SEED_B_WELD, [12, 24]);
  if (weld > 0.60) {
    if (material === "ember") material = "emberdim";
    else if (material === "glass") material = "cinder";
  }
  return material;
}

function emberRiftGeometry(): CompositionGeometry {
  const segments = buildFractureSegments();
  return {
    materialAt: (x, y) => emberRiftMaterialAt(x, y, segments),
    // Target 8, cap 16: a genuinely wide trunk swell, not the narrowest gap the
    // welds happen to leave (that read as a 2-3 tile sliver, too short to exist).
    causewaySpecs: Object.freeze([
      { id: "b-ew-trunk", axis: "east-west", targetSpan: 8, maxSpan: 16 },
      { id: "b-ns-trunk", axis: "north-south", targetSpan: 8, maxSpan: 16 },
    ]),
  };
}

// ---------------------------------------------------------------------------
// composition C - The Shattered Pavement (toroidal Voronoi)
// ---------------------------------------------------------------------------

interface VoronoiSeed {
  readonly x: number;
  readonly y: number;
  readonly tilt: number;
  readonly toneSeed: number;
  readonly index: number;
}

const SEED_C_LATTICE = 0xc101;
const SEED_C_EXTRA = 0xc102;
const SEED_C_WARP_X = 0xc201;
const SEED_C_WARP_Y = 0xc202;
const SEED_C_SLUMP = 0xc203;
const SEED_C_TONE = 0xc204;

/** 22-tile jittered grid (5x5 = 25 seeds) plus 7 extra random seeds. */
function buildVoronoiSeeds(): VoronoiSeed[] {
  const seeds: VoronoiSeed[] = [];
  const rng = makeRng(SEED_C_LATTICE);
  const step = 22;
  let index = 0;
  for (let gy = 0; gy < NIRVANA_WEST_ROWS; gy += step) {
    for (let gx = 0; gx < NIRVANA_WEST_COLUMNS; gx += step) {
      const jx = randRange(rng, 1, 21);
      const jy = randRange(rng, 1, 21);
      seeds.push({
        x: wrapPos(gx + jx, NIRVANA_WEST_COLUMNS),
        y: wrapPos(gy + jy, NIRVANA_WEST_ROWS),
        tilt: rng() * Math.PI * 2,
        toneSeed: Math.floor(rng() * 1_000_000),
        index,
      });
      index += 1;
    }
  }
  const extraRng = makeRng(SEED_C_EXTRA);
  for (let i = 0; i < 7; i += 1) {
    seeds.push({
      x: extraRng() * NIRVANA_WEST_COLUMNS,
      y: extraRng() * NIRVANA_WEST_ROWS,
      tilt: extraRng() * Math.PI * 2,
      toneSeed: Math.floor(extraRng() * 1_000_000),
      index,
    });
    index += 1;
  }
  return seeds;
}

function seedDistance(x: number, y: number, seed: VoronoiSeed): number {
  const dx = wrapDelta(x, seed.x, NIRVANA_WEST_COLUMNS);
  const dy = wrapDelta(y, seed.y, NIRVANA_WEST_ROWS);
  return Math.hypot(dx, dy);
}

/** Slab-interior tier ladder the lee-edge ash drift steps UP through. */
const TIER_LADDER: readonly NirvanaWestMaterial[] = Object.freeze([
  "cinder", "slate", "dust", "ash", "ashpale",
]);

function stepUpTier(material: NirvanaWestMaterial): NirvanaWestMaterial {
  const index = TIER_LADDER.indexOf(material);
  if (index < 0 || index === TIER_LADDER.length - 1) return material;
  return TIER_LADDER[index + 1];
}

function shatteredPavementMaterialAt(
  x: number,
  y: number,
  seeds: readonly VoronoiSeed[],
): NirvanaWestMaterial {
  // Warp the sample point - enough to break ruler-perfect cell walls, little
  // enough that facets stay angular rather than rounding into blobs.
  const warpX = (toroidalFbm(x, y, SEED_C_WARP_X, [8, 16]) - 0.5) * 4;
  const warpY = (toroidalFbm(x, y, SEED_C_WARP_Y, [8, 16]) - 0.5) * 4;
  const wx = x + warpX;
  const wy = y + warpY;

  let nearest = seeds[0];
  let d0 = Number.POSITIVE_INFINITY;
  let d1 = Number.POSITIVE_INFINITY;
  for (const seed of seeds) {
    const d = seedDistance(wx, wy, seed);
    if (d < d0) {
      d1 = d0;
      d0 = d;
      nearest = seed;
    } else if (d < d1) {
      d1 = d;
    }
  }
  const joint = d1 - d0;

  // Contrast, not just shape, is what makes upthrust PLATES rather than a
  // mosaic: the scree/clinker joint core is widened (was 1.5) so the joint
  // reads as a crisp dark line rather than a soft graded band, the cinder/
  // slatedark and slatedark/slate shoulders are narrowed to match, and slab
  // interiors start sooner (3.6, was 4.4) so more of each plate is genuine
  // interior rather than transition.
  let material: NirvanaWestMaterial;
  if (joint < 2.4) {
    const slump = toroidalFbm(x, y, SEED_C_SLUMP, [12, 24]);
    material = slump > 0.56 ? "cinder" : bandPick(x, y, SEED_C_TONE + 1, "scree", "clinker");
  } else if (joint < 3.0) {
    material = bandPick(x, y, SEED_C_TONE + 2, "cinder", "slatedark");
  } else if (joint < 3.6) {
    material = bandPick(x, y, SEED_C_TONE + 3, "slatedark", "slate");
  } else {
    // Push each cell's own random tone toward the extremes so neighbouring
    // plates land in clearly different buckets rather than clustering toward
    // similar mid-greys - the fix for slabs reading as soft camouflage blobs
    // rather than distinct facets.
    const rawTone = hash2(nearest.index, 0, nearest.toneSeed);
    const centered = rawTone - 0.5;
    const tone = 0.5 + Math.sign(centered) * (Math.abs(centered) * 2) ** 0.6 * 0.5;
    if (tone > 0.80) material = "ashpale";
    else if (tone > 0.62) material = bandPick(x, y, SEED_C_TONE + 4, "ash", "dust");
    else if (tone > 0.42) material = bandPick(x, y, SEED_C_TONE + 5, "dust", "slate");
    else if (tone > 0.20) material = bandPick(x, y, SEED_C_TONE + 6, "slate", "slatedark");
    else material = bandPick(x, y, SEED_C_TONE + 7, "cinder", "glass");

    // Ash drifts collect against each slab's lee edge.
    const dx = wrapDelta(wx, nearest.x, NIRVANA_WEST_COLUMNS);
    const dy = wrapDelta(wy, nearest.y, NIRVANA_WEST_ROWS);
    const angleFromSeed = Math.atan2(dy, dx);
    const lee = 0.5 + 0.5 * Math.cos(angleFromSeed - nearest.tilt);
    if (lee > 0.62 && joint < 10) material = stepUpTier(material);
    if (lee > 0.84) material = "ashpale";
  }
  return material;
}

function shatteredPavementGeometry(): CompositionGeometry {
  const seeds = buildVoronoiSeeds();
  return {
    materialAt: (x, y) => shatteredPavementMaterialAt(x, y, seeds),
    // A fixed (line, midstream) hint is fragile here by construction - a joint's
    // exact position moves whenever the seeds or warp are retuned - so the seat
    // is swept from the field instead of guessed.
    causewaySpecs: Object.freeze([
      { id: "c-ew-joint", axis: "east-west", targetSpan: 8, maxSpan: 14 },
      { id: "c-ns-joint", axis: "north-south", targetSpan: 8, maxSpan: 14 },
    ]),
  };
}

// ---------------------------------------------------------------------------
// dispatch + assembly
// ---------------------------------------------------------------------------

function geometryFor(compositionId: NirvanaWestCompositionId): CompositionGeometry {
  switch (compositionId) {
    case "a-ashfall-drifts": return ashfallGeometry();
    case "b-ember-rift": return emberRiftGeometry();
    case "c-shattered-pavement": return shatteredPavementGeometry();
    default: {
      const exhaustive: never = compositionId;
      throw new NirvanaWestSceneError(`Unknown Nirvana West composition ${String(exhaustive)}.`);
    }
  }
}

/** Author one of the three Nirvana West pilot compositions. */
export function createNirvanaWestScene(
  compositionId: NirvanaWestCompositionId,
  ruinKit: NirvanaWestRuinKit = "ancient",
): NirvanaWestScene {
  const geometry = geometryFor(compositionId);

  // The RAW, pre-demotion field - used only to measure demotedTiles.
  const rawCorners = buildCornerField(geometry.materialAt);
  const rawTiles = deriveTiles(rawCorners);
  const demotedTiles = countRawBlockedFootprintTiles(rawTiles);

  const corners = rawCorners.slice();
  demoteShelterPlotCorners(corners);

  let tiles = deriveTiles(corners);
  const causeways = resolveCauseways(tiles, geometry.causewaySpecs);
  tiles = applyCrossingDecks(tiles, causeways);
  let collision = collisionFrom(tiles);

  for (let pass = 0; pass < MAX_CONNECTIVITY_PASSES; pass += 1) {
    const components = walkableComponents(collision, NIRVANA_WEST_COLUMNS, NIRVANA_WEST_ROWS);
    if (components.length <= 1) break;
    const main = components[0];
    const orphan = components[1];
    if (orphan.tiles.length >= MIN_REPAIR_POCKET_TILES) {
      const { from, to } = nearestPair(main, orphan, NIRVANA_WEST_COLUMNS, NIRVANA_WEST_ROWS);
      carveCrossingCorners(corners, from, to, 1.4);
    } else {
      sealPocket(corners, orphan, NIRVANA_WEST_COLUMNS);
    }
    tiles = applyCrossingDecks(deriveTiles(corners), causeways);
    collision = collisionFrom(tiles);
  }

  const props = placeProps(tiles, compositionId, causeways, ruinKit);

  const withProps = Uint8Array.from(collision);
  for (const prop of props) {
    if (!prop.blocks) continue;
    const index = prop.tile.row * NIRVANA_WEST_COLUMNS + prop.tile.column;
    if (index >= 0 && index < withProps.length) withProps[index] = 1;
  }

  const keptProps: NirvanaWestProp[] = [...props];
  for (let pass = 0; pass < MAX_PROP_REPAIR_PASSES; pass += 1) {
    const components = walkableComponents(withProps, NIRVANA_WEST_COLUMNS, NIRVANA_WEST_ROWS);
    if (components.length <= 1) break;
    const orphan = components[components.length - 1];
    const orphanTiles = new Set(orphan.tiles);
    let removedIndex = -1;
    for (let index = 0; index < keptProps.length; index += 1) {
      const prop = keptProps[index];
      if (!prop.blocks) continue;
      const propIndex = prop.tile.row * NIRVANA_WEST_COLUMNS + prop.tile.column;
      const column = propIndex % NIRVANA_WEST_COLUMNS;
      const row = Math.floor(propIndex / NIRVANA_WEST_COLUMNS);
      const neighbours = [
        row * NIRVANA_WEST_COLUMNS + ((column - 1 + NIRVANA_WEST_COLUMNS) % NIRVANA_WEST_COLUMNS),
        row * NIRVANA_WEST_COLUMNS + ((column + 1) % NIRVANA_WEST_COLUMNS),
        (((row - 1 + NIRVANA_WEST_ROWS) % NIRVANA_WEST_ROWS) * NIRVANA_WEST_COLUMNS) + column,
        (((row + 1) % NIRVANA_WEST_ROWS) * NIRVANA_WEST_COLUMNS) + column,
      ];
      if (!neighbours.some((neighbour) => orphanTiles.has(neighbour))) continue;
      if (collision[propIndex] === 1) continue;
      removedIndex = index;
      break;
    }
    if (removedIndex < 0) {
      for (const index of orphan.tiles) withProps[index] = 1;
      continue;
    }
    const [removed] = keptProps.splice(removedIndex, 1);
    withProps[removed.tile.row * NIRVANA_WEST_COLUMNS + removed.tile.column] = 0;
  }

  const animatedEnvironment = placeAnimatedEnvironment(tiles);

  return Object.freeze({
    compositionId,
    ruinKit,
    columns: NIRVANA_WEST_COLUMNS,
    rows: NIRVANA_WEST_ROWS,
    tileSize: NIRVANA_WEST_TILE_SIZE,
    widthPixels: NIRVANA_WEST_WIDTH_PX,
    heightPixels: NIRVANA_WEST_HEIGHT_PX,
    tiles: Object.freeze(tiles),
    collision: withProps,
    props: Object.freeze(keptProps),
    causeways: Object.freeze(causeways),
    cornerMaterials: Object.freeze(corners),
    demotedTiles,
    animatedEnvironment: Object.freeze(animatedEnvironment),
  });
}
