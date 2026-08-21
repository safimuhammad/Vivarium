/**
 * @fileoverview Exact-region adapter: the approved Ember Rift, composed onto the
 * generic Nirvana West recipe.
 *
 * Deliberately ADDITIVE, and that is the central design decision of this integration —
 * mirrors `warmSprings/WarmSpringsRegionMapRecipe.ts` in shape byte for byte. Nirvana
 * West has no authored chunk world and no growth policy: it falls through to the
 * generic `createRegionMapRecipe` exactly as Warm Springs does, so instead of replacing
 * the recipe, this builder starts from the unmodified generic one, protects everything
 * it declares, and UNIONS the rift's blocking terrain and every ruin's measured
 * footprint into `grid.collision` through `navigation/groundTerrain.ts`'s
 * `composeGroundTerrainCollision` — the seam itself, never exclusion rects.
 *
 * What that buys, and it is not a small thing: every generic invariant `validateRecipe`
 * already enforces still runs against the new collision. Shelter plots must stay clear,
 * path and soil cells must stay collision-open, authored scenery must stay legal,
 * anchors must stay connected. The acceptance bar is therefore machine-checked on every
 * parse rather than asserted once in a report.
 *
 * TWO fields are replaced rather than passed through, and both are deliberate:
 *
 * - **`grid.collision`**, the terrain seam, exactly as Warm Springs does it.
 * - **`animatedEnvironment`**, because the generic rule is wrong for this region rather
 *   than merely thin. The generic rule places 4 flames per district anchor inside the
 *   eight `LANDSCAPE_SECTORS` — for Nirvana West that means fire on bare cold slate,
 *   nowhere near a fissure, when this region's whole identity IS the fire. But the
 *   BUDGET stays exactly what the generic recipe already enforces (32, four per
 *   sector): {@link deriveFissureAnimatedEnvironment} only ever RELOCATES the generic
 *   recipe's own 32 placements onto the hottest fissure ground within each placement's
 *   own sector, keeping every `id` and `kind`, so the generic `validateCompositionDensity`
 *   check still passes unmodified on parse and nothing else in the world has to change.
 *
 * Everything else — `pathMask`, `soilMask`, `waterVoidMask`, gates, anchors, staging,
 * shelter plots, `staticScenery`, `scenicClusters`, `scenicLandmarks`,
 * `storyNeighborhoods`, `visualPathCompositions`, `terrainPatches`,
 * `occupiedHomeObligations`, `districts` — is passed through from the generic recipe
 * untouched, so no placement is displaced, no story contract moves, and no authored
 * position is retired.
 *
 * The authored scene rides along as a WeakMap sidecar, transferred on trusted clones
 * exactly as Warm Springs' and Nirvana's do. **No recipe object is ever cloned or
 * mutated by this module** — identity-keyed sidecars fail closed, and a copy would
 * silently lose the scene and break rendering entirely.
 */

import { composeGroundTerrainCollision } from "../navigation/groundTerrain";
import { findNavigationPath } from "../navigation/navigation";
import { applyWrapSeams, deriveWrapSeamCandidates } from "../navigation/wrapSeams";
import type { Vec2 } from "../../contracts";
import type { TileCoord } from "../../map/regionMap";
import type { RegionMapIdentity } from "../maps/RegionMapIdentity";
import {
  createRegionMapRecipe,
  registerRegionMapRecipeCloneTransfer,
  type AnimatedEnvironmentPlacement,
  type RegionMapRecipeV1,
} from "../maps/RegionMapRecipe";
import {
  feetAnchoredVisualRect,
  navigationTileForFeet,
  shelterRenderRect,
} from "../productionGeometry";
import {
  animatedPhaseSeed,
  createNirvanaWestScene,
  nirvanaWestSceneHash,
  NIRVANA_WEST_COLUMNS,
  NIRVANA_WEST_ROWS,
  NIRVANA_WEST_TILE_SIZE,
  type NirvanaWestProtection,
  type NirvanaWestScene,
} from "./NirvanaWestTerrainField";

export const NIRVANA_WEST_REGION_ID = "nirvana_west";
const REQUIRED_KIT = "ash-waste";

/** One built Nirvana West region: the authored scene plus the hash that binds it. */
export interface NirvanaWestAuthoredScene {
  readonly scene: NirvanaWestScene;
  readonly sceneHash: string;
}

const NIRVANA_WEST_SCENE_SIDECARS = new WeakMap<RegionMapRecipeV1, NirvanaWestAuthoredScene>();

