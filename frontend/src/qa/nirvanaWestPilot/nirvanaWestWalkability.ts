/**
 * Adapters that connect the Nirvana West PILOT scene to the exact PRODUCTION
 * consumers of a terrain walkability mask, and the money function that decides
 * whether a composition is buildable: {@link shelterPlotReport}.
 *
 * Mirrors `warmSpringsPilot/springsWalkability.ts` in shape. `nirvanaWestScene.ts`
 * derives one `collision` mask (row-major, 1 = blocked) already shaped like the
 * production `NavigationGrid`, so `toNavigationGrid` below is a zero-copy view
 * exactly as the Warm Springs pilot's is - with one addition: this region is a
 * torus, so the grid also declares `topology: "toroidal"`, matching
 * `RegionMapRecipe.ts`'s `REGION_WALK_TOPOLOGY` (every region in this world wraps).
 * That is what lets the real production `findNavigationPath` step across either
 * wrap seam using this exact collision buffer, not just this module's own
 * flood fill - see `measure-nirvana-west-compositions.mjs`'s navigator proof.
 */

import type { Vec2 } from "../../renderer2d/contracts";
import { tileCenter, type TileCoord } from "../../renderer2d/map/regionMap";
import type { NavigationGrid } from "../../renderer2d/production/navigation/navigation";
import { shelterRenderRect } from "../../renderer2d/production/productionGeometry";
import type { NirvanaWestScene } from "./nirvanaWestScene";

/**
 * Adapt the pilot scene's collision mask to the production `NavigationGrid`
 * shape. No copy is made: the grid is a read-only view over the scene's own
 * `Uint8Array`, exactly as a real `RegionMapRecipeV1` exposes its `grid` field.
 * `topology: "toroidal"` is what makes the production pathfinder honour the
 * wrap seams this scene was built to have - see the module docstring.
 */
export function toNavigationGrid(scene: NirvanaWestScene): NavigationGrid {
  return {
    columns: scene.columns,
    rows: scene.rows,
    collision: scene.collision,
    topology: "toroidal",
  };
}

/** The centre point, in world pixels, of every walkable tile. */
export function walkablePoints(scene: NirvanaWestScene): readonly Vec2[] {
  const points: Vec2[] = [];
  for (let row = 0; row < scene.rows; row += 1) {
    for (let column = 0; column < scene.columns; column += 1) {
      if (scene.collision[row * scene.columns + column] === 0) {
        points.push(tileCenter({ column, row }));
      }
    }
  }
  return points;
}

// ---------------------------------------------------------------------------
// shelter plot geometry (contract §1 - the GENERIC recipe, RegionMapRecipe.ts)
// ---------------------------------------------------------------------------

/** The 8 district origin tiles, `{column, row}` - frozen by contract §1. */
export const DISTRICT_ORIGINS: readonly TileCoord[] = Object.freeze([
  { column: 18, row: 18 }, { column: 34, row: 18 },
  { column: 50, row: 18 }, { column: 66, row: 18 },
  { column: 66, row: 50 }, { column: 50, row: 50 },
  { column: 34, row: 50 }, { column: 18, row: 50 },
]);

/** The 16 shelter-plot tile offsets within a district - frozen by contract §1. */
export const SHELTER_PLOT_OFFSETS: readonly TileCoord[] = Object.freeze([
  { column: 0, row: 3 }, { column: 4, row: 3 }, { column: 8, row: 3 },
  { column: 0, row: 7 }, { column: 4, row: 7 }, { column: 8, row: 7 },
  { column: 0, row: 11 }, { column: 4, row: 11 }, { column: 8, row: 11 },
  { column: 0, row: 15 }, { column: 4, row: 15 }, { column: 8, row: 15 },
  { column: 0, row: 19 }, { column: 4, row: 19 }, { column: 8, row: 19 },
  { column: 4, row: 23 },
]);

export interface ShelterPlotRef {
  readonly id: string;
  readonly districtIndex: number;
  readonly plotIndex: number;
  readonly tile: TileCoord;
}

/** All 128 shelter plots (8 districts x 16 offsets), in a stable order. */
export function allShelterPlots(): readonly ShelterPlotRef[] {
  const plots: ShelterPlotRef[] = [];
  DISTRICT_ORIGINS.forEach((origin, districtIndex) => {
    SHELTER_PLOT_OFFSETS.forEach((offset, plotIndex) => {
      plots.push({
        id: `district-${districtIndex}:plot-${plotIndex}`,
        districtIndex,
        plotIndex,
        tile: { column: origin.column + offset.column, row: origin.row + offset.row },
      });
    });
  });
  return Object.freeze(plots);
}

