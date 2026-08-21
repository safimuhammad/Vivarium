/**
 * @fileoverview Physical convergence for two-participant interaction beats.
 *
 * The backend only ever publishes a REGION and an ACTION -- never a position.
 * If a strike, a gift, a proposal or a revival is to READ, the frontend has to
 * bring the two bodies together first: the initiator walks to within an
 * interaction distance of the other party (or of the structure), turns to face
 * them, and only then does the act's pose and its overlay fire.
 *
 * Every choreography family used to resolve that approach on its own, against
 * the region's collision grid alone. The renderer's own apply-time gate
 * (`presentationRouteIsClear`) additionally excludes every home's rendered
 * footprint -- so once a home existed, choreography kept authoring approach
 * routes ending beside a being who stood in a doorway, and the renderer kept
 * dropping them with no diagnostic and no fallback. The being played its
 * contact pose in place, fifteen tiles from the person it was reaching for.
 *
 * This module is the one place that asks the renderer's own question before
 * authoring the walk: `SpatialDirector.nearestLegalStandingPoint` picks a
 * contact tile the renderer will accept, and `presentationRouteIsClear`
 * verifies the resolved path end to end. A route that survives both is one
 * the renderer cannot silently veto.
 *
 * The renderer's gate now asks TWO questions, and this module already satisfies
 * both: OBJECT exclusions (home footprints, tall landmarks) via
 * `presentationRouteIsClear` over rects, and GROUND terrain via the
 * destination tile's `grid.collision` — which every route here is resolved over
 * already, because `exclusionAwareGrid` starts from `recipe.grid.collision` and
 * only ever closes further cells. See
 * `renderer2d/production/navigation/groundTerrain.ts`.
 */

import type { Rect, Vec2 } from "../../renderer2d/contracts";
import { TILE_SIZE, tileCenter, type TileCoord } from "../../renderer2d/map/regionMap";
import type { RegionMapRecipeV1 } from "../../renderer2d/production/maps/RegionMapRecipe";
import {
  contactTileCandidates,
  homeRouteExclusionRects,
  nearestLegalStandingPoint,
} from "../../renderer2d/production/placement/SpatialDirector";
import type { PlacementLedgerSnapshot } from "../../renderer2d/production/placement/PlacementLedger";
import {
  connectNavigationEndpoints,
  findNavigationPath,
  wrapNavigationTile,
} from "../../renderer2d/production/navigation/navigation";
import {
  SHELTER_RENDER_FOOTPRINT,
  presentationPointIsClear,
  presentationRouteIsClear,
} from "../../renderer2d/production/productionGeometry";

export { INTERACTION_CONTACT_TOLERANCE_PX } from "../../renderer2d/production/placement/SpatialDirector";

/** Half of the rendered shelter footprint, used to derive a door's outward normal. */
const SHELTER_FOOTPRINT_HALF_PX = SHELTER_RENDER_FOOTPRINT.width / 2;

/** How far out along a door's normal a visitor may be pushed before falling back to a ring search. */
const OUTWARD_SEARCH_TILES = 5;

/** Deterministic pixel-to-tile projection shared by every route resolver here. */
export function contactPointTile(point: Vec2): TileCoord {
  return { column: Math.floor(point.x / TILE_SIZE), row: Math.floor(point.y / TILE_SIZE) };
}

/** True when a navigation tile is inside the grid and collision-open. */
export function contactTileIsOpen(grid: RegionMapRecipeV1["grid"], tile: TileCoord): boolean {
  // Canonicalised first, so a contact candidate that spills over a seam is judged by the
  // ground it actually names rather than being called "off the map".
  const candidate = wrapNavigationTile(grid, tile);
  if (candidate.column < 0 || candidate.row < 0
    || candidate.column >= grid.columns || candidate.row >= grid.rows) {
    return false;
  }
  return grid.collision[candidate.row * grid.columns + candidate.column] === 0;
}

/**
 * Exactly the exclusion set `ProductionSceneGraph` enforces at apply time for
 * the homes standing in `regionId`, rebuilt from the same two authorities the
 * renderer reads: the placement ledger's home records and the region recipe's
 * shelter plots.
 *
 * Scenic-landmark interaction exclusions are deliberately NOT included: they
 * are published onto a live environment the choreography layer never sees, and
 * a route rejected only by one of those degrades to the pre-existing "no
 * physical contact" fallback rather than to a wrong-looking beat.
 */
export function homeExclusionsForRegion(
  placement: PlacementLedgerSnapshot,
  recipes: ReadonlyMap<string, RegionMapRecipeV1>,
  regionId: string | null,
): readonly Rect[] {
  return homeRouteExclusionRects(homePlotsForRegion(placement, recipes, regionId));
}