registerRegionMapRecipeCloneTransfer((source, clone) => {
  const authored = NIRVANA_WEST_SCENE_SIDECARS.get(source);
  if (authored !== undefined) NIRVANA_WEST_SCENE_SIDECARS.set(clone, authored);
});

/**
 * One memoised authored scene per generic-recipe fingerprint.
 *
 * The scene build is pure in the generic recipe (its protection mask is derived from it
 * and every seed in the composition is a literal), but it is not cheap: a corner field
 * over 97x97 corners, fracture-segment construction, causeway resolution, two
 * connectivity-repair passes and several hundred prop placements with footprint
 * composition. Production builds the same region repeatedly — live boot, archive parse,
 * every chronicle harness mount — so the cost was paid over and over. Memoising it keeps
 * a repeat build at generic cost.
 *
 * The recipe OBJECT is still constructed fresh every call: consumers rely on isolated
 * mutable-typed-array identity, and the scene itself is deeply frozen, so sharing it is
 * safe.
 */
const NIRVANA_WEST_SCENE_MEMO = new Map<string, NirvanaWestAuthoredScene>();
const NIRVANA_WEST_SCENE_MEMO_LIMIT = 8;

function memoisedScene(
  fingerprint: string,
  build: () => NirvanaWestAuthoredScene,
): NirvanaWestAuthoredScene {
  const cached = NIRVANA_WEST_SCENE_MEMO.get(fingerprint);
  if (cached !== undefined) return cached;
  const authored = build();
  if (NIRVANA_WEST_SCENE_MEMO.size >= NIRVANA_WEST_SCENE_MEMO_LIMIT) {
    const oldest = NIRVANA_WEST_SCENE_MEMO.keys().next();
    if (oldest.done !== true) NIRVANA_WEST_SCENE_MEMO.delete(oldest.value);
  }
  NIRVANA_WEST_SCENE_MEMO.set(fingerprint, authored);
  return authored;
}

/** Resolve the authored scene retained by a trusted Live or Archive recipe clone. */
export function nirvanaWestAuthoredSceneSidecar(
  recipe: RegionMapRecipeV1,
): NirvanaWestAuthoredScene | null {
  return NIRVANA_WEST_SCENE_SIDECARS.get(recipe) ?? null;
}

function markTile(
  mask: Uint8Array,
  columns: number,
  rows: number,
  column: number,
  row: number,
): void {
  if (column < 0 || row < 0 || column >= columns || row >= rows) return;
  mask[row * columns + column] = 1;
}

/**
 * Every tile the terrain's blocking materials and every ruin's footprint may never close.
 *
 * Read from the recipe rather than guessed, which is both narrower than the pilot's
 * hand-declared 128-plot table (it is the real thing) and wider (it also covers
 * anchors, staging envelopes, authored scenery, the scenic cluster and story layers,
 * and the visual path layer the pilot never saw). Protecting generously is visually
 * cheap here: the gate only demotes BLOCKING materials or drops a footprint, and every
 * tonal tier plus `emberdim`/`glass` are walkable, so protected ground still carries
 * the region's mineral identity — it simply cannot become live ember, brine, clinker,
 * scree or rime, and a ruin cannot stand on it.
 *
 * @param recipe - The generic recipe whose mechanics must survive.
 * @returns A frozen protection mask over the canonical 96x96 grid.
 */
