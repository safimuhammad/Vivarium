/**
 * @fileoverview Deterministic four-neighbour route search over a region's collision grid.
 *
 * The grid carries its own **walk topology**. `"bounded"` (the default, and what an
 * omitted field means) is the historical behaviour: the rim is a wall and a step off
 * the edge is simply not a step. `"toroidal"` makes the grid periodic — a step off the
 * west edge arrives on the east edge of the same row, a step off the north edge arrives
 * on the south edge of the same column — which is how a being "walks off one edge and
 * reappears on the opposite edge".
 *
 * Two consequences are load-bearing and deliberately handled here rather than by callers:
 *
 *  - **Tiles stay canonical, waypoints do not.** Every `TileCoord` this module emits is
 *    inside `[0, columns) x [0, rows)`, so collision lookups, tile indices and every
 *    existing tile-keyed consumer keep working unchanged. The emitted `waypoints`,
 *    however, are *unrolled*: consecutive waypoints are always exactly one tile apart in
 *    world pixels, even across a seam, so the point that crosses the west edge continues
 *    to `x < 0` instead of teleporting to the far side of the region. A being animating
 *    along such a route is genuinely walking off the edge, which is what makes the
 *    crossing drawable (see the renderer's periodic actor copy). Callers commit a
 *    canonical position again via {@link wrapNavigationPoint}.
 *  - **The heuristic must stay admissible.** See {@link navigationTileDistance}.
 */

import { nearestPeriodicCoordinate } from "../../camera/RegionPresentationTopology";
import type { Vec2 } from "../../contracts";
import { TILE_SIZE, tileCenter, type TileCoord } from "../../map/regionMap";

/** How a region's walk physics treat the grid boundary. */
export type NavigationTopology = "bounded" | "toroidal";

export interface NavigationGrid {
  readonly columns: number;
  readonly rows: number;
  readonly collision: Uint8Array;
  /**
   * Walk topology of this grid; an omitted field means `"bounded"`.
   *
   * Optional on purpose: every grid built before toroidal physics existed — and every
   * bounded region built after — keeps its exact previous behaviour and its exact
   * previous serialized bytes.
   */
  readonly topology?: NavigationTopology;
}

export interface NavigationRequest {
  readonly start: TileCoord;
  readonly goal: TileCoord;
  readonly softOccupied?: ReadonlySet<number>;
  readonly maxVisited?: number;
}

export type NavigationDiagnosticCode =
  | "invalid-start"
  | "goal-unreachable"
  | "search-budget-exhausted";

export interface NavigationDiagnostic {
  readonly code: NavigationDiagnosticCode;
  readonly requestedGoal: TileCoord;
  readonly resolvedGoal: TileCoord | null;
}

export interface NavigationResult {
  readonly status: "reached" | "nearest" | "unreachable";
  readonly tiles: readonly TileCoord[];
  readonly waypoints: readonly Vec2[];
  readonly diagnostic: NavigationDiagnostic | null;
}

export interface NavigationEndpointConnectors {
  readonly start?: Vec2;
  readonly goal?: Vec2;
}

interface OpenNode {
  readonly tile: TileCoord;
  readonly g: number;
  readonly h: number;
  readonly f: number;
  readonly insertion: number;
}

const NEIGHBORS = [
  { column: 0, row: -1 },
  { column: 1, row: 0 },
  { column: 0, row: 1 },
  { column: -1, row: 0 },
] as const;

/** Return the row-major index of a tile in a navigation grid. */
export function navigationTileIndex(grid: Pick<NavigationGrid, "columns">, tile: TileCoord): number {
  return tile.row * grid.columns + tile.column;
}

/** True when this grid's walk physics wrap at the rim. */
export function navigationGridIsToroidal(grid: Pick<NavigationGrid, "topology">): boolean {
  return grid.topology === "toroidal";
}

/**
 * The canonical in-grid tile for a coordinate.
 *
 * Identity on a bounded grid (an out-of-range tile stays out of range and is rejected
 * by the open test); the periodic representative on a toroidal grid.
 */
export function wrapNavigationTile(
  grid: Pick<NavigationGrid, "columns" | "rows" | "topology">,
  tile: TileCoord,
): TileCoord {
  if (!navigationGridIsToroidal(grid)) return tile;
  return {
    column: positiveModulo(tile.column, grid.columns),
    row: positiveModulo(tile.row, grid.rows),
  };
}

