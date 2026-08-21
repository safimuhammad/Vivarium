/**
 * @fileoverview The Nirvana West terrain field — the ONE source from which both the
 * picture and the walkability mask are derived, so the ground a body cannot enter is
 * exactly the ground drawn as one of {@link NirvanaWestMaterial}'s blocking materials.
 *
 * This is the owner-approved composition **B, "The Ember Rift"**
 * (`.superpowers/sdd/nirvana-west-pilot-report.md` §9/§12b, pushed further in the v2
 * section: fire animates, barren ground is textured, and ruined industrial structures
 * stand on it), promoted from the pilot `qa/nirvanaWestPilot/nirvanaWestScene.ts` with
 * its fracture geometry — trunk bearings, branch/kink machinery, width modulation, the
 * plains tier field, the weld-crossing field — carried across UNCHANGED. What the owner
 * approved by eye is what this module builds.
 *
 * Compositions A ("Ashfall Drifts") and C ("Shattered Pavement") are GONE — only B
 * ships. So are the pilot's own hardcoded 128 shelter-plot coordinates, its "ancient"
 * ruin kit (the owner chose industrial), its 300-placement animated-fire authoring
 * pass, and its "seal small orphan pockets with paint" connectivity repair. Four things
 * changed on the way into production, all structural:
 *
 * 1. **Protection comes from the REAL recipe, not hardcoded plot geometry.** The pilot
 *    proved plot safety against a hand-declared 128-plot table. Production reads the
 *    real mechanics geometry from the recipe instead — see
 *    `NirvanaWestRegionMapRecipe.ts`'s `nirvanaWestProtectionFromRecipe`. A corner that
 *    would sample a blocking material is demoted to its walkable twin
 *    (`NIRVANA_WEST_DEMOTIONS`) whenever any of the four tiles touching that corner is
 *    protected. Because a tile only blocks at >= 2 blocking corners, a protected tile
 *    can then never be blocked — the guarantee is structural, exactly as Warm Springs'
 *    corridor-gate successor proved.
 * 2. **The connectivity repair is MONOTONE — it only ever opens ground, never seals.**
 *    The pilot sealed small orphan pockets by painting over them, and that fought the
 *    carve: sealing a scrap beside a protected tile could isolate the protected tile,
 *    the next pass would carve back to it, and the two operations oscillated until the
 *    attempt budget ran out. Warm Springs measured this at 17% of sampled seeds and
 *    fixed it by never sealing — repair here follows that exact fix: an orphan
 *    component is either carved open (if it holds protected ground or is large enough
 *    to matter) by a breadth-first walk over ground the region's OWN generic collision
 *    already left open, or it is left alone. Repair is relative to the generic
 *    recipe's own pre-existing components (`baseCollision`), never to an absolute
 *    "one component" target — the generic Nirvana West region is not one component to
 *    begin with (the mechanics guard ring separates the settled core from the margin
 *    except at the four gates), and this terrain may not fix a shape it did not create.
 * 3. **Ruined structures get a REAL ground footprint.** A ruin's sprite is drawn two to
 *    five tiles wide while its single foot pivot blocks one; `../placement/sceneryFootprint.ts`
 *    (shared with Nirvana East) is what turns a declared `SceneryContactModel` into the
 *    real set of tiles a body cannot cross. Ordinary small props stay single-tile via
 *    `singleTileFootprint`. A footprint that would cover PROTECTED ground drops the prop
 *    entirely rather than moving it — see {@link NIRVANA_WEST_PROP_FRAMES}'s docstring
 *    for why drop, not move, was chosen.
 * 4. **The connectivity repair, causeway seating and material field stay genuinely
 *    TOROIDAL; the base-component repair stays BOUNDED.** These are deliberately
 *    different, not an oversight. The picture (corner lattice, fracture geometry) is
 *    sampled with wrapped deltas so it tiles smoothly at the seam the owner approved
 *    (`verifyToroidalSeam`, kept below). But a production region's actual walkable
 *    topology is a bounded rectangle with at most two narrow, RE-DERIVED portals per
 *    axis (`navigation/wrapSeams.ts`) — not a fully-open torus — so treating every rim
 *    tile as adjacent to its opposite edge during connectivity repair would invent
 *    connectivity the published grid does not have. `NirvanaWestRegionMapRecipe.ts`
 *    re-derives the real seams AFTER this terrain unions in, exactly as Warm Springs
 *    does; this module's own repair therefore mirrors `WarmSpringsTerrainField.ts`'s
 *    bounded discipline, not the pilot's fully-wrapped one.
 *
 * Terrain reaches movement legality through `navigation/groundTerrain.ts` —
 * `grid.collision` plus the destination-tile check — never through exclusion rects. See
 * that module's header for why the two are different rules, not two approximations of one.
 */

import type { TileCoord } from "../../map/regionMap";
import {
  sceneryFootprintTilesForFoot,
  singleTileFootprint,
  type SceneryContactModel,
  type SceneryFootprintExtent,
  type SceneryFrameGeometry,
} from "../placement/sceneryFootprint";
import {
  BLOCKING_NIRVANA_WEST_MATERIALS,
  demotedNirvanaWestMaterial,
  hasNirvanaWestRimSet,
  isBlockingNirvanaWestMaterial,
  isNirvanaWestVoidMaterial,
  NIRVANA_WEST_BASE_VARIANTS,
  NIRVANA_WEST_EDGE_VARIANTS,
  NIRVANA_WEST_MATERIAL_PRIORITY,
  NIRVANA_WEST_PLAIN_TIERS,
  type NirvanaWestMaterial,
} from "./NirvanaWestMaterials";

export const NIRVANA_WEST_COLUMNS = 96;
export const NIRVANA_WEST_ROWS = 96;
export const NIRVANA_WEST_TILE_SIZE = 32;
export const NIRVANA_WEST_WIDTH_PX = NIRVANA_WEST_COLUMNS * NIRVANA_WEST_TILE_SIZE;
export const NIRVANA_WEST_HEIGHT_PX = NIRVANA_WEST_ROWS * NIRVANA_WEST_TILE_SIZE;

/** A walkable pocket smaller than this is left alone unless it holds protected ground. */
const MIN_REPAIR_POCKET_TILES = 20;

/**
 * How many times the whole scene may be rebuilt while the prop-connectivity repair
 * carves. Each attempt opens strictly more ground, so this is a safety stop, not a
 * tuning dial — mirrors `WarmSpringsTerrainField.ts`'s `MAX_SCENE_ATTEMPTS`.
 */
const MAX_SCENE_ATTEMPTS = 24;

/** Pre-prop connectivity-repair pass budget. */
const MAX_BASE_REPAIR_PASSES = 60;

/** Prop-removal-vs-rebuild repair pass budget. */
const MAX_PROP_REPAIR_PASSES = 80;

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
  /** The species key into {@link NIRVANA_WEST_PROP_FRAMES}. */
  readonly species: string;
  readonly frameId: string;
  readonly x: number;
  readonly y: number;
  readonly footY: number;
  readonly footX: number;
  readonly blocks: boolean;
  readonly tile: Readonly<{ column: number; row: number }>;
}

/**
 * One built Nirvana West terrain field: the picture (`tiles`, `props`), the mask
 * (`collision`), and the crossing (`causeways`) that keep it connected.
 */