export function nirvanaWestProtectionFromRecipe(
  recipe: RegionMapRecipeV1,
): NirvanaWestProtection {
  const columns = recipe.grid.columns;
  const rows = recipe.grid.rows;
  const guarded = new Uint8Array(columns * rows);
  const mark = (column: number, row: number): void => markTile(guarded, columns, rows, column, row);

  for (const tile of [
    ...recipe.arrivalAnchors,
    ...recipe.spawnAnchors,
    ...recipe.socialAnchors,
    ...recipe.resourceAnchors.energy,
    ...recipe.resourceAnchors.materials,
    ...recipe.stagingAnchors,
    ...recipe.gates.map(({ tile }) => tile),
  ]) {
    mark(tile.column, tile.row);
  }

  for (const plot of recipe.shelterPlots) {
    mark(plot.tile.column, plot.tile.row);
    mark(plot.door.column, plot.door.row);
    // The real 128x128 render footprint: a plot is LOST if ANY tile it covers blocks.
    const rect = shelterRenderRect(plot.tile);
    const minColumn = Math.floor(rect.x / NIRVANA_WEST_TILE_SIZE);
    const maxColumn = Math.floor((rect.x + rect.width - 1) / NIRVANA_WEST_TILE_SIZE);
    const minRow = Math.floor(rect.y / NIRVANA_WEST_TILE_SIZE);
    const maxRow = Math.floor((rect.y + rect.height - 1) / NIRVANA_WEST_TILE_SIZE);
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) mark(column, row);
    }
  }

  for (const point of recipe.stagingPoints) {
    const tile = navigationTileForFeet(point);
    mark(tile.column, tile.row);
  }

  // Only PASSIVE scenery needs protecting. `validateRecipe` requires a placement's tile
  // to match its own `blocksMovement` flag, so a blocking placement is already hard
  // collision and terrain closing it changes nothing — while protecting it would punch
  // a hole in the rift for no gain. Measured on Warm Springs: protecting blocking
  // scenery too was a major contributor to the isolated-protected-tile islands that
  // made 12% of sampled run seeds fail to build.
  for (const placement of recipe.staticScenery) {
    if (placement.blocksMovement) continue;
    mark(placement.tile.column, placement.tile.row);
  }
  for (const cluster of recipe.scenicClusters) mark(cluster.anchor.column, cluster.anchor.row);
  for (const placement of recipe.animatedEnvironment) {
    mark(placement.tile.column, placement.tile.row);
  }

  // The visual story layer. These records declare `collisionBehavior: "visual-only"`,
  // but `validateRecipe` still requires every centreline, shoulder and clearing cell to
  // be collision-OPEN — a visual composition may not be drawn over a wall.
  for (const path of recipe.visualPathCompositions) {
    for (const cell of [...path.centerlineCells, ...path.shoulderCells, ...path.clearingCells]) {
      mark(cell.column, cell.row);
    }
  }
  for (const patch of recipe.terrainPatches) {
    for (const cell of patch.cells) mark(cell.column, cell.row);
  }
  for (const obligation of recipe.occupiedHomeObligations) {
    for (const binding of obligation.approachBindings) {
      mark(binding.doorAnchor.column, binding.doorAnchor.row);
      for (const cell of binding.apronCells) mark(cell.column, cell.row);
    }
  }
  // Every story's own reference route, so `nearestAuthoritativePathContext` — which
  // `validateRecipe` RE-RUNS at parse time via `findNavigationPath(recipe.grid, ...)`
  // and requires to reproduce the exact baked-in diagnostic byte for byte — can never
  // be forced onto a detour by this terrain. It is not enough to protect the two
  // endpoints and the recorded nearest tile: the validator walks the FULL route the
  // real navigator returns and takes whichever tile on it is first tagged `pathMask`,
  // so if this terrain closes so much as one tile the GENERIC route used, the
  // recomputed route (and therefore its nearest tile, distance or constraint) can
  // legitimately differ even though every individually-recorded tile stayed open.
  // Protecting the recorded route computed against the UNMODIFIED generic grid — the
  // same grid this protection mask is itself being built from — guarantees the route
  // this terrain composes onto can never differ from it. Measured: this is exactly
  // what seed 229 needed; seeds 401/7/1337 already had a route this terrain never
  // touched, which is why the failure was seed-dependent rather than universal.
  for (const story of recipe.storyNeighborhoods) {
    mark(story.anchor.column, story.anchor.row);
    if (story.pathContext.mode === "local-authoritative-path") {
      mark(story.pathContext.contextAnchor.column, story.pathContext.contextAnchor.row);
    }
    const district = recipe.districts[story.districtIndex];
    const goal = district?.socialAnchors[0];
    if (goal !== undefined) {
      const route = findNavigationPath(recipe.grid, { start: story.anchor, goal });
      for (const tile of route.tiles) mark(tile.column, tile.row);
    }
  }

  // The same class of risk, the same fix: `createOccupiedHomeApproachBinding`'s own
  // `nearestAuthoritativePathContext(doorAnchor, district.socialAnchors[0], ...)` is
  // re-run and compared exactly at parse time too.
  for (const obligation of recipe.occupiedHomeObligations) {
    const district = recipe.districts[obligation.districtIndex];
    const goal = district?.socialAnchors[0];
    if (goal === undefined) continue;
    for (const binding of obligation.approachBindings) {
      const route = findNavigationPath(recipe.grid, { start: binding.doorAnchor, goal });
      for (const tile of route.tiles) mark(tile.column, tile.row);
    }
  }

  for (let index = 0; index < guarded.length; index += 1) {
    if (recipe.pathMask[index] === 1 || recipe.soilMask[index] === 1) guarded[index] = 1;
  }

  // `ash-waste` declares no water bodies (`WATER_BODY_SIZES` has no entry for it), so
  // `waterVoidMask` is all-zero today — this loop is a zero-cost defensive parity with
  // Warm Springs' equivalent protection builder, not a live behaviour, in case a future
  // kit change ever adds water here.
  for (let index = 0; index < guarded.length; index += 1) {
    if (recipe.waterVoidMask[index] === 1) guarded[index] = 1;
  }

  return Object.freeze({
    columns,
    rows,
    protected: guarded,
  });
}