/**
 * The canonical in-region world point for an exact position.
 *
 * Unrolled route waypoints deliberately leave the region's pixel rect while a being is
 * mid-crossing; this is how a caller commits a settled position back into it.
 */
export function wrapNavigationPoint(
  grid: Pick<NavigationGrid, "columns" | "rows" | "topology">,
  point: Vec2,
): Vec2 {
  if (!navigationGridIsToroidal(grid)) return { ...point };
  return {
    x: positiveModulo(point.x, grid.columns * TILE_SIZE),
    y: positiveModulo(point.y, grid.rows * TILE_SIZE),
  };
}

/**
 * Minimum number of four-neighbour steps between two tiles on an OBSTACLE-FREE grid.
 *
 * Bounded: plain Manhattan. Toroidal: per-axis `min(|d|, extent - |d|)`, i.e. the
 * shorter of "walk across" and "walk around".
 *
 * **Admissibility.** A* needs `h(n) <= h*(n)` for every node, where `h*` is the true
 * remaining cost. Every legal move changes exactly one axis by exactly one and costs at
 * least 1 (the soft-occupancy surcharge only ever adds). A path of `k` steps therefore
 * changes the column by at most `k_c` steps and the row by at most `k_r`, with
 * `k_c + k_r <= k`. On a periodic axis of extent `E`, no sequence of `m` unit steps can
 * connect two coordinates whose periodic separation exceeds `m`, because each step moves
 * the periodic separation by at most 1 — so `min(|d|, E - |d|) <= k_c` and likewise for
 * rows. Summing gives `h <= k <= h*`. The same argument with `E = infinity` gives the
 * bounded case. Obstacles can only raise `h*`, never lower it, so the bound survives
 * them. The heuristic is also consistent (each step changes it by at most 1 while
 * costing at least 1), so the first expansion of the goal is optimal.
 */
export function navigationTileDistance(
  grid: Pick<NavigationGrid, "columns" | "rows" | "topology">,
  left: TileCoord,
  right: TileCoord,
): number {
  if (!navigationGridIsToroidal(grid)) {
    return Math.abs(left.column - right.column) + Math.abs(left.row - right.row);
  }
  return periodicSeparation(left.column, right.column, grid.columns)
    + periodicSeparation(left.row, right.row, grid.rows);
}

/** Join exact feet positions to a centered tile route without snapping across cells. */
export function connectNavigationEndpoints(
  grid: Pick<NavigationGrid, "columns" | "rows" | "topology">,
  result: NavigationResult,
  connectors: NavigationEndpointConnectors,
): readonly Vec2[] | null {
  const firstTile = result.tiles[0];
  const lastTile = result.tiles.at(-1);
  if (firstTile === undefined || lastTile === undefined) return null;
  const start = connectors.start === undefined
    ? undefined
    : wrapNavigationPoint(grid, connectors.start);
  if (start !== undefined && !sameTile(pointTile(start), firstTile)) return null;
  if (connectors.goal !== undefined
    && !sameTile(pointTile(wrapNavigationPoint(grid, connectors.goal)), lastTile)) {
    return null;
  }

  if (result.tiles.length === 1 && connectors.start !== undefined && connectors.goal !== undefined) {
    return samePoint(connectors.start, connectors.goal)
      ? [{ ...connectors.start }]
      : [{ ...connectors.start }, { ...connectors.goal }];
  }

  const waypoints = result.waypoints.map((point) => ({ ...point }));
  if (connectors.start !== undefined && !samePoint(connectors.start, waypoints[0]!)) {
    waypoints.unshift({ ...connectors.start });
  }
  if (connectors.goal !== undefined) {
    // The route's last waypoint may be unrolled outside the region rect (the being is
    // mid-crossing); the exact goal must follow it onto the SAME periodic copy or the
    // final segment would jump the whole region width backwards.
    const anchor = waypoints.at(-1)!;
    const goal = nearestPeriodicPoint(grid, connectors.goal, anchor);
    if (!samePoint(goal, anchor)) waypoints.push(goal);
  }
  return waypoints;
}

