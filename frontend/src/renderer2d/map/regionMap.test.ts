import { describe, expect, it } from "vitest";

import { deriveDemoRegionMap, tileCenter, tileIndex } from "./regionMap";

describe("deriveDemoRegionMap", () => {
  it("derives the same complete recipe for the same seed", () => {
    const first = deriveDemoRegionMap(20260711);
    const second = deriveDemoRegionMap(20260711);

    expect(first).toMatchObject({ version: 1, regionId: "nirvana", columns: 16, rows: 9 });
    expect([...first.collision]).toEqual([...second.collision]);
    expect(first.props).toEqual(second.props);
    expect(first.anchors).toEqual(second.anchors);
    expect(first.shelterPlots).toEqual(second.shelterPlots);
    expect(first.anchors).toEqual({
      spawn: { column: 2, row: 7 },
      social: { column: 6, row: 5 },
      shelterDoor: { column: 11, row: 4 },
      story: { column: 8, row: 5 },
    });
  });

  it("uses the recipe as the collision source for every obstructing prop", () => {
    const map = deriveDemoRegionMap(42);
    const obstacles = map.props.filter(({ kind }) => kind === "pond" || kind === "tree" || kind === "shrub" || kind === "post");

    expect(obstacles.length).toBeGreaterThan(0);
    for (const prop of obstacles) expect(map.collision[tileIndex(map, prop.tile)]).toBe(1);
    for (const anchor of Object.values(map.anchors)) expect(map.collision[tileIndex(map, anchor)]).toBe(0);
    expect(tileCenter({ column: 2, row: 3 })).toEqual({ x: 80, y: 112 });
  });

  it("encodes all 16x9 ground tiles and the approved central pale path", () => {
    const map = deriveDemoRegionMap(1);
    expect(map.ground).toHaveLength(16 * 9);
    expect(map.ground.every((tile, index) => tile.tile.column === index % 16 && tile.tile.row === Math.floor(index / 16))).toBe(true);
    const palePath = map.ground.filter(({ terrain }) => terrain === "pale-path").map(({ tile }) => `${tile.column},${tile.row}`);
    expect(palePath).toEqual([
      "11,4", "6,5", "7,5", "8,5", "9,5", "10,5", "11,5",
      "2,6", "3,6", "4,6", "5,6", "6,6", "2,7",
    ]);
  });

  it("keeps the path readable inside diverse scenery clusters concentrated at the edges", () => {
    const map = deriveDemoRegionMap(7_113);
    const pathTiles = new Set(map.ground.filter(({ terrain }) => terrain === "pale-path")
      .map(({ tile }) => `${tile.column},${tile.row}`));
    const scenery = map.props.filter(({ kind }) => kind !== "pond");
    const occupiedTiles = map.props.map(({ tile }) => `${tile.column},${tile.row}`);
    const edgeScenery = scenery.filter(({ tile }) => (
      tile.column <= 2 || tile.column >= 13 || tile.row <= 1 || tile.row >= 7
    ));

    expect(scenery.length).toBeGreaterThanOrEqual(32);
    expect(new Set(scenery.map(({ kind }) => kind)).size).toBeGreaterThanOrEqual(12);
    expect(edgeScenery.length).toBeGreaterThanOrEqual(24);
    expect(new Set(map.props.map(({ id }) => id)).size).toBe(map.props.length);
    expect(new Set(occupiedTiles).size).toBe(map.props.length);
    expect(occupiedTiles.filter((tile) => pathTiles.has(tile))).toEqual([]);
  });

  it("isolates every derived recipe from caller mutation", () => {
    const dirty = deriveDemoRegionMap(5);
    dirty.collision[0] = 1;
    (dirty.props as unknown as { tile: { column: number; row: number } }[])[0]!.tile.column = 9;
    (dirty.ground as unknown as { terrain: string }[])[0]!.terrain = "pale-path";
    (dirty.shelterPlots as unknown as { door: { column: number; row: number } }[])[0]!.door.column = 0;

    const fresh = deriveDemoRegionMap(5);
    expect(fresh.collision[0]).toBe(0);
    expect(fresh.props[0]!.tile).toEqual({ column: 0, row: 1 });
    expect(fresh.ground[0]!.terrain).toBe("grass");
    expect(fresh.shelterPlots[0]!.door).toEqual({ column: 11, row: 4 });
  });
});