// ---------------------------------------------------------------------------
// the fissure-derived animated environment placement rule
// ---------------------------------------------------------------------------

/**
 * How many flames the region carries, on what ground, and how many smoke anchors.
 *
 * **These are the pilot's own rule, costed.** The approved pilot lit roughly three of
 * every four live-crust tiles and then ALSO lit the welded `emberdim` seam beside live
 * crust (`nirvanaWestScene.ts`'s `placeAnimatedEnvironment`: `hash2(...) < 0.74` on every
 * `ember` tile, plus deep-fissure vents, plus a third pass over the seam). Re-run on the
 * SHIPPED production terrain that rule asks for **396-401 placements** across the four
 * measured run seeds — more than the pilot's own 300, because the `EMBER_CORE_LIVE_BIAS`
 * rebalance grew live crust from 117 to ~410 tiles.
 *
 * 384 is that rule at production's own supply, split by ground because a single ranking
 * would spend the entire budget on live crust before reaching the seam:
 *
 * | quota | ground | why |
 * |---|---|---|
 * | 256 | `ember` — live crust, which BLOCKS | the fissure cores themselves |
 * | 64 | `emberdim` touching live crust | the pilot's own third pass: the crust is cooled, the gas under it is not. Measured: without it the fire stopped at the fissure core and the big basins — the frames a viewer actually looks at — stayed dark |
 * | 64 | `cinder` scorch ring | cooked but unlit ground; the industrial half of the read |
 *
 * The measured legal supply per run seed is ~400 live-crust tiles, ~65-73 welded-seam
 * tiles and ~1,550 scorch-ring tiles, so every quota is met with margin at every seed.
 *
 * **What 384 costs, measured in a real browser rather than reasoned about**
 * (`drawImage` of one 32x32 sub-rect, the exact draw `EnvironmentSystem.drawAmbientPool`
 * makes per slot per frame; 50 pool draws per timed block, median of 9 trials):
 *
 * | placements | ms per frame |
 * |---|---|
 * | 32 (before) | 0.060 |
 * | 128 | 0.238 |
 * | 256 | 0.480 |
 * | 320 | 0.610 |
 * | **384** | **0.716** |
 * | 512 | 0.958 |
 *
 * Dead linear at **1.87 microseconds per placement**, so the whole fire is 4.3 % of a
 * 60 fps frame — and the region draws several thousand static operations before it gets
 * here. The other costs are the same shape: one `AmbientSlot` object per placement, and
 * ~98 B of recipe JSON per placement (~38 KB for the whole fire, measured on the
 * serialized recipe).
 */
const NIRVANA_WEST_LIVE_CRUST_FLAMES = 256;
const NIRVANA_WEST_WELDED_SEAM_FLAMES = 64;
const NIRVANA_WEST_SMOKE_COUNT = 64;
const NIRVANA_WEST_FLAME_COUNT =
  NIRVANA_WEST_LIVE_CRUST_FLAMES + NIRVANA_WEST_WELDED_SEAM_FLAMES;

/**
 * The region's exact animated-environment budget.
 *
 * Declared here AND in `RegionMapRecipe.ts`'s `EXACT_ANIMATED_ENVIRONMENT_BUDGETS`; the
 * two are asserted equal by this module's own suite, so a change in one that is not made
 * in the other fails a test rather than a parse in production.
 */
export const NIRVANA_WEST_ANIMATED_ENVIRONMENT_BUDGET =
  NIRVANA_WEST_FLAME_COUNT + NIRVANA_WEST_SMOKE_COUNT;

/**
 * How molten a tile's FINAL derived material reads, for fissure-placement scoring.
 *
 * `ember` is LIVE crust and it BLOCKS — which is the whole point, and which the first
 * production rule got backwards. That rule required a placement's tile to be
 * collision-OPEN, so the only ground it could ever choose was cooled: measured on the
 * shipped region, all 32 flames stood on `emberdim` (25) or `cinder` (7) and **not one
 * stood on live crust**. Nothing in `validateRecipe` asks for an open tile — an animated
 * placement is a decal, not a body — so the requirement was self-imposed and it excluded
 * exactly the tiles fire belongs on.
 */