/** Every placed home standing in `regionId`, as its render-origin plot and its door point. */
export function homePlotsForRegion(
  placement: PlacementLedgerSnapshot,
  recipes: ReadonlyMap<string, RegionMapRecipeV1>,
  regionId: string | null,
): readonly Readonly<{ plot: Vec2; door: Vec2 }>[] {
  if (regionId === null) return [];
  const recipe = recipes.get(regionId);
  if (recipe === undefined) return [];
  const plots: { plot: Vec2; door: Vec2 }[] = [];
  for (const home of placement.homes.values()) {
    if (home.regionId !== regionId) continue;
    const shelter = recipe.shelterPlots.find(({ id }) => id === home.plotId);
    if (shelter === undefined) continue;
    plots.push({ plot: tileCenter(shelter.tile), door: { ...home.door } });
  }
  return plots;
}

/**
 * The render-origin plot of the shelter whose authored door is exactly `door`,
 * taken from the region recipe rather than the placement ledger.
 *
 * `home_built` routes its actor to a shelter plot that is being RESERVED and is
 * therefore not in the ledger yet, so the ledger-derived exclusion set is blind
 * to the very structure the being is walking to -- which is how a builder ended
 * up standing inside his own new house, invisible behind its roof, and stayed
 * there for the rest of the chronicle. The recipe knows the plot regardless.
 */
export function recipePlotForDoor(recipe: RegionMapRecipeV1, door: Vec2): Vec2 | null {
  const shelter = recipe.shelterPlots.find((candidate) => {
    const point = tileCenter(candidate.door);
    return point.x === door.x && point.y === door.y;
  });
  return shelter === undefined ? null : tileCenter(shelter.tile);
}

/**
 * The region's navigation grid with every tile a standing body could not
 * legally occupy (because its envelope overlaps a structure exclusion) marked
 * blocked.
 *
 * Path-finding on the raw grid is what made the renderer's veto unavoidable:
 * A* knows only the terrain collision mask, so it routes straight through a
 * house, and the whole resulting route is then rejected. Searching on this
 * derived grid means the path comes back AROUND the structure -- an approach
 * that both layers agree on.
 */
/**
 * Derived grids are memoised per (grid identity, exclusion signature).
 *
 * Building one walks every tile in a 96x96 region against every exclusion rect;
 * a beat can resolve its contact route more than once, and the region's homes
 * change only when a home is built or ruined, so recomputing it per call made
 * the whole presentation measurably slower. The cache is keyed on the recipe's
 * own grid object (stable per region) and on the exact rect geometry, so a new
 * home invalidates it automatically.
 */
const exclusionGridCache = new WeakMap<
  RegionMapRecipeV1["grid"],
  Map<string, RegionMapRecipeV1["grid"]>
>();

function exclusionSignature(exclusions: readonly Rect[]): string {
  return exclusions.map((rect) => `${rect.x},${rect.y},${rect.width},${rect.height}`).join("|");
}

export function exclusionAwareGrid(
  grid: RegionMapRecipeV1["grid"],
  exclusions: readonly Rect[],
  /**
   * Tiles that stay walkable even when excluded -- always the mover's own
   * current tile, so a being already standing somewhere it should not be can
   * still walk OUT rather than being stranded there forever.
   */
  exemptTiles: readonly TileCoord[] = [],
): RegionMapRecipeV1["grid"] {
  if (exclusions.length === 0) return grid;
  const signature = exclusionSignature(exclusions);
  let perGrid = exclusionGridCache.get(grid);
  if (perGrid === undefined) {
    perGrid = new Map();
    exclusionGridCache.set(grid, perGrid);
  }
  let excluded = perGrid.get(signature);
  if (excluded === undefined) {
    const collision = Uint8Array.from(grid.collision);
    for (let row = 0; row < grid.rows; row += 1) {
      for (let column = 0; column < grid.columns; column += 1) {
        const index = row * grid.columns + column;
        if (collision[index] !== 0) continue;
        if (!presentationPointIsClear(tileCenter({ column, row }), exclusions)) collision[index] = 1;
      }
    }
    excluded = { ...grid, collision };
    perGrid.set(signature, excluded);
  }
  const exempt = exemptTiles.filter((tile) => (
    tile.column >= 0 && tile.row >= 0 && tile.column < grid.columns && tile.row < grid.rows
    && grid.collision[tile.row * grid.columns + tile.column] === 0
    && excluded!.collision[tile.row * grid.columns + tile.column] !== 0
  ));
  if (exempt.length === 0) return excluded;
  // Exemptions are per-call (they name the mover's own tile), so they are
  // applied to a copy and never poison the shared cached grid.
  const collision = Uint8Array.from(excluded.collision);
  for (const tile of exempt) collision[tile.row * grid.columns + tile.column] = 0;
  return { ...grid, collision };
}

