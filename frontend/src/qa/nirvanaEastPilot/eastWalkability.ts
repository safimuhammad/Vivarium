/**
 * Adapters that connect the Nirvana East PILOT scene to the exact PRODUCTION
 * consumers of a terrain walkability mask, the money function that decides
 * whether a composition is buildable ({@link shelterPlotReport}), and the
 * torus-specific proofs the contract demands (§2.6, §9).
 *
 * Mirrors `warmSpringsPilot/springsWalkability.ts` in shape. `eastScene.ts`
 * derives one `collision` mask (row-major, 1 = blocked) already shaped like
 * the production `NavigationGrid`, so `toNavigationGrid` below is a zero-copy
 * view exactly as the Warm Springs pilot's is.
 */

import type { Vec2 } from "../../renderer2d/contracts";
import { tileCenter, type TileCoord } from "../../renderer2d/map/regionMap";
import type { NavigationGrid } from "../../renderer2d/production/navigation/navigation";
import { shelterRenderRect } from "../../renderer2d/production/productionGeometry";
import { cornerSeamMismatches, type NirvanaEastScene } from "./eastScene";

/**
 * Adapt the pilot scene's collision mask to the production `NavigationGrid`
 * shape. No copy is made: the grid is a read-only view over the scene's own
 * `Uint8Array`, exactly as a real `RegionMapRecipeV1` exposes its `grid` field.
 */
export function toNavigationGrid(scene: NirvanaEastScene): NavigationGrid {
  return {
    columns: scene.columns,
    rows: scene.rows,
    collision: scene.collision,
  };
}