const MOLTEN_SCORE: Readonly<Partial<Record<string, number>>> = Object.freeze({
  ember: 3,
  emberdim: 1,
  cinder: 0,
});

/** Minimum Chebyshev separation between two smoke anchors, so the ring never clumps. */
const SMOKE_ANCHOR_MIN_SEPARATION = 3;

function chebyshev(a: TileCoord, b: TileCoord): number {
  return Math.max(Math.abs(a.column - b.column), Math.abs(a.row - b.row));
}

const VON_NEUMANN: readonly TileCoord[] = Object.freeze([
  { column: -1, row: 0 }, { column: 1, row: 0 },
  { column: 0, row: -1 }, { column: 0, row: 1 },
]);

/**
 * Every tile an animated placement may NOT stand on, rasterised from the exact rectangles
 * `validateRecipe` itself tests.
 *
 * Three of the generic validators judge an animated placement's 32x32 render rect in
 * PIXELS — against every shelter's 128x128 frame (`validateShelterEnvironmentClearance`),
 * every canonical staging point's standing envelope (`validateStagingGeometry`) and every
 * critical-route standing envelope, meaning every `pathMask` tile and every shelter door
 * (`validateCriticalRouteEnvironmentClearance`). A tile-level protection mask is not the
 * same thing as those rectangles, and at 32 placements the difference never bit; at 320 it
 * would, constantly.
 *
 * So the exclusion is rasterised from the rectangles themselves rather than approximated
 * by a dilation: every tile whose own 32x32 box intersects a forbidden rect is marked. A
 * candidate that survives this mask cannot fail those validators, by construction, and if
 * the envelope geometry is ever retuned this follows it instead of drifting from it.
 */
function animatedPlacementExclusion(recipe: RegionMapRecipeV1): Uint8Array {
  const { columns, rows } = recipe.grid;
  const excluded = new Uint8Array(columns * rows);
  const markRect = (rect: Readonly<{ x: number; y: number; width: number; height: number }>): void => {
    const minColumn = Math.floor(rect.x / NIRVANA_WEST_TILE_SIZE);
    const maxColumn = Math.floor((rect.x + rect.width - 1) / NIRVANA_WEST_TILE_SIZE);
    const minRow = Math.floor(rect.y / NIRVANA_WEST_TILE_SIZE);
    const maxRow = Math.floor((rect.y + rect.height - 1) / NIRVANA_WEST_TILE_SIZE);
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        if (column < 0 || row < 0 || column >= columns || row >= rows) continue;
        excluded[row * columns + column] = 1;
      }
    }
  };

  // `validateRecipeCategoryPartition` gives every tile ONE category, and an animated
  // placement may not share a tile with static scenery of any kind. The region's own
  // protection mask deliberately guards only PASSIVE scenery (guarding blocking scenery
  // too was measured to strand protected tiles and fail 12 % of seeds during Warm
  // Springs), so blocking placements have to be excluded here instead. At 32 placements
  // the collision never happened; at 320 it happens at every seed.
  for (const placement of recipe.staticScenery) {
    const index = placement.tile.row * columns + placement.tile.column;
    if (index >= 0 && index < excluded.length) excluded[index] = 1;
  }

  for (const plot of recipe.shelterPlots) markRect(shelterRenderRect(plot.tile));
  for (const point of recipe.stagingPoints) markRect(feetAnchoredVisualRect(point));
  const criticalFeet: Vec2[] = [];
  for (let index = 0; index < recipe.pathMask.length; index += 1) {
    if (recipe.pathMask[index] !== 1) continue;
    criticalFeet.push(tileFeet(index % columns, Math.floor(index / columns)));
  }
  for (const plot of recipe.shelterPlots) criticalFeet.push(tileFeet(plot.door.column, plot.door.row));
  for (const feet of criticalFeet) markRect(feetAnchoredVisualRect(feet));
  return excluded;
}

/** The pixel point `validateRecipe`'s `tileCenter` anchors a standing envelope at. */
function tileFeet(column: number, row: number): Vec2 {
  return {
    x: column * NIRVANA_WEST_TILE_SIZE + NIRVANA_WEST_TILE_SIZE / 2,
    y: row * NIRVANA_WEST_TILE_SIZE + NIRVANA_WEST_TILE_SIZE / 2,
  };
}