/**
 * Find a deterministic four-neighbor route with explicit fallback diagnostics.
 *
 * Honours `grid.topology`: on a toroidal grid the four neighbours of an edge tile
 * include the tile on the opposite edge, and a wrapped neighbour is still only
 * enterable when its own collision byte is open — so a seam whose far side is blocked
 * simply never yields a step, and can never produce a route that leads nowhere.
 *
 * @param grid - Region collision grid; `topology` decides whether the rim wraps.
 * @param request - Start/goal tiles, optional soft occupancy and search budget.
 * @returns Canonical in-grid `tiles` plus continuous (possibly out-of-rect) `waypoints`.
 */
export function findNavigationPath(grid: NavigationGrid, request: NavigationRequest): NavigationResult {
  assertValidGrid(grid);
  const start = wrapNavigationTile(grid, request.start);
  const goal = wrapNavigationTile(grid, request.goal);
  if (!isOpen(grid, start)) {
    return emptyResult("invalid-start", request.goal);
  }

  const maximumVisited = normalizeBudget(request.maxVisited, grid.columns * grid.rows);
  const open: OpenNode[] = [];
  const costs = new Map<string, number>();
  const parents = new Map<string, TileCoord>();
  let insertion = 0;
  let visited = 0;
  let nearest = start;
  let nearestCost = 0;
  const startH = navigationTileDistance(grid, start, goal);
  open.push({ tile: start, g: 0, h: startH, f: startH, insertion: insertion++ });
  costs.set(tileKey(start), 0);

  while (open.length > 0) {
    open.sort(compareOpenNodes);
    const current = open.shift()!;
    if (current.g !== costs.get(tileKey(current.tile))) continue;
    visited += 1;
    if (compareNearest(grid, current.tile, current.g, nearest, nearestCost, goal) < 0) {
      nearest = current.tile;
      nearestCost = current.g;
    }
    if (sameTile(current.tile, goal)) {
      return buildResult(grid, "reached", current.tile, parents, null);
    }
    if (visited >= maximumVisited) {
      return buildResult(grid, "nearest", nearest, parents, {
        code: "search-budget-exhausted",
        requestedGoal: request.goal,
        resolvedGoal: nearest,
      });
    }

    for (const delta of NEIGHBORS) {
      const next = wrapNavigationTile(grid, {
        column: current.tile.column + delta.column,
        row: current.tile.row + delta.row,
      });
      if (!isOpen(grid, next)) continue;
      const softCost = request.softOccupied?.has(navigationTileIndex(grid, next)) ? 4 : 0;
      const nextCost = current.g + 1 + softCost;
      const nextKey = tileKey(next);
      if (nextCost >= (costs.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
      costs.set(nextKey, nextCost);
      parents.set(nextKey, current.tile);
      const h = navigationTileDistance(grid, next, goal);
      open.push({ tile: next, g: nextCost, h, f: nextCost + h, insertion: insertion++ });
    }
  }

  return buildResult(grid, "nearest", nearest, parents, {
    code: "goal-unreachable",
    requestedGoal: request.goal,
    resolvedGoal: nearest,
  });
}

function assertValidGrid(grid: NavigationGrid): void {
  if (!Number.isSafeInteger(grid.columns) || grid.columns <= 0 ||
      !Number.isSafeInteger(grid.rows) || grid.rows <= 0 ||
      grid.collision.length !== grid.columns * grid.rows) {
    throw new Error("navigation grid dimensions and collision length must agree");
  }
  if (grid.topology !== undefined && grid.topology !== "bounded" && grid.topology !== "toroidal") {
    throw new Error("navigation grid topology must be \"bounded\" or \"toroidal\"");
  }
}

function normalizeBudget(requested: number | undefined, capacity: number): number {
  if (requested === undefined) return capacity;
  if (!Number.isSafeInteger(requested) || requested <= 0) {
    throw new Error("maxVisited must be a positive safe integer");
  }
  return Math.min(requested, capacity);
}

function compareOpenNodes(left: OpenNode, right: OpenNode): number {
  return left.f - right.f || left.h - right.h ||
    left.tile.row - right.tile.row || left.tile.column - right.tile.column ||
    left.insertion - right.insertion;
}

function compareNearest(
  grid: NavigationGrid,
  candidate: TileCoord,
  candidateCost: number,
  current: TileCoord,
  currentCost: number,
  goal: TileCoord,
): number {
  return navigationTileDistance(grid, candidate, goal) - navigationTileDistance(grid, current, goal) ||
    candidateCost - currentCost || candidate.row - current.row || candidate.column - current.column;
}

function buildResult(
  grid: NavigationGrid,
  status: NavigationResult["status"],
  end: TileCoord,
  parents: ReadonlyMap<string, TileCoord>,
  diagnostic: NavigationDiagnostic | null,
): NavigationResult {
  const tiles = [end];
  let cursor = end;
  while (parents.has(tileKey(cursor))) {
    cursor = parents.get(tileKey(cursor))!;
    tiles.push(cursor);
  }
  tiles.reverse();
  return { status, tiles, waypoints: unrolledWaypoints(grid, tiles), diagnostic };
}

/**
 * Tile centers in CONTINUOUS world pixels: consecutive waypoints are always exactly one
 * tile apart, so a wrapped step leaves the region rect instead of teleporting across it.
 *
 * Identical to `tiles.map(tileCenter)` for every bounded grid and for every toroidal
 * route that never crosses a seam.
 */
function unrolledWaypoints(grid: NavigationGrid, tiles: readonly TileCoord[]): readonly Vec2[] {
  const first = tiles[0];
  if (first === undefined) return [];
  let column = first.column;
  let row = first.row;
  const waypoints: Vec2[] = [tileCenter(first)];
  for (let index = 1; index < tiles.length; index += 1) {
    const previous = tiles[index - 1]!;
    const next = tiles[index]!;
    column += signedStep(previous.column, next.column, grid.columns, navigationGridIsToroidal(grid));
    row += signedStep(previous.row, next.row, grid.rows, navigationGridIsToroidal(grid));
    waypoints.push(tileCenter({ column, row }));
  }
  return waypoints;
}

/** The signed one-axis displacement of a single step, taking the seam when it is shorter. */
function signedStep(from: number, to: number, extent: number, toroidal: boolean): number {
  const raw = to - from;
  if (!toroidal) return raw;
  if (raw > extent / 2) return raw - extent;
  if (raw < -extent / 2) return raw + extent;
  return raw;
}

/** The periodic copy of `point` nearest to `anchor` (identity on a bounded grid). */
function nearestPeriodicPoint(
  grid: Pick<NavigationGrid, "columns" | "rows" | "topology">,
  point: Vec2,
  anchor: Vec2,
): Vec2 {
  if (!navigationGridIsToroidal(grid)) return { ...point };
  return {
    x: nearestPeriodicCoordinate(point.x, anchor.x, 0, grid.columns * TILE_SIZE),
    y: nearestPeriodicCoordinate(point.y, anchor.y, 0, grid.rows * TILE_SIZE),
  };
}

function emptyResult(code: NavigationDiagnosticCode, requestedGoal: TileCoord): NavigationResult {
  return {
    status: "unreachable",
    tiles: [],
    waypoints: [],
    diagnostic: { code, requestedGoal, resolvedGoal: null },
  };
}

function isOpen(grid: NavigationGrid, tile: TileCoord): boolean {
  const candidate = wrapNavigationTile(grid, tile);
  return candidate.column >= 0 && candidate.column < grid.columns &&
    candidate.row >= 0 && candidate.row < grid.rows &&
    grid.collision[navigationTileIndex(grid, candidate)] === 0;
}

function sameTile(left: TileCoord, right: TileCoord): boolean {
  return left.column === right.column && left.row === right.row;
}

function pointTile(point: Vec2): TileCoord {
  return { column: Math.floor(point.x / TILE_SIZE), row: Math.floor(point.y / TILE_SIZE) };
}

function samePoint(left: Vec2, right: Vec2): boolean {
  return left.x === right.x && left.y === right.y;
}

/**
 * Shortest separation between two coordinates on a periodic axis of extent `extent`.
 *
 * Reduced into one period before the min, so a coordinate pair more than one period apart
 * cannot produce a negative "distance".
 */
function periodicSeparation(left: number, right: number, extent: number): number {
  const wrapped = positiveModulo(Math.abs(left - right), extent);
  return Math.min(wrapped, extent - wrapped);
}

/** Non-negative remainder; works for fractional pixel coordinates as well as tile indices. */
function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function tileKey(tile: TileCoord): string {
  return `${tile.column},${tile.row}`;
}
