import type { Vec2 } from "../contracts";
import { tileCenter, tileIndex, type TileCoord } from "./regionMap";

export interface NavigationRequest {
  readonly start: TileCoord;
  readonly goal: TileCoord;
  readonly softBlocked?: ReadonlySet<number>;
}

export interface NavigationGrid {
  readonly columns: number;
  readonly rows: number;
  readonly collision: Uint8Array;
}

export interface NavigationResult {
  readonly status: "reached" | "nearest" | "unreachable";
  readonly tiles: readonly TileCoord[];
  readonly waypoints: readonly Vec2[];
}

export interface PathPriority { readonly tile: TileCoord; readonly h: number; readonly f: number }
interface OpenNode extends PathPriority { readonly g: number }

const NEIGHBORS = [{ column: 0, row: -1 }, { column: 1, row: 0 }, { column: 0, row: 1 }, { column: -1, row: 0 }] as const;
const heuristic = (a: TileCoord, b: TileCoord): number => Math.abs(a.column - b.column) + Math.abs(a.row - b.row);
const key = (tile: TileCoord): string => `${tile.column},${tile.row}`;
const inBounds = (map: NavigationGrid, tile: TileCoord): boolean => tile.column >= 0 && tile.column < map.columns && tile.row >= 0 && tile.row < map.rows;
/** Compares deterministic A* priority independently of open-set insertion order. */
export function comparePathPriority(a: PathPriority, b: PathPriority): number {
  return a.f - b.f || a.h - b.h || a.tile.row - b.tile.row || a.tile.column - b.tile.column;
}

/** Enumerates adjacent tiles in the navigation policy's fixed N/E/S/W order. */
export function enumerateNeighbors(tile: TileCoord): readonly TileCoord[] {
  return NEIGHBORS.map((delta) => ({ column: tile.column + delta.column, row: tile.row + delta.row }));
}

function buildResult(status: NavigationResult["status"], end: TileCoord, cameFrom: ReadonlyMap<string, TileCoord>): NavigationResult {
  const tiles: TileCoord[] = [end];
  let cursor = end;
  while (cameFrom.has(key(cursor))) {
    cursor = cameFrom.get(key(cursor))!;
    tiles.push(cursor);
  }
  tiles.reverse();
  return { status, tiles, waypoints: tiles.map(tileCenter) };
}

/** Finds a deterministic legal route, falling back to the nearest visited tile. */
export function findPath(map: NavigationGrid, request: NavigationRequest): NavigationResult {
  if (!inBounds(map, request.start) || map.collision[tileIndex(map, request.start)] !== 0) {
    return { status: "unreachable", tiles: [], waypoints: [] };
  }

  const open: OpenNode[] = [{ tile: request.start, g: 0, h: heuristic(request.start, request.goal), f: heuristic(request.start, request.goal) }];
  const bestCosts = new Map([[key(request.start), 0]]);
  const cameFrom = new Map<string, TileCoord>();
  let nearest = request.start;

  while (open.length > 0) {
    open.sort(comparePathPriority);
    const current = open.shift()!;
    if (current.g !== bestCosts.get(key(current.tile))) continue;
    const nearestOrder = heuristic(current.tile, request.goal) - heuristic(nearest, request.goal) || current.tile.row - nearest.row || current.tile.column - nearest.column;
    if (nearestOrder < 0) nearest = current.tile;
    if (inBounds(map, request.goal) && current.tile.column === request.goal.column && current.tile.row === request.goal.row) {
      return buildResult("reached", current.tile, cameFrom);
    }

    for (const next of enumerateNeighbors(current.tile)) {
      if (!inBounds(map, next) || map.collision[tileIndex(map, next)] !== 0) continue;
      const nextIndex = tileIndex(map, next);
      const cost = current.g + 1 + (request.softBlocked?.has(nextIndex) ? 4 : 0);
      if (cost >= (bestCosts.get(key(next)) ?? Number.POSITIVE_INFINITY)) continue;
      bestCosts.set(key(next), cost);
      cameFrom.set(key(next), current.tile);
      const h = heuristic(next, request.goal);
      open.push({ tile: next, g: cost, h, f: cost + h });
    }
  }
  return buildResult("nearest", nearest, cameFrom);
}