export interface NirvanaWestScene {
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
   * How many PROTECTED tiles the RAW, pre-demotion field would have blocked. The cost
   * this composition's demotion pass paid on the recipe's behalf — how hard the
   * fracture network fights the fixed mechanics geometry.
   */
  readonly demotedTiles: number;
  /**
   * How many large, blocking props (a footprint spanning protected ground) were
   * dropped rather than placed. See {@link NIRVANA_WEST_PROP_FRAMES}'s docstring.
   */
  readonly droppedForProtection: number;
  /**
   * Where each authored industrial site was seated, in tile coordinates.
   *
   * Exposed because "the complex exists and is where the search said it should
   * be" is an assertable property, not a matter of eye: a site that fails to
   * seat leaves the region green and silently without its identity, which is the
   * exact failure the first production pass shipped.
   */
  readonly industrialAnchors: readonly Readonly<{
    id: string; column: number; row: number;
  }>[];
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
// toroidal primitives — kept from the pilot for the ART field only; see the
// module docstring's point 4 for why connectivity repair does NOT use these.
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
 * {@link NIRVANA_WEST_COLUMNS} (96), so the whole field tiles seamlessly across both
 * wrap seams, not just at their exact boundary samples.
 */
function toroidalFbm(x: number, y: number, seed: number, periods: readonly number[]): number {
  let sum = 0;
  let amplitude = 0.5;
  let norm = 0;
  for (let index = 0; index < periods.length; index += 1) {
    const period = periods[index]!;
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

/**
 * A coarse, smoothly-patchy pick between two materials — never per-corner dither.
 *
 * `bias` is the `toroidalFbm` level `a` must clear. 0.5 is an even split; a LOWER
 * bias hands more ground to `a`.
 */
function bandPickBiased(
  x: number,
  y: number,
  seed: number,
  a: NirvanaWestMaterial,
  b: NirvanaWestMaterial,
  bias: number,
): NirvanaWestMaterial {
  return toroidalFbm(x, y, seed, [12, 24]) > bias ? a : b;
}

/** A coarse, smoothly-patchy 50/50 pick between two materials — never per-corner dither. */
function bandPick(
  x: number,
  y: number,
  seed: number,
  a: NirvanaWestMaterial,
  b: NirvanaWestMaterial,
): NirvanaWestMaterial {
  return bandPickBiased(x, y, seed, a, b, 0.5);
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
 * likewise for row 96 vs. row 0 - the periodicity the approved picture relies on
 * holds by construction, not by a later patch.
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
 * lands on column/row 0 or 96. Every POST-build mutation (connectivity-repair
 * carves) must go through this — a raw `corners[i] = m` write at the rim would
 * silently break the seam invariant {@link verifyToroidalSeam} checks for.
 */
function setCornerMaterial(
  corners: NirvanaWestMaterial[],
  column: number,
  row: number,
  material: NirvanaWestMaterial,
): void {
  if (column < 0 || row < 0 || column > NIRVANA_WEST_COLUMNS || row > NIRVANA_WEST_ROWS) return;
  corners[cornerIndex(column, row)] = material;
  if (column === 0) corners[cornerIndex(NIRVANA_WEST_COLUMNS, row)] = material;
  if (column === NIRVANA_WEST_COLUMNS) corners[cornerIndex(0, row)] = material;
  if (row === 0) corners[cornerIndex(column, NIRVANA_WEST_ROWS)] = material;
  if (row === NIRVANA_WEST_ROWS) corners[cornerIndex(column, 0)] = material;
}

/**
 * Proves the torus holds: corner (96, y) must equal corner (0, y) for every row,
 * and corner (x, 96) must equal corner (x, 0) for every column. Kept from the pilot
 * as a supplementary, stronger-than-required check on the ART field's own
 * periodicity — production's REQUIRED wrap invariant is
 * `navigation/wrapSeams.ts`'s `wrapSeamViolations` on the finished, composed recipe
 * grid (see `NirvanaWestRegionMapRecipe.ts`), which is a different and weaker
 * contract (a bounded rim with declared portals, not a fully open torus).
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
// tile derivation
// ---------------------------------------------------------------------------

function tileVariant(column: number, row: number, salt: number, count: number): number {
  if (count <= 0) return 0;
  return Math.floor(hash2(column, row, 0x2468 + salt) * count) % count;
}

/**
 * Materials whose base fill is RULED rather than random — one pinned variant for
 * the whole field, so the drawn joints line up tile to tile.
 *
 * `slab` is the only one, and it is the one exception the region needs. Every
 * other material here is noise (ash, grit, crazing, rubble), and noise wants
 * eight independent variants so the 32 px lattice disappears. Concrete is the
 * opposite: its whole legibility comes from RULED STRAIGHT LINES. Each of the
 * eight authored `t.slab.*` variants draws its bay joints from a different
 * world-space window (`offsetX = variant * 61.5` in the authoring script), so
 * choosing among them per tile scatters the joints at eight different phases —
 * measured on the first cut of the industrial apron, a 25x7 slab field read as a
 * chaotic mesh of dashes, like scaffolding, and not as concrete at all.
 *
 * Pinning one variant makes the joints periodic at the tile pitch and the apron
 * reads instantly as cast bays. The repetition that would be a defect anywhere
 * else is the correct answer here: a poured apron IS repetitive, and rectangles
 * ruled at a constant pitch are the only non-noise shape in a region otherwise
 * made entirely of fracture noise — which is exactly why they are the part of the
 * industrial push that still reads when the island is downsampled.
 */
const NIRVANA_WEST_RULED_MATERIALS: readonly NirvanaWestMaterial[] = Object.freeze(["slab"]);

/** The base-fill variant for one tile — pinned for ruled materials, hashed otherwise. */
function baseFillVariant(
  material: NirvanaWestMaterial,
  column: number,
  row: number,
): number {
  if (NIRVANA_WEST_RULED_MATERIALS.includes(material)) return 0;
  return tileVariant(
    column,
    row,
    NIRVANA_WEST_MATERIAL_PRIORITY[material],
    NIRVANA_WEST_BASE_VARIANTS,
  );
}

function deriveTile(
  corners: readonly NirvanaWestMaterial[],
  column: number,
  row: number,
): NirvanaWestTile {
  const cornerMaterials: readonly NirvanaWestMaterial[] = [
    corners[cornerIndex(column, row)]!,
    corners[cornerIndex(column + 1, row)]!,
    corners[cornerIndex(column + 1, row + 1)]!,
    corners[cornerIndex(column, row + 1)]!,
  ];
  const priorities = cornerMaterials.map((material) => NIRVANA_WEST_MATERIAL_PRIORITY[material]);
  const basePriority = Math.min(...priorities);
  const base = cornerMaterials[priorities.indexOf(basePriority)]!;

  const present = [...new Set(cornerMaterials)]
    .filter((material) => NIRVANA_WEST_MATERIAL_PRIORITY[material] > basePriority)
    .sort((left, right) => (
      NIRVANA_WEST_MATERIAL_PRIORITY[left] - NIRVANA_WEST_MATERIAL_PRIORITY[right]
    ));

  const overlays: NirvanaWestTileOverlay[] = [];
  const rims: NirvanaWestTileRim[] = [];
  const baseIsVoid = isNirvanaWestVoidMaterial(base);
  for (const material of present) {
    const threshold = NIRVANA_WEST_MATERIAL_PRIORITY[material];
    let mask = 0;
    for (let corner = 0; corner < 4; corner += 1) {
      if (priorities[corner]! >= threshold) mask |= 1 << corner;
    }
    if (mask === 0) continue;
    const salt = NIRVANA_WEST_MATERIAL_PRIORITY[material] * 31 + mask;
    // Mask 15 is drawn from the material's own BASE frame, so it takes the same
    // ruled/hashed decision the base fill does — see {@link baseFillVariant}.
    const variant = mask === 15
      ? baseFillVariant(material, column, row)
      : tileVariant(column, row, salt, NIRVANA_WEST_EDGE_VARIANTS[material]);
    overlays.push({ material, mask, variant });
    if (baseIsVoid && mask !== 15 && hasNirvanaWestRimSet(material)) {
      rims.push({ material, mask, variant });
    }
  }

  const blockingCorners = cornerMaterials.filter((material) => (
    BLOCKING_NIRVANA_WEST_MATERIALS.includes(material)
  )).length;
  const blocked = blockingCorners >= 2;

  const agreeing = cornerMaterials.filter(
    (candidate) => isBlockingNirvanaWestMaterial(candidate) === blocked,
  );
  const tally = new Map<NirvanaWestMaterial, number>();
  for (const candidate of agreeing) {
    tally.set(candidate, (tally.get(candidate) ?? 0) + 1);
  }
  let material = agreeing[0]!;
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
    baseVariant: baseFillVariant(base, column, row),
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
    collision[index] = tiles[index]!.blocked ? 1 : 0;
  }
  return collision;
}

// ---------------------------------------------------------------------------
// connectivity — BOUNDED (no wraparound). See the module docstring's point 4.
// ---------------------------------------------------------------------------

export interface NirvanaWestComponent {
  readonly tiles: readonly number[];
}

/** Four-connected walkable components over a row-major collision mask, bounded at the rim. */
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

// ---------------------------------------------------------------------------
// causeways — the crossing resolver. Line-scan positions stay wrapPos-based
// (harmless: every candidate line's own ends are already boundary-rim tiles,
// which the generic recipe closes to hard collision independent of this
// field, gates/seams aside — see the module docstring). The CONNECTIVITY
// REPAIR below this section is what is bounded, not this.
// ---------------------------------------------------------------------------

interface CrossingPlan {
  readonly id: string;
  readonly axis: NirvanaWestCrossingAxis;
  /** Row for an east-west span, column for a north-south span. */
  readonly line: number;
  /** A position along the span axis known/expected to be in blocked ground - a HINT. */
  readonly midstream: number;
}

interface CausewaySpec {
  readonly id: string;
  readonly axis: NirvanaWestCrossingAxis;
  /** The blocked-run length this causeway should read as - short and purposeful. */
  readonly targetSpan: number;
  /** Hard ceiling; a run this long or longer never reads as a single crossing. */
  readonly maxSpan: number;
}

/**
 * Every 4th line across the whole axis - dense enough to find any real feature.
 *
 * Deliberately EXCLUDES line 0: the generic recipe's `markBoundaryCollision` closes
 * the ENTIRE outer rim (every tile of row 0, row `ROWS-1`, column 0 and column
 * `COLUMNS-1`) to hard collision regardless of this terrain, with only rare,
 * narrow exceptions at a gate or a later-declared wrap seam. A causeway whose LINE
 * is the rim itself would be crossing into ground that is closed independent of
 * composition B — not a real crossing, and its far abutment ends up sitting ON the
 * closed rim, which is unreachable by construction. `92` (the last candidate) stays
 * safely interior (`92 < COLUMNS - 1 = 95`), so only the `0` end needs dropping.
 */
const CAUSEWAY_LINE_CANDIDATES: readonly number[] = Object.freeze(
  Array.from({ length: NIRVANA_WEST_COLUMNS / 4 - 1 }, (_, index) => (index + 1) * 4),
);

function crossingTileRef(plan: CrossingPlan, position: number): NirvanaWestTileRef {
  // Only `line` is ever wrapped here, and harmlessly: CAUSEWAY_LINE_CANDIDATES is
  // always in [0, extent). `position` is NEVER wrapped — see this section's header:
  // a production region's real topology is BOUNDED with at most two narrow,
  // separately re-derived portals, not a fully open torus, so wrapping a causeway's
  // own span position would let it seat on ground that is not actually adjacent in
  // the published grid. `position` here is always caller-guaranteed to already be
  // in range; see `blockedAtPosition`'s explicit boundary guard for the read side.
  return plan.axis === "east-west"
    ? { column: position, row: wrapPos(plan.line, NIRVANA_WEST_ROWS) }
    : { column: wrapPos(plan.line, NIRVANA_WEST_COLUMNS), row: position };
}

/**
 * The two things a causeway seat has to know about one position on its line.
 *
 * **`baseClosed` is not a refinement, it is the correctness condition**, and it is
 * Nirvana East's third seed-robustness fix in Nirvana West's clothes (see that
 * region's report §4.3: *base collision is not this field's to change*). A deck
 * sets the TERRAIN tile walkable, but the published grid is `base | terrain`
 * (`composeGroundTerrainCollision`) and the union can only ever ADD blocking — so
 * decking a tile the GENERIC recipe already closes produces a plank a body can
 * never stand on, and an abutment the generic recipe closes is a bank the
 * navigator can never reach. Both show up as `findNavigationPath` returning
 * `unreachable` with 0 of N deck tiles on the route, which is exactly the defect
 * this region shipped with before this pass: the seat was chosen against terrain
 * alone and happened to land on base-closed ground the moment the fissure field
 * was re-weighted.
 */
interface CausewayLineGround {
  /** True when this terrain closes the position, or it is off the end of the line. */
  readonly blocked: (position: number) => boolean;
  /** True when the region's OWN generic collision already closes the position. */
  readonly baseClosed: (position: number) => boolean;
}

/**
 * True when `position` is blocked ground OR outside `[0, extent)` — the region's own
 * rim is itself a hard wall for causeway-seating purposes (see this section's header),
 * so treating "off the end" as "blocked" is what stops an abutment search from ever
 * wrapping past the true boundary.
 */
function blockedAtPosition(
  tiles: readonly NirvanaWestTile[],
  axis: NirvanaWestCrossingAxis,
  line: number,
  position: number,
): boolean {
  const extent = axis === "east-west" ? NIRVANA_WEST_COLUMNS : NIRVANA_WEST_ROWS;
  if (position < 0 || position >= extent) return true;
  const ref = crossingTileRef({ id: "", axis, line, midstream: 0 }, position);
  return tiles[ref.row * NIRVANA_WEST_COLUMNS + ref.column]!.blocked;
}

/** The terrain/base pair of predicates for one candidate line. */
function causewayLineGround(
  tiles: readonly NirvanaWestTile[],
  baseCollision: Uint8Array,
  axis: NirvanaWestCrossingAxis,
  line: number,
): CausewayLineGround {
  const extent = axis === "east-west" ? NIRVANA_WEST_COLUMNS : NIRVANA_WEST_ROWS;
  return {
    blocked: (position: number): boolean => blockedAtPosition(tiles, axis, line, position),
    baseClosed: (position: number): boolean => {
      if (position < 0 || position >= extent) return true;
      const ref = crossingTileRef({ id: "", axis, line, midstream: 0 }, position);
      return baseCollision[ref.row * NIRVANA_WEST_COLUMNS + ref.column] === 1;
    },
  };
}

/** A position a deck may legally cover: this terrain closes it, the base does not. */
function isDeckable(ground: CausewayLineGround, position: number): boolean {
  return ground.blocked(position) && !ground.baseClosed(position);
}

/** A position a body may stand on: neither this terrain nor the base closes it. */
function isAbutment(ground: CausewayLineGround, position: number): boolean {
  return !ground.blocked(position) && !ground.baseClosed(position);
}

/**
 * The longest contiguous DECKABLE run on one line, within `[0, extent)` — a plain
 * linear scan, deliberately NOT wrapped (see this section's header). A run whose
 * far end never reaches an in-bounds open tile — i.e. one that touches the true
 * region boundary at position 0 or `extent - 1` — is REJECTED (`null`): such a run
 * has no far-side abutment to cross to and is not a real crossing, only a dead end
 * into the region's own closed rim. A base-closed position ENDS a run rather than
 * extending it, and a run whose own abutments are not stand-on-able is rejected —
 * see {@link CausewayLineGround}.
 */
function longestBlockedRun(
  tiles: readonly NirvanaWestTile[],
  baseCollision: Uint8Array,
  axis: NirvanaWestCrossingAxis,
  line: number,
): { readonly center: number; readonly length: number } | null {
  const extent = axis === "east-west" ? NIRVANA_WEST_COLUMNS : NIRVANA_WEST_ROWS;
  const ground = causewayLineGround(tiles, baseCollision, axis, line);

  let bestStart = -1;
  let bestLength = 0;
  let curStart = -1;
  let curLength = 0;
  const consider = (start: number, length: number): void => {
    if (length <= bestLength) return;
    if (start === 0 || start + length - 1 === extent - 1) return;
    if (!isAbutment(ground, start - 1) || !isAbutment(ground, start + length)) return;
    bestLength = length;
    bestStart = start;
  };
  for (let position = 0; position < extent; position += 1) {
    if (isDeckable(ground, position)) {
      if (curStart === -1) curStart = position;
      curLength += 1;
      consider(curStart, curLength);
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
 * never leave a causeway plan pointing at dry ground. The abutment search is
 * bounded at the true rim (`first > 0`, `last < extent - 1`): the region's own
 * boundary is a hard wall for a causeway to seat against, not a wraparound point.
 */
function resolveCrossing(
  tiles: readonly NirvanaWestTile[],
  baseCollision: Uint8Array,
  plan: CrossingPlan,
  maxSpan: number,
): NirvanaWestCrossing {
  const extent = plan.axis === "east-west" ? NIRVANA_WEST_COLUMNS : NIRVANA_WEST_ROWS;
  const ground = causewayLineGround(tiles, baseCollision, plan.axis, plan.line);
  const deckable = (position: number): boolean => isDeckable(ground, position);

  let midstream = plan.midstream;
  if (!deckable(midstream)) {
    let found: number | null = null;
    for (let offset = 1; offset <= MAX_CAUSEWAY_SEARCH && found === null; offset += 1) {
      for (const candidate of [midstream - offset, midstream + offset]) {
        if (deckable(candidate)) {
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
  while (first > 0 && deckable(first - 1) && midstream - first < maxSpan) first -= 1;
  let last = midstream;
  while (last < extent - 1 && deckable(last + 1) && last - midstream < maxSpan) last += 1;

  if (first <= 0 || last >= extent - 1
    || !isAbutment(ground, first - 1) || !isAbutment(ground, last + 1)) {
    throw new NirvanaWestSceneError(
      `Causeway ${plan.id}: the blocked run from ${first} to ${last} does not reach walkable `
      + `ground at both ends within ${maxSpan} tiles (or runs into the region's own boundary).`,
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
function seatCauseway(
  tiles: readonly NirvanaWestTile[],
  baseCollision: Uint8Array,
  spec: CausewaySpec,
): NirvanaWestCrossing {
  let best: { readonly line: number; readonly center: number; readonly length: number } | null = null;
  for (const line of CAUSEWAY_LINE_CANDIDATES) {
    const run = longestBlockedRun(tiles, baseCollision, spec.axis, line);
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
  return resolveCrossing(tiles, baseCollision, plan, spec.maxSpan);
}

function resolveCauseways(
  tiles: readonly NirvanaWestTile[],
  baseCollision: Uint8Array,
  specs: readonly CausewaySpec[],
): NirvanaWestCrossing[] {
  return specs.map((spec) => seatCauseway(tiles, baseCollision, spec));
}

/** Overlay causeway decks onto derived tiles; `causeway` is never sampled in the corner field. */
function applyCrossingDecks(
  tiles: readonly NirvanaWestTile[],
  crossings: readonly NirvanaWestCrossing[],
): NirvanaWestTile[] {
  const decked = [...tiles];
  for (const crossing of crossings) {
    for (const ref of crossing.deck) {
      const index = ref.row * NIRVANA_WEST_COLUMNS + ref.column;
      const tile = decked[index]!;
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
// protection — driven entirely by the recipe-derived mask built in
// `NirvanaWestRegionMapRecipe.ts`'s `nirvanaWestProtectionFromRecipe`.
// ---------------------------------------------------------------------------

/**
 * The ground production forbids blocking terrain from ever closing.
 *
 * Row-major over the canonical 96x96 grid, `1` = protected. Built by
 * `NirvanaWestRegionMapRecipe.ts` from the REAL recipe — anchors, gates, staging,
 * shelter plot render footprints, passive scenery, scenic cluster anchors, animated
 * environment tiles, visual-path cells, terrain patches, occupied-home approach
 * bindings, story anchors, and every `pathMask`/`soilMask` cell — so this field never
 * has to guess the world's mechanics geometry.
 */
export interface NirvanaWestProtection {
  readonly columns: number;
  readonly rows: number;
  readonly protected: Uint8Array;
}

/** True when any of the four tiles touching corner `(column, row)` is protected. */
function cornerTouchesProtectedTile(
  protection: NirvanaWestProtection,
  column: number,
  row: number,
): boolean {
  for (const [dc, dr] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
    const c = wrapPos(column + dc, NIRVANA_WEST_COLUMNS);
    const r = wrapPos(row + dr, NIRVANA_WEST_ROWS);
    if (protection.protected[r * NIRVANA_WEST_COLUMNS + c] === 1) return true;
  }
  return false;
}

function isProtectedTile(protection: NirvanaWestProtection, index: number): boolean {
  return protection.protected[index] === 1;
}

/**
 * Demote every blocking corner that touches a protected tile.
 *
 * Because a tile only blocks at >= 2 blocking corners (`deriveTile`), a protected tile
 * can then never be blocked — the guarantee is structural, not a post-hoc repair. Every
 * corner (0..96 inclusive on both axes) is visited directly rather than through
 * {@link setCornerMaterial}'s mirroring: `cornerTouchesProtectedTile` already evaluates
 * identically at column/row 0 and 96 (both reduce to the same wrapped tile indices), so
 * the two rim copies are demoted independently but always agree.
 */
function demoteProtectedCorners(
  corners: NirvanaWestMaterial[],
  protection: NirvanaWestProtection,
): void {
  for (let row = 0; row <= NIRVANA_WEST_ROWS; row += 1) {
    for (let column = 0; column <= NIRVANA_WEST_COLUMNS; column += 1) {
      const index = cornerIndex(column, row);
      const material = corners[index]!;
      if (isBlockingNirvanaWestMaterial(material) && cornerTouchesProtectedTile(protection, column, row)) {
        corners[index] = demotedNirvanaWestMaterial(material);
      }
    }
  }
}

/** How many PROTECTED tiles the RAW (pre-demotion) field would have blocked. */
function countRawBlockedProtectedTiles(
  rawTiles: readonly NirvanaWestTile[],
  protection: NirvanaWestProtection,
): number {
  let count = 0;
  for (let index = 0; index < rawTiles.length; index += 1) {
    if (isProtectedTile(protection, index) && rawTiles[index]!.blocked) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// composition B - The Ember Rift (dendritic fracture network). UNCHANGED from
// the pilot: bearings, kink/branch machinery, width modulation, weld field.
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

// Bearings spread widely (roughly 0.3 / 1.6 / 2.8 / 4.5 rad) so the four trunks
// genuinely CROSS rather than running as near-parallel slashes on the same bearing.
const EMBER_TRUNKS: readonly TrunkSpec[] = Object.freeze([
  { x: 6, y: 74, ang: 0.30, width: 3.4, steps: 22, seed: 0xb101 },
  { x: 88, y: 26, ang: 1.60, width: 3.0, steps: 20, seed: 0xb102 },
  { x: 44, y: 92, ang: 2.80, width: 2.6, steps: 18, seed: 0xb103 },
  // 4th trunk, started from grid centre so it runs through the CENTRAL third
  // rather than round a margin: only ~36% of this island's land projects onto
  // the world map, and the free-margin belt is the thinnest-surviving part of
  // that. A rift confined to the margins would be almost invisible on the
  // island map; one that runs through the settlement's own centre reads.
  { x: 48, y: 50, ang: 4.50, width: 3.0, steps: 20, seed: 0xb104 },
]);

const MAX_FRACTURE_SEGMENTS = 170;

/**
 * Width along one branch's own run: pinches toward a hairline and swells to
 * 2.6-2.8x base using 1D fbm over the branch's own progress fraction - never a
 * constant-width ribbon, which reads as a painted stripe rather than a crack.
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
    ang += randRange(rng, -0.6, 0.6);
    const nx = x + Math.cos(ang) * run;
    const ny = y + Math.sin(ang) * run;
    const width = baseWidth * fractureWidthFactor(i / steps, widthSeed);
    segments.push({ ax: x, ay: y, bx: nx, by: ny, width });
    if (depth < 2 && rng() < 0.22 && segments.length < MAX_FRACTURE_SEGMENTS) {
      const sign = rng() < 0.5 ? -1 : 1;
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
 * How much of the fissure CORE stays LIVE molten `ember` rather than cooling to
 * `emberdim` — the `toroidalFbm` level a core corner must clear to burn.
 *
 * **This is the region's single most consequential picture dial, and it was
 * measured against the approved pilot plate rather than chosen.** At the pilot's
 * even 0.5 split the shipped region drew `ember` over **0.72 %** of its own
 * surface against `emberdim`'s 8.25 % — an 11:1 defeat for the one material that
 * carries the region's only saturated accent. The consequence is visible in the
 * production plate the owner rejected: because `ember` has the LOWEST paint
 * priority it is always a tile's base, so a core tile holding a single ember
 * corner shows one quarter of molten rock under three quarters of cold overlay.
 * Dithered evenly, the fire therefore never assembles into a basin — it survives
 * only as a one-tile contour where the dither happens to run, which reads as
 * coral WIRE around dark voids instead of the approved plate's broad, crazed,
 * glowing floor.
 *
 * Lowering the bias inverts the core's default: molten unless cooled. The welds
 * (`SEED_B_WELD`) still cross it, the `band` geometry is untouched, and the
 * fissure network is exactly where it was — only the core's interior temperature
 * changes. `ember` BLOCKS, so this is also a collision dial; the value is the
 * lowest one measured to hold every invariant (see the region report's
 * before/after table).
 */
const EMBER_CORE_LIVE_BIAS = 0.18;

/**
 * Dark-dominant by design: this region is dark with bright accents, not bright
 * with dark cracks. `ashpale`/`ash` are DELIBERATELY absent from the plains -
 * they only ever appear in the narrow halo immediately around a fissure.
 */
function emberRiftPlainsMaterial(x: number, y: number): NirvanaWestMaterial {
  const tier = toroidalFbm(x, y, SEED_B_PLAINS, [8, 16, 32]);
  if (tier > 0.78) return "dust";
  if (tier > 0.48) return "slate";
  if (tier > 0.20) return "slatedark";
  return "cinder";
}

/**
 * Composition B's material field. Never references `brine` or `rime` — both belonged
 * to compositions A and C, which the owner did not choose — so this field is
 * unaffected by whether those two materials remain declared in
 * `NirvanaWestMaterials.ts` or are trimmed from it.
 */
function emberRiftMaterialAt(
  x: number,
  y: number,
  segments: readonly FractureSegment[],
): NirvanaWestMaterial {
  const { distance, width } = nearestFracture(x, y, segments);
  const grain = (toroidalFbm(x, y, SEED_B_GRAIN, [6, 12, 24]) - 0.5) * 1.6;
  const band = (distance + grain) / width;

  let material: NirvanaWestMaterial;
  if (band < 0.55) {
    material = bandPickBiased(
      x, y, SEED_B_GRAIN + 1, "ember", "emberdim", EMBER_CORE_LIVE_BIAS,
    );
  }
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

/** Target 8, cap 16: a genuinely wide trunk swell, not the narrowest weld gap. */
const EMBER_RIFT_CAUSEWAY_SPECS: readonly CausewaySpec[] = Object.freeze([
  { id: "b-ew-trunk", axis: "east-west", targetSpan: 8, maxSpan: 16 },
  { id: "b-ns-trunk", axis: "north-south", targetSpan: 8, maxSpan: 16 },
]);

// ---------------------------------------------------------------------------
// scenery frame geometry + ground-contact footprints
// ---------------------------------------------------------------------------

/**
 * One species' frame geometry, and — for BLOCKING species whose sprite is drawn
 * wider than the one tile its foot pivot occupies — the ground-contact model
 * `sceneryFootprintTilesForFoot` (`../placement/sceneryFootprint.ts`) needs to
 * compute its real footprint.
 */
export interface NirvanaWestPropFrame {
  readonly width: number;
  readonly height: number;
  readonly pivotX: number;
  readonly pivotY: number;
  /**
   * Ground-contact model, present only for species whose drawn frame is
   * meaningfully wider than one tile. Absent means "ordinary small prop" —
   * footprint resolved via `singleTileFootprint` instead.
   */
  readonly contact?: SceneryContactModel;
}

/**
 * Every species' frame geometry, hand-read from the shipped
 * `assets/renderer2d/regions/nirvana-west-v1/atlas.json`'s own authored
 * `sceneryFrames` table (`[frameId, x, y, width, height, pivotX, pivotY]`) so a
 * prop's foot lands exactly where the art was drawn to be anchored — the same
 * "scene hardcodes what the art authored" discipline `springsScene.ts`'s
 * `PROP_PIVOTS` uses.
 *
 * **A single exported const another module can extend.** Adding a species here is
 * a one-line data change: a frame entry, and — only if it is a BLOCKING species
 * whose sprite spans more than about one tile — a `contact` model. This table is
 * intentionally wider than the species this module actually PLACES (see
 * {@link SPECIES}): it also carries frame geometry for every other species the
 * shipped atlas contains (the industrial-complex species — powerhall, tankfarm,
 * pipeline, fence, railspur, slab, apron, spill, tailings — and the two
 * rime-biased pilot props, bonestone/rimecluster, which this composition's own
 * material field never produces ground for), so a future placement pass — an
 * industrial-complex layout, say — can call `sceneryFootprintTilesForFoot` against
 * this SAME table without inventing a second one.
 *
 * **Contact-model fractions were derived from the real authoring geometry**, not
 * guessed: each large structure's ground-contact rect/ellipse was read directly out
 * of its paint function (`author-nirvana-west-production-art.mjs`) — the pixel
 * column/row range where the structure's own drawn base actually touches `baseY`
 * (its pivot row), excluding the reserved cast-shadow margin the frame carries
 * around it. `coolingtower` and `reactorhusk` are true radially-symmetric structures
 * at their base, so their contact is an `ellipse`; `gantry`, `stack`, `powerhall` and
 * `tankfarm` combine a narrow mast/wall with a separate ground object (a fallen
 * pipe, a fallen truss, a bunded tank row) offset from it, so their contact is the
 * tighter-fitting `rect`. `pylon`'s own leg-spread base (measured ≈0.89 tile inside
 * its 40px frame) already fits inside one tile, so it stays an ordinary small prop
 * with no declared contact model.
 *
 * **Protected ground: drop, never move.** `placeProps` below drops (does not
 * place) any BLOCKING prop whose footprint would cover a protected mechanics
 * tile, rather than nudging it elsewhere. Moving would require re-deriving a new
 * foot position and re-checking material eligibility, terrain-blocked status and
 * every other placed prop's claim all over again — a second placement pass with
 * its own failure modes — for an outcome (ruins are already rare: a few dozen per
 * built region) that dropping achieves for free and monotonically: it can only
 * ever leave MORE ground open, never risk closing protected ground by accident.
 */
export const NIRVANA_WEST_PROP_FRAMES: Readonly<Record<string, NirvanaWestPropFrame>> = Object.freeze({
  // --- placed by this module (see SPECIES) --------------------------------
  snag: { width: 32, height: 72, pivotX: 16, pivotY: 68 },
  snagtall: { width: 28, height: 88, pivotX: 14, pivotY: 84 },
  snagfallen: { width: 56, height: 24, pivotX: 28, pivotY: 21 },
  stump: { width: 24, height: 20, pivotX: 12, pivotY: 18 },
  slagrock: { width: 40, height: 32, pivotX: 20, pivotY: 29 },
  ashpile: { width: 40, height: 24, pivotX: 20, pivotY: 21 },
  ejecta: { width: 40, height: 32, pivotX: 20, pivotY: 29 },
  clinkerchunk: { width: 28, height: 20, pivotX: 14, pivotY: 18 },
  deadbrush: { width: 32, height: 28, pivotX: 16, pivotY: 26 },
  ashripple: { width: 32, height: 20, pivotX: 16, pivotY: 18 },
  glassshard: { width: 20, height: 28, pivotX: 10, pivotY: 26 },
  emberwisp: { width: 40, height: 56, pivotX: 20, pivotY: 50 },
  // Leg-spread base ≈28.4px inside a 40px frame (≈0.89 tile) - fits in one
  // tile at its own measured base, so no contact model is declared.
  pylon: { width: 40, height: 96, pivotX: 20, pivotY: 92 },
  causeway: { width: 32, height: 32, pivotX: 16, pivotY: 31 },
  coolingtower: {
    width: 184, height: 176, pivotX: 50, pivotY: 132,
    // Base ring radius 30px at y=baseY (radiusAt(0) = 30 - sin(0)*12 = 30),
    // centred on the tower's own drawn axis (cx === pivotX exactly).
    contact: {
      shape: "ellipse", centerXFraction: 0.2717, centerYFraction: 0.75,
      halfWidthFraction: 0.1630, halfHeightFraction: 0.0815, shrink: 0.9,
    },
  },
  reactorhusk: {
    width: 184, height: 136, pivotX: 52, pivotY: 106,
    // Dome half-width R = 40 + variant*4; conservative (max, variant=1) R=44.
    contact: {
      shape: "ellipse", centerXFraction: 0.2826, centerYFraction: 0.7794,
      halfWidthFraction: 0.2391, halfHeightFraction: 0.1196, shrink: 0.9,
    },
  },
  gantry: {
    width: 164, height: 120, pivotX: 22, pivotY: 88,
    // Union of the mast's braced base (x 13..31) and the fallen pipe lying on
    // the ground beside it (x 6..100, y baseY-15..baseY+3).
    contact: {
      shape: "rect", centerXFraction: 0.3232, centerYFraction: 0.6833,
      halfWidthFraction: 0.2866, halfHeightFraction: 0.075, shrink: 0.85,
    },
  },
  stack: {
    width: 176, height: 164, pivotX: 28, pivotY: 124,
    // Union of the chimney base (x 15..41) and the snapped piece lying to the
    // right (x 46..104, y fallY-6..fallY+6).
    contact: {
      shape: "rect", centerXFraction: 0.3381, centerYFraction: 0.7256,
      halfWidthFraction: 0.2528, halfHeightFraction: 0.0366, shrink: 0.85,
    },
  },
  // --- present in the shipped atlas; not placed by this module's SPECIES
  // table (rime-biased, or belong to compositions/kits this module drops) —
  // kept here purely as extension data, per this table's own docstring.
  bonestone: { width: 24, height: 44, pivotX: 12, pivotY: 41 },
  rimecluster: { width: 24, height: 20, pivotX: 12, pivotY: 18 },
  dunecrest: { width: 48, height: 20, pivotX: 24, pivotY: 18 },
  slabtilt: { width: 28, height: 36, pivotX: 14, pivotY: 33 },
  // --- the owner's industrial-complex addition (data only — see this
  // module's return report for why placement is out of scope here) --------
  powerhall: {
    width: 320, height: 208, pivotX: 70, pivotY: 168,
    // Wall base spans local x 8..~238 at y=baseY; footprint is the wall's own
    // ground line, not its height.
    contact: {
      shape: "rect", centerXFraction: 0.3844, centerYFraction: 0.7788,
      halfWidthFraction: 0.3594, halfHeightFraction: 0.0385, shrink: 0.85,
    },
  },
  tankfarm: {
    width: 184, height: 124, pivotX: 44, pivotY: 100,
    // The containment bund (x 6..162, y baseY-9..baseY) - the tanks (cx 40/92/136,
    // r <= 27) all stand fully within it, so the bund alone bounds the footprint.
    contact: {
      shape: "rect", centerXFraction: 0.4565, centerYFraction: 0.7702,
      halfWidthFraction: 0.4239, halfHeightFraction: 0.0363, shrink: 0.85,
    },
  },
  tailings: {
    width: 96, height: 52, pivotX: 40, pivotY: 46,
    // Union of the spoil heap and its flat spill fan (local x 2..94).
    contact: {
      shape: "rect", centerXFraction: 0.5, centerYFraction: 0.8558,
      halfWidthFraction: 0.4792, halfHeightFraction: 0.0865, shrink: 0.85,
    },
  },
  pipeline: { width: 32, height: 44, pivotX: 16, pivotY: 38 },
  fence: { width: 32, height: 30, pivotX: 16, pivotY: 28 },
  railspur: { width: 32, height: 18, pivotX: 16, pivotY: 16 },
  slab: { width: 64, height: 44, pivotX: 32, pivotY: 40 },
  apron: { width: 96, height: 60, pivotX: 48, pivotY: 56 },
  spill: { width: 48, height: 32, pivotX: 24, pivotY: 29 },
});

const FOOTPRINT_EXTENT: SceneryFootprintExtent = Object.freeze({
  columns: NIRVANA_WEST_COLUMNS,
  rows: NIRVANA_WEST_ROWS,
  tileSize: NIRVANA_WEST_TILE_SIZE,
  topology: "toroidal",
});

/**
 * Every tile one placed prop's ground contact occupies, resolved through the
 * shared `../placement/sceneryFootprint.ts` — declared-contact species get their
 * real multi-tile footprint; everything else stays the ordinary single tile.
 *
 * @throws {NirvanaWestSceneError} If `species` has no {@link NIRVANA_WEST_PROP_FRAMES} entry.
 */
function propFootprintTiles(
  species: string,
  footColumn: number,
  footRow: number,
): readonly TileCoord[] {
  const frame = NIRVANA_WEST_PROP_FRAMES[species];
  if (frame === undefined) {
    throw new NirvanaWestSceneError(`Nirvana West scene has no frame entry for species ${species}.`);
  }
  if (frame.contact === undefined) {
    return singleTileFootprint({ footColumn, footRow }, FOOTPRINT_EXTENT);
  }
  const geometry: SceneryFrameGeometry = {
    width: frame.width, height: frame.height, pivotX: frame.pivotX, pivotY: frame.pivotY,
  };
  return sceneryFootprintTilesForFoot({ footColumn, footRow }, geometry, frame.contact, FOOTPRINT_EXTENT);
}

// ---------------------------------------------------------------------------
// THE INDUSTRIAL COMPLEX — an authored LAYOUT seated by searching the terrain
// ---------------------------------------------------------------------------

/**
 * @remarks
 * **Why a layout and not a scatter, and why this is the whole difference between
 * "industry" and "a junkyard".**
 *
 * The region shipped once with the industrial vocabulary AUTHORED but never
 * PLACED — `powerhall`, `tankfarm`, `tailings`, `pipeline`, `fence` and
 * `railspur` all drew zero times, and the walkable `slab`/`spoil` tiers were
 * declared, published in the atlas and sampled zero times. Handing those species
 * to the existing cluster/scatter machinery ({@link SPECIES}) would have placed
 * them, and would have been the WRONG fix: scattering a turbine hall and a tank
 * farm at independent random anchors produces objects standing near each other,
 * which is not a plant. Three things make a site read, and none of them is
 * quantity:
 *
 * 1. **Relationship and scale.** One hero — the most intact structure in the
 *    frame, so the eye has something to name — with everything else supporting
 *    it. The `powerhall` is the only piece in the vocabulary with WINDOWS and the
 *    only wide horizontal mass, so it is the counterweight to all the verticals;
 *    the `tankfarm` is the only piece that is itself a REPEATED unit, and three
 *    of the same thing standing together is what separates a plant from a ruin.
 * 2. **Connective tissue.** `pipeline`, `fence` and `railspur` frames JOIN at the
 *    32 px tile pitch, so they are laid as RUNS, not sprinkled. Runs are what
 *    turn scattered objects into a site — and, laid at exact tile centres with no
 *    jitter, they are the only straight lines in a region otherwise made of
 *    fracture noise. All three are NON-BLOCKING by decision (a perimeter fence a
 *    body cannot step through would quarter the region; a rail spur is flat; a
 *    pipe run is elevated on trestles), which is what lets them march straight
 *    across the settled band at zero cost to a single plot, route or staging
 *    point.
 * 3. **Ground evidence.** `slab` and `spoil` are TERRAIN, not decals, and they
 *    are walkable — so an apron runs under a shelter plot at zero plot cost, and
 *    because they are the only RECTANGLES in the region they are the part of this
 *    push that still reads at island scale, where a 100-300 px ruin sits under the
 *    ~3-4 tile floor and vanishes.
 *
 * The sites are AUTHORED in tile offsets and SEATED by searching the real
 * terrain: every candidate anchor is scored by how many of its pieces land on
 * plain, unprotected, unblocked ground, penalised for fissure inside the site
 * box, and tie-broken toward the centre of the region so the works ends up over
 * the settlement rather than in the margin. Pieces are then refused INDIVIDUALLY
 * at placement time — dropped, never moved, exactly as {@link
 * NIRVANA_WEST_PROP_FRAMES}'s docstring requires.
 */

/** One authored piece of a site, positioned in tile offsets from the site anchor. */
interface IndustrialPieceSpec {
  readonly species: string;
  /** Tile offset east of the anchor. */
  readonly dc: number;
  /** Tile offset south of the anchor. */
  readonly dr: number;
  readonly variant: number;
  /**
   * Weight in the anchor search. The hero and the hall carry most of it: an
   * anchor that seats the tank farm but loses the cooling tower is not the site.
   */
  readonly weight: number;
  /**
   * When true, an anchor that cannot seat this piece is not a candidate at all.
   *
   * Weight alone is not enough, and that was measured: with the site saturating
   * at a "satisfied" weight, the search happily traded the turbine hall away for
   * five points of smaller pieces and seated a plant with no hall in it. The
   * hall is the only structure in the vocabulary with WINDOWS and the only wide
   * horizontal mass — losing it does not make the site 20 % worse, it makes it a
   * different and much weaker picture. Requirement, not price.
   */
  readonly required?: boolean;
  /**
   * Additional AUTHORED bays for this piece, tried in declared order when the
   * first is refused.
   *
   * **This is authoring, not relocation, and the distinction is load-bearing.**
   * The region's safety rule is that a blocking prop whose ground contact would
   * cover protected ground is DROPPED, never moved — and that rule is untouched:
   * it still runs unconditionally in {@link placeProps}, on whatever bay the plan
   * chose, and drops the piece outright. What `bays` changes is the PLAN: the
   * layout declares two or three places in the compound where a given piece
   * would be compositionally right, instead of exactly one, so a stack refused by
   * a staging point two tiles wide moves to the next bay of the same plant rather
   * than leaving a hole. Every bay is hand-declared and part of the design; none
   * is derived, searched or nudged. Measured without them: three of the works'
   * ten pieces were refused at every seed and the eastern third of the apron
   * stood empty.
   */
  readonly bays?: readonly Readonly<{ dc: number; dr: number }>[];
}

/** An axis-aligned ground-evidence rectangle, in tile offsets from the site anchor. */
interface IndustrialGroundRect {
  readonly material: NirvanaWestMaterial;
  readonly dc: number;
  readonly dr: number;
  readonly columns: number;
  readonly rows: number;
}

/** One authored site: its pieces, its ground evidence, and how it is seated. */
interface IndustrialSiteSpec {
  readonly id: string;
  readonly pieces: readonly IndustrialPieceSpec[];
  readonly ground: readonly IndustrialGroundRect[];
  /** The site's own bounding box in tile offsets — scored for "is this a plain?". */
  readonly box: Readonly<{ west: number; east: number; north: number; south: number }>;
  /** Wrapped Chebyshev tiles this site must keep from every earlier-seated site. */
  readonly minSeparation: number;
  /**
   * The weighted fit at or above which the site counts as fully seated, so the
   * search stops buying pieces and starts buying POSITION.
   *
   * Without this the search is a pure fit maximiser, and a pure fit maximiser
   * always walks to the empty margin: the only ground that seats twenty-six tiles
   * of plant with nothing refused is ground nobody lives on. Measured — seated
   * that way the works landed at column 5, the far western rim, which is
   * precisely the "the identity lives around the edge of where beings actually
   * are" defect this programme has already had to fix once in Nirvana East.
   * Above this threshold the site is complete enough to read, and every further
   * point of fit is worth less than being where it can be SEEN — so ties are
   * broken toward the middle of the region and the works ends up looming over a
   * district instead of decorating the rim.
   */
  readonly satisfiedWeight: number;
}

/**
 * THE WORKS — the one dominant complex.
 *
 * Anchor is the hero cooling tower's own foot. Read left to right the frame is:
 * the turbine hall (wide, horizontal, windowed), a stack, the hero tower, a
 * second stack, the reactor husk; and threaded along the front, low and flat, two
 * tank farms, a gantry and two spoil heaps. That is deliberately a SILHOUETTE
 * composition: two tall verticals flanking the hero, one long horizontal mass
 * beside it, and a low front row so nothing important is hidden by the foot sort.
 *
 * **WIDE AND SHALLOW is a measured decision, not a style.** The first cut was
 * nine rows deep, and in the settled band that is fatal: the plot-free corridor
 * running through the middle of this settlement is about seven rows tall, so a
 * deep site either reaches into a district — where its whole front row is
 * refused on protected ground, measured at four pieces lost — or the search
 * walks it out to the empty rim to find room. Four foot rows fit the corridor
 * the settlement actually leaves, and a long frontage is in any case the truer
 * silhouette for a plant seen from this angle.
 */
const NIRVANA_WEST_WORKS: IndustrialSiteSpec = Object.freeze({
  id: "works",
  pieces: Object.freeze([
    // The hero stands in the FRONT rank with clear ground either side of it.
    // Nothing in this vocabulary is bigger than the turbine hall, so the tower
    // cannot be the hero by size; it is the hero by being unique in the region,
    // central in the site, and the one structure nothing is drawn in front of.
    {
      species: "coolingtower", dc: 0, dr: 1, variant: 0, weight: 6, required: true,
      bays: [{ dc: 0, dr: 2 }, { dc: 0, dr: 0 }],
    },
    {
      species: "powerhall", dc: -13, dr: -2, variant: 0, weight: 5, required: true,
      bays: [{ dc: -13, dr: -3 }, { dc: -13, dr: -1 }],
    },
    {
      species: "reactorhusk", dc: 11, dr: -3, variant: 0, weight: 2,
      bays: [{ dc: 11, dr: -1 }, { dc: 13, dr: 3 }],
    },
    {
      species: "stack", dc: -4, dr: -1, variant: 0, weight: 2,
      bays: [{ dc: -4, dr: -3 }, { dc: -6, dr: -1 }],
    },
    {
      species: "stack", dc: 12, dr: -1, variant: 1, weight: 2,
      bays: [{ dc: 12, dr: -3 }, { dc: 14, dr: -1 }],
    },
    {
      species: "tailings", dc: -15, dr: 2, variant: 0, weight: 1,
      bays: [{ dc: -15, dr: 3 }, { dc: -15, dr: 1 }],
    },
    {
      species: "tankfarm", dc: -9, dr: 2, variant: 0, weight: 3,
      bays: [{ dc: -9, dr: 3 }, { dc: -9, dr: 1 }],
    },
    {
      species: "tankfarm", dc: 5, dr: 2, variant: 1, weight: 2,
      bays: [{ dc: 5, dr: 3 }, { dc: 5, dr: 1 }],
    },
    {
      species: "gantry", dc: 9, dr: 2, variant: 0, weight: 1,
      bays: [{ dc: 9, dr: 3 }, { dc: 7, dr: 3 }],
    },
    {
      species: "tailings", dc: 15, dr: 2, variant: 1, weight: 1,
      bays: [{ dc: 15, dr: 3 }, { dc: 17, dr: 3 }],
    },
  ]),
  ground: Object.freeze([
    // The main apron: the pad the plant stands ON, sized to the plant — long and
    // shallow, exactly as the plant is. Held SNUG deliberately: the first cut
    // poured 28x8 under five structures and read as an empty car park, because a
    // pale rectangle much larger than the things on it makes them look small,
    // and `slab` is the brightest material in a region whose whole discipline is
    // dark ground with one accent.
    { material: "slab", dc: -16, dr: -2, columns: 32, rows: 6 },
    // The back pad, offset and narrower, so the concrete reads as CAST BAYS
    // rather than one painted block.
    { material: "slab", dc: -8, dr: -4, columns: 23, rows: 2 },
    // Tailings staining. Deliberately WIDER than the concrete and much darker:
    // this is how the site's ground evidence gets to be large without the pale
    // value taking over the frame.
    { material: "spoil", dc: -19, dr: 4, columns: 38, rows: 3 },
    { material: "spoil", dc: -22, dr: -3, columns: 4, rows: 8 },
  ] as const),
  box: Object.freeze({ west: -17, east: 19, north: -6, south: 5 }),
  minSeparation: 0,
  // 25 of 25 available. The hero and the hall are REQUIRED (11), so this buys
  // both stacks and the first tank farm on top of them — the pieces that ARE
  // the composition — and spends everything above that on position.
  satisfiedWeight: 18,
});

/**
 * THE SATELLITE — one smaller works, so the region reads as an industrial
 * LANDSCAPE rather than as one object with empty ground around it.
 *
 * Deliberately has no cooling tower: the hero is unique, which is what lets it
 * be the thing the eye names.
 */
const NIRVANA_WEST_SATELLITE: IndustrialSiteSpec = Object.freeze({
  id: "satellite",
  pieces: Object.freeze([
    {
      species: "tankfarm", dc: 0, dr: 0, variant: 1, weight: 4, required: true,
      bays: [{ dc: 0, dr: 1 }, { dc: 0, dr: -1 }],
    },
    {
      species: "stack", dc: -6, dr: -2, variant: 2, weight: 3,
      bays: [{ dc: -6, dr: -1 }, { dc: -8, dr: -2 }],
    },
    {
      species: "gantry", dc: 5, dr: 1, variant: 1, weight: 2,
      bays: [{ dc: 5, dr: 2 }, { dc: 7, dr: 1 }],
    },
    {
      species: "tailings", dc: 2, dr: 4, variant: 0, weight: 1,
      bays: [{ dc: 2, dr: 3 }, { dc: 4, dr: 4 }],
    },
  ]),
  ground: Object.freeze([
    { material: "slab", dc: -8, dr: -3, columns: 17, rows: 7 },
    { material: "spoil", dc: 0, dr: 3, columns: 7, rows: 4 },
  ] as const),
  box: Object.freeze({ west: -9, east: 9, north: -6, south: 6 }),
  minSeparation: 26,
  // 10 of 10 available; 7 keeps the tank farm and the stack.
  satisfiedWeight: 7,
});

const NIRVANA_WEST_INDUSTRIAL_SITES: readonly IndustrialSiteSpec[] = Object.freeze([
  NIRVANA_WEST_WORKS,
  NIRVANA_WEST_SATELLITE,
]);

/** Ground a structure may be founded on: the plain's own tonal tiers, nothing else. */
const SITE_FOUNDABLE_MATERIALS: readonly NirvanaWestMaterial[] = NIRVANA_WEST_PLAIN_TIERS;

/** Ground the site score treats as "this is a fissure, not a plain". */
const SITE_VOID_MATERIALS: readonly NirvanaWestMaterial[] = Object.freeze([
  "ember", "emberdim", "glass",
]);

/**
 * One placed authored prop, resolved to absolute tile coordinates.
 *
 * Produced by {@link planIndustrialLayout} and consumed by {@link placeProps},
 * which applies exactly the same claim / protected-footprint / drop rules to it
 * as to every scattered species — an authored piece gets no exemption from the
 * safety rules, only from the randomness.
 */
interface AuthoredIndustrialProp {
  readonly id: string;
  readonly species: string;
  readonly variant: number;
  readonly column: number;
  readonly row: number;
  readonly blocks: boolean;
}

/** The complete seated layout: what to draw, and what ground to pour under it. */
interface IndustrialLayout {
  readonly props: readonly AuthoredIndustrialProp[];
  readonly ground: readonly Readonly<{
    material: NirvanaWestMaterial;
    column: number;
    row: number;
    columns: number;
    rows: number;
  }>[];
  /** Seated anchors, for diagnostics and tests. */
  readonly anchors: readonly Readonly<{ id: string; column: number; row: number }>[];
}

/**
 * A species' footprint as tile OFFSETS from its foot tile.
 *
 * Translation-invariant by construction — every authored piece is seated on an
 * exact tile centre, so the contact rect/ellipse lands in the same relative tiles
 * wherever it stands. Computing it once and reusing it is what keeps the anchor
 * search (9,216 candidates x 9 pieces) cheap enough to run inside every scene build.
 */
const INDUSTRIAL_FOOTPRINT_OFFSETS = new Map<string, readonly Readonly<{ dc: number; dr: number }>[]>();

function industrialFootprintOffsets(
  species: string,
): readonly Readonly<{ dc: number; dr: number }>[] {
  const cached = INDUSTRIAL_FOOTPRINT_OFFSETS.get(species);
  if (cached !== undefined) return cached;
  // Sampled at the middle of the region so no footprint tile can wrap and fold
  // two distinct offsets onto one coordinate.
  const originColumn = NIRVANA_WEST_COLUMNS / 2;
  const originRow = NIRVANA_WEST_ROWS / 2;
  const offsets = propFootprintTiles(species, originColumn + 0.5, originRow + 0.5)
    .map((tile) => Object.freeze({
      dc: tile.column - originColumn,
      dr: tile.row - originRow,
    }));
  const frozen = Object.freeze(offsets);
  INDUSTRIAL_FOOTPRINT_OFFSETS.set(species, frozen);
  return frozen;
}

/** Scratch masks the anchor search reads, built once per scene. */
interface SiteGround {
  /** 1 when a structure may be founded here: plain tier, open, unprotected. */
  readonly foundable: Uint8Array;
  /**
   * 1 when a structure's ground contact may cover this tile: unprotected AND
   * open.
   *
   * Open matters as much as unprotected, for two reasons that were both
   * measured. Visually, a turbine hall standing with a third of its wall inside
   * a clinker reef is not a building on ground, it is a building in a wall.
   * Mechanically, the placement pass drops a piece whose footprint collides with
   * anything already claimed — including the tiles the connectivity repair had
   * to carve, which are exactly the tiles beside blocking terrain — so a search
   * that permits blocked footprint tiles keeps proposing anchors the placement
   * pass then silently refuses. Measured before this rule: the turbine hall,
   * declared REQUIRED and passing the search at every seed, was placed at NONE
   * of them.
   */
  readonly coverable: Uint8Array;
  /** 1 when this tile is fissure ground — scored against, never forbidden. */
  readonly voidGround: Uint8Array;
}

function buildSiteGround(
  tiles: readonly NirvanaWestTile[],
  protection: NirvanaWestProtection,
): SiteGround {
  const total = NIRVANA_WEST_COLUMNS * NIRVANA_WEST_ROWS;
  const foundable = new Uint8Array(total);
  const coverable = new Uint8Array(total);
  const voidGround = new Uint8Array(total);
  for (let index = 0; index < total; index += 1) {
    const tile = tiles[index]!;
    const guarded = protection.protected[index] === 1;
    if (!guarded && !tile.blocked) coverable[index] = 1;
    if (!guarded && !tile.blocked && SITE_FOUNDABLE_MATERIALS.includes(tile.material)) {
      foundable[index] = 1;
    }
    if (SITE_VOID_MATERIALS.includes(tile.material)) voidGround[index] = 1;
  }
  return { foundable, coverable, voidGround };
}

function tileIndexAt(column: number, row: number): number {
  return wrapPos(row, NIRVANA_WEST_ROWS) * NIRVANA_WEST_COLUMNS
    + wrapPos(column, NIRVANA_WEST_COLUMNS);
}

/** True when this piece may stand here: founded ground, and every covered tile clear. */
function industrialPieceFits(
  ground: SiteGround,
  species: string,
  column: number,
  row: number,
  claimed?: ReadonlySet<number>,
): boolean {
  if (ground.foundable[tileIndexAt(column, row)] !== 1) return false;
  for (const offset of industrialFootprintOffsets(species)) {
    const index = tileIndexAt(column + offset.dc, row + offset.dr);
    if (ground.coverable[index] !== 1) return false;
    if (claimed !== undefined && claimed.has(index)) return false;
  }
  return true;
}

/** Every authored bay for a piece, primary first. */
function industrialPieceBays(
  piece: IndustrialPieceSpec,
): readonly Readonly<{ dc: number; dr: number }>[] {
  return [{ dc: piece.dc, dr: piece.dr }, ...(piece.bays ?? [])];
}

/**
 * The first authored bay this piece can actually take, or `null` for none.
 *
 * @param claimed - Tile indices already taken by earlier pieces of this plan, so
 *   two pieces can never choose bays that overlap on the ground.
 */
function chooseIndustrialBay(
  piece: IndustrialPieceSpec,
  ground: SiteGround,
  anchorColumn: number,
  anchorRow: number,
  claimed?: ReadonlySet<number>,
): Readonly<{ dc: number; dr: number }> | null {
  for (const bay of industrialPieceBays(piece)) {
    if (industrialPieceFits(
      ground, piece.species, anchorColumn + bay.dc, anchorRow + bay.dr, claimed,
    )) {
      return bay;
    }
  }
  return null;
}

/** Wrapped Chebyshev distance in tiles — the torus metric the region actually has. */
function wrappedTileDistance(
  aColumn: number, aRow: number, bColumn: number, bRow: number,
): number {
  return Math.max(
    Math.abs(wrapDelta(aColumn, bColumn, NIRVANA_WEST_COLUMNS)),
    Math.abs(wrapDelta(aRow, bRow, NIRVANA_WEST_ROWS)),
  );
}

/**
 * Seat one site by searching every anchor on the region.
 *
 * @returns The best anchor, or `null` when no anchor seats the site's hero piece.
 */
function seatIndustrialSite(
  site: IndustrialSiteSpec,
  ground: SiteGround,
  taken: readonly Readonly<{ column: number; row: number }>[],
): Readonly<{ column: number; row: number }> | null {
  const required = site.pieces.filter((piece) => piece.required === true);
  let best: Readonly<{ column: number; row: number; score: number; cost: number }> | null = null;
  const boxTiles = (site.box.east - site.box.west + 1) * (site.box.south - site.box.north + 1);

  for (let row = 0; row < NIRVANA_WEST_ROWS; row += 1) {
    for (let column = 0; column < NIRVANA_WEST_COLUMNS; column += 1) {
      // Every REQUIRED piece must land, or this is not the site — and checking
      // them first prunes the great majority of anchors before any scoring work.
      let seatsRequired = true;
      for (const piece of required) {
        if (chooseIndustrialBay(piece, ground, column, row) === null) {
          seatsRequired = false;
          break;
        }
      }
      if (!seatsRequired) continue;
      let tooClose = false;
      for (const other of taken) {
        if (wrappedTileDistance(column, row, other.column, other.row) < site.minSeparation) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      // Doubled units: a piece on its PRIMARY bay is worth twice a piece that
      // had to fall back to an alternate. Without that weighting the alternates
      // flatten the search — every second anchor reaches "satisfied" on fallback
      // bays alone, and the tie-break then seats a plant assembled entirely out
      // of its own second choices. Measured: the works walked two districts south
      // and its fence run collapsed from 45 pieces to 13.
      let fit = 0;
      for (const piece of site.pieces) {
        const bay = chooseIndustrialBay(piece, ground, column, row);
        if (bay === null) continue;
        fit += (bay.dc === piece.dc && bay.dr === piece.dr) ? piece.weight * 2 : piece.weight;
      }
      // Saturating the fit at `satisfiedWeight` is what turns the search from a
      // fit maximiser into a SITING decision — see that field's docstring.
      const score = Math.min(fit, site.satisfiedWeight * 2);

      let voidTiles = 0;
      for (let dr = site.box.north; dr <= site.box.south; dr += 1) {
        for (let dc = site.box.west; dc <= site.box.east; dc += 1) {
          voidTiles += ground.voidGround[tileIndexAt(column + dc, row + dr)]!;
        }
      }
      const centre = wrappedTileDistance(
        column, row, NIRVANA_WEST_COLUMNS / 2, NIRVANA_WEST_ROWS / 2,
      );
      // Lower is better. A site sitting a quarter inside a fissure pays about as
      // much as one sitting six tiles further out — enough to move it off the
      // crack, never enough to make a fissure disqualifying.
      const cost = (voidTiles / boxTiles) * 24 + centre * 0.25;

      const better = best === null
        || score > best.score
        || (score === best.score
          && (cost < best.cost - 1e-9
            || (Math.abs(cost - best.cost) <= 1e-9
              && (row < best.row || (row === best.row && column < best.column)))));
      if (better) best = { column, row, score, cost };
    }
  }
  return best === null ? null : Object.freeze({ column: best.column, row: best.row });
}

/** Whether a linear run may lay a piece here: open, unprotected ground. */
function runPieceFits(ground: SiteGround, column: number, row: number): boolean {
  const index = tileIndexAt(column, row);
  return ground.coverable[index] === 1 && ground.foundable[index] === 1;
}

/**
 * Pick the clearest line for a region-crossing run, within `[from, to]` rows.
 *
 * A trunk pipeline that happens to land on a district row loses more than half
 * its pieces and reads as dashes; measuring the candidates and taking the
 * clearest costs nothing and makes the run unbroken wherever the region allows it.
 */
function clearestRunRow(ground: SiteGround, from: number, to: number): number {
  let bestRow = from;
  let bestOpen = -1;
  for (let row = from; row <= to; row += 1) {
    let open = 0;
    for (let column = 0; column < NIRVANA_WEST_COLUMNS; column += 1) {
      if (runPieceFits(ground, column, row)) open += 1;
    }
    if (open > bestOpen) {
      bestOpen = open;
      bestRow = row;
    }
  }
  return wrapPos(bestRow, NIRVANA_WEST_ROWS);
}

/**
 * Pick the clearest column for a north-south run over `[rowFrom, rowTo]`.
 *
 * The settlement is a grid of solid district blocks separated by narrow
 * gutters, so a north-south run seated by offset alone lands inside a block and
 * lays NOTHING — measured: the authored pipe spur placed 0 of 13 pieces at every
 * seed. The gutters are two or three tiles wide and always in the same places;
 * finding them is a 13-column scan.
 */
function clearestRunColumn(
  ground: SiteGround,
  from: number,
  to: number,
  rowFrom: number,
  rowTo: number,
): number {
  let bestColumn = from;
  let bestOpen = -1;
  for (let column = from; column <= to; column += 1) {
    let open = 0;
    for (let row = rowFrom; row <= rowTo; row += 1) {
      if (runPieceFits(ground, column, row)) open += 1;
    }
    if (open > bestOpen) {
      bestOpen = open;
      bestColumn = column;
    }
  }
  return wrapPos(bestColumn, NIRVANA_WEST_COLUMNS);
}

/** Pipeline variants: 0 east-west, 1 east-west with a joint collar, 2 north-south, 3 riser. */
const PIPELINE_EW = 0;
const PIPELINE_EW_COLLAR = 1;
const PIPELINE_NS = 2;
const PIPELINE_RISER = 3;
/** Fence variants: 0 east-west run, 1 north-south run, 2 a torn panel / corner. */
const FENCE_EW = 0;
const FENCE_NS = 1;
const FENCE_TORN = 2;
/** Rail spur variants: 0 east-west, 1 north-south. */
const RAILSPUR_EW = 0;

/** How many tiles either side of the works the rail siding runs. */
const RAIL_SIDING_REACH = 20;
/** How far either side of the works each perimeter fence line runs. */
const FENCE_LINE_REACH = 20;
/** How far the fence's short returns turn in at each end of a line. */
const FENCE_RETURN_LENGTH = 4;
/** Pylon line: count and spacing. */
const PYLON_LINE_COUNT = 12;
const PYLON_LINE_SPACING = 7;

/**
 * Every connective-tissue run, derived from the seated works anchor.
 *
 * All of it is NON-BLOCKING — see this section's remarks, point 2 — so a run may
 * cross the settled band without costing a plot, a route cell or a staging point,
 * and the only reason a piece is skipped is that it would be drawn over protected
 * ground or on a wall.
 */
function industrialRuns(
  ground: SiteGround,
  works: Readonly<{ column: number; row: number }>,
): AuthoredIndustrialProp[] {
  const props: AuthoredIndustrialProp[] = [];
  const lay = (
    id: string, species: string, variant: number, column: number, row: number, blocks: boolean,
  ): void => {
    const c = wrapPos(column, NIRVANA_WEST_COLUMNS);
    const r = wrapPos(row, NIRVANA_WEST_ROWS);
    if (!runPieceFits(ground, c, r)) return;
    props.push(Object.freeze({ id, species, variant, column: c, row: r, blocks }));
  };

  // 1. The trunk pipeline: right across the region, on the clearest line just
  //    south of the works. This is the run that says the plant SERVED somewhere.
  const trunkRow = clearestRunRow(ground, works.row + 8, works.row + 11);
  for (let column = 0; column < NIRVANA_WEST_COLUMNS; column += 1) {
    lay(
      `works:pipe-trunk:${column}`,
      "pipeline",
      column % 4 === 0 ? PIPELINE_EW_COLLAR : PIPELINE_EW,
      column,
      trunkRow,
      false,
    );
  }

  // 2. A north-south spur off the plant, terminating in a riser at each end.
  //    Seated in whichever inter-district gutter is clearest — see
  //    {@link clearestRunColumn}. The one cross-axis line in the layout, so the
  //    site does not read as four parallel horizontals and nothing else.
  const spurTop = works.row - 20;
  const spurBottom = works.row - 8;
  const spurColumn = clearestRunColumn(
    ground, works.column - 6, works.column + 12, spurTop, spurBottom,
  );
  for (let step = 0; step <= spurBottom - spurTop; step += 1) {
    const row = spurBottom - step;
    const riser = step === 0 || step === spurBottom - spurTop;
    lay(
      `works:pipe-spur:${step}`,
      "pipeline",
      riser ? PIPELINE_RISER : PIPELINE_NS,
      spurColumn,
      row,
      false,
    );
  }

  // 3. The compound fence. NOT a closed rectangle: a rectangle seated in the
  //    settled band loses most of its corners and short sides to protected
  //    ground and reads as scattered dashes. Two LONG parallel lines that run
  //    well past the plant, with a short return at each end, survive the gaps
  //    and read as what they are — a perimeter marching across the plain.
  const west = works.column - FENCE_LINE_REACH;
  const east = works.column + FENCE_LINE_REACH;
  const north = works.row - 6;
  const south = works.row + 7;
  for (let column = west; column <= east; column += 1) {
    const end = column === west || column === east;
    lay(`works:fence-n:${column}`, "fence", end ? FENCE_TORN : FENCE_EW, column, north, false);
    lay(`works:fence-s:${column}`, "fence", end ? FENCE_TORN : FENCE_EW, column, south, false);
  }
  for (let step = 1; step <= FENCE_RETURN_LENGTH; step += 1) {
    lay(`works:fence-wn:${step}`, "fence", FENCE_NS, west, north + step, false);
    lay(`works:fence-en:${step}`, "fence", FENCE_NS, east, north + step, false);
    lay(`works:fence-ws:${step}`, "fence", FENCE_NS, west, south - step, false);
    lay(`works:fence-es:${step}`, "fence", FENCE_NS, east, south - step, false);
  }

  // 4. The rail siding, flat, drawn under everything, running out of the plant
  //    both ways across its own tailings apron.
  for (let step = -RAIL_SIDING_REACH; step <= RAIL_SIDING_REACH; step += 1) {
    lay(
      `works:rail:${step}`,
      "railspur",
      RAILSPUR_EW,
      works.column + step,
      works.row + 5,
      false,
    );
  }

  // 5. The pylon line marching away from the compound — blocking, but a single
  //    tile each, and the only piece of tissue that reads at a distance.
  //    Seated on the clearest line well north of the works: a transmission line
  //    goes SOMEWHERE, so it belongs on open ground away from the plant rather
  //    than stapled to its fence.
  const pylonRow = clearestRunRow(ground, works.row - 34, works.row - 12);
  for (let step = 0; step < PYLON_LINE_COUNT; step += 1) {
    lay(
      `works:pylon:${step}`,
      "pylon",
      step % 2,
      works.column - 30 + step * PYLON_LINE_SPACING,
      pylonRow,
      true,
    );
  }
  return props;
}

/**
 * Seat every authored industrial site against the real terrain, and derive the
 * runs and the ground evidence that tie them together.
 *
 * @param tiles - The RAW derived tiles, before any apron is poured.
 * @param protection - The recipe's protection mask; never violated.
 * @returns The complete layout. Empty when no site could be seated at all — the
 *   region still builds, it simply has no complex that seed.
 */
function planIndustrialLayout(
  tiles: readonly NirvanaWestTile[],
  protection: NirvanaWestProtection,
): IndustrialLayout {
  const ground = buildSiteGround(tiles, protection);
  const props: AuthoredIndustrialProp[] = [];
  const groundRects: Array<Readonly<{
    material: NirvanaWestMaterial; column: number; row: number; columns: number; rows: number;
  }>> = [];
  const anchors: Array<Readonly<{ id: string; column: number; row: number }>> = [];
  const taken: Array<Readonly<{ column: number; row: number }>> = [];

  for (const site of NIRVANA_WEST_INDUSTRIAL_SITES) {
    const anchor = seatIndustrialSite(site, ground, taken);
    if (anchor === null) continue;
    taken.push(anchor);
    anchors.push(Object.freeze({ id: site.id, column: anchor.column, row: anchor.row }));
    const claimed = new Set<number>();
    site.pieces.forEach((piece, index) => {
      const bay = chooseIndustrialBay(piece, ground, anchor.column, anchor.row, claimed);
      if (bay === null) return;
      const column = wrapPos(anchor.column + bay.dc, NIRVANA_WEST_COLUMNS);
      const row = wrapPos(anchor.row + bay.dr, NIRVANA_WEST_ROWS);
      for (const offset of industrialFootprintOffsets(piece.species)) {
        claimed.add(tileIndexAt(column + offset.dc, row + offset.dr));
      }
      props.push(Object.freeze({
        id: `${site.id}:${piece.species}:${index}`,
        species: piece.species,
        variant: piece.variant,
        column,
        row,
        blocks: true,
      }));
    });
    for (const rect of site.ground) {
      groundRects.push(Object.freeze({
        material: rect.material,
        column: wrapPos(anchor.column + rect.dc, NIRVANA_WEST_COLUMNS),
        row: wrapPos(anchor.row + rect.dr, NIRVANA_WEST_ROWS),
        columns: rect.columns,
        rows: rect.rows,
      }));
    }
    if (site.id === "works") props.push(...industrialRuns(ground, anchor));
  }

  return Object.freeze({
    props: Object.freeze(props),
    ground: Object.freeze(groundRects),
    anchors: Object.freeze(anchors),
  });
}

/**
 * Pour the authored aprons and tailings into the CORNER field.
 *
 * Ground evidence is terrain rather than a decal for the reason in this section's
 * remarks (point 3), and pouring it at corner level is what gives it the region's
 * own authored edge transitions instead of a hard cut.
 *
 * Two rules, both deliberate:
 *
 * - **The fissure wins.** A corner already carrying `ember`, `emberdim` or
 *   `glass` is never overwritten, so a live crack cuts straight THROUGH the
 *   concrete instead of being erased by it — which is both the better picture and
 *   the honest one: the plant did not survive the ground opening under it.
 * - **This can only ever open ground.** `slab` and `spoil` are walkable, so
 *   pouring them over `clinker`/`scree` removes blocking and adds none. No
 *   protected tile can be closed by this pass, at any anchor, by construction.
 */
function pourIndustrialGround(
  corners: NirvanaWestMaterial[],
  layout: IndustrialLayout,
): void {
  for (const rect of layout.ground) {
    for (let row = 0; row <= rect.rows; row += 1) {
      for (let column = 0; column <= rect.columns; column += 1) {
        const cornerColumn = wrapPos(rect.column + column, NIRVANA_WEST_COLUMNS);
        const cornerRow = wrapPos(rect.row + row, NIRVANA_WEST_ROWS);
        const existing = corners[cornerIndex(cornerColumn, cornerRow)]!;
        if (SITE_VOID_MATERIALS.includes(existing)) continue;
        setCornerMaterial(corners, cornerColumn, cornerRow, rect.material);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// prop placement — trimmed to the species composition B's own material field
// can actually reach (dropped: A/C-signature species `dunecrest`/`slabtilt`,
// the ancient ruin kit the owner did not choose, and `bonestone`/`rimecluster`,
// whose placement gate requires adjacency to a `rime` tile this composition's
// geometry never produces).
// ---------------------------------------------------------------------------

interface SpeciesRule {
  readonly id: string;
  readonly variants: number;
  readonly on: readonly NirvanaWestMaterial[];
  readonly blocks: boolean;
  readonly clusters: number;
  readonly spread: number;
  readonly perCluster: number;
  readonly scatter: number;
  readonly seed: number;
}

const ON_PLAINS: readonly NirvanaWestMaterial[] = NIRVANA_WEST_PLAIN_TIERS;

const SPECIES: readonly SpeciesRule[] = Object.freeze([
  {
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
    id: "ejecta", variants: 3, on: ["clinker", "scree", "cinder"], blocks: true,
    clusters: 5, spread: 3.0, perCluster: 5, scatter: 2, seed: 2153,
  },
  {
    id: "clinkerchunk", variants: 3, on: ["clinker", "scree", "cinder"], blocks: false,
    clusters: 0, spread: 0, perCluster: 0, scatter: 220, seed: 2161,
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
    id: "emberwisp", variants: 3, on: ["emberdim", "cinder", "glass", "ash"], blocks: false,
    clusters: 0, spread: 0, perCluster: 0, scatter: 10, seed: 2237,
  },
  {
    id: "pylon", variants: 2, on: ON_PLAINS, blocks: true,
    clusters: 3, spread: 1.4, perCluster: 1, scatter: 3, seed: 2239,
  },
  // --- the owner-approved industrial ruin kit -----------------------------
  //
  // Deliberately THINNED now that the authored complex exists (see the
  // industrial-complex section's remarks). These four species are the plant's
  // own vocabulary, and scattering them at the old rates on top of a seated
  // works produces exactly the failure mode this push was warned about: not
  // industry, a junkyard. What is left is a handful of lone outliers on the
  // plain — a landscape that HAD industry — while the complex carries the
  // reading. `coolingtower` is scattered ZERO times: the hero is unique, which
  // is the whole reason the eye can name it.
  {
    id: "coolingtower", variants: 2, on: ON_PLAINS, blocks: true,
    clusters: 0, spread: 0, perCluster: 0, scatter: 0, seed: 2339,
  },
  {
    id: "reactorhusk", variants: 2, on: ON_PLAINS, blocks: true,
    clusters: 1, spread: 1.4, perCluster: 1, scatter: 2, seed: 2341,
  },
  {
    id: "gantry", variants: 3, on: ON_PLAINS, blocks: true,
    clusters: 2, spread: 2.0, perCluster: 1, scatter: 2, seed: 2347,
  },
  {
    id: "stack", variants: 3, on: ON_PLAINS, blocks: true,
    clusters: 2, spread: 2.0, perCluster: 1, scatter: 2, seed: 2351,
  },
]);

/** Authored scenery frame variant count for the causeway deck decal. */
const CAUSEWAY_DECK_VARIANTS = 6;

function makeProp(
  id: string,
  species: string,
  frameId: string,
  footX: number,
  footY: number,
  blocks: boolean,
): NirvanaWestProp {
  const frame = NIRVANA_WEST_PROP_FRAMES[species];
  if (frame === undefined) {
    throw new NirvanaWestSceneError(`Nirvana West scene has no frame entry for species ${species}.`);
  }
  return Object.freeze({
    id,
    species,
    frameId,
    x: Math.round(footX - frame.pivotX),
    y: Math.round(footY - frame.pivotY),
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

interface PlacementResult {
  readonly props: readonly NirvanaWestProp[];
  readonly droppedForProtection: number;
}

function placeProps(
  tiles: readonly NirvanaWestTile[],
  protection: NirvanaWestProtection,
  causeways: readonly NirvanaWestCrossing[],
  repairedTiles: ReadonlySet<string>,
  layout: IndustrialLayout,
): PlacementResult {
  const props: NirvanaWestProp[] = [];
  const claimed = new Set<string>();
  let droppedForProtection = 0;

  // Every protected tile the recipe declares is pre-claimed as prop-free, so no
  // candidate can ever be selected onto ground the world's mechanics need.
  for (let index = 0; index < protection.protected.length; index += 1) {
    if (protection.protected[index] === 0) continue;
    const column = index % NIRVANA_WEST_COLUMNS;
    const row = Math.floor(index / NIRVANA_WEST_COLUMNS);
    claimed.add(`block:${column},${row}`);
  }
  for (const causeway of causeways) {
    for (const abutment of causeway.abutments) {
      claimed.add(`block:${abutment.column},${abutment.row}`);
    }
  }
  // Nothing grows on ground the connectivity repair had to carve open either.
  for (const key of repairedTiles) claimed.add(`block:${key}`);

  const tileAt = (column: number, row: number): NirvanaWestTile => {
    const c = wrapPos(column, NIRVANA_WEST_COLUMNS);
    const r = wrapPos(row, NIRVANA_WEST_ROWS);
    return tiles[r * NIRVANA_WEST_COLUMNS + c]!;
  };

  const isAdjacentToEmber = (column: number, row: number): boolean => (
    [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const
  ).some(([dc, dr]) => tileAt(column + dc, row + dr).material === "ember");

  // The authored industrial layout is placed FIRST, so the complex claims its
  // ground and the scattered species yield to it rather than the other way round.
  // It gets no exemption from the safety rules — same protected-footprint drop,
  // same occupancy claim, same "never on ground the repair carved open".
  for (const authored of layout.props) {
    const tile = tileAt(authored.column, authored.row);
    const footX = authored.column * NIRVANA_WEST_TILE_SIZE + NIRVANA_WEST_TILE_SIZE / 2;
    const footY = authored.row * NIRVANA_WEST_TILE_SIZE + NIRVANA_WEST_TILE_SIZE / 2;
    if (authored.blocks) {
      const occupancy = `block:${authored.column},${authored.row}`;
      if (claimed.has(occupancy) || tile.blocked) continue;
      const footprint = propFootprintTiles(
        authored.species,
        footX / NIRVANA_WEST_TILE_SIZE,
        footY / NIRVANA_WEST_TILE_SIZE,
      );
      if (footprint.some((t) => protection.protected[t.row * NIRVANA_WEST_COLUMNS + t.column] === 1)) {
        droppedForProtection += 1;
        continue;
      }
      if (footprint.some((t) => claimed.has(`block:${t.column},${t.row}`))) continue;
      for (const t of footprint) claimed.add(`block:${t.column},${t.row}`);
    } else if (claimed.has(`block:${authored.column},${authored.row}`)) {
      // Non-blocking tissue still refuses protected ground and the carve — a
      // fence drawn across a doorway or a repaired crossing is a lie about the
      // ground, even though it costs the navigator nothing.
      continue;
    }
    claimed.add(authored.id);
    props.push(makeProp(
      authored.id,
      authored.species,
      `s.${authored.species}.${authored.variant}`,
      footX,
      footY,
      authored.blocks,
    ));
  }

  for (const species of SPECIES) {
    for (const candidate of candidatePositions(species)) {
      const tile = tileAt(candidate.column, candidate.row);
      if (!species.on.includes(tile.material)) continue;
      if (species.id === "emberwisp" && !isAdjacentToEmber(candidate.column, candidate.row)) continue;

      const footX = candidate.column * NIRVANA_WEST_TILE_SIZE + NIRVANA_WEST_TILE_SIZE / 2
        + candidate.offsetX;
      const footY = candidate.row * NIRVANA_WEST_TILE_SIZE + NIRVANA_WEST_TILE_SIZE / 2
        + candidate.offsetY;
      const key = `${species.id}:${candidate.column},${candidate.row}`;
      if (claimed.has(key)) continue;

      if (species.blocks) {
        const occupancy = `block:${candidate.column},${candidate.row}`;
        if (claimed.has(occupancy) || tile.blocked) continue;
        const footprint = propFootprintTiles(
          species.id,
          footX / NIRVANA_WEST_TILE_SIZE,
          footY / NIRVANA_WEST_TILE_SIZE,
        );
        // CRITICAL: a footprint tile must never close a protected tile. Rather than
        // move the prop (a second placement pass with its own failure modes — see
        // NIRVANA_WEST_PROP_FRAMES's docstring), drop it outright: monotone, and
        // ruins are rare enough that losing an occasional one to plot-adjacency is
        // a negligible visual cost against a hard safety guarantee.
        if (footprint.some((t) => protection.protected[t.row * NIRVANA_WEST_COLUMNS + t.column] === 1)) {
          droppedForProtection += 1;
          continue;
        }
        // Also drop onto ground another already-placed footprint already claimed,
        // so two blocking props' footprints can never overlap.
        if (footprint.some((t) => claimed.has(`block:${t.column},${t.row}`))) continue;
        for (const t of footprint) claimed.add(`block:${t.column},${t.row}`);
      }
      claimed.add(key);
      props.push(makeProp(key, species.id, `s.${species.id}.${candidate.variant}`, footX, footY, species.blocks));
    }
  }

  // One deck-piece decal per causeway tile - non-blocking decoration.
  for (const causeway of causeways) {
    for (const ref of causeway.deck) {
      const variant = Math.floor(hash2(ref.column, ref.row, 0x9a11) * CAUSEWAY_DECK_VARIANTS)
        % CAUSEWAY_DECK_VARIANTS;
      props.push(makeProp(
        `causeway:${causeway.id}:${ref.column},${ref.row}`,
        "causeway",
        `s.causeway.${variant}`,
        ref.column * NIRVANA_WEST_TILE_SIZE + NIRVANA_WEST_TILE_SIZE / 2,
        ref.row * NIRVANA_WEST_TILE_SIZE + NIRVANA_WEST_TILE_SIZE / 2,
        false,
      ));
    }
  }

  props.sort((left, right) => left.footY - right.footY
    || left.footX - right.footX
    || left.id.localeCompare(right.id));
  return { props: Object.freeze(props), droppedForProtection };
}

/** A blocking prop's full footprint, for collision union / removal bookkeeping. */
function propFootprint(prop: NirvanaWestProp): readonly TileCoord[] {
  return propFootprintTiles(prop.species, prop.footX / NIRVANA_WEST_TILE_SIZE, prop.footY / NIRVANA_WEST_TILE_SIZE);
}

// ---------------------------------------------------------------------------
// animated environment phase — reused by
// `NirvanaWestRegionMapRecipe.ts`'s `deriveFissureAnimatedEnvironment`.
// ---------------------------------------------------------------------------

/**
 * `Math.floor(hash2(column, row, 0x0e77) * 0x7fffffff)` - always a non-negative
 * integer. Mirrors production's `EnvironmentSystem.ts` `phaseIndex` formula
 * (via a per-tile seed) exactly, so neighbouring flames are out of step.
 */
export function animatedPhaseSeed(column: number, row: number): number {
  return Math.floor(hash2(column, row, 0x0e77) * 0x7fffffff);
}

// ---------------------------------------------------------------------------
// assembly
// ---------------------------------------------------------------------------

/**
 * Build the approved Nirvana West terrain field — composition B, "The Ember Rift".
 *
 * Deterministic: given the same protection mask and base collision it returns
 * byte-identical tiles, collision, props and causeways.
 *
 * Order: corner field -> demote protected corners -> derive tiles -> resolve
 * causeways from the DERIVED blocked runs -> apply decks -> repair connectivity
 * relative to the region's own pre-existing components (monotone: open only,
 * never seal) -> place props -> repair connectivity again against blocking
 * props, removing a prop (freeing its WHOLE footprint) before ever carving new
 * terrain a second time.
 *
 * @param protection - Tiles that must never end up blocked.
 * @param baseCollision - The region's collision BEFORE this terrain, row-major,
 *   `1` = blocked. Connectivity is repaired relative to the COMPOSED mask (base
 *   union terrain) against the base's OWN pre-existing components — see the
 *   module docstring's point 2.
 * @returns One frozen scene: the picture, the mask, the props and the causeways.
 * @throws {NirvanaWestSceneError} If the composition cannot be built as specified,
 *   or does not settle within the attempt budget.
 */
export function createNirvanaWestScene(
  protection: NirvanaWestProtection,
  baseCollision: Uint8Array,
): NirvanaWestScene {
  if (protection.columns !== NIRVANA_WEST_COLUMNS || protection.rows !== NIRVANA_WEST_ROWS
    || protection.protected.length !== NIRVANA_WEST_COLUMNS * NIRVANA_WEST_ROWS
    || baseCollision.length !== NIRVANA_WEST_COLUMNS * NIRVANA_WEST_ROWS) {
    throw new NirvanaWestSceneError(
      `Nirvana West protection mask must cover the exact ${NIRVANA_WEST_COLUMNS}x${NIRVANA_WEST_ROWS} region.`,
    );
  }

  const segments = buildFractureSegments();
  const materialAt = (x: number, y: number): NirvanaWestMaterial => emberRiftMaterialAt(x, y, segments);

  // The RAW, pre-demotion field - used only to measure demotedTiles.
  const rawCorners = buildCornerField(materialAt);
  const rawTiles = deriveTiles(rawCorners);
  const demotedTiles = countRawBlockedProtectedTiles(rawTiles, protection);

  const corners = rawCorners.slice();
  demoteProtectedCorners(corners, protection);

  // The industrial complex is seated against the RAW terrain — the ground as the
  // fracture field left it — and its aprons are then poured into the corner
  // lattice, so every later stage (causeway seating, connectivity repair, prop
  // placement) sees the concrete as ordinary walkable terrain rather than as a
  // special case. Pouring after the protection demotion is safe in both
  // directions: `slab`/`spoil` never block, so this can only open ground.
  const industrial = planIndustrialLayout(rawTiles, protection);
  pourIndustrialGround(corners, industrial);

  /** The mask a body actually walks: this terrain unioned onto what was already there. */
  const composed = (terrain: Uint8Array): Uint8Array => {
    const union = Uint8Array.from(terrain);
    for (let index = 0; index < union.length; index += 1) {
      if (baseCollision[index] === 1) union[index] = 1;
    }
    return union;
  };
  const baseLabels = new Int32Array(baseCollision.length).fill(-1);
  walkableComponents(baseCollision, NIRVANA_WEST_COLUMNS, NIRVANA_WEST_ROWS)
    .forEach((component, label) => {
      for (const index of component.tiles) baseLabels[index] = label;
    });

  const repairedTiles = new Set<string>();
  /** Open orphans the region ITSELF already left disconnected; no carve can reach them. */
  const unreachableBeforeTerrain = new Set<number>();

  const firstSplit = (terrain: Uint8Array): {
    main: { readonly tiles: readonly number[] };
    orphan: { readonly tiles: readonly number[] };
  } | null => {
    const grouped = new Map<number, Array<{ readonly tiles: readonly number[] }>>();
    for (const component of walkableComponents(composed(terrain), NIRVANA_WEST_COLUMNS, NIRVANA_WEST_ROWS)) {
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
        const significant = orphan.tiles.length >= MIN_REPAIR_POCKET_TILES
          || orphan.tiles.some((tile) => isProtectedTile(protection, tile));
        if (significant) return { main, orphan };
      }
    }
    return null;
  };

  /**
   * Open a walkable path from `orphan` to `main`, following ground the region
   * itself leaves open in `baseCollision` — a breadth-first walk, not a straight
   * line, so the carve never opens ground the GENERIC recipe deliberately closed.
   *
   * @returns `true` when a path was opened, `false` when no base-open route
   *   exists — in which case the orphan was already unreachable before this
   *   terrain and is recorded so later passes skip it.
   */
  const carveBetween = (
    main: { readonly tiles: readonly number[] },
    orphan: { readonly tiles: readonly number[] },
  ): boolean => {
    const total = NIRVANA_WEST_COLUMNS * NIRVANA_WEST_ROWS;
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
      const column = index % NIRVANA_WEST_COLUMNS;
      const row = Math.floor(index / NIRVANA_WEST_COLUMNS);
      for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const c = column + dc;
        const r = row + dr;
        if (c < 0 || r < 0 || c >= NIRVANA_WEST_COLUMNS || r >= NIRVANA_WEST_ROWS) continue;
        const next = r * NIRVANA_WEST_COLUMNS + c;
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
      const column = index % NIRVANA_WEST_COLUMNS;
      const row = Math.floor(index / NIRVANA_WEST_COLUMNS);
      for (const [dc, dr] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
        setCornerMaterial(corners, column + dc, row + dr, "cinder");
      }
      repairedTiles.add(`${column},${row}`);
    }
    return true;
  };

  let tiles: NirvanaWestTile[] = [];
  let causeways: NirvanaWestCrossing[] = [];
  let collision: Uint8Array = new Uint8Array(NIRVANA_WEST_COLUMNS * NIRVANA_WEST_ROWS);
  let keptProps: NirvanaWestProp[] = [];
  let droppedForProtection = 0;
  let withProps: Uint8Array = collision;

  let settled = false;
  for (let attempt = 0; attempt < MAX_SCENE_ATTEMPTS && !settled; attempt += 1) {
    tiles = deriveTiles(corners);
    causeways = resolveCauseways(tiles, baseCollision, EMBER_RIFT_CAUSEWAY_SPECS);
    tiles = applyCrossingDecks(tiles, causeways);
    collision = collisionFrom(tiles);

    for (let pass = 0; pass < MAX_BASE_REPAIR_PASSES; pass += 1) {
      const split = firstSplit(collision);
      if (split === null) break;
      if (!carveBetween(split.main, split.orphan)) {
        for (const tile of split.orphan.tiles) unreachableBeforeTerrain.add(tile);
      }
      tiles = applyCrossingDecks(deriveTiles(corners), causeways);
      collision = collisionFrom(tiles);
    }

    const placement = placeProps(tiles, protection, causeways, repairedTiles, industrial);
    droppedForProtection = placement.droppedForProtection;
    withProps = Uint8Array.from(collision);
    for (const prop of placement.props) {
      if (!prop.blocks) continue;
      for (const t of propFootprint(prop)) withProps[t.row * NIRVANA_WEST_COLUMNS + t.column] = 1;
    }
    keptProps = [...placement.props];

    let rebuild = false;
    for (let pass = 0; pass < MAX_PROP_REPAIR_PASSES; pass += 1) {
      const split = firstSplit(withProps);
      if (split === null) break;
      const orphan = split.orphan;
      const orphanTiles = new Set(orphan.tiles);
      let removedIndex = -1;
      for (let index = 0; index < keptProps.length; index += 1) {
        const prop = keptProps[index]!;
        if (!prop.blocks) continue;
        const footprint = propFootprint(prop);
        const touchesOrphan = footprint.some((t) => {
          const idx = t.row * NIRVANA_WEST_COLUMNS + t.column;
          const column = idx % NIRVANA_WEST_COLUMNS;
          const row = Math.floor(idx / NIRVANA_WEST_COLUMNS);
          const neighbours = [
            column > 0 ? idx - 1 : -1,
            column < NIRVANA_WEST_COLUMNS - 1 ? idx + 1 : -1,
            row > 0 ? idx - NIRVANA_WEST_COLUMNS : -1,
            row < NIRVANA_WEST_ROWS - 1 ? idx + NIRVANA_WEST_COLUMNS : -1,
            idx,
          ];
          return neighbours.some((n) => n >= 0 && orphanTiles.has(n));
        });
        if (!touchesOrphan) continue;
        removedIndex = index;
        break;
      }
      if (removedIndex < 0) {
        if (!carveBetween(split.main, orphan)) {
          for (const tile of orphan.tiles) unreachableBeforeTerrain.add(tile);
        }
        rebuild = true;
        break;
      }
      const [removed] = keptProps.splice(removedIndex, 1);
      // Restore each footprint tile to its TERRAIN-only value, never a hardcoded
      // 0: a multi-tile footprint may legitimately overlap ground the terrain
      // itself already blocks, and clearing that to 0 would silently re-open
      // terrain that must stay closed.
      for (const t of propFootprint(removed!)) {
        const idx = t.row * NIRVANA_WEST_COLUMNS + t.column;
        withProps[idx] = collision[idx]!;
      }
    }
    if (!rebuild) settled = true;
  }
  if (!settled) {
    throw new NirvanaWestSceneError(
      `Nirvana West terrain did not settle in ${MAX_SCENE_ATTEMPTS} attempts.`,
    );
  }

  return Object.freeze({
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
    droppedForProtection,
    industrialAnchors: industrial.anchors,
  });
}

/**
 * A stable eight-hex digest of everything a Nirvana West scene draws and blocks.
 *
 * Carried in the recipe's `presentationProfile.staticSceneHash`, which is what binds a
 * persisted recipe to the exact picture it was built from.
 */
export function nirvanaWestSceneHash(scene: NirvanaWestScene): string {
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
    for (const rim of tile.rims) feed(`w${rim.material}.${rim.mask}.${rim.variant}`);
    feed(";");
  }
  for (const prop of scene.props) feed(`${prop.id}@${prop.frameId}@${prop.x},${prop.y};`);
  for (const causeway of scene.causeways) {
    feed(`${causeway.id}:${causeway.axis}:${causeway.deck.length};`);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