/**
 * Place the region's whole fire on the ground it belongs to.
 *
 * The generic rule gives every region 4 placements per district anchor, all of them
 * inside the eight rim `LANDSCAPE_SECTORS` — the top and bottom 16 rows. For most kits
 * that is right: ambient grass and smoke belong in the margins. For `nirvana_west` it was
 * doubly wrong, and both halves were measured on the shipped region before being changed:
 *
 *  1. **Every one of the 32 flames was in a rim band**, so the entire settled middle of
 *     the region — including the approved pilot's own viewport at tile (0,54), the frame
 *     the fire was gated on — carried no fire at all.
 *  2. **Not one stood on live crust**, because the rule demanded a collision-open tile and
 *     `ember` blocks (25 sat on cooled `emberdim`, 7 on `cinder`).
 *
 * This rule instead ranks EVERY tile in the region by how molten it is, takes the hottest
 * {@link NIRVANA_WEST_FLAME_COUNT} for `ember` flames and the best
 * {@link NIRVANA_WEST_SMOKE_COUNT} scorch-ring tiles for `smoke-anchor` puffs, and
 * excludes only what the recipe's own validators forbid
 * ({@link animatedPlacementExclusion} plus the region's protection mask). Flames take no
 * minimum separation — a fissure that burns is a FIELD of fire, and the pilot's own rule
 * lit adjacent tiles freely; smoke anchors keep {@link SMOKE_ANCHOR_MIN_SEPARATION} so the
 * scorch ring reads as vents rather than as fog.
 *
 * Ranking is deterministic and total: score, then {@link animatedPhaseSeed} of the tile
 * (the same phase primitive the pilot's fire used, so there is no second hash to keep in
 * sync), then row, then column. `phaseSeed` is derived from the chosen tile, so
 * neighbouring flames are out of step — which is what makes a dense field of them read as
 * fire rather than as a blinking grid.
 *
 * @param scene - The authored terrain field, for its final derived material per tile.
 * @param recipe - The recipe whose mechanics decide what ground a placement may occupy.
 * @returns Exactly {@link NIRVANA_WEST_ANIMATED_ENVIRONMENT_BUDGET} placements, ordered
 *   canonically, every tile unique and legal.
 * @throws {Error} If the region cannot supply its declared budget of legal tiles — a
 *   failure that must be loud, never a quietly short fire.
 */
