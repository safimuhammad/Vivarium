/**
 * @fileoverview The Nirvana East terrain field — the ONE source from which both the
 * picture and the walkability mask are derived, so the ground a body cannot enter is
 * exactly the ground drawn as brine, thorn, mesa, scarp or slot.
 *
 * This is the owner-approved composition **B, "Butte Country"** (mesa/butte/outcrop
 * landform objects standing on a calm open playa floor), promoted from the pilot
 * `qa/nirvanaEastPilot/eastScene.ts` with its geometry — the deliberate two-mass wall,
 * the coarse/fine landform lattice, the crossing plans, the nine prop species, every
 * seed — carried across UNCHANGED. What the owner approved by eye is what this module
 * builds. Mirrors `warmSprings/WarmSpringsTerrainField.ts` in shape and discipline —
 * Warm Springs is the same problem solved once already; this follows it.
 *
 * ## Composition-only promotion: A and C are gone
 *
 * The pilot authored three candidate compositions (`a-arroyo-braid`, `b-mesa-field`,
 * `c-salt-pan`) sharing one geometry vocabulary. Only B shipped, so every A/C-only
 * system is deleted here, not merely unreferenced: `arroyoBraidGeometry`,
 * `saltPanGeometry`, `findBandBoundaryRow`, `geometryFor`, the composition-id union, and
 * three whole subsystems B never touches —
 *
 *  - **channels** (`Channel`, `closedLoopChannel`, `localChannel`, `channelMaterialAt`,
 *    `rampOpen`, every spline/meander helper that fed them),
 *  - **radial masses** (`MassRing`, `RadialMass`, `massDistances`, `scarpEffectiveOuter`,
 *    `radialMassMaterialAt`, `massOuterReach`, `angularDelta`),
 *  - **bands** (`BandSpec`, `bandMaterialAt`, `wrapUnit`),
 *
 * proven dead by the pilot's own `mesaFieldGeometry()`, which returns `channels: []`,
 * `masses: []`, `band: null`, `openFloor: true` — {@link cornerMaterialFor} below checks
 * channels, then masses, then bands, then falls through to the open floor; with all
 * three inputs empty/null, only the open floor ever paints for B. `identityApronAt` and
 * `backgroundMaterialAt` are dead for the identical reason one level further down: they
 * only ran in the pilot's `else` branch when `openFloor` was false, which B never is —
 * so they are deleted here too, not merely unreferenced.
 *
 * ## The four real changes, over the pilot
 *
 * 1. **The plot gate reads a real protection mask, not 128 hardcoded anchors.** See
 *    {@link NirvanaEastProtection} and {@link blockingAdmitted}. The recipe's own water
 *    is sampled into the corner field as `brine`, exactly as Warm Springs samples its
 *    water as `pool` — see {@link cornerIsRecipeWater} and {@link buildCornerField}.
 * 2. **Landform footprints come from the SHARED `placement/sceneryFootprint.ts`
 *    module**, not a bespoke ellipse formula duplicated per region. See
 *    {@link LANDFORM_CONTACT} and {@link tryPlaceLandform}. `makeProp` also now derives
 *    an ordinary prop's tile through the same module's `singleTileFootprint`, so the
 *    tile-unit wrap discipline lives in one place for every prop, landform or not.
 * 3. **The scene builder takes a protection mask and a base collision, and is
 *    composition-free.** {@link createNirvanaEastScene} builds exactly Butte Country;
 *    there is no composition parameter to get wrong.
 * 4. **The connectivity repair is MONOTONE: it only ever OPENS ground, never seals.**
 *    This is the one structural rewrite, and it is not cosmetic — see the next section.
 *
 * ## Why the repair no longer seals, in detail
 *
 * The pilot's assembly called `sealPocket` — write a blocking material over a small
 * disconnected pocket so it stops counting as a stray walkable island — and, less
 * visibly, its post-prop repair pass had a second, unnamed seal of its own: when no
 * removable prop touched a prop-caused orphan, it wrote `1` directly into the collision
 * mask for every tile of that orphan. Both are the exact defect Warm Springs measured
 * and fixed at cause (`.superpowers/sdd/warm-springs-live-report.md` §9.1): "Sealing a
 * scrap beside a protected tile isolated the protected tile; the next pass carved back
 * to it; the two oscillated until the attempt budget ran out" — 12% of 400 sampled seeds
 * failed to build. Both seal points are deleted here, not tuned; the repair only ever
 * opens ground now, which is what makes it provably terminate. Two more fixes travel
 * with it, from the same report section:
 *
 *  - **Fix 1 — build-free causeways.** Every tile a repair carve opens is recorded in a
 *    `causeways` set and claimed prop-free in {@link placeProps}, exactly like a crossing
 *    abutment already was. A blocking prop landing on a causeway would sever the very
 *    connection it was carved to make.
 *  - **Fix 3 — the carve follows a breadth-first route over BASE-open ground.** A
 *    straight line between the two nearest tiles of two components can cut through
 *    ground the region's OWN mechanics (not this terrain) already keep shut, opening it
 *    forever. {@link carveBetween} instead searches breadth-first, 4-connected,
 *    TOROIDALLY, over tiles where `baseCollision` is already open, and paints only the
 *    verified route — `carveCrossing` (unchanged from the pilot) is still the brush that
 *    paints each short step of that route, but the ENDPOINTS it is fed now come from the
 *    search, never from raw nearest-tile geometry.
 *
 * The connectivity invariant is RELATIVE, exactly as Warm Springs states it: a body of
 * unprotected open ground the base recipe already keeps as its own component may not be
 * merged or split by this terrain, and a protected tile must always remain reachable
 * within the component it started in. Small scraps of ordinary open ground that predate
 * this terrain, or that no base-open route can reach, are left alone — they carry
 * nothing, and every region already has a few.
 *
 * `nearestPair` and `sealPocket` both still appear in the promotion's own "keep verbatim"
 * list — but `sealPocket` is also, in the same instructions, the one function explicitly
 * ordered deleted at cause. Where those two conflict this module follows the more
 * specific, cited, safety-critical instruction: `sealPocket` is gone. `nearestPair` is
 * kept, verbatim, per that same list — its role (a raw-distance hint for where to carve)
 * is superseded by {@link carveBetween}'s breadth-first search, so nothing in this module
 * calls it; it is retained for interface parity with the pilot and because the repo's
 * `tsconfig.json` does not set `noUnusedLocals`, so its retention costs nothing. Flagged
 * in the promotion report, not hidden.
 *
 * ## Torus law (contract §2, unchanged)
 *
 * Every field function here stays periodic with period (96, 96) BY CONSTRUCTION —
 * {@link periodicValueNoise}/{@link periodicFbm} hash a wrapped lattice, the corner field
 * is stored as a 96x96 array with wrapped indices ({@link cornerIndex}), and
 * {@link nirvanaEastCornerSeamMismatches} proves `cornerAt(96, y) === cornerAt(0, y)` and
 * `cornerAt(x, 96) === cornerAt(x, 0)` for every one of the 96 pairs on both axes.
 *
 * Terrain reaches movement legality through `navigation/groundTerrain.ts` —
 * `grid.collision` plus the destination-tile check — never through exclusion rects.
 * `scene.collision` returned here is THIS TERRAIN's own blocking mask alone (terrain
 * materials plus blocking prop/landform footprints); the caller unions it onto the
 * region's base collision through `composeGroundTerrainCollision`, exactly as Warm
 * Springs' caller does.
 */

import {
  deriveSceneryFootprintGeometry,
  sceneryFootprintTilesForFoot,
  singleTileFootprint,
  type SceneryContactModel,
  type SceneryFootprintExtent,
  type SceneryFrameGeometry,
} from "../placement/sceneryFootprint";
import {
  BLOCKING_NIRVANA_EAST_MATERIALS,
  hasShoreSet,
  isBlockingNirvanaEastMaterial,
  isWaterMaterial,
  NIRVANA_EAST_BASE_VARIANTS,
  NIRVANA_EAST_EDGE_VARIANTS,
  NIRVANA_EAST_MATERIAL_PRIORITY,
  type NirvanaEastMaterial,
} from "./NirvanaEastMaterials";

export const NIRVANA_EAST_REGION_ID = "nirvana_east";

export const NIRVANA_EAST_COLUMNS = 96;
export const NIRVANA_EAST_ROWS = 96;
export const NIRVANA_EAST_TILE_SIZE = 32;
export const NIRVANA_EAST_WIDTH_PX = NIRVANA_EAST_COLUMNS * NIRVANA_EAST_TILE_SIZE;
export const NIRVANA_EAST_HEIGHT_PX = NIRVANA_EAST_ROWS * NIRVANA_EAST_TILE_SIZE;

/** The torus period, tiles, on both axes (contract §2 — always square, always 96). */
const TORUS = NIRVANA_EAST_COLUMNS;

/**
 * ROUND 2: landforms are authored illustrated OBJECTS standing on the ground plane, not
 * terrain colour tiers. Three size tiers, matching the authored atlas frames exactly
 * (`s.mesa.*` / `s.butte.*` / `s.outcrop.*`).
 */
