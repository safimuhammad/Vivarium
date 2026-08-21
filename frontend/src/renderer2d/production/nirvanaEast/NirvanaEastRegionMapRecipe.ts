/**
 * @fileoverview Exact-region adapter: the approved "Butte Country", composed onto the
 * generic Nirvana East recipe.
 *
 * Deliberately ADDITIVE, for the same measured reason Warm Springs is. The before-shot
 * (`.superpowers/sdd/nirvana-east-live-report.md` §2) established that Nirvana East is
 * structurally identical to Warm Springs and NOT to Nirvana: the generic
 * `createRegionMapRecipe` on the `dry-scrub` kit, a fixed 96x96 grid, no growth policy, no
 * authored-scene sidecar, no presentation profile, and 128 shelter plots pinned at fixed
 * coordinates. Nirvana replaced its whole region with an authored chunk world and had to
 * suppress the generic presentation to do it; there is nothing here to replace.
 *
 * So this builder starts from the unmodified generic recipe, protects everything it
 * declares, and UNIONS Butte Country's blocking terrain and landform footprints into
 * `grid.collision` through `navigation/groundTerrain.ts`'s `composeGroundTerrainCollision`
 * — the seam itself, never exclusion rects.
 *
 * What that buys: every generic invariant `validateRecipe` already enforces still runs
 * against the new collision. Shelter plots stay clear, path and soil cells stay
 * collision-open, authored scenery stays legal, anchors stay connected. The acceptance bar
 * is machine-checked on every parse rather than asserted once in a report.
 *
 * The one field this builder replaces outright is `grid.collision`. Everything else —
 * `pathMask`, `soilMask`, `waterVoidMask`, gates, anchors, staging, shelter plots,
 * `staticScenery`, `scenicClusters`, `storyNeighborhoods`, `districts`, `terrainPatches`,
 * `visualPathCompositions` — is passed through from the generic recipe untouched, so no
 * placement is displaced, no story contract moves, and no authored position is retired.
 *
 * **Toroidal, and the seams are re-derived AFTER the terrain lands.** Nirvana East's grid
 * is already `topology: "toroidal"` (torus physics shipped world-wide before this work —
 * `.superpowers/sdd/torus-physics-report.md`). The union may re-close whichever seam pair
 * the generic recipe opened, so the seams are re-derived against the FINISHED collision:
 * the region's own terrain decides where its walk seams can be.
 *
 * The authored scene rides along as a WeakMap sidecar, transferred on trusted clones
 * exactly as Nirvana's and Warm Springs' do. **No recipe object is ever cloned or mutated
 * by this module** — identity-keyed sidecars fail closed, and a copy would silently lose
 * the scene and stop the region rendering entirely.
 */

import { tileCenter } from "../../map/regionMap";
import { composeGroundTerrainCollision } from "../navigation/groundTerrain";
import { findNavigationPath } from "../navigation/navigation";
import { applyWrapSeams, deriveWrapSeamCandidates } from "../navigation/wrapSeams";
import type { RegionMapIdentity } from "../maps/RegionMapIdentity";
import {
  createRegionMapRecipe,
  registerRegionMapRecipeCloneTransfer,
  type RegionMapRecipeV1,
} from "../maps/RegionMapRecipe";
import { navigationTileForFeet, shelterRenderRect } from "../productionGeometry";
import {
  createNirvanaEastScene,
  nirvanaEastSceneHash,
  NIRVANA_EAST_COLUMNS,
  NIRVANA_EAST_ROWS,
  NIRVANA_EAST_TILE_SIZE,
  type NirvanaEastProtection,
  type NirvanaEastScene,
} from "./NirvanaEastTerrainField";

export const NIRVANA_EAST_REGION_ID = "nirvana_east";
const REQUIRED_KIT = "dry-scrub";

/** One built Nirvana East region: the authored scene plus the hash that binds it. */
export interface NirvanaEastAuthoredScene {
  readonly scene: NirvanaEastScene;
  readonly sceneHash: string;
}

const NIRVANA_EAST_SCENE_SIDECARS = new WeakMap<RegionMapRecipeV1, NirvanaEastAuthoredScene>();

registerRegionMapRecipeCloneTransfer((source, clone) => {
  const authored = NIRVANA_EAST_SCENE_SIDECARS.get(source);
  if (authored !== undefined) NIRVANA_EAST_SCENE_SIDECARS.set(clone, authored);
});