export interface ShelterPlotStatus {
  readonly plot: ShelterPlotRef;
  /** True when all 25 tiles of the plot's real render footprint are unblocked. */
  readonly clear: boolean;
}

export interface ShelterPlotReport {
  readonly total: number;
  readonly clear: number;
  readonly lost: number;
  readonly statuses: readonly ShelterPlotStatus[];
}

/**
 * True iff every tile spanned by the real 128x128 shelter render footprint at
 * `plotTile` is walkable in the scene's collision mask. Uses the production
 * `shelterRenderRect` unmodified, so the footprint's true origin (the render
 * rect starts at the plot tile's CENTRE) is exactly what production would place.
 * None of the 128 plots ever approach the wrap seam (max reach is column 82,
 * row 78 against a 96-wide/tall grid), so no wrap handling is needed here.
 */
export function shelterPlotIsClear(scene: NirvanaWestScene, plotTile: TileCoord): boolean {
  const rect = shelterRenderRect(plotTile);
  const minColumn = Math.floor(rect.x / scene.tileSize);
  const maxColumn = Math.floor((rect.x + rect.width - 1) / scene.tileSize);
  const minRow = Math.floor(rect.y / scene.tileSize);
  const maxRow = Math.floor((rect.y + rect.height - 1) / scene.tileSize);

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      if (column < 0 || row < 0 || column >= scene.columns || row >= scene.rows) return false;
      if (scene.collision[row * scene.columns + column] === 1) return false;
    }
  }
  return true;
}

/**
 * THE MONEY FUNCTION: per-plot clear/lost status for all 128 shelter plots, plus
 * totals. This is the number that decides whether a composition is buildable -
 * "a plot is LOST if ANY of its 25 tiles is blocking terrain" measured directly
 * against the derived collision mask, tile by tile, for every plot in every
 * district.
 */
export function shelterPlotReport(scene: NirvanaWestScene): ShelterPlotReport {
  const statuses = allShelterPlots().map((plot) => ({
    plot,
    clear: shelterPlotIsClear(scene, plot.tile),
  }));
  const clear = statuses.filter((status) => status.clear).length;
  return {
    total: statuses.length,
    clear,
    lost: statuses.length - clear,
    statuses: Object.freeze(statuses),
  };
}

// ---------------------------------------------------------------------------
// ash-waste identity visibility (does the region's identity reach where beings
// actually live, or only the margins nobody stands in)
// ---------------------------------------------------------------------------

const IDENTITY_MATERIALS: ReadonlySet<string> = new Set([
  "ember", "emberdim", "brine", "glass", "clinker", "scree", "rime", "ashpale",
]);

export interface IdentityVisibilityReport {
  readonly plotsWithIdentityInView: number;
  readonly total: number;
  readonly medianDistance: number;
  readonly maxDistance: number;
}

/**
 * For each of the 128 shelter plots, the Chebyshev tile distance from the plot's
 * anchor tile to the nearest ash-waste-identity tile (`ember`/`emberdim`/`brine`/
 * `glass`/`clinker`/`scree`/`rime`/`ashpale`), plus how many plots have one within
 * a 1536x1024 viewport half-extent (24 columns, 16 rows) of their centre.
 *
 * Warm Springs proved this the honest way to catch a beautiful margin quietly
 * hiding a region whose identity nobody standing in a district will ever see.
 * Same check here, over this region's own identity vocabulary.
 */
export function identityVisibilityReport(scene: NirvanaWestScene): IdentityVisibilityReport {
  const identityTiles: TileCoord[] = [];
  for (let row = 0; row < scene.rows; row += 1) {
    for (let column = 0; column < scene.columns; column += 1) {
      const tile = scene.tiles[row * scene.columns + column];
      if (IDENTITY_MATERIALS.has(tile.material)) identityTiles.push({ column, row });
    }
  }

  const distances: number[] = [];
  let plotsWithIdentityInView = 0;
  for (const plot of allShelterPlots()) {
    let best = Number.POSITIVE_INFINITY;
    for (const identity of identityTiles) {
      const dx = Math.abs(identity.column - plot.tile.column);
      const dy = Math.abs(identity.row - plot.tile.row);
      const chebyshev = Math.max(dx, dy);
      if (chebyshev < best) best = chebyshev;
      if (dx <= 24 && dy <= 16) {
        plotsWithIdentityInView += 1;
        break;
      }
    }
    distances.push(Number.isFinite(best) ? best : Number.POSITIVE_INFINITY);
  }

  const sorted = [...distances].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];

  return {
    plotsWithIdentityInView,
    total: allShelterPlots().length,
    medianDistance: median,
    maxDistance: sorted[sorted.length - 1] ?? Number.POSITIVE_INFINITY,
  };
}