export type NirvanaEastLandformTier = "mesa" | "butte" | "outcrop";

export const NIRVANA_EAST_LANDFORM_TIERS: readonly NirvanaEastLandformTier[] = Object.freeze([
  "mesa",
  "butte",
  "outcrop",
]);

/**
 * How many authored PLAN VARIANTS the published atlas carries per landform tier.
 *
 * **The headroom is spent where the repetition is actually visible, and nowhere else.**
 * The region carries 54 landforms; measured at four run seeds the mix is 1-3 mesas,
 * 10-13 buttes and 39-41 outcrops, and the infill pass that raised outcrops from 31 to
 * ~40 put 7-10 of them into the settled band — so the small tiers are the ones a viewer
 * sees several of in one frame, and they are also by far the cheapest to vary
 * (an outcrop frame is 20,480 px against a mesa's 196,608).
 *
 * Hence: **outcrop 4, butte 3, mesa 1.** The mesa keeps exactly one plan — it is a hero
 * object, there are only ever one to three of them in the whole region, and it is the
 * silhouette that took two owner rounds to win, so a second mesa plan would spend ~20 KB
 * (a fifth of the entire per-kit budget) on the one tier whose repetition nobody can see.
 *
 * Every tier's variant 0 is the approved plan, unchanged, so the object the owner gated
 * still ships byte-for-byte; the extra variants are strictly additive frames.
 *
 * `NirvanaEastAssetProfile.ts` asserts the published atlas carries exactly these frames,
 * at exactly the tier's authored geometry, every time it loads.
 */
export const NIRVANA_EAST_LANDFORM_VARIANTS:
Readonly<Record<NirvanaEastLandformTier, number>> = Object.freeze({
  mesa: 1,
  butte: 3,
  outcrop: 4,
});

/**
 * How far apart, in tiles, two landforms of the same tier have to be before repeating a
 * plan stops being visible.
 *
 * Sized to the frame a viewer judges in one glance, not guessed: the production plates
 * crop 1,536 x 1,024 px, which at 32 px tiles is 48 x 32 tiles. A radius of 24 tiles is
 * that crop's own half-width, so any two rocks that can appear together are inside each
 * other's neighbourhood. The first value tried was 16, and the measurement said it was
 * too small — the settled-band plate still showed four of five outcrops alike, because
 * the two that repeated were 18 tiles apart and therefore invisible to the rule while
 * being perfectly visible in the same frame.
 */
const LANDFORM_VARIANT_NEIGHBOURHOOD = 24;

/**
 * Choose the authored plan variant every landform draws, once, for the whole field.
 *
 * **Why this is not simply a hash of the foot tile, which is what it was first.** A plain
 * hash is uniform over the REGION and says nothing about neighbours, and the repetition
 * this pass exists to remove is a local phenomenon: what reads badly is four outcrops in
 * one frame with the same silhouette, not an imbalanced census. Measured on the first cut
 * — a per-tile hash — the region-wide outcrop split was an even 11/11/10/8 while the
 * settled band, the frame the plates actually show, came out **5 of 7 identical** at seed
 * 401 and 7 of 9 at seed 1337. Uniform globally, unchanged where it mattered.
 *
 * So the plan is chosen greedily against the neighbours already chosen: each rock takes
 * the plan that is LEAST represented among same-tier landforms within
 * {@link LANDFORM_VARIANT_NEIGHBOURHOOD} tiles (toroidally), weighted by 1/(1 + distance)
 * so an immediate neighbour outvotes a distant one, and ties break on the same per-tile
 * hash so the field never falls into a readable cycle.
 *
 * **Deterministic and placement-order independent.** The scan order is the canonical
 * (row, column, id) sort of the placements, NOT the order the lattices and the infill pass
 * happened to append them in — otherwise adding one rock would renumber every rock behind
 * it and the whole region would repaint.
 *
 * The tier's contact model is a fraction of its FRAME, not of its plan
 * ({@link LANDFORM_CONTACT}), and every variant of a tier shares one frame geometry — so
 * this choice moves pixels and nothing else. Collision, footprints, the protection gate
 * and every connectivity invariant are unchanged by construction.
 */
function assignLandformVariants(
  placements: readonly NirvanaEastLandformPlacement[],
): ReadonlyMap<string, number> {
  const ordered = [...placements].sort((left, right) => wrapCoord(left.footRow) - wrapCoord(right.footRow)
    || wrapCoord(left.footCol) - wrapCoord(right.footCol)
    || left.id.localeCompare(right.id));
  const assigned: Array<{
    tier: NirvanaEastLandformTier; column: number; row: number; variant: number;
  }> = [];
  const chosen = new Map<string, number>();
  for (const placement of ordered) {
    const variants = NIRVANA_EAST_LANDFORM_VARIANTS[placement.tier];
    const column = wrapCoord(placement.footCol);
    const row = wrapCoord(placement.footRow);
    const tie = hash2(Math.floor(column), Math.floor(row), SEED_B + 97);
    let bestVariant = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let step = 0; step < variants; step += 1) {
      // Start the sweep at the hash's own pick, so with no neighbours at all the choice
      // is the hash's and the field keeps its uncorrelated look.
      const variant = (Math.floor(tie * variants) + step) % variants;
      let crowding = 0;
      for (const other of assigned) {
        if (other.tier !== placement.tier || other.variant !== variant) continue;
        const dc = Math.abs(other.column - column);
        const dr = Math.abs(other.row - row);
        const distance = Math.hypot(Math.min(dc, TORUS - dc), Math.min(dr, TORUS - dr));
        if (distance > LANDFORM_VARIANT_NEIGHBOURHOOD) continue;
        crowding += 1 / (1 + distance);
      }
      if (crowding < bestScore) {
        bestScore = crowding;
        bestVariant = variant;
        if (crowding === 0) break; // nothing beats an unused plan; keep the hash's order
      }
    }
    assigned.push({ tier: placement.tier, column, row, variant: bestVariant });
    chosen.set(placement.id, bestVariant);
  }
  return chosen;
}

/** A walkable pocket smaller than this — and holding no protected tile — is left alone. */
const MIN_DECKED_POCKET_TILES = 20;

/** No authored crossing may span more blocked ground than this. */
const MAX_CROSSING_DECK_TILES = 16;

/**
 * How many times the whole scene may be rebuilt while the connectivity repair carves.
 *
 * Each attempt opens strictly more ground, so this is a safety stop, not a tuning dial —
 * mirrors Warm Springs' identical constant and value.
 */
const MAX_SCENE_ATTEMPTS = 24;

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
   * Every tile this ONE prop instance blocks. An ordinary single-tile prop (thornbush,
   * boulder, hoodoo, ...) always carries a one-element footprint from
   * {@link singleTileFootprint}; a landform carries its full multi-tile ellipse from
   * {@link tryPlaceLandform}, toroidally wrapped.
   */
  readonly footprint: readonly NirvanaEastTileRef[];
  /**
   * Non-null only for landform props: the id every prop entry belonging to ONE physical
   * landform placement shares — the anchor (which blocks) and its purely-visual
   * wrapped-edge duplicates (see {@link wrapDuplicateOffsets}) alike. The connectivity
   * repair removes a whole group together, never a lone duplicate, so a dropped landform
   * never leaves a floating sprite with mismatched collision.
   */
  readonly landformGroup: string | null;
}

/**
 * One accepted landform placement, pre-plot-safety-checked. `footCol`/`footRow` are the
 * sprite's foot (pivot) in RAW, possibly out-of-[0,96) continuous TILE units — wrapped
 * only at the point of use, exactly like every other periodic field in this module.
 * `footprint` is the already-wrapped, deduplicated set of blocked tiles.
 */
export interface NirvanaEastLandformPlacement {
  readonly id: string;
  readonly tier: NirvanaEastLandformTier;
  readonly footCol: number;
  readonly footRow: number;
  readonly footprint: readonly NirvanaEastTileRef[];
}

export interface NirvanaEastScene {
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
  readonly landforms: readonly NirvanaEastLandformPlacement[];
}

/**
 * The ground production forbids blocking terrain from ever closing.
 *
 * Row-major over the canonical 96x96 grid, `1` = protected. Built by
 * `NirvanaEastRegionMapRecipe.ts` from the REAL recipe — shelter render footprints,
 * anchors, gates, staging envelopes, path/soil tiles, authored scenery and the visual
 * story layer — so this field never has to guess the world's mechanics geometry. The
 * pilot's `blockingAdmitted(column, row)` hardcoded the 128 shelter-plot anchors this
 * mask replaces.
 */