/**
 * One memoised authored scene per generic-recipe fingerprint.
 *
 * The scene build is pure in the generic recipe (its protection mask is derived from it
 * and every seed in the composition is a literal), but it is not cheap: a 96x96 corner
 * field, ~54 landform placements each with a multi-tile elliptical footprint, crossing
 * resolution, two connectivity-repair loops and ~900 prop placements. Production builds
 * the same region repeatedly — live boot, archive parse, every chronicle harness mount —
 * so the cost would be paid over and over. Memoising keeps a repeat build at generic cost.
 *
 * The recipe OBJECT is still constructed fresh every call: consumers rely on isolated
 * mutable-typed-array identity (`second.grid.collision !== first.grid.collision`), and the
 * scene itself is deeply frozen, so sharing it is safe.
 */
const NIRVANA_EAST_SCENE_MEMO = new Map<string, NirvanaEastAuthoredScene>();
const NIRVANA_EAST_SCENE_MEMO_LIMIT = 8;

function memoisedScene(
  fingerprint: string,
  build: () => NirvanaEastAuthoredScene,
): NirvanaEastAuthoredScene {
  const cached = NIRVANA_EAST_SCENE_MEMO.get(fingerprint);
  if (cached !== undefined) return cached;
  const authored = build();
  if (NIRVANA_EAST_SCENE_MEMO.size >= NIRVANA_EAST_SCENE_MEMO_LIMIT) {
    const oldest = NIRVANA_EAST_SCENE_MEMO.keys().next();
    if (oldest.done !== true) NIRVANA_EAST_SCENE_MEMO.delete(oldest.value);
  }
  NIRVANA_EAST_SCENE_MEMO.set(fingerprint, authored);
  return authored;
}