/** The centre point, in world pixels, of every walkable tile. */
export function walkablePoints(scene: NirvanaEastScene): readonly Vec2[] {
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
 */
export function shelterPlotIsClear(scene: NirvanaEastScene, plotTile: TileCoord): boolean {
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
 * THE MONEY FUNCTION: per-plot clear/lost status for all 128 shelter plots,
 * plus totals. This is the number that decides whether a composition is
 * buildable - contract §1's "PLOT COST RULE" ("a plot is LOST if ANY of its
 * 25 tiles is blocking terrain") measured directly against the derived
 * collision mask, tile by tile, for every plot in every district.
 */
export function shelterPlotReport(scene: NirvanaEastScene): ShelterPlotReport {
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
// identity visibility (does the region's identity reach where beings
// actually live, or only the margins nobody stands in - contract §9)
// ---------------------------------------------------------------------------

/** Identity materials, frozen by contract §9 - NOT the same set as "walkable". */
const IDENTITY_MATERIALS: ReadonlySet<string> = new Set([
  "brine", "brinerim", "salt", "redsand", "oxide", "mesa", "scarp", "slot",
]);

export interface IdentityVisibilityReport {
  readonly plotsWithIdentityInView: number;
  readonly total: number;
  readonly medianDistance: number;
  readonly maxDistance: number;
}

/**
 * For each of the 128 shelter plots, the Chebyshev tile distance from the
 * plot's anchor tile to the nearest identity tile, plus how many plots have
 * one within a 1536x1024 viewport half-extent (24 columns, 16 rows) of their
 * centre (contract §9's `inView` metric).
 */
export function identityVisibilityReport(scene: NirvanaEastScene): IdentityVisibilityReport {
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

// ---------------------------------------------------------------------------
// the torus proofs (contract §2.5, §2.6)
// ---------------------------------------------------------------------------

export interface TorusReport {
  readonly seamMismatchNS: number;
  readonly seamMismatchEW: number;
  readonly wrapOpeningsNS: number;
  readonly wrapOpeningsEW: number;
}

/**
 * The torus invariant and the wrap-opening counts, combined (contract §2.5,
 * §2.6): seam mismatches on both axes (must be 0), and how generously the
 * seam itself is walkable (`wrapOpeningsNS`/`wrapOpeningsEW`, both must be
 * >0, target >=20) - "a composition where the wrap seam is a wall of blocked
 * ground is a route dead-end at the join."
 */
export function torusReport(scene: NirvanaEastScene): TorusReport {
  const seams = cornerSeamMismatches(scene);

  let wrapOpeningsNS = 0;
  for (let column = 0; column < scene.columns; column += 1) {
    const north = scene.collision[0 * scene.columns + column];
    const south = scene.collision[(scene.rows - 1) * scene.columns + column];
    if (north === 0 && south === 0) wrapOpeningsNS += 1;
  }

  let wrapOpeningsEW = 0;
  for (let row = 0; row < scene.rows; row += 1) {
    const west = scene.collision[row * scene.columns + 0];
    const east = scene.collision[row * scene.columns + (scene.columns - 1)];
    if (west === 0 && east === 0) wrapOpeningsEW += 1;
  }

  return {
    seamMismatchNS: seams.northSouth,
    seamMismatchEW: seams.eastWest,
    wrapOpeningsNS,
    wrapOpeningsEW,
  };
}

// ---------------------------------------------------------------------------
// landmark anchor sites (contract §7.8)
// ---------------------------------------------------------------------------

export type LandmarkKind = "sun-rock-outcrop" | "deadwood-thorn-crescent" | "wind-scrub-clump";

export interface LandmarkAnchorSite {
  readonly id: string;
  readonly kind: LandmarkKind;
  readonly tile: TileCoord;
}

const LANDMARK_PROP_PREFIXES: readonly { readonly prefix: string; readonly kind: LandmarkKind }[] = Object.freeze([
  { prefix: "s.boulder.", kind: "sun-rock-outcrop" },
  { prefix: "s.hoodoo.", kind: "sun-rock-outcrop" },
  // Round 2: mesa/butte/outcrop are ALSO sun-rock-outcrop-scale features -
  // more so than a boulder or hoodoo, now that they are the region's primary
  // illustrated landform objects (contract: round-1 open item 4, "A had only
  // 1 sun-rock-outcrop landmark anchor against B's 10" - resolved by this
  // once landform objects exist to anchor against).
  { prefix: "s.mesa.", kind: "sun-rock-outcrop" },
  { prefix: "s.butte.", kind: "sun-rock-outcrop" },
  { prefix: "s.outcrop.", kind: "sun-rock-outcrop" },
  { prefix: "s.deadwood.", kind: "deadwood-thorn-crescent" },
  { prefix: "s.thornbush.", kind: "deadwood-thorn-crescent" },
  { prefix: "s.mesquite.", kind: "deadwood-thorn-crescent" },
  { prefix: "s.saltbush.", kind: "wind-scrub-clump" },
  { prefix: "s.bunchgrass.", kind: "wind-scrub-clump" },
]);

const NEIGHBOUR_OFFSETS: readonly (readonly [number, number])[] = Object.freeze([
  [0, -1], [1, 0], [0, 1], [-1, 0], [-1, -1], [1, -1], [1, 1], [-1, 1],
]);

/**
 * At least 8 clear, walkable-adjacent, off-plot sites suited to `dry-scrub`'s
 * three landmark composites (contract §7.8) - derived from the SCENE alone
 * (not from any composition-internal authoring data), by finding a walkable,
 * off-plot tile immediately adjacent to a prop whose kind matches one of the
 * three landmark families. Reusing real scattered props as anchors means a
 * site is guaranteed to already read as "the right kind of place."
 */
export function landmarkAnchorSites(scene: NirvanaEastScene): readonly LandmarkAnchorSite[] {
  const plots = allShelterPlots();
  const nearPlot = (column: number, row: number): boolean => plots.some((plot) => (
    column >= plot.tile.column - 1 && column <= plot.tile.column + 5
    && row >= plot.tile.row - 1 && row <= plot.tile.row + 5
  ));

  const sites: LandmarkAnchorSite[] = [];
  const seen = new Set<string>();
  for (const prop of scene.props) {
    const match = LANDMARK_PROP_PREFIXES.find((entry) => prop.frameId.startsWith(entry.prefix));
    if (match === undefined) continue;
    for (const [dc, dr] of NEIGHBOUR_OFFSETS) {
      const column = ((prop.tile.column + dc) % scene.columns + scene.columns) % scene.columns;
      const row = ((prop.tile.row + dr) % scene.rows + scene.rows) % scene.rows;
      const index = row * scene.columns + column;
      if (scene.collision[index] !== 0) continue;
      if (nearPlot(column, row)) continue;
      const key = `${column},${row}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sites.push({ id: `landmark:${match.kind}:${sites.length}`, kind: match.kind, tile: { column, row } });
      break;
    }
  }
  return Object.freeze(sites);
}