export interface NirvanaEastProtection {
  readonly columns: number;
  readonly rows: number;
  /** Tiles the region's mechanics need open; blocking materials and landforms are denied here. */
  readonly protected: Uint8Array;
  /**
   * The recipe's own authored water (`waterVoidMask`), row-major, `1` = water.
   *
   * These tiles are already hard collision in the generic recipe, so painting walkable
   * ground over them would be invisible wall. Sampled into the corner field as `brine`
   * instead — see {@link cornerIsRecipeWater} — exactly as Warm Springs samples its own
   * water as `pool`.
   */
  readonly water: Uint8Array;
  /**
   * The recipe's authored route network (`pathMask`), row-major, `1` = route.
   *
   * Accepted for shape parity with the recipe (and with `WarmSpringsProtection`) and
   * validated at the same dimension check as every other field here, but NOT consumed by
   * Butte Country's ground rule: composition B's approved plate has no path overlay — its
   * whole floor is the calm open playa {@link openFloorMaterialAt} paints — unlike Warm
   * Springs' terrace, which draws its route network as a worn sinter track. Kept rather
   * than dropped so a future composition (or a shared protection-mask builder) does not
   * have to change its return shape to add one.
   */
  readonly path: Uint8Array;
}

// ---------------------------------------------------------------------------
// deterministic, TOROIDALLY PERIODIC noise (contract §2.1) — unchanged from the pilot
// ---------------------------------------------------------------------------

function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 0x27d4_eb2d) ^ Math.imul(y | 0, 0x1656_67b1)
    ^ Math.imul(seed | 0, 0x9e37_79b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85eb_ca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2_ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffff_ffff;
}

/**
 * Value noise whose lattice hash is wrapped modulo `period` BEFORE hashing, so the field
 * is EXACTLY periodic: `noise(x, y) === noise(x + period, y)`. `period` must be a
 * positive integer. Every caller derives it as `TORUS / feature`, so it is only ever an
 * integer when `feature` divides `TORUS` — {@link periodicFbm} enforces that at call time.
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
 * Periodic fractal-brownian-motion. `features` lists one FEATURE size (tiles spanned by
 * one noise cell) per octave, each of which MUST divide {@link TORUS} — `TORUS / feature`
 * is then an exact integer lattice period, so the whole sum is periodic with period
 * (96, 96).
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
// shelter-district geometry — kept for `districtCenters()`, which the pilot's own
// `mesaFieldGeometry()` still calls (see that function). The 128-anchor PLOT machinery
// that used to gate blocking terrain and pre-claim props is gone: {@link
// NirvanaEastProtection} replaces it with the real recipe geometry.
// ---------------------------------------------------------------------------

const SHELTER_DISTRICT_ORIGINS: readonly Point[] = Object.freeze([
  { x: 18, y: 18 }, { x: 34, y: 18 }, { x: 50, y: 18 }, { x: 66, y: 18 },
  { x: 66, y: 50 }, { x: 50, y: 50 }, { x: 34, y: 50 }, { x: 18, y: 50 },
]);

/**
 * Extra corner-columns of padding denied around a protected tile. A tile blocks once
 * >=2 of its 4 corners agree, and a corner at (column,row) is treated as coordinate-close
 * to a protected tile at the same numeric distance the pilot's own plot padding used — see
 * {@link dilateProtectedMask}.
 */
const PLOT_GATE_BUFFER = 1;

// ---------------------------------------------------------------------------
// the plot-safety gate — NOW a protection mask read from the real recipe (change 1)
// ---------------------------------------------------------------------------

/**
 * Dilate `protection.protected` by `buffer` tiles (Chebyshev, toroidal), ONCE per scene
 * build, so {@link blockingAdmitted} is an O(1) lookup rather than the pilot's O(128)
 * scan per corner.
 *
 * The dilation reproduces the pilot's own toroidal buffer semantics exactly: the pilot
 * denied a corner at `column` when `column` fell within
 * `[anchor.x - buffer, anchor.x + PLOT_SPAN + buffer]` of ANY plot anchor — i.e. within
 * plain coordinate (not tile-touch) distance `buffer` of the protected tile RANGE
 * `[anchor.x, anchor.x + PLOT_SPAN]`. Dilating the real per-tile protected mask by
 * Chebyshev distance `buffer` and then testing a corner's own (column, row) directly
 * against the dilated mask (via {@link cornerIndex}'s wrap) is the same rule generalised
 * from "a rectangular plot" to "any protected tile shape."
 */
function dilateProtectedMask(protection: NirvanaEastProtection, buffer: number): Uint8Array {
  const { columns, rows, protected: source } = protection;
  const dilated = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (source[row * columns + column] !== 1) continue;
      for (let dr = -buffer; dr <= buffer; dr += 1) {
        const r = ((row + dr) % rows + rows) % rows;
        for (let dc = -buffer; dc <= buffer; dc += 1) {
          const c = ((column + dc) % columns + columns) % columns;
          dilated[r * columns + c] = 1;
        }
      }
    }
  }
  return dilated;
}

/**
 * THE UNIVERSAL PLOT-SAFETY GATE. True when a blocking material may be admitted at
 * corner `(column, row)` — i.e. when that corner is not within {@link PLOT_GATE_BUFFER}
 * tiles (toroidally, via the precomputed `dilatedProtected` mask) of any protected tile.
 */
function blockingAdmitted(dilatedProtected: Uint8Array, column: number, row: number): boolean {
  return dilatedProtected[cornerIndex(column, row)] !== 1;
}

/**
 * True when at least two of the four tiles touching corner `(x, y)` are recipe water.
 *
 * Two, not one: a tile blocks at >= 2 blocking corners, so a one-tile rule would make
 * every tile merely ADJACENT to authored water block as well. Mirrors Warm Springs'
 * `cornerIsRecipeWater` exactly.
 */