/** Resolve the authored scene retained by a trusted Live or Archive recipe clone. */
export function nirvanaEastAuthoredSceneSidecar(
  recipe: RegionMapRecipeV1,
): NirvanaEastAuthoredScene | null {
  return NIRVANA_EAST_SCENE_SIDECARS.get(recipe) ?? null;
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
 * Every tile Butte Country's blocking materials and landform objects may never close.
 *
 * Read from the recipe rather than guessed. The pilot's own gate hardcoded the 128 shelter
 * plots; this is both narrower (it is the real thing) and much wider — it also covers
 * anchors, gates, staging envelopes, authored scenery, the animated environment, the
 * visual story layer and the terrain patches, none of which the pilot ever saw.
 *
 * Protecting generously is visually cheap in this region specifically, and that is the
 * measured reason the design survives. Nirvana East's identity materials are WALKABLE by
 * construction — red oxide, red sand, bone-white salt, charcoal gravel and pale hardpan
 * all carry the region's look at zero plot cost — so protected ground still reads as
 * Nirvana East. It simply cannot become brine, thorn, mesa, scarp or slot, and no landform
 * object may stand on it.
 *
 * @param recipe - The generic recipe whose mechanics must survive.
 * @returns A frozen protection mask over the canonical 96x96 grid.
 */
export function nirvanaEastProtectionFromRecipe(
  recipe: RegionMapRecipeV1,
): NirvanaEastProtection {
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
    const minColumn = Math.floor(rect.x / NIRVANA_EAST_TILE_SIZE);
    const maxColumn = Math.floor((rect.x + rect.width - 1) / NIRVANA_EAST_TILE_SIZE);
    const minRow = Math.floor(rect.y / NIRVANA_EAST_TILE_SIZE);
    const maxRow = Math.floor((rect.y + rect.height - 1) / NIRVANA_EAST_TILE_SIZE);
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) mark(column, row);
    }
  }

  for (const point of recipe.stagingPoints) {
    const tile = navigationTileForFeet(point);
    mark(tile.column, tile.row);
  }

  // Only PASSIVE scenery needs protecting. `validateRecipe` requires a placement's tile to
  // match its own `blocksMovement` flag, so a blocking placement (`sun-rock`, `thorn`) is
  // already hard collision and terrain closing it changes nothing — while protecting it
  // would punch holes in the composition for no gain. Measured on Warm Springs: protecting
  // blocking scenery too was a major contributor to the isolated-protected-tile islands
  // that made 12 % of sampled run seeds fail to build.
  for (const placement of recipe.staticScenery) {
    if (placement.blocksMovement) continue;
    mark(placement.tile.column, placement.tile.row);
  }
  for (const cluster of recipe.scenicClusters) mark(cluster.anchor.column, cluster.anchor.row);
  for (const placement of recipe.animatedEnvironment) {
    mark(placement.tile.column, placement.tile.row);
  }

  // The visual story layer. These records declare `collisionBehavior: "visual-only"`, but
  // `validateRecipe` still requires every centreline, shoulder and clearing cell to be
  // collision-OPEN — a visual composition may not be drawn over a wall.
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
  for (const story of recipe.storyNeighborhoods) {
    mark(story.anchor.column, story.anchor.row);
    if (story.pathContext.mode === "local-authoritative-path") {
      mark(story.pathContext.contextAnchor.column, story.pathContext.contextAnchor.row);
    }
  }

  // THE STORY DIAGNOSTIC ROUTE, and it is not an optional nicety — it was found by a
  // failing parse, exactly as Warm Springs found its visual-path shoulders.
  //
  // `validateStoryCompositionRecords` re-derives, for every story neighbourhood, the
  // route from its anchor to its district's first social anchor through the recipe's OWN
  // grid, and demands that the first path-mask tile on that route, and its index along
  // it, still match what the record froze (`RegionMapRecipe.ts:3663`). That diagnostic
  // depends on the whole ROUTE, not on its endpoints — so terrain anywhere along it can
  // invalidate the recipe even though every endpoint is untouched. Nirvana East's
  // landform objects are 36-55 tiles each, big enough to do exactly that, and the first
  // build threw "recipe detached story path context must preserve exact nearest
  // navigation diagnostic" on three of four sampled seeds.
  //
  // Protecting the route the GENERIC grid already returns pins the diagnostic by
  // construction: terrain only ever CLOSES ground, so a preserved optimal route stays
  // optimal and the frozen tile and distance stay exact.
  for (const story of recipe.storyNeighborhoods) {
    const district = recipe.districts[story.districtIndex];
    const goal = district?.socialAnchors[0];
    if (goal === undefined) continue;
    const route = findNavigationPath(recipe.grid, { start: story.anchor, goal });
    if (route.status !== "reached") continue;
    for (const tile of route.tiles) mark(tile.column, tile.row);
  }

  // THE OCCUPIED-HOME APPROACH DIAGNOSTIC ROUTE — the same defect class as the story
  // route above, found the same way, by a failing parse.
  //
  // `createOccupiedHomeApproachBinding` freezes, per shelter plot,
  // `nearestAuthoritativePathContext(plot.door, district.socialAnchors[0], grid, pathMask)`
  // — the first `pathMask` tile on the route the real navigator returns, and its index
  // along that route — and `validateRecipe` RE-DERIVES it at parse time against the
  // composed grid and demands it match byte for byte
  // (`RegionMapRecipe.ts` "recipe occupied-home approach must preserve its exact local
  // apron and navigation diagnostic"). Protecting the door and the apron cells is NOT
  // enough: the diagnostic depends on the whole ROUTE, so a landform closing one tile the
  // generic route used can push the recomputed route onto a detour whose first path tile
  // or index differs, even though every recorded cell stayed open.
  //
  // Measured: seed 7 threw exactly that once landform infill reached the settled band.
  // Same remedy as the story route — protect the route the GENERIC grid already returns,
  // which pins the diagnostic by construction, because terrain only ever CLOSES ground so
  // a preserved optimal route stays optimal.
  const approachGoalByDistrict = recipe.districts.map((district) => district.socialAnchors[0]);
  for (let index = 0; index < recipe.districts.length; index += 1) {
    const goal = approachGoalByDistrict[index];
    if (goal === undefined) continue;
    for (const plot of recipe.districts[index]!.shelterPlots) {
      const route = findNavigationPath(recipe.grid, { start: plot.door, goal });
      if (route.status !== "reached") continue;
      for (const tile of route.tiles) mark(tile.column, tile.row);
    }
  }

  for (let index = 0; index < guarded.length; index += 1) {
    if (recipe.pathMask[index] === 1 || recipe.soilMask[index] === 1) guarded[index] = 1;
  }

  // Every water component must keep an eligible cardinal shoreline neighbour that is
  // collision-open (`validateRecipe`). Protecting the open cardinal neighbours of the
  // region's authored water keeps that invariant structurally rather than by luck.
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (recipe.waterVoidMask[row * columns + column] !== 1) continue;
      for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const c = column + dc;
        const r = row + dr;
        if (c <= 0 || r <= 0 || c >= columns - 1 || r >= rows - 1) continue;
        if (recipe.waterVoidMask[r * columns + c] === 1) continue;
        if (recipe.grid.collision[r * columns + c] === 0) mark(c, r);
      }
    }
  }

  return Object.freeze({
    columns,
    rows,
    protected: guarded,
    water: Uint8Array.from(recipe.waterVoidMask),
    path: Uint8Array.from(recipe.pathMask),
  });
}