/** A resolved approach, in the shape both choreography families already consume. */
export interface LegalContactRoute {
  readonly status: "reached" | "fallback";
  readonly waypoints: readonly Vec2[];
  /** The tile the mover ends on, or `null` when the approach did not resolve. */
  readonly contactPoint: Vec2 | null;
  readonly detail: string;
}

const NO_ROUTE = Object.freeze({ status: "fallback" as const, waypoints: [], contactPoint: null });

/**
 * Walk `moverPoint` to the nearest tile beside `targetPoint` that BOTH the
 * region's collision grid and the renderer's exclusion gate accept.
 *
 * Candidates are ordered nearest-first ({@link contactTileCandidates}), so an
 * orthogonally adjacent tile -- arm's length, the interaction distance every
 * two-participant beat wants -- always wins when one is available. The wider
 * rings only ever come into play when the other party stands somewhere a body
 * legally cannot join them, above all a home's doorway; there the visitor ends
 * up directly in front of the structure rather than not moving at all.
 *
 * Returns a fallback (never a partial walk) when nothing legal is reachable,
 * so the caller keeps its existing evidence-visible non-physical motif.
 */
export function resolveLegalContactRoute(
  moverPoint: Vec2,
  targetPoint: Vec2,
  recipe: RegionMapRecipeV1,
  exclusions: readonly Rect[],
): LegalContactRoute {
  const start = contactPointTile(moverPoint);
  if (!contactTileIsOpen(recipe.grid, start)) {
    return { ...NO_ROUTE, detail: "the mover's exact retained start tile is not collision-open" };
  }
  const grid = exclusionAwareGrid(recipe.grid, exclusions, [start]);
  const occupied = contactPointTile(targetPoint);
  for (const goal of contactTileCandidates(occupied)) {
    if (!contactTileIsOpen(grid, goal)) continue;
    const goalPoint = tileCenter(goal);
    const result = findNavigationPath(grid, { start, goal });
    if (result.status !== "reached") continue;
    const waypoints = connectNavigationEndpoints(grid, result, { start: moverPoint });
    if (waypoints === null) continue;
    if (!presentationRouteIsClear(moverPoint, waypoints, exclusions)) continue;
    return {
      status: "reached",
      waypoints,
      contactPoint: goalPoint,
      detail: "collision-open, footprint-clear contact route reached",
    };
  }
  return {
    ...NO_ROUTE,
    detail: "no collision-open, footprint-clear contact route is reachable",
  };
}

/**
 * Where a being should stand to interact with a STRUCTURE.
 *
 * The authored door anchor sits well inside the shelter's 128 px render rect
 * -- correct for the home's own door art, wrong as a body position: a being
 * placed there renders behind the roof and, because the door carve-out is 7 px
 * shorter than the measured standing envelope, is illegal under the very gate
 * that decides whether anyone may walk to it. This returns the door point
 * itself when it genuinely admits a body, and otherwise the closest legal tile
 * in front of the structure.
 */
export function structureStandingPoint(
  door: Vec2,
  plot: Vec2 | null,
  recipe: RegionMapRecipeV1,
  exclusions: readonly Rect[],
): Vec2 | null {
  const isOpen = (tile: TileCoord): boolean => contactTileIsOpen(recipe.grid, tile);
  if (isOpen(contactPointTile(door)) && presentationPointIsClear(door, exclusions)) {
    return { ...door };
  }
  // Step straight out along the door's own outward normal first, so a visitor
  // ends up IN FRONT of the doorway rather than merely somewhere legal beside
  // the walls. The normal is derived from the door's offset within the
  // rendered footprint, never hardcoded.
  if (plot !== null) {
    const centre = {
      x: plot.x + SHELTER_FOOTPRINT_HALF_PX,
      y: plot.y + SHELTER_FOOTPRINT_HALF_PX,
    };
    const dx = door.x - centre.x;
    const dy = door.y - centre.y;
    const step = Math.abs(dy) >= Math.abs(dx)
      ? { column: 0, row: Math.sign(dy) || 1 }
      : { column: Math.sign(dx) || 1, row: 0 };
    const doorTile = contactPointTile(door);
    for (let out = 1; out <= OUTWARD_SEARCH_TILES; out += 1) {
      const tile = { column: doorTile.column + step.column * out, row: doorTile.row + step.row * out };
      if (!isOpen(tile)) continue;
      const point = tileCenter(tile);
      if (presentationPointIsClear(point, exclusions)) return point;
    }
  }
  return nearestLegalStandingPoint(door, exclusions, isOpen);
}