function cornerIsRecipeWater(protection: NirvanaEastProtection, x: number, y: number): boolean {
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

function isProtectedTile(protection: NirvanaEastProtection, index: number): boolean {
  return protection.protected[index] === 1;
}

// ---------------------------------------------------------------------------
// the open floor (composition B's whole ground) — unchanged from the pilot
// ---------------------------------------------------------------------------

/**
 * Feature sizes for the OPEN FLOOR (composition B only). 32 and 16 tiles per noise cell
 * against the ordinary background's 16/8/4 and the apron's 6/3 — an order of magnitude
 * calmer, and both divide 96 so the torus is untouched.
 */
const OPEN_FLOOR_FEATURES: readonly number[] = [32, 16, 8];
const OPEN_FLOOR_ACCENT_FEATURES: readonly number[] = [16, 8];

/**
 * The open playa floor Butte Country's landform objects stand on.
 *
 * A PALE, CALM playa — hardpan-dominant, with large bright salt pans and large charcoal
 * gravel / red oxide pavement masses — built from very-low-frequency fields so a patch
 * is tens of tiles across rather than three or four. The RED landform objects are the
 * only saturated red in the frame and the only thing with relief: figure against ground.
 */
export function openFloorMaterialAt(column: number, row: number, seed: number): NirvanaEastMaterial {
  const tone = periodicFbm(column, row, seed + 7000, OPEN_FLOOR_FEATURES);
  const accent = periodicFbm(column, row, seed + 7300, OPEN_FLOOR_ACCENT_FEATURES);
  if (tone > 0.585) return "salt";
  if (tone < 0.395) return accent > 0.56 ? "gravel" : "oxide";
  // Rust veins and stringers threaded through the pale zone, so a calm hardpan zone
  // still carries the region's identity materials.
  if (accent > 0.74) return "redsand";
  if (accent < 0.24) return "dustgrass";
  return "hardpan";
}

// ---------------------------------------------------------------------------
// corner field assembly — composition-free (change 3): only the open floor plus the
// recipe's own gated water ever paints a corner for Butte Country.
// ---------------------------------------------------------------------------

function cornerMaterialFor(
  geometry: MesaFieldGeometry,
  protection: NirvanaEastProtection,
  dilatedProtected: Uint8Array,
  x: number,
  y: number,
): NirvanaEastMaterial {
  // The recipe's authored water comes first, exactly as Warm Springs samples its own
  // authored springs as `pool` ahead of every generated layer (module docstring, change
  // 1): those tiles are already hard collision in the generic recipe.
  if (blockingAdmitted(dilatedProtected, x, y) && cornerIsRecipeWater(protection, x, y)) {
    return "brine";
  }
  // `openFloorMaterialAt` never returns a material in `BLOCKING_NIRVANA_EAST_MATERIALS`
  // (salt/gravel/oxide/redsand/dustgrass/hardpan are all WALKABLE), so no plot gate is
  // needed for it — unlike the deleted channel/mass/band systems, which painted brine,
  // thorn, mesa, scarp and slot directly into the corner field and had to be gated
  // individually.
  return openFloorMaterialAt(x, y, geometry.cornerSeed);
}

function cornerIndex(column: number, row: number): number {
  const c = ((column % NIRVANA_EAST_COLUMNS) + NIRVANA_EAST_COLUMNS) % NIRVANA_EAST_COLUMNS;
  const r = ((row % NIRVANA_EAST_ROWS) + NIRVANA_EAST_ROWS) % NIRVANA_EAST_ROWS;
  return r * NIRVANA_EAST_COLUMNS + c;
}

/**
 * The torus-invariant accessor: any `(column, row)`, however far outside `[0, 96)`,
 * resolves to the same wrapped cell as its canonical equivalent. This is what makes
 * `cornerAt(96, y) === cornerAt(0, y)` true BY CONSTRUCTION (contract §2.5).
 */
export function cornerAt(
  corners: readonly NirvanaEastMaterial[],
  column: number,
  row: number,
): NirvanaEastMaterial {
  return corners[cornerIndex(column, row)];
}

/**
 * The provable torus invariant (contract §2.5): the corner field, sampled on the 96x96
 * lattice with wrapped indices, must agree at column 96 with column 0 (for all 96 rows)
 * and at row 96 with row 0 (for all 96 columns). Zero mismatches on both axes or the
 * composition is not shippable.
 */
export function nirvanaEastCornerSeamMismatches(scene: NirvanaEastScene): { northSouth: number; eastWest: number } {
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

function buildCornerField(
  geometry: MesaFieldGeometry,
  protection: NirvanaEastProtection,
  dilatedProtected: Uint8Array,
): NirvanaEastMaterial[] {
  const corners: NirvanaEastMaterial[] = new Array(NIRVANA_EAST_COLUMNS * NIRVANA_EAST_ROWS);
  for (let row = 0; row < NIRVANA_EAST_ROWS; row += 1) {
    for (let column = 0; column < NIRVANA_EAST_COLUMNS; column += 1) {
      corners[cornerIndex(column, row)] = cornerMaterialFor(geometry, protection, dilatedProtected, column, row);
    }
  }
  return corners;
}

/**
 * Paint a walkable causeway-safe swath into the corner field between two points.
 *
 * Kept verbatim from the pilot. In the pilot's own assembly this was fed a single
 * straight `(from, to)` pair spanning the whole gap between two components — the exact
 * shape Warm Springs fix 3 identified as unsafe. In production it is instead fed one
 * short segment per step of a verified breadth-first route (see {@link carveBetween}),
 * so the tool is unchanged but the path it paints is now provably safe.
 */
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

// ---------------------------------------------------------------------------
// tile derivation (identical discipline to the Warm Springs pilot) — unchanged
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

  const agreeing = cornerMaterials.filter((candidate) => isBlockingNirvanaEastMaterial(candidate) === blocked);
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
// crossings — identical derivation discipline to Warm Springs' boardwalks, unchanged.
// Operates on the BOUNDED [0, limit) domain deliberately, matching the real
// `findNavigationPath` (which does not route across the torus seam) — crossings are a
// LOCAL concept.
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
 * Resolve one crossing plan, or `null` if this specific line genuinely has nothing to
 * cross. `plan.midstream` is a HINT, not an assertion — the resolver searches OUTWARD
 * across the ENTIRE line for the nearest blocked position; a fully-walkable line simply
 * means this composition does not need a crossing there, so `null` is returned rather
 * than thrown.
 */
function resolveCrossing(
  tiles: readonly NirvanaEastTile[],
  plan: CrossingPlan,
  baseCollision: Uint8Array,
): NirvanaEastCrossing | null {
  const limit = plan.axis === "east-west" ? NIRVANA_EAST_COLUMNS : NIRVANA_EAST_ROWS;
  const blockedAt = (position: number): boolean => {
    if (position < 0 || position >= limit) return true;
    const ref = tileRefAlong(plan, position);
    return tiles[ref.row * NIRVANA_EAST_COLUMNS + ref.column].blocked;
  };
  /**
   * True when the GENERIC recipe already closes this tile.
   *
   * A plank deck makes a tile walkable in THIS field's own mask, but the field composes
   * onto the recipe by UNION (`composeGroundTerrainCollision`) and a union can only ever
   * add blocking — base collision is not this field's to re-open. So a deck laid over
   * ground the generic recipe already blocks is a deck a being can never set foot on, and
   * the crossing is unusable however well the terrain around it behaves.
   *
   * Measured, not assumed: at run seed 1337 `b-ns-wall` decked (45,16), which the generic
   * recipe blocks with its own placement, and the real navigator returned `nearest`
   * instead of `reached` for a crossing every gate otherwise called resolved. This is the
   * same lesson Warm Springs' third seed-robustness fix records — "base collision is not
   * this field's to change, so the causeway has to go where the base leaves room"
   * (`.superpowers/sdd/warm-springs-live-report.md` §9.1).
   */
  const baseBlockedAt = (position: number): boolean => {
    if (position < 0 || position >= limit) return true;
    const ref = tileRefAlong(plan, position);
    return baseCollision[ref.row * NIRVANA_EAST_COLUMNS + ref.column] === 1;
  };
  /** A crossable candidate: this field blocks it, and the base leaves room to deck it. */
  const deckableAt = (position: number): boolean => blockedAt(position) && !baseBlockedAt(position);

  const midstream = ((): number | null => {
    if (deckableAt(plan.midstream)) return plan.midstream;
    for (let offset = 1; offset < limit; offset += 1) {
      for (const candidate of [plan.midstream - offset, plan.midstream + offset]) {
        if (candidate <= 0 || candidate >= limit - 1) continue;
        if (deckableAt(candidate)) return candidate;
      }
    }
    return null;
  })();
  if (midstream === null) return null;

  let first = midstream;
  while (first > 0 && deckableAt(first - 1) && midstream - first < MAX_CROSSING_DECK_TILES) first -= 1;
  let last = midstream;
  while (last < limit - 1 && deckableAt(last + 1) && last - midstream < MAX_CROSSING_DECK_TILES) last += 1;

  // Both abutments must be genuinely standable: unblocked by this field AND left open by
  // the base. An abutment the base closes is a bank a being can never stand on.
  if (blockedAt(first - 1) || baseBlockedAt(first - 1)) return null;
  if (blockedAt(last + 1) || baseBlockedAt(last + 1)) return null;

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
  baseCollision: Uint8Array,
): NirvanaEastCrossing[] {
  const resolved: NirvanaEastCrossing[] = [];
  for (const plan of plans) {
    const crossing = resolveCrossing(tiles, plan, baseCollision);
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
// connectivity - TOROIDAL by default (contract §2.6), unchanged
// ---------------------------------------------------------------------------

export interface NirvanaEastComponent {
  readonly tiles: readonly number[];
}

/** Four-connected walkable components; wraps at both edges when `toroidal` (the default). */
export function nirvanaEastWalkableComponents(
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

/**
 * Nearest raw-distance pair of tiles between two components, toroidally. Kept verbatim
 * per the promotion's "keep unchanged and exact" list. Unused by
 * {@link createNirvanaEastScene}'s repair: its role — a hint for where to carve — is
 * superseded by {@link carveBetween}'s breadth-first search over base-open ground (module
 * docstring, "why the repair no longer seals"). Retained for interface parity with the
 * pilot; the repo's `tsconfig.json` sets neither `noUnusedLocals` nor a lint gate on this
 * package, so its retention has no build cost.
 */
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
// Reference kept live (see docstring above) without being part of the shipped repair
// path — TypeScript would otherwise report it unused under a stricter local config.
void nearestPair;

// ---------------------------------------------------------------------------
// landform footprints — via the SHARED sceneryFootprint module (change 2)
// ---------------------------------------------------------------------------

/**
 * Where a landform tier's frame touches the ground, as fractions of the frame — the
 * exact contact model the pilot's bespoke `landformFootprintGeometry` hand-derived
 * (cap centre 0.245 + wall height 0.30 = 0.545 of frame height), now declared once for
 * `placement/sceneryFootprint.ts` to consume. Reproduces the pilot's own hand-derived
 * tier table (mesa 5.00/2.26/-0.96/-3.02, butte 2.81/1.32/-0.54/-1.76, outcrop
 * 1.56/0.76/-0.30/-1.01) — pinned by `sceneryFootprint.test.ts` and this module's own
 * test suite.
 */
const LANDFORM_CONTACT: SceneryContactModel = {
  shape: "ellipse",
  centerXFraction: 0.44,
  centerYFraction: 0.545,
  halfWidthFraction: 0.34,
  halfHeightFraction: 0.205,
  shrink: 0.92,
};

/** The grid every scenery footprint in this region is resolved against. */
const NIRVANA_EAST_EXTENT: SceneryFootprintExtent = {
  columns: NIRVANA_EAST_COLUMNS,
  rows: NIRVANA_EAST_ROWS,
  tileSize: NIRVANA_EAST_TILE_SIZE,
  topology: "toroidal",
};

/**
 * Sprite feet offsets, kept in step with the SHIPPED atlas's own authored pivots
 * (`assets/atlas.json` sceneryFrames) - the same "scene hardcodes what the art
 * authored" discipline `WarmSpringsTerrainField.ts`'s `PROP_PIVOTS` uses. The three
 * landform tiers (`mesa`/`butte`/`outcrop`) are the REAL authored pivots asserted
 * against the published atlas by `NirvanaEastAssetProfile.ts`'s
 * `assertLandformPivotsAgree` every time it loads, rather than trusted here silently.
 * Kept verbatim, in full — including species (`mesquite`, `saltrime`) composition B
 * never places — per the promotion's "keep unchanged and exact" instruction: this is
 * plain data shared with the whole atlas vocabulary (`NirvanaEastAssetProfile.ts`
 * enumerates all sixteen species), not composition-specific logic.
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

function frameFor(tier: NirvanaEastLandformTier): SceneryFrameGeometry {
  const pivot = PROP_PIVOTS[tier];
  if (pivot === undefined) {
    throw new NirvanaEastSceneError(`Nirvana East scene has no pivot entry for landform tier ${tier}.`);
  }
  const [width, height, pivotX, pivotY] = pivot;
  return { width, height, pivotX, pivotY };
}

/**
 * Attempt one landform placement: derive its footprint through the shared module and
 * reject it OUTRIGHT (before ever touching `placements`) if any footprint tile is one the
 * region's mechanics need open. Returns `true` iff the placement was accepted and pushed.
 *
 * **This gate reads the UNDILATED protection mask, and that is deliberate — it was
 * measured.** The 1-tile dilation exists for the CORNER field: a tile blocks once >= 2 of
 * its 4 corners carry a blocking material, so denying blocking material at a corner has
 * to cover every corner of every protected tile, and a symmetric 1-tile buffer is the
 * smallest safe superset of that. A landform footprint is not corner data — it is already
 * the exact set of TILES the object closes, so the honest test is "does this close a tile
 * the mechanics need", and dilating it over-rejects by construction.
 *
 * The measurement that forced this (`landform-diagnosis.json`): the pilot's plot-only gate
 * denied 32.4 % of the region and the real recipe-derived protection covers a near-identical
 * 33.7 % — but the pilot's was eight solid district blocks while the real one is SCATTERED
 * (256 staging anchors, 256 staging points, 420 terrain-patch cells, 393 path/soil cells,
 * 202 visual-path cells sprinkled region-wide). Dilated, that scatter inflates to 51.1 %,
 * and a mesa's 36-tile footprint then almost always clips one stray tile. Gating landforms
 * on the dilated mask cost 20 of 50 placements — including BOTH mesas of the deliberate
 * two-mesa wall, each rejected over 4-5 tiles of a 36-tile footprint — and the 1:1 plate
 * showed the region visibly stripped of the objects that are its whole subject.
 *
 * Nothing is weakened: `NirvanaEastRegionMapRecipe.test.ts` asserts, on the composed
 * collision at four run seeds, that no mechanics tile, staging point, route cell, soil cell
 * or passive-scenery cell is closed, and that no protected tile is stranded.
 */
function tryPlaceLandform(
  placements: NirvanaEastLandformPlacement[],
  protectedTiles: Uint8Array,
  tier: NirvanaEastLandformTier,
  footCol: number,
  footRow: number,
  id: string,
): boolean {
  const footprint = sceneryFootprintTilesForFoot(
    { footColumn: footCol, footRow: footRow },
    frameFor(tier),
    LANDFORM_CONTACT,
    NIRVANA_EAST_EXTENT,
  );
  if (footprint.length === 0) return false;
  for (const tile of footprint) {
    if (protectedTiles[tile.row * NIRVANA_EAST_COLUMNS + tile.column] === 1) return false;
  }
  placements.push(Object.freeze({ id, tier, footCol, footRow, footprint }));
  return true;
}

/**
 * The tier ladder, largest first — the order {@link placeLargestAdmittedLandform}
 * steps down.
 */
const LANDFORM_TIER_LADDER: readonly NirvanaEastLandformTier[] = Object.freeze([
  "mesa", "butte", "outcrop",
]);

/**
 * Place the LARGEST tier this site legally admits, stepping down the ladder from
 * the tier the lattice asked for.
 *
 * **This is what puts the region's identity where beings actually live, without
 * weakening one byte of the protection it is gated on.** Measured on the shipped
 * region: 43-45 landforms, and exactly ONE of them — a single butte, at every run
 * seed — stood inside the bounding box of the 128 shelter plots. Every other
 * mesa, butte and outcrop was in the outer margin. That is correct behaviour, not
 * a bug: a mesa's ground contact is ~36 tiles and the settled band is a scatter of
 * staging points, route cells, soil cells and story cells, so a mesa almost always
 * clips one and is rightly refused. The wrong fix would be to relax the gate.
 *
 * The right fix is that the tiers are not interchangeable in size:
 *
 * | tier | frame | ground contact |
 * |---|---|---|
 * | `mesa` | 512x384 | ~10.0 x 4.5 tiles |
 * | `butte` | 288x224 | ~5.6 x 2.6 |
 * | `outcrop` | 160x128 | ~3.1 x 1.5 |
 *
 * An outcrop closes roughly a twelfth of what a mesa closes, so ground that can
 * never legally hold a mesa can very often hold an outcrop. Asking for the
 * largest tier a site admits — rather than asking for one tier and taking nothing
 * when it is refused — turns a site the settlement would have denied outright into
 * a smaller rock the settlement can carry, and the field keeps its big objects
 * exactly where it always had them, in the open margin. The result is a graded
 * landscape: mesas and buttes on the open playa, outcrops threading between the
 * districts, which is what butte country actually looks like.
 *
 * @returns The tier actually placed, or `null` when even an outcrop is refused.
 */
function placeLargestAdmittedLandform(
  placements: NirvanaEastLandformPlacement[],
  protectedTiles: Uint8Array,
  tier: NirvanaEastLandformTier,
  footCol: number,
  footRow: number,
  id: string,
): NirvanaEastLandformTier | null {
  const start = LANDFORM_TIER_LADDER.indexOf(tier);
  for (let step = start < 0 ? 0 : start; step < LANDFORM_TIER_LADDER.length; step += 1) {
    const candidate = LANDFORM_TIER_LADDER[step]!;
    if (tryPlaceLandform(placements, protectedTiles, candidate, footCol, footRow, id)) {
      return candidate;
    }
  }
  return null;
}

/**
 * How many landform objects the field aims to carry in total.
 *
 * The number the OWNER approved, on the pilot plate: 54. The shipped region
 * builds 43-45, because the pilot's gate saw only the 128 plot footprints while
 * the real recipe also protects staging envelopes, routes, soil, story cells and
 * visual-path cells. This is the target the infill pass fills TOWARD, never past.
 */
const LANDFORM_TARGET_COUNT = 54;

/** Candidate infill sites are tested on this tile pitch. */
const LANDFORM_INFILL_PITCH = 2;

/** Tiles of clear ground an infill landform must keep from every other landform. */
const LANDFORM_INFILL_SEPARATION = 2;

/** Half-width of the window used to score how SETTLED a candidate infill site is. */
const LANDFORM_SETTLEMENT_WINDOW = 6;

/**
 * Fill the settled band with the largest tier each remaining site legally admits.
 *
 * **Why a SEARCH and not another lattice.** The tier ladder alone
 * ({@link placeLargestAdmittedLandform}) barely moved the measurement — 45 -> 47
 * landforms, still exactly ONE inside the settled band — and the reason is that
 * the two authored lattices sample on a 16- and an 8-tile pitch, so inside the
 * settlement they mostly land ON a district block, where nothing of any tier is
 * legal. The settlement's open ground is its GUTTERS: two- to four-tile lanes
 * between the district blocks, which an outcrop's ~3.1 x 1.5-tile contact fits and
 * a lattice on an 8-tile pitch almost never hits. Finding them is a scan, not a
 * finer dice roll.
 *
 * Candidates are ordered by how much PROTECTED ground surrounds them, most first,
 * so the pass spends its budget where beings actually live rather than topping up
 * the empty margin the lattices have already furnished. Nothing about the gate is
 * relaxed: every candidate still goes through {@link tryPlaceLandform}, which
 * refuses outright if a single footprint tile is one the mechanics need.
 *
 * Deterministic: a fixed scan order, a fixed hash for the sub-tile jitter, no RNG.
 */
function infillLandforms(
  placements: NirvanaEastLandformPlacement[],
  protectedTiles: Uint8Array,
): void {
  if (placements.length >= LANDFORM_TARGET_COUNT) return;

  const taken = new Uint8Array(NIRVANA_EAST_COLUMNS * NIRVANA_EAST_ROWS);
  const claim = (placement: NirvanaEastLandformPlacement): void => {
    for (const tile of placement.footprint) {
      for (let dr = -LANDFORM_INFILL_SEPARATION; dr <= LANDFORM_INFILL_SEPARATION; dr += 1) {
        for (let dc = -LANDFORM_INFILL_SEPARATION; dc <= LANDFORM_INFILL_SEPARATION; dc += 1) {
          taken[wrapCoord(tile.row + dr) * NIRVANA_EAST_COLUMNS + wrapCoord(tile.column + dc)] = 1;
        }
      }
    }
  };
  for (const placement of placements) claim(placement);

  // Prefix sums over the protection mask, so the settlement score of 2,304
  // candidates is 2,304 constant-time window reads rather than 2,304 x 169.
  const width = NIRVANA_EAST_COLUMNS;
  const height = NIRVANA_EAST_ROWS;
  const rowSums = new Int32Array(width * height);
  for (let row = 0; row < height; row += 1) {
    let running = 0;
    for (let column = 0; column < width; column += 1) {
      running += protectedTiles[row * width + column] === 1 ? 1 : 0;
      rowSums[row * width + column] = running;
    }
  }
  const settlementScore = (column: number, row: number): number => {
    let total = 0;
    for (let dr = -LANDFORM_SETTLEMENT_WINDOW; dr <= LANDFORM_SETTLEMENT_WINDOW; dr += 1) {
      const r = wrapCoord(row + dr);
      const left = wrapCoord(column - LANDFORM_SETTLEMENT_WINDOW);
      const right = wrapCoord(column + LANDFORM_SETTLEMENT_WINDOW);
      const rowBase = r * width;
      total += left <= right
        ? rowSums[rowBase + right]! - (left > 0 ? rowSums[rowBase + left - 1]! : 0)
        : rowSums[rowBase + width - 1]! - (left > 0 ? rowSums[rowBase + left - 1]! : 0)
          + rowSums[rowBase + right]!;
    }
    return total;
  };

  interface Candidate { readonly column: number; readonly row: number; readonly score: number }
  const candidates: Candidate[] = [];
  for (let row = 0; row < height; row += LANDFORM_INFILL_PITCH) {
    for (let column = 0; column < width; column += LANDFORM_INFILL_PITCH) {
      candidates.push({ column, row, score: settlementScore(column, row) });
    }
  }
  candidates.sort((left, right) => right.score - left.score
    || left.row - right.row
    || left.column - right.column);

  for (const candidate of candidates) {
    if (placements.length >= LANDFORM_TARGET_COUNT) return;
    if (candidate.score === 0) return; // beyond here is empty margin, already furnished
    // A sub-tile jitter so the infill never reads as a grid of rocks.
    const footCol = candidate.column
      + (hash2(candidate.column, candidate.row, SEED_B + 81) - 0.5) * 0.9;
    const footRow = candidate.row
      + (hash2(candidate.column, candidate.row, SEED_B + 82) - 0.5) * 0.9;
    const probe: NirvanaEastLandformPlacement[] = [];
    const tier = placeLargestAdmittedLandform(
      probe, protectedTiles, "mesa", footCol, footRow,
      `field-infill:${candidate.column},${candidate.row}`,
    );
    if (tier === null) continue;
    const placement = probe[0]!;
    if (placement.footprint.some((tile) => taken[tile.row * width + tile.column] === 1)) continue;
    placements.push(placement);
    claim(placement);
  }
}

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
  // Tile-unit wrap, via the SAME shared module every landform uses (change 2) - the
  // round-1 bug this guards against wrapped a PIXEL value with the 96-TILE period,
  // silently misplacing every blocking prop's collision tile.
  const footprint = singleTileFootprint(
    { footColumn: footX / NIRVANA_EAST_TILE_SIZE, footRow: footY / NIRVANA_EAST_TILE_SIZE },
    NIRVANA_EAST_EXTENT,
  );
  if (footprint.length === 0) {
    throw new NirvanaEastSceneError(`Nirvana East scene prop ${id} produced no footprint tile.`);
  }
  const tile = footprint[0];
  return Object.freeze({
    id,
    frameId,
    x: Math.round(footX - pivotX),
    y: Math.round(footY - pivotY),
    footX: Math.round(footX),
    footY: Math.round(footY),
    blocks,
    tile,
    footprint,
    landformGroup: null,
  });
}

// ---------------------------------------------------------------------------
// landform props - visual instances of a `NirvanaEastLandformPlacement`, including
// wrapped duplicates so a placement straddling the canvas edge is painted on BOTH sides
// within the single render. Unchanged from the pilot.
// ---------------------------------------------------------------------------

/**
 * Which whole-region pixel offsets a sprite drawn at `(x, y)` sized `(width, height)`
 * needs a duplicate at, so that any part of it that would be clipped by the true canvas
 * edge reappears on the opposite edge within the SAME single-region render.
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
 * wrapped-edge duplicates (`blocks: false`, empty `footprint` - the anchor alone carries
 * the real, already-toroidally-wrapped footprint). All entries share `landformGroup` so
 * the connectivity repair drops or keeps the whole physical object as one unit.
 */
function propsForLandform(
  placement: NirvanaEastLandformPlacement,
  variants: ReadonlyMap<string, number>,
): NirvanaEastProp[] {
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

  const variant = variants.get(placement.id);
  if (variant === undefined) {
    throw new NirvanaEastSceneError(
      `Nirvana East scene has no plan variant assigned for landform ${placement.id}.`,
    );
  }
  const build = (id: string, dx: number, dy: number, blocks: boolean): NirvanaEastProp => Object.freeze({
    id,
    frameId: `s.${placement.tier}.${variant}`,
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

// ---------------------------------------------------------------------------
// ordinary scenery species - unchanged discipline from the pilot
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
}

/**
 * Place every prop for the built scene: ordinary species, the signature dust-devil
 * pass, crossing decking, and landform objects.
 *
 * Pre-claims prop-free ground from THREE sources before placement even starts: every
 * protected tile (change 1 — replaces the pilot's 128-anchor plot loop), every crossing
 * abutment, every landform footprint tile, and — new in production — every causeway tile
 * the connectivity repair had to carve (Warm Springs fix 1: a blocking prop on a
 * causeway would sever the very connection it was carved to make).
 */
function placeProps(
  tiles: readonly NirvanaEastTile[],
  geometry: MesaFieldGeometry,
  protection: NirvanaEastProtection,
  crossings: readonly NirvanaEastCrossing[],
  causeways: ReadonlySet<string>,
): NirvanaEastProp[] {
  const props: NirvanaEastProp[] = [];
  const claimed = new Set<string>();

  for (let index = 0; index < protection.protected.length; index += 1) {
    if (protection.protected[index] === 0) continue;
    const column = index % NIRVANA_EAST_COLUMNS;
    const row = Math.floor(index / NIRVANA_EAST_COLUMNS);
    claimed.add(`block:${column},${row}`);
  }
  for (const crossing of crossings) {
    for (const abutment of crossing.abutments) {
      claimed.add(`block:${abutment.column},${abutment.row}`);
    }
  }
  // Nothing spawns a blocking prop on ground a landform's own footprint already claims.
  for (const placement of geometry.landforms) {
    for (const tile of placement.footprint) {
      claimed.add(`block:${tile.column},${tile.row}`);
    }
  }
  // Nor on a causeway the connectivity repair had to carve open (Warm Springs fix 1).
  for (const key of causeways) claimed.add(`block:${key}`);

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

  // The dust-devil pass - the region's signature element, drawn LAST over everything by
  // the painter. Scattered lightly, anywhere walkable, never claimed against.
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

  // Crossings: plank deck run + a ramp/end piece at each abutment.
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

  // Landform objects - one anchor (blocks, real footprint) plus its wrapped-edge visual
  // duplicates, if any.
  const landformVariants = assignLandformVariants(geometry.landforms);
  for (const placement of geometry.landforms) {
    props.push(...propsForLandform(placement, landformVariants));
  }

  props.sort((left, right) => left.footY - right.footY
    || left.footX - right.footX
    || left.id.localeCompare(right.id));
  return props;
}

// ---------------------------------------------------------------------------
// composition B data — "Butte Country", every constant unchanged from the pilot
// ---------------------------------------------------------------------------

const SEED_B = 0x81b2;

function districtCenters(): readonly Point[] {
  return SHELTER_DISTRICT_ORIGINS.map((origin) => ({ x: origin.x + 6, y: origin.y + 11 }));
}

/**
 * The geometry one call to {@link createNirvanaEastScene} needs: composition B's
 * landform placements (already plot-safety-checked), its crossing plans, its prop
 * species table, and the noise seed the open floor uses. Channels, radial masses and
 * bands are gone entirely (module docstring) rather than present-but-empty, since
 * `cornerMaterialFor` no longer has a branch that would ever consult them.
 */
interface MesaFieldGeometry {
  readonly cornerSeed: number;
  /**
   * Vestigial: computed exactly as the pilot's own `mesaFieldGeometry()` computed its
   * (inert, by the pilot's own admission) `identityAnchors`/`identityReach`/
   * `identityDensity`/`identityPalette` — preserved verbatim so this promotion changes
   * `mesaFieldGeometry`'s own body as little as possible, per the "keep unchanged and
   * exact" instruction covering `districtCenters`. Never read: `cornerMaterialFor` has
   * no identity-apron branch (`identityApronAt`/`backgroundMaterialAt` are deleted, see
   * module docstring) for composition B to reach.
   */
  readonly identityAnchors: readonly Point[];
  readonly identityReach: number;
  readonly identityDensity: number;
  readonly identityPalette: readonly NirvanaEastMaterial[];
  readonly crossingPlans: readonly CrossingPlan[];
  readonly landforms: readonly NirvanaEastLandformPlacement[];
  readonly propHints: PropHints;
}

/**
 * ROUND 2 (contract §3): the mesa/scarp radial-mass painting is DELETED entirely - no
 * `butteRings`, no distance-field rings at all. A butte is an authored illustrated
 * OBJECT standing on open ground, placed on a wrapped jittered lattice spanning the
 * WHOLE region.
 *
 * @param protectedTiles - The recipe-derived protection mask, UNDILATED, threaded
 *   through to every {@link tryPlaceLandform} call so a landform is rejected before it
 *   is ever placed. The pilot's own `mesaFieldGeometry()` took no such parameter because
 *   its gate was hardcoded; this is the one signature change against the pilot, required
 *   by change 1. See {@link tryPlaceLandform} for why this mask is undilated while the
 *   corner field's is not.
 */
function mesaFieldGeometry(protectedTiles: Uint8Array): MesaFieldGeometry {
  const landforms: NirvanaEastLandformPlacement[] = [];

  // THE DELIBERATE WALL: two `mesa` placements with their FOOTPRINT centres (not
  // pivots - the tier's own offset is baked in via `deriveSceneryFootprintGeometry`) 9
  // tiles apart: mesa halfColumns is ~5.0, so a 9-tile centre spacing overlaps the two
  // ellipses by a full tile - a solid, gapless seam rather than two objects merely
  // touching. Footprint centre row 8 sits well inside the 18-row-tall north margin.
  const mesaGeometry = deriveSceneryFootprintGeometry(frameFor("mesa"), LANDFORM_CONTACT, NIRVANA_EAST_TILE_SIZE);
  const wallFootprintRow = 8;
  const wallFootRow = wallFootprintRow - mesaGeometry.offsetRows;
  const wallFootCol1 = 40 - mesaGeometry.offsetColumns;
  const wallFootCol2 = 49 - mesaGeometry.offsetColumns;
  tryPlaceLandform(landforms, protectedTiles, "mesa", wallFootCol1, wallFootRow, "wall-1");
  tryPlaceLandform(landforms, protectedTiles, "mesa", wallFootCol2, wallFootRow, "wall-2");

  // THE FIELD: two passes, coarse (mesa/butte-heavy) then fine (outcrop-heavy), each
  // lattice spacing chosen to divide 96 exactly so the placement lattice itself is
  // periodic on the torus by construction. Spans the WHOLE region; the districts thin
  // the field on their own via `tryPlaceLandform`'s plot rejection.
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
      placeLargestAdmittedLandform(landforms, protectedTiles, tier, baseX + jx, baseY + jy, `field-coarse:${column},${row}`);
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
      placeLargestAdmittedLandform(landforms, protectedTiles, tier, baseX + jx, baseY + jy, `field-fine:${column},${row}`);
    }
  }

  // THE INFILL: the settled band, searched rather than sampled, up to the count the
  // owner approved on the pilot plate. See `infillLandforms`.
  infillLandforms(landforms, protectedTiles);

  /**
   * **Composition B carries NO plank causeways, and that is a deliberate removal.**
   *
   * A plank causeway is a bridge, and a bridge is a statement that the ground under
   * it cannot be walked. Composition B has no such ground: `openFloorMaterialAt`
   * returns only salt, hardpan, sand, redsand, oxide, gravel and dustgrass, every
   * one of them walkable, so the region contains no blocking TERRAIN at all. The
   * only blocked tiles in it are OBJECTS — landform footprints, boulders,
   * thornbush. The measured consequence, from the shipped region:
   *
   * | seed | crossings | deck tiles inside a landform footprint |
   * |---|---|---|
   * | 401 | 4 | 10/10, 4/4, 1/1, 3/3 — **100 %** |
   * | 229 | 3 | 9/9, 1/1, 3/3 — **100 %** |
   * | 7 | 4 | 19/19, 4/4, 1/1, 3/3 — **100 %** |
   * | 1337 | 3 | 6/6, 1/1, 3/3 — **100 %** |
   *
   * Every deck tile in the region, at every seed, lay inside a rock. That is not
   * bad luck and it cannot be fixed by RELOCATING the crossings, which was the
   * other option considered: there is nowhere else in this composition for a
   * bridge to be, because a bridge needs impassable ground to span and this
   * composition has none. The drawn result was a plank walkway crossing a mesa at
   * the height of its cliff face with its end-piece emerging from inside the stone
   * (`scratchpad/being-sprite-evidence/nirvana-east-live/crossing-b-ew-wall-1to1.png`).
   *
   * A causeway also says the wrong thing about a rock: it says the rock is
   * passable. In butte country you walk AROUND a butte. Removing the crossings
   * makes the deliberate two-mesa wall a genuine wall, which is what it was
   * authored to be.
   *
   * Connectivity never depended on them and does not now: it is carried by the
   * landform placement gate, the monotone `carveBetween` repair over base-open
   * ground, and the landform-group removal loop — all three asserted at four run
   * seeds to keep every protected tile reachable and to split no pre-existing
   * component. Measured after the removal: 0/128 shelter plots lost, 0 mechanics
   * cells closed, component count identical to the generic region's at every seed.
   *
   * The machinery is KEPT, not deleted — `resolveCrossings`, `applyCrossingDecks`
   * and the plank prop pass all still work and are still covered — because the
   * composition that needs a crossing is a composition with blocking terrain, and
   * this region may yet grow one. What is removed is the PLAN table, which is
   * composition data.
   */
  const crossingPlans: readonly CrossingPlan[] = Object.freeze([]);

  // Vestigial return-data (see `MesaFieldGeometry.identityAnchors`'s docstring).
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
    cornerSeed: SEED_B,
    identityAnchors: Object.freeze(floorAnchors),
    identityReach: 0,
    identityDensity: 0,
    identityPalette: Object.freeze(["hardpan"]),
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

// ---------------------------------------------------------------------------
// assembly (change 3 + change 4) — protection + base collision in, one scene out
// ---------------------------------------------------------------------------

/**
 * Open a walkable causeway from `orphan` to `main`, following ground the BASE recipe
 * itself leaves open (Warm Springs fix 3, `.superpowers/sdd/warm-springs-live-report.md`
 * §9.1 point 3) — never a straight line, which can cut through ground the base keeps
 * shut forever.
 *
 * Breadth-first, TOROIDALLY 4-connected (Nirvana East is a torus; Warm Springs is not),
 * multi-source from every orphan tile to multi-goal at every main tile, over tiles where
 * `baseCollision` is open. `carveCrossing` (unchanged from the pilot) paints each
 * consecutive step of the found route — a sequence of short, verified-safe brush
 * strokes, never one long unverified line.
 *
 * @returns `true` when a causeway was opened — every route tile is recorded in
 *   `causeways`, so no prop may ever stand on it (Warm Springs fix 1) — or `false` when
 *   no base-open route exists at all, meaning the orphan was already unreachable before
 *   this terrain and must be left alone rather than sealed.
 */
function carveBetween(
  corners: NirvanaEastMaterial[],
  causeways: Set<string>,
  baseCollision: Uint8Array,
  main: NirvanaEastComponent,
  orphan: NirvanaEastComponent,
): boolean {
  const total = NIRVANA_EAST_COLUMNS * NIRVANA_EAST_ROWS;
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
    const index = queue[head];
    const column = index % NIRVANA_EAST_COLUMNS;
    const row = Math.floor(index / NIRVANA_EAST_COLUMNS);
    for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const c = (column + dc + NIRVANA_EAST_COLUMNS) % NIRVANA_EAST_COLUMNS;
      const r = (row + dr + NIRVANA_EAST_ROWS) % NIRVANA_EAST_ROWS;
      const next = r * NIRVANA_EAST_COLUMNS + c;
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

  const route: number[] = [];
  for (let index = reached; index >= 0; index = cameFrom[index]) route.push(index);
  route.reverse();

  const centerOf = (index: number): Point => ({
    x: (index % NIRVANA_EAST_COLUMNS) + 0.5,
    y: Math.floor(index / NIRVANA_EAST_COLUMNS) + 0.5,
  });
  const claim = (index: number): void => {
    causeways.add(`${index % NIRVANA_EAST_COLUMNS},${Math.floor(index / NIRVANA_EAST_COLUMNS)}`);
  };
  claim(route[0]);
  for (let index = 1; index < route.length; index += 1) {
    const touched = carveCrossing(corners, centerOf(route[index - 1]), centerOf(route[index]), 1.3);
    for (const tile of touched) causeways.add(`${tile.column},${tile.row}`);
    claim(route[index]);
  }
  return true;
}

/**
 * Build the approved Nirvana East terrain field — composition B, "Butte Country".
 *
 * Deterministic: given the same protection mask and base collision it returns
 * byte-identical tiles, collision, props and crossings. Every seed in the composition is
 * a literal, so the only input that can move the picture is the mechanics geometry it is
 * protecting.
 *
 * @param protection - Tiles that must never end up blocked, plus the recipe's own water
 *   and route masks.
 * @param baseCollision - The region's collision BEFORE this terrain, row-major, `1` =
 *   blocked. Connectivity is repaired against the COMPOSED mask (base union terrain),
 *   never against terrain alone — a pocket that only exists in the union is exactly the
 *   kind a terrain-only repair cannot see. The invariant is RELATIVE, not absolute,
 *   exactly as Warm Springs states it: terrain may not split a pre-existing base
 *   component or strand a protected tile, but is not asked to fix a region shape it did
 *   not create.
 * @returns One frozen scene: the picture, this terrain's OWN blocking mask (the caller
 *   unions it onto `baseCollision`), the props and the crossings.
 * @throws {NirvanaEastSceneError} If the protection mask or base collision do not cover
 *   the exact 96x96 region, if an authored crossing spans more blocked ground than
 *   {@link MAX_CROSSING_DECK_TILES} once resolved, or if the repair does not settle
 *   within {@link MAX_SCENE_ATTEMPTS} attempts.
 */
export function createNirvanaEastScene(
  protection: NirvanaEastProtection,
  baseCollision: Uint8Array,
): NirvanaEastScene {
  const expectedLength = NIRVANA_EAST_COLUMNS * NIRVANA_EAST_ROWS;
  if (protection.columns !== NIRVANA_EAST_COLUMNS || protection.rows !== NIRVANA_EAST_ROWS
    || protection.protected.length !== expectedLength
    || protection.water.length !== expectedLength
    || protection.path.length !== expectedLength
    || baseCollision.length !== expectedLength) {
    throw new NirvanaEastSceneError(
      `Nirvana East protection mask must cover the exact ${NIRVANA_EAST_COLUMNS}x${NIRVANA_EAST_ROWS} region.`,
    );
  }

  const dilatedProtected = dilateProtectedMask(protection, PLOT_GATE_BUFFER);
  const geometry = mesaFieldGeometry(protection.protected);
  const corners = buildCornerField(geometry, protection, dilatedProtected);

  // Landform footprints are pure composition data, computed once up front so
  // `resolveCrossings` can see them: a crossing plan must be resolved against
  // terrain-blocking OR landform-footprint-blocking, or an authored crossing over a
  // butte wall would never find anything to deck. This overlay never mutates `corners`
  // or the returned tiles' reported material - landform blocking is applied later,
  // exactly like every other prop, via each placement's own footprint.
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

  // Which pre-existing BASE component every open tile belonged to before this terrain
  // existed - the relative invariant's reference point.
  const baseLabels = new Int32Array(baseCollision.length).fill(-1);
  nirvanaEastWalkableComponents(baseCollision, NIRVANA_EAST_COLUMNS, NIRVANA_EAST_ROWS, true)
    .forEach((component, label) => {
      for (const index of component.tiles) baseLabels[index] = label;
    });

  /** The mask a body actually walks: this terrain unioned onto what was already there. */
  const composed = (terrain: Uint8Array): Uint8Array => {
    const union = Uint8Array.from(terrain);
    for (let index = 0; index < union.length; index += 1) {
      if (baseCollision[index] === 1) union[index] = 1;
    }
    return union;
  };

  /** Every tile a repair carve opened; nothing may ever be built on it (Warm Springs fix 1). */
  const causeways = new Set<string>();
  /** Open tiles the base collision itself already wells off from their own component. */
  const unreachableBeforeTerrain = new Set<number>();

  /**
   * The first SIGNIFICANT split this terrain has made in a pre-existing base component,
   * or `null` when there is none left. "Significant" is either an orphan holding
   * protected ground - which must never be stranded, at any size - or an orphan big
   * enough to be worth a causeway. Anything smaller is left exactly as it is (module
   * docstring, "why the repair no longer seals").
   */
  const firstSplit = (terrain: Uint8Array): {
    main: NirvanaEastComponent;
    orphan: NirvanaEastComponent;
  } | null => {
    const grouped = new Map<number, NirvanaEastComponent[]>();
    for (const component of nirvanaEastWalkableComponents(
      composed(terrain),
      NIRVANA_EAST_COLUMNS,
      NIRVANA_EAST_ROWS,
      true,
    )) {
      const label = baseLabels[component.tiles[0]];
      const siblings = grouped.get(label);
      if (siblings === undefined) grouped.set(label, [component]);
      else siblings.push(component);
    }
    for (const siblings of grouped.values()) {
      if (siblings.length <= 1) continue;
      const main = siblings[0];
      for (let index = 1; index < siblings.length; index += 1) {
        const orphan = siblings[index];
        if (orphan.tiles.every((tile) => unreachableBeforeTerrain.has(tile))) continue;
        const significant = orphan.tiles.length >= MIN_DECKED_POCKET_TILES
          || orphan.tiles.some((tile) => isProtectedTile(protection, tile));
        if (significant) return { main, orphan };
      }
    }
    return null;
  };

  let tiles: NirvanaEastTile[] = [];
  let crossings: NirvanaEastCrossing[] = [];
  let collision: Uint8Array = new Uint8Array(expectedLength);
  let keptProps: NirvanaEastProp[] = [];
  let withProps: Uint8Array = collision;

  // The scene is settled by re-running the whole build whenever the PROP pass turns out
  // to have stranded protected ground and no prop removal can fix it. Each attempt opens
  // strictly more terrain via `carveBetween`, so it converges; failing closed instead was
  // measured (Warm Springs) to reject 12% of run seeds, unacceptable in a world that must
  // run forever on any seed.
  let settled = false;
  for (let attempt = 0; attempt < MAX_SCENE_ATTEMPTS && !settled; attempt += 1) {
    tiles = deriveTiles(corners);
    crossings = resolveCrossings(withLandformOverlay(tiles), geometry.crossingPlans, baseCollision);
    tiles = applyCrossingDecks(tiles, crossings);
    collision = collisionFrom(tiles);

    // Phase 1: terrain-only connectivity repair, before any prop exists.
    for (let pass = 0; pass < 60; pass += 1) {
      const split = firstSplit(collision);
      if (split === null) break;
      if (!carveBetween(corners, causeways, baseCollision, split.main, split.orphan)) {
        for (const tile of split.orphan.tiles) unreachableBeforeTerrain.add(tile);
        continue;
      }
      tiles = applyCrossingDecks(deriveTiles(corners), crossings);
      collision = collisionFrom(tiles);
    }

    const props = placeProps(tiles, geometry, protection, crossings, causeways);
    const deckIndices = new Set<number>();
    for (const tile of tiles) {
      if (tile.crossingDeck) deckIndices.add(tile.row * NIRVANA_EAST_COLUMNS + tile.column);
    }
    const withPropFootprints = (candidateProps: readonly NirvanaEastProp[]): Uint8Array => {
      const out = Uint8Array.from(collision);
      for (const prop of candidateProps) {
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

    keptProps = [...props];
    withProps = withPropFootprints(keptProps);

    // A landform's anchor and its purely-visual wrapped-edge duplicates always rise or
    // fall TOGETHER: grouping by `landformGroup` (falling back to the prop's own id, so
    // an ordinary single-tile prop is its own one-member group) is what lets the repair
    // below drop a whole LANDFORM placement, not one tile of it.
    const groupKeyOf = (prop: NirvanaEastProp): string => prop.landformGroup ?? `single:${prop.id}`;

    // Phase 2: prop-caused connectivity repair. Only ever REMOVES a prop or CARVES new
    // ground - never seals the mask directly, unlike the pilot's own fallback here
    // (module docstring, "why the repair no longer seals").
    let rebuild = false;
    for (let pass = 0; pass < 80; pass += 1) {
      const split = firstSplit(withProps);
      if (split === null) break;
      const orphan = split.orphan;
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
        const allTerrainBlocked = footprintTiles.every((tile) => (
          collision[tile.row * NIRVANA_EAST_COLUMNS + tile.column] === 1
        ));
        if (allTerrainBlocked) continue;
        removalKey = key;
        break;
      }

      if (removalKey === null) {
        // Bounded by terrain rather than by props, so the terrain has to give: carve a
        // causeway and rebuild the whole scene, which re-places props with the new
        // causeway claimed build-free. This REPLACES the pilot's own fallback here,
        // which wrote directly into the mask (`withProps[index] = 1` for every orphan
        // tile) - a seal, the exact defect this promotion removes at cause (module
        // docstring).
        if (!carveBetween(corners, causeways, baseCollision, split.main, orphan)) {
          for (const tile of orphan.tiles) unreachableBeforeTerrain.add(tile);
        }
        rebuild = true;
        break;
      }
      keptProps = keptProps.filter((prop) => groupKeyOf(prop) !== removalKey);
      withProps = withPropFootprints(keptProps);
    }
    if (!rebuild) settled = true;
  }
  if (!settled) {
    throw new NirvanaEastSceneError(
      `Nirvana East terrain did not settle in ${MAX_SCENE_ATTEMPTS} attempts.`,
    );
  }

  return Object.freeze({
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
    landforms: geometry.landforms,
  });
}

/**
 * A stable eight-hex digest of everything a Nirvana East scene draws and blocks.
 *
 * Carried in the recipe's `presentationProfile.staticSceneHash`, which is what binds a
 * persisted recipe to the exact picture it was built from: a scene that has drifted
 * fails to load rather than rendering different art under the same identity. Follows
 * `warmSpringsSceneHash`'s exact shape (FNV-1a over tiles/props/crossings, 8 hex chars).
 */
export function nirvanaEastSceneHash(scene: NirvanaEastScene): string {
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
  for (const crossing of scene.crossings) {
    feed(`${crossing.id}:${crossing.axis}:${crossing.deck.length};`);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
