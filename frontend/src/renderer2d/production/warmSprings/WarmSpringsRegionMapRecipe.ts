/**
 * @fileoverview Exact-region adapter: the approved Great Terrace, composed onto the
 * generic Warm Springs recipe.
 *
 * Deliberately ADDITIVE, and that is the central design decision of this integration.
 * Nirvana replaced its whole region — grid, paths, scenery, story lists — with an authored
 * chunk world, and had to suppress the generic presentation to do it. Warm Springs has no
 * chunk world and no growth: it is a fixed 96x96 generic region. So instead of replacing
 * the recipe, this builder starts from the unmodified generic one, protects everything it
 * declares, and UNIONS the terrace's blocking terrain into `grid.collision` through
 * `navigation/groundTerrain.ts`'s `composeGroundTerrainCollision` — the seam itself.
 *
 * What that buys, and it is not a small thing: every generic invariant `validateRecipe`
 * already enforces still runs against the new collision. Shelter plots must stay clear,
 * path and soil cells must stay collision-open, authored scenery must stay legal, anchors
 * must stay connected. The acceptance bar is therefore machine-checked on every parse
 * rather than asserted once in a report.
 *
 * The one field this builder replaces outright is `grid.collision`. Everything else —
 * `pathMask`, `soilMask`, `waterVoidMask`, gates, anchors, staging, shelter plots,
 * `staticScenery`, `scenicClusters`, `storyNeighborhoods`, `districts` — is passed through
 * from the generic recipe untouched, so no placement is displaced, no story contract moves,
 * and no authored position is retired.
 *
 * The authored scene rides along as a WeakMap sidecar, transferred on trusted clones
 * exactly as Nirvana's does. **No recipe object is ever cloned or mutated by this module** —
 * identity-keyed sidecars fail closed, and a copy would silently lose the scene and break
 * rendering entirely.
 */

import { tileCenter } from "../../map/regionMap";
import { composeGroundTerrainCollision } from "../navigation/groundTerrain";
import { applyWrapSeams, deriveWrapSeamCandidates } from "../navigation/wrapSeams";
import type { RegionMapIdentity } from "../maps/RegionMapIdentity";
import {
  createRegionMapRecipe,
  registerRegionMapRecipeCloneTransfer,
  type RegionMapRecipeV1,
} from "../maps/RegionMapRecipe";
import { navigationTileForFeet, shelterRenderRect } from "../productionGeometry";
import {
  createWarmSpringsScene,
  warmSpringsSceneHash,
  WARM_SPRINGS_COLUMNS,
  WARM_SPRINGS_ROWS,
  WARM_SPRINGS_TILE_SIZE,
  type WarmSpringsProtection,
  type WarmSpringsScene,
} from "./WarmSpringsTerrainField";

export const WARM_SPRINGS_REGION_ID = "warm_springs";
const REQUIRED_KIT = "spring-terraces";

/** One built Warm Springs region: the authored scene plus the hash that binds it. */
export interface WarmSpringsAuthoredScene {
  readonly scene: WarmSpringsScene;
  readonly sceneHash: string;
}

const WARM_SPRINGS_SCENE_SIDECARS = new WeakMap<RegionMapRecipeV1, WarmSpringsAuthoredScene>();

registerRegionMapRecipeCloneTransfer((source, clone) => {
  const authored = WARM_SPRINGS_SCENE_SIDECARS.get(source);
  if (authored !== undefined) WARM_SPRINGS_SCENE_SIDECARS.set(clone, authored);
});

/**
 * One memoised authored scene per generic-recipe fingerprint.
 *
 * The scene build is pure in the generic recipe (its protection mask is derived from it
 * and every seed in the composition is a literal), but it is not cheap: corner field,
 * boardwalk resolution, two connectivity-repair loops and ~780 prop placements, measured
 * at ~60 ms on top of the generic recipe's own ~83 ms. Production builds the same region
 * repeatedly — live boot, archive parse, every chronicle harness mount — so the cost was
 * paid over and over. Memoising it keeps a repeat build at generic cost.
 *
 * The recipe OBJECT is still constructed fresh every call: consumers rely on isolated
 * mutable-typed-array identity (`second.grid.collision !== first.grid.collision`), and the
 * scene itself is deeply frozen, so sharing it is safe.
 */
const WARM_SPRINGS_SCENE_MEMO = new Map<string, WarmSpringsAuthoredScene>();
const WARM_SPRINGS_SCENE_MEMO_LIMIT = 8;

function memoisedScene(
  fingerprint: string,
  build: () => WarmSpringsAuthoredScene,
): WarmSpringsAuthoredScene {
  const cached = WARM_SPRINGS_SCENE_MEMO.get(fingerprint);
  if (cached !== undefined) return cached;
  const authored = build();
  if (WARM_SPRINGS_SCENE_MEMO.size >= WARM_SPRINGS_SCENE_MEMO_LIMIT) {
    const oldest = WARM_SPRINGS_SCENE_MEMO.keys().next();
    if (oldest.done !== true) WARM_SPRINGS_SCENE_MEMO.delete(oldest.value);
  }
  WARM_SPRINGS_SCENE_MEMO.set(fingerprint, authored);
  return authored;
}