export function deriveFissureAnimatedEnvironment(
  scene: NirvanaWestScene,
  recipe: RegionMapRecipeV1,
): readonly AnimatedEnvironmentPlacement[] {
  const { columns, rows } = recipe.grid;
  const protection = nirvanaWestProtectionFromRecipe(recipe);
  const excluded = animatedPlacementExclusion(recipe);
  const materialAt = (column: number, row: number): string =>
    scene.tiles[row * NIRVANA_WEST_COLUMNS + column]!.material;

  interface Candidate { readonly tile: TileCoord; readonly score: number; readonly tie: number }
  const liveCrust: Candidate[] = [];
  const weldedSeam: Candidate[] = [];
  const cooledCrust: Candidate[] = [];
  const smokeCandidates: Candidate[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      if (protection.protected[index] === 1 || excluded[index] === 1) continue;
      const material = materialAt(column, row);
      const score = MOLTEN_SCORE[material];
      if (score === undefined) continue;
      const tile: TileCoord = Object.freeze({ column, row });
      const tie = animatedPhaseSeed(column, row);
      if (material === "ember") { liveCrust.push({ tile, score, tie }); continue; }
      if (material === "cinder") { smokeCandidates.push({ tile, score, tie }); continue; }
      // The welded seam still burns, and it is the pilot's own third pass, kept because
      // it is the reason the fire does not read as a rule: `emberdim` is `ember`'s
      // WALKABLE twin — the demotion that keeps this region at 0/128 plots lost — so a
      // fire confined to live crust stops dead on exactly the line where a shelter plot
      // begins. The crust there is cooled; the gas under it is not.
      const adjacent = VON_NEUMANN.some((offset) => {
        const c = column + offset.column;
        const r = row + offset.row;
        if (c < 0 || r < 0 || c >= columns || r >= rows) return false;
        return materialAt(c, r) === "ember";
      });
      (adjacent ? weldedSeam : cooledCrust).push({ tile, score: score + (adjacent ? 1 : 0), tie });
    }
  }

  const byHeat = (left: Candidate, right: Candidate): number => right.score - left.score
    || left.tie - right.tie
    || left.tile.row - right.tile.row
    || left.tile.column - right.tile.column;
  for (const list of [liveCrust, weldedSeam, cooledCrust, smokeCandidates]) list.sort(byHeat);

  // Quotas, not one ranked list. A single ranking would spend the whole flame budget on
  // live crust before it ever reached the welded seam (there are ~400 legal live-crust
  // tiles against a 320-flame budget), and the seam is exactly the ground that carries
  // fire out of the fissure core and into the basins a viewer is actually looking at.
  const flames: Candidate[] = [
    ...liveCrust.slice(0, NIRVANA_WEST_LIVE_CRUST_FLAMES),
    ...weldedSeam.slice(0, NIRVANA_WEST_WELDED_SEAM_FLAMES),
  ];
  // Short of either quota, fall back down the same heat ladder rather than ship a short
  // fire: the budget is an equality the recipe validator enforces, so falling short is a
  // parse failure, not a quietly dimmer region.
  for (const fallback of [liveCrust, weldedSeam, cooledCrust, smokeCandidates]) {
    if (flames.length >= NIRVANA_WEST_FLAME_COUNT) break;
    for (const candidate of fallback) {
      if (flames.length >= NIRVANA_WEST_FLAME_COUNT) break;
      if (flames.includes(candidate)) continue;
      flames.push(candidate);
    }
  }
  flames.length = Math.min(flames.length, NIRVANA_WEST_FLAME_COUNT);
  const taken = new Set(flames.map(({ tile }) => tile.row * columns + tile.column));

  const smoke: Candidate[] = [];
  const spaced = (candidate: Candidate): boolean =>
    smoke.every(({ tile }) => chebyshev(tile, candidate.tile) >= SMOKE_ANCHOR_MIN_SEPARATION);
  for (const pass of [true, false]) {
    for (const candidate of smokeCandidates) {
      if (smoke.length >= NIRVANA_WEST_SMOKE_COUNT) break;
      if (taken.has(candidate.tile.row * columns + candidate.tile.column)) continue;
      if (pass && !spaced(candidate)) continue;
      smoke.push(candidate);
      taken.add(candidate.tile.row * columns + candidate.tile.column);
    }
  }

  if (flames.length + smoke.length !== NIRVANA_WEST_ANIMATED_ENVIRONMENT_BUDGET) {
    throw new Error(
      `Nirvana West could not seat its animated environment budget: wanted `
      + `${NIRVANA_WEST_ANIMATED_ENVIRONMENT_BUDGET}, found ${flames.length} flame and `
      + `${smoke.length} smoke tiles that are legal for an animated placement.`,
    );
  }

  const placements: AnimatedEnvironmentPlacement[] = [
    ...flames.map(({ tile }) => ({ tile, kind: "ember" as const })),
    ...smoke.map(({ tile }) => ({ tile, kind: "smoke-anchor" as const })),
  ].map(({ tile, kind }) => Object.freeze({
    id: `fissure-${kind}-${tile.column}-${tile.row}`,
    kind,
    tile,
    phaseSeed: animatedPhaseSeed(tile.column, tile.row),
  }));
  placements.sort((left, right) => left.tile.row - right.tile.row
    || left.tile.column - right.tile.column);
  return Object.freeze(placements);
}

/**
 * Build Nirvana West's production recipe: the generic region, wearing the Ember Rift.
 *
 * @param identity - The exact `nirvana_west` region identity.
 * @returns A recipe whose `grid.collision` carries the rift's blocking terrain and
 *   every ruin's measured footprint, whose `animatedEnvironment` is relocated onto the
 *   fissures, and whose `presentationProfile` names the exact scene the renderer must
 *   paint.
 * @throws If `identity` is not exact `nirvana_west`, or the generic recipe does not use
 *   the `ash-waste` kit at the canonical 96x96 boundary.
 */