/**
 * Build Nirvana East's production recipe: the generic region, wearing Butte Country.
 *
 * @param identity - The exact `nirvana_east` region identity.
 * @returns A recipe whose `grid.collision` carries the composition's blocking terrain and
 *   landform footprints, and whose `presentationProfile` names the exact scene the
 *   renderer must paint.
 * @throws If `identity` is not exact `nirvana_east`, or the generic recipe does not use
 *   the `dry-scrub` kit at the canonical 96x96 boundary.
 */
export function createNirvanaEastRegionMapRecipe(
  identity: RegionMapIdentity,
): RegionMapRecipeV1 {
  if (identity.regionId !== NIRVANA_EAST_REGION_ID) {
    throw new Error("Nirvana East recipe builder requires exact region nirvana_east");
  }
  const generic = createRegionMapRecipe(identity);
  if (generic.kit !== REQUIRED_KIT) {
    throw new Error("Nirvana East exact presentation requires the dry-scrub kit");
  }
  if (generic.grid.columns !== NIRVANA_EAST_COLUMNS || generic.grid.rows !== NIRVANA_EAST_ROWS) {
    throw new Error("Nirvana East exact presentation requires the canonical 96x96 boundary");
  }

  const authored = memoisedScene(generic.identityHash, () => {
    const scene = createNirvanaEastScene(
      nirvanaEastProtectionFromRecipe(generic),
      generic.grid.collision,
    );
    return Object.freeze({ scene, sceneHash: nirvanaEastSceneHash(scene) });
  });
  const collision = composeGroundTerrainCollision(generic.grid, [{
    columns: authored.scene.columns,
    rows: authored.scene.rows,
    blocked: authored.scene.collision,
  }]);
  // Butte Country composes by UNION, so it may well have re-closed the seams the generic
  // recipe opened. Re-derive against the finished collision rather than trusting the
  // generic choice: the region's own terrain decides where its walk seams can be.
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

  const recipe: RegionMapRecipeV1 = {
    ...generic,
    presentationProfile: {
      kind: "nirvana-east-v1",
      atlasProfileVersion: 2,
      staticSceneHash: authored.sceneHash,
    },
    grid: {
      columns: generic.grid.columns,
      rows: generic.grid.rows,
      collision,
      ...(generic.grid.topology === undefined ? {} : { topology: generic.grid.topology }),
    },
  };
  NIRVANA_EAST_SCENE_SIDECARS.set(recipe, authored);
  return recipe;
}

/**
 * Reconstruct or return the authored scene associated with a recipe.
 *
 * A recipe carrying the exact profile but no sidecar is a trust failure, not a cache
 * miss: it means the scene was lost on a copy, and rebuilding a different one under the
 * same identity is exactly the drift the scene hash exists to catch.
 */
export function nirvanaEastAuthoredSceneForRecipe(
  recipe: RegionMapRecipeV1,
): NirvanaEastAuthoredScene {
  if (recipe.regionId !== NIRVANA_EAST_REGION_ID) {
    throw new Error("Nirvana East scene reconstruction requires exact region nirvana_east");
  }
  const trusted = nirvanaEastAuthoredSceneSidecar(recipe);
  if (trusted !== null) return trusted;
  if (recipe.presentationProfile?.kind === "nirvana-east-v1") {
    throw new Error("Nirvana East exact recipes require their trusted authored-scene sidecar");
  }
  const scene = createNirvanaEastScene(
    nirvanaEastProtectionFromRecipe(recipe),
    recipe.grid.collision,
  );
  return Object.freeze({ scene, sceneHash: nirvanaEastSceneHash(scene) });
}

/** The world-pixel centre of one tile; re-exported so probes need not re-derive it. */
export { tileCenter };
