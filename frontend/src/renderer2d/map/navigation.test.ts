import { describe, expect, it } from "vitest";

import type { TileCoord } from "./regionMap";
import type { NavigationGrid } from "./navigation";
import { deriveDemoRegionMap, tileIndex } from "./regionMap";
import { comparePathPriority, enumerateNeighbors, findPath } from "./navigation";

function openMap(columns = 5, rows = 5): NavigationGrid {
  return {
    columns, rows, collision: new Uint8Array(columns * rows),
  };
}

describe("findPath", () => {
  it("enumerates neighbors in exact north, east, south, west order", () => {
    expect(enumerateNeighbors({ column: 4, row: 3 })).toEqual([
      { column: 4, row: 2 }, { column: 5, row: 3 }, { column: 4, row: 4 }, { column: 3, row: 3 },
    ]);
  });

  it("compares open-node priority by f, then h, then row, then column", () => {
    const node = (f: number, h: number, row: number, column: number) => ({ f, h, tile: { row, column } });
    expect(comparePathPriority(node(1, 99, 9, 9), node(2, 0, 0, 0))).toBeLessThan(0);
    expect(comparePathPriority(node(2, 1, 9, 9), node(2, 2, 0, 0))).toBeLessThan(0);
    expect(comparePathPriority(node(2, 2, 1, 9), node(2, 2, 2, 0))).toBeLessThan(0);
    expect(comparePathPriority(node(2, 2, 2, 1), node(2, 2, 2, 2))).toBeLessThan(0);
  });

  it("finds a legal deterministic route across the demo region", () => {
    const map = deriveDemoRegionMap(20260711);
    const route = findPath(map, { start: map.anchors.spawn, goal: map.anchors.shelterDoor });

    expect(route.status).toBe("reached");
    expect(route.tiles.length).toBeGreaterThan(4);
    expect(route.waypoints.length).toBe(route.tiles.length);
    for (const tile of route.tiles) expect(map.collision[tileIndex(map, tile)]).toBe(0);
  });

  it("uses north, east, south, west as the stable neighbor tie order", () => {
    const route = findPath(openMap(), { start: { column: 2, row: 2 }, goal: { column: 3, row: 1 } });
    expect(route.tiles).toEqual([{ column: 2, row: 2 }, { column: 2, row: 1 }, { column: 3, row: 1 }]);
  });

  it("orders competing open nodes by f, then h, then row, then column", () => {
    const map = openMap(7, 7);
    map.collision[2 * 7 + 3] = 1;
    expect(findPath(map, { start: { column: 3, row: 3 }, goal: { column: 3, row: 0 } }).tiles.slice(0, 3)).toEqual([
      { column: 3, row: 3 }, { column: 2, row: 3 }, { column: 2, row: 2 },
    ]);
  });

  it("returns the nearest reachable tile for a blocked goal", () => {
    const map = openMap();
    const goal: TileCoord = { column: 2, row: 2 };
    map.collision[tileIndex(map, goal)] = 1;
    const route = findPath(map, { start: { column: 0, row: 2 }, goal });

    expect(route.status).toBe("nearest");
    expect(route.tiles.at(-1)).toEqual({ column: 2, row: 1 });
  });

  it("never routes through pond or scenery props", () => {
    const map = deriveDemoRegionMap(8);
    const route = findPath(map, { start: map.anchors.spawn, goal: { column: 14, row: 1 } });
    const hardBlocked = new Set(map.props
      .filter(({ tile }) => map.collision[tileIndex(map, tile)] === 1)
      .map(({ tile }) => tileIndex(map, tile)));
    expect(route.tiles.every((tile) => !hardBlocked.has(tileIndex(map, tile)))).toBe(true);
  });

  it("rejects an invalid start and charges a deterministic soft-block penalty", () => {
    const map = openMap();
    expect(findPath(map, { start: { column: -1, row: 0 }, goal: { column: 1, row: 1 } })).toEqual({ status: "unreachable", tiles: [], waypoints: [] });

    const softBlocked = new Set([tileIndex(map, { column: 1, row: 0 })]);
    expect(findPath(map, { start: { column: 0, row: 0 }, goal: { column: 2, row: 0 }, softBlocked }).tiles).toEqual([
      { column: 0, row: 0 }, { column: 0, row: 1 }, { column: 1, row: 1 }, { column: 2, row: 1 }, { column: 2, row: 0 },
    ]);
  });

  it("treats every out-of-bounds and hard-blocked start as unreachable", () => {
    const map = openMap();
    map.collision[tileIndex(map, { column: 2, row: 2 })] = 1;
    for (const start of [{ column: -1, row: 0 }, { column: 5, row: 0 }, { column: 0, row: 5 }, { column: 2, row: 2 }]) {
      expect(findPath(map, { start, goal: { column: 0, row: 0 } }).status).toBe("unreachable");
    }
  });

  it("returns nearest for an out-of-bounds goal and an open disconnected goal", () => {
    const map = openMap();
    expect(findPath(map, { start: { column: 0, row: 0 }, goal: { column: 5, row: 2 } })).toMatchObject({ status: "nearest", tiles: expect.arrayContaining([{ column: 4, row: 2 }]) });
    for (const tile of [{ column: 1, row: 2 }, { column: 2, row: 1 }, { column: 3, row: 2 }, { column: 2, row: 3 }]) map.collision[tileIndex(map, tile)] = 1;
    const disconnected = findPath(map, { start: { column: 0, row: 0 }, goal: { column: 2, row: 2 } });
    expect(disconnected.status).toBe("nearest");
    expect(disconnected.tiles.at(-1)).toEqual({ column: 2, row: 0 });
  });
});