export function createNirvanaWestRegionMapRecipe(
  identity: RegionMapIdentity,
): RegionMapRecipeV1 {
  if (identity.regionId !== NIRVANA_WEST_REGION_ID) {
    throw new Error("Nirvana West recipe builder requires exact region nirvana_west");
  }
  const generic = createRegionMapRecipe(identity);
  if (generic.kit !== REQUIRED_KIT) {
    throw new Error("Nirvana West exact presentation requires the ash-waste kit");
  }
  if (generic.grid.columns !== NIRVANA_WEST_COLUMNS || generic.grid.rows !== NIRVANA_WEST_ROWS) {
    throw new Error("Nirvana West exact presentation requires the canonical 96x96 boundary");
  }

  const authored = memoisedScene(generic.identityHash, () => {
    const scene = createNirvanaWestScene(
      nirvanaWestProtectionFromRecipe(generic),
      generic.grid.collision,
    );
    return Object.freeze({ scene, sceneHash: nirvanaWestSceneHash(scene) });
  });

  const collision = composeGroundTerrainCollision(generic.grid, [{
    columns: authored.scene.columns,
    rows: authored.scene.rows,
    blocked: authored.scene.collision,
  }]);
  // The rift composes by UNION, so it may well have re-closed the seams the generic
  // recipe opened. Re-derive against the finished collision rather than trusting the
  // generic choice: the region's own terrain decides where its walk seams can be.
  // `ash-waste` declares no water bodies, so `waterVoidMask` is all-zero and vetoes
  // nothing here — passed anyway so the call reads the same as every other region's.
  applyWrapSeams(
    collision,
    generic.grid.columns,
    generic.grid.rows,
    deriveWrapSeamCandidates(
      collision,
      generic.grid.columns,
      generic.grid.rows,
      [generic.waterVoidMask],
    ),
  );

  const composedGrid = {
    columns: generic.grid.columns,
    rows: generic.grid.rows,
    collision,
    ...(generic.grid.topology === undefined ? {} : { topology: generic.grid.topology }),
  };

  const recipe: RegionMapRecipeV1 = {
    ...generic,
    // `RegionPresentationProfile["kind"]` includes `"nirvana-west-v1"` in the shared
    // `maps/RegionMapRecipe.ts` union — verified directly against that file before this
    // was written, so no local cast is needed here.
    presentationProfile: {
      kind: "nirvana-west-v1",
      atlasProfileVersion: 2,
      staticSceneHash: authored.sceneHash,
    },
    grid: composedGrid,
    animatedEnvironment: deriveFissureAnimatedEnvironment(
      authored.scene,
      { ...generic, grid: composedGrid },
    ),
  };
  NIRVANA_WEST_SCENE_SIDECARS.set(recipe, authored);
  return recipe;
}

/**
 * Reconstruct or return the authored scene associated with a recipe.
 *
 * A recipe carrying the exact profile but no sidecar is a trust failure, not a cache
 * miss: it means the scene was lost on a copy, and rebuilding a different one under the
 * same identity is exactly the drift the scene hash exists to catch.
 */
export function nirvanaWestAuthoredSceneForRecipe(
  recipe: RegionMapRecipeV1,
): NirvanaWestAuthoredScene {
  if (recipe.regionId !== NIRVANA_WEST_REGION_ID) {
    throw new Error("Nirvana West scene reconstruction requires exact region nirvana_west");
  }
  const trusted = nirvanaWestAuthoredSceneSidecar(recipe);
  if (trusted !== null) return trusted;
  if (recipe.presentationProfile?.kind === "nirvana-west-v1") {
    throw new Error("Nirvana West exact recipes require their trusted authored-scene sidecar");
  }
  const scene = createNirvanaWestScene(
    nirvanaWestProtectionFromRecipe(recipe),
    recipe.grid.collision,
  );
  return Object.freeze({ scene, sceneHash: nirvanaWestSceneHash(scene) });
}

/**
 * How many tiles of each fire-bearing class are LEGAL for an animated placement.
 *
 * Diagnostic only — published so a budget can be chosen against the region's real supply
 * (and re-checked when the terrain is retuned) instead of against a number someone liked.
 *
 * @param scene - The authored terrain field.
 * @param recipe - The composed recipe whose validators decide legality.
 * @returns Counts of legal live-crust, welded-seam and scorch-ring tiles.
 */
export function nirvanaWestAnimatedCandidateCensus(
  scene: NirvanaWestScene,
  recipe: RegionMapRecipeV1,
): Readonly<{ liveCrust: number; weldedSeam: number; cooledCrust: number; scorchRing: number }> {
  const { columns, rows } = recipe.grid;
  const protection = nirvanaWestProtectionFromRecipe(recipe);
  const excluded = animatedPlacementExclusion(recipe);
  const materialAt = (column: number, row: number): string =>
    scene.tiles[row * NIRVANA_WEST_COLUMNS + column]!.material;
  let liveCrust = 0;
  let weldedSeam = 0;
  let cooledCrust = 0;
  let scorchRing = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      if (protection.protected[index] === 1 || excluded[index] === 1) continue;
      const material = materialAt(column, row);
      if (material === "ember") { liveCrust += 1; continue; }
      if (material === "cinder") { scorchRing += 1; continue; }
      if (material !== "emberdim") continue;
      const seam = VON_NEUMANN.some((offset) => {
        const c = column + offset.column;
        const r = row + offset.row;
        if (c < 0 || r < 0 || c >= columns || r >= rows) return false;
        return materialAt(c, r) === "ember";
      });
      if (seam) weldedSeam += 1;
      else cooledCrust += 1;
    }
  }
  return Object.freeze({ liveCrust, weldedSeam, cooledCrust, scorchRing });
}