/** Resolve the authored scene retained by a trusted Live or Archive recipe clone. */
export function warmSpringsAuthoredSceneSidecar(
  recipe: RegionMapRecipeV1,
): WarmSpringsAuthoredScene | null {
  return WARM_SPRINGS_SCENE_SIDECARS.get(recipe) ?? null;
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
 * Every tile the terrace's blocking materials may never close.
 *
 * Read from the recipe rather than guessed, which is both narrower than the pilot's
 * hand-declared free-space geometry (it is the real thing) and wider (it also covers
 * anchors, staging envelopes, authored scenery and the animated environment the pilot
 * never saw). Protecting generously is visually cheap here: the gate only demotes
 * BLOCKING materials, and `sinter` / `travertine` are walkable, so protected ground still
 * carries the region's mineral identity — it simply cannot become pool, mat, mud, scrub,
 * reed or rock.
 *
 * @param recipe - The generic recipe whose mechanics must survive.
 * @returns A frozen protection mask over the canonical 96x96 grid.
 */
export function warmSpringsProtectionFromRecipe(
  recipe: RegionMapRecipeV1,
): WarmSpringsProtection {
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
    const minColumn = Math.floor(rect.x / WARM_SPRINGS_TILE_SIZE);
    const maxColumn = Math.floor((rect.x + rect.width - 1) / WARM_SPRINGS_TILE_SIZE);
    const minRow = Math.floor(rect.y / WARM_SPRINGS_TILE_SIZE);
    const maxRow = Math.floor((rect.y + rect.height - 1) / WARM_SPRINGS_TILE_SIZE);
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) mark(column, row);
    }
  }

  for (const point of recipe.stagingPoints) {
    const tile = navigationTileForFeet(point);
    mark(tile.column, tile.row);
  }

  // Only PASSIVE scenery needs protecting. `validateRecipe` requires a placement's tile to
  // match its own `blocksMovement` flag, so a blocking placement (`terrace-rock`, `willow`)
  // is already hard collision and terrain closing it changes nothing — while protecting it
  // would punch a hole in the channel for no gain. Measured: protecting blocking scenery
  // too was a major contributor to the isolated-protected-tile islands that made 12 % of
  // sampled run seeds fail to build.
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
  // collision-OPEN — a visual composition may not be drawn over a wall. Found by
  // measurement: without this, two of four sampled seeds failed to parse with
  // "recipe visual path shoulder must avoid water, collision, soil, scenery, shelters".
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

  for (let index = 0; index < guarded.length; index += 1) {
    if (recipe.pathMask[index] === 1 || recipe.soilMask[index] === 1) guarded[index] = 1;
  }

  // Every water component must keep an eligible cardinal shoreline neighbour that is
  // collision-open (`validateRecipe`). Protecting the open cardinal neighbours of the
  // authored springs keeps that invariant structurally rather than by luck.
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
 * Build Warm Springs' production recipe: the generic region, wearing the Great Terrace.
 *
 * @param identity - The exact `warm_springs` region identity.
 * @returns A recipe whose `grid.collision` carries the terrace's blocking terrain and
 *   whose `presentationProfile` names the exact scene the renderer must paint.
 * @throws If `identity` is not exact `warm_springs`, or the generic recipe does not use
 *   the `spring-terraces` kit at the canonical 96x96 boundary.
 */
export function createWarmSpringsRegionMapRecipe(
  identity: RegionMapIdentity,
): RegionMapRecipeV1 {
  if (identity.regionId !== WARM_SPRINGS_REGION_ID) {
    throw new Error("Warm Springs recipe builder requires exact region warm_springs");
  }
  const generic = createRegionMapRecipe(identity);
  if (generic.kit !== REQUIRED_KIT) {
    throw new Error("Warm Springs exact presentation requires the spring-terraces kit");
  }
  if (generic.grid.columns !== WARM_SPRINGS_COLUMNS || generic.grid.rows !== WARM_SPRINGS_ROWS) {
    throw new Error("Warm Springs exact presentation requires the canonical 96x96 boundary");
  }

  const authored = memoisedScene(generic.identityHash, () => {
    const scene = createWarmSpringsScene(
      warmSpringsProtectionFromRecipe(generic),
      generic.grid.collision,
    );
    return Object.freeze({ scene, sceneHash: warmSpringsSceneHash(scene) });
  });
  const collision = composeGroundTerrainCollision(generic.grid, [{
    columns: authored.scene.columns,
    rows: authored.scene.rows,
    blocked: authored.scene.collision,
  }]);
  // The terrace composes by UNION, so it may well have re-closed the seams the generic
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
      kind: "warm-springs-v1",
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
  WARM_SPRINGS_SCENE_SIDECARS.set(recipe, authored);
  return recipe;
}

/**
 * Reconstruct or return the authored scene associated with a recipe.
 *
 * A recipe carrying the exact profile but no sidecar is a trust failure, not a cache
 * miss: it means the scene was lost on a copy, and rebuilding a different one under the
 * same identity is exactly the drift the scene hash exists to catch.
 */
export function warmSpringsAuthoredSceneForRecipe(
  recipe: RegionMapRecipeV1,
): WarmSpringsAuthoredScene {
  if (recipe.regionId !== WARM_SPRINGS_REGION_ID) {
    throw new Error("Warm Springs scene reconstruction requires exact region warm_springs");
  }
  const trusted = warmSpringsAuthoredSceneSidecar(recipe);
  if (trusted !== null) return trusted;
  if (recipe.presentationProfile?.kind === "warm-springs-v1") {
    throw new Error("Warm Springs exact recipes require their trusted authored-scene sidecar");
  }
  const scene = createWarmSpringsScene(
    warmSpringsProtectionFromRecipe(recipe),
    recipe.grid.collision,
  );
  return Object.freeze({ scene, sceneHash: warmSpringsSceneHash(scene) });
}

/** The world-pixel centre of one tile; re-exported so probes need not re-derive it. */
export { tileCenter };
