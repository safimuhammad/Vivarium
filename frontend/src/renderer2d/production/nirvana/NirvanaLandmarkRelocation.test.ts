import { describe, expect, it } from "vitest";

import type { RegionSnapshot } from "../../../app/schemas";
import { createRegionMapIdentity } from "../maps/RegionMapIdentity";
import { createRegionMapRecipe } from "../maps/RegionMapRecipe";
import { shelterRenderRect } from "../productionGeometry";
import {
  createNirvanaRegionMapRecipe,
  createNirvanaInitialRegionForRecipe,
  nirvanaMechanicsExclusionsFromRecipe,
} from "./NirvanaRegionMapRecipe";
import {
  NIRVANA_UNRELOCATABLE_LANDMARKS,
  nirvanaLandmarkRelocation,
} from "./NirvanaLandmarkRelocation";
import { NIRVANA_CHUNK_COLUMNS, NIRVANA_CHUNK_ROWS, NIRVANA_TILE_SIZE } from "./NirvanaRegionV2";

function makeRegion(
  name: string,
  description: string,
  connections: readonly string[],
): RegionSnapshot {
  return {
    name,
    description,
    connections: [...connections],
    energy_rate: 0.2,
    materials_rate: 0.2,
    current_energy: 40,
    current_materials: 40,
    max_energy: 100,
    max_materials: 100,
  };
}

const regions: readonly RegionSnapshot[] = [
  makeRegion("nirvana", "a once-heavenly landscape, now thinning and picked-over", ["warm_springs", "nirvana_east"]),
  makeRegion("warm_springs", "hot spring lakes", ["nirvana"]),
  makeRegion("nirvana_east", "a struggling, near-barren stretch", ["nirvana"]),
];

const COLUMNS = 96;
const ROWS = 96;

/**
 * The nine authored macro landmarks the river displaced and the terrain field recovered,
 * with the WORLD bounds each must be published at.
 *
 * Owner instruction, `.superpowers/sdd/nirvana-live-report.md` §D: relocate rather than
 * retire. Pinning the exact published bounds is what makes a drift loud — a relocation
 * that quietly slid onto other ground would otherwise still "pass" as recovered.
 */
const RECOVERED: readonly (readonly [string, string])[] = [
  ["0,0:hero-ancient-oak", "9,20 8x7"],
  ["0,0:reclaimed-ruined-garden", "4,6 8x8"],
  ["0,0:woodland-bottom-west", "7,28 8x4"],
  ["1,0:transition-grove-north", "56,9 4x4"],
  ["0,1:old-road-grove-west-high", "7,35 4x4"],
  ["0,1:old-road-grove-west-mid", "9,43 4x4"],
  ["0,1:old-road-grove-west-low", "11,56 4x4"],
  ["0,2:settlement-grove-west-high", "9,68 4x4"],
  ["0,2:settlement-ruined-garden", "8,77 8x8"],
];

function nirvanaRegionUnderTest(): ReturnType<typeof createNirvanaInitialRegionForRecipe> {
  const identity = createRegionMapIdentity(401, regions[0]!, regions);
  return createNirvanaInitialRegionForRecipe(createNirvanaRegionMapRecipe(identity));
}

function publishedLandmarkBounds(): ReadonlyMap<string, string> {
  const initial = nirvanaRegionUnderTest();
  expect(initial).not.toBeNull();
  const bounds = new Map<string, string>();
  for (const [key, chunk] of initial!.region.chunks) {
    const [chunkColumn, chunkRow] = key.split(",").map(Number);
    const originColumn = (chunkColumn ?? 0) * NIRVANA_CHUNK_COLUMNS;
    const originRow = (chunkRow ?? 0) * NIRVANA_CHUNK_ROWS;
    for (const landmark of chunk.landmarks) {
      bounds.set(`${key}:${landmark.id}`, [
        `${originColumn + landmark.bounds.column},${originRow + landmark.bounds.row}`,
        `${landmark.bounds.columns}x${landmark.bounds.rows}`,
      ].join(" "));
    }
  }
  return bounds;
}

describe("Nirvana landmark recovery", () => {
  it("publishes all nine displaced landmarks at their authored alternative homes", () => {
    const published = publishedLandmarkBounds();

    for (const [id, expectedBounds] of RECOVERED) {
      expect(published.get(id), id).toBe(expectedBounds);
    }
    // 27 authored macro landmarks, minus the four with no intent-preserving home.
    expect(published.size).toBe(23);
  });

  it("keeps the four landmarks with no legal home retired rather than dumping them", () => {
    const published = publishedLandmarkBounds();

    expect([...NIRVANA_UNRELOCATABLE_LANDMARKS].sort()).toEqual([
      "0,0:woodland-east-upper",
      "0,0:woodland-top-east",
      "0,0:woodland-top-garden",
      "0,0:woodland-west-bottom",
    ]);
    for (const id of NIRVANA_UNRELOCATABLE_LANDMARKS) {
      expect(published.has(id), id).toBe(false);
      const [, landmarkId] = id.split(":");
      expect(nirvanaLandmarkRelocation({ column: 0, row: 0 }, landmarkId!)).toBeNull();
    }
  });

  it("carries a written rationale for every relocation", () => {
    for (const [id] of RECOVERED) {
      const [chunkKey, landmarkId] = id.split(":");
      const [column, row] = chunkKey!.split(",").map(Number);
      const relocation = nirvanaLandmarkRelocation(
        { column: column!, row: row! },
        landmarkId!,
      );
      expect(relocation, id).not.toBeNull();
      expect(relocation!.rationale.length, id).toBeGreaterThan(20);
    }
  });

  it("costs no shelter plot, no mechanics tile and no extra walkable component", () => {
    const identity = createRegionMapIdentity(401, regions[0]!, regions);
    const exclusions = nirvanaMechanicsExclusionsFromRecipe(createRegionMapRecipe(identity));
    const recipe = createNirvanaRegionMapRecipe(identity);
    const { collision } = recipe.grid;

    const blockedAt = (column: number, row: number): boolean =>
      column >= 0 && row >= 0 && column < COLUMNS && row < ROWS
      && collision[row * COLUMNS + column] === 1;

    const lostPlots = exclusions.shelterPlots.filter(({ tile }) => {
      const rect = shelterRenderRect(tile);
      for (let row = Math.floor(rect.y / NIRVANA_TILE_SIZE);
        row <= Math.floor((rect.y + rect.height - 1) / NIRVANA_TILE_SIZE); row += 1) {
        for (let column = Math.floor(rect.x / NIRVANA_TILE_SIZE);
          column <= Math.floor((rect.x + rect.width - 1) / NIRVANA_TILE_SIZE); column += 1) {
          if (blockedAt(column, row)) return true;
        }
      }
      return false;
    });
    expect(lostPlots.map(({ id }) => id)).toEqual([]);

    const mechanicsTiles = new Set<string>(exclusions.hardTiles);
    for (const { tile, door } of exclusions.shelterPlots) {
      mechanicsTiles.add(`${tile.column},${tile.row}`);
      mechanicsTiles.add(`${door.column},${door.row}`);
    }
    for (const point of exclusions.stagingPoints) {
      mechanicsTiles.add([
        Math.floor(point.x / NIRVANA_TILE_SIZE),
        Math.floor(point.y / NIRVANA_TILE_SIZE),
      ].join(","));
    }
    for (const anchor of exclusions.anchors) mechanicsTiles.add(`${anchor.column},${anchor.row}`);
    for (const { tile } of exclusions.gates) mechanicsTiles.add(`${tile.column},${tile.row}`);
    const closed = [...mechanicsTiles].filter((key) => {
      const [column, row] = key.split(",").map(Number);
      return blockedAt(column!, row!);
    });
    expect(closed).toEqual([]);

    const seen = new Uint8Array(COLUMNS * ROWS);
    const componentSizes: number[] = [];
    for (let start = 0; start < COLUMNS * ROWS; start += 1) {
      if (collision[start] === 1 || seen[start] === 1) continue;
      let size = 0;
      const stack = [start];
      seen[start] = 1;
      while (stack.length > 0) {
        const index = stack.pop()!;
        size += 1;
        const column = index % COLUMNS;
        const row = Math.floor(index / COLUMNS);
        for (const neighbour of [
          column > 0 ? index - 1 : -1,
          column < COLUMNS - 1 ? index + 1 : -1,
          row > 0 ? index - COLUMNS : -1,
          row < ROWS - 1 ? index + COLUMNS : -1,
        ]) {
          if (neighbour < 0 || seen[neighbour] === 1 || collision[neighbour] === 1) continue;
          seen[neighbour] = 1;
          stack.push(neighbour);
        }
      }
      componentSizes.push(size);
    }
    expect(componentSizes).toHaveLength(1);
  });

  it("leaves both walled-garden courts open, so they can still be walked into", () => {
    const initial = nirvanaRegionUnderTest();
    expect(initial).not.toBeNull();
    const identity = createRegionMapIdentity(401, regions[0]!, regions);
    const { collision } = createNirvanaRegionMapRecipe(identity).grid;

    // A walled garden is only a place worth walking to if its court is reachable. Its one
    // gate is the two tiles at the middle of its south wall, so a relocation that parks
    // that gate against another landmark turns the court into an unreachable pocket the
    // field's connectivity repair then seals shut — silently, with every other invariant
    // still green. That is exactly what the first `settlement-ruined-garden` position did.
    const courts: Record<string, number> = {};
    for (const [key, chunk] of initial!.region.chunks) {
      const [chunkColumn, chunkRow] = key.split(",").map(Number);
      const originColumn = (chunkColumn ?? 0) * NIRVANA_CHUNK_COLUMNS;
      const originRow = (chunkRow ?? 0) * NIRVANA_CHUNK_ROWS;
      for (const landmark of chunk.landmarks) {
        if (landmark.feature !== "ruined-garden") continue;
        const { bounds } = landmark;
        let open = 0;
        for (let row = bounds.row + 1; row < bounds.row + bounds.rows - 1; row += 1) {
          for (let column = bounds.column + 1;
            column < bounds.column + bounds.columns - 1; column += 1) {
            const index = (originRow + row) * COLUMNS + (originColumn + column);
            if (collision[index] !== 1) open += 1;
          }
        }
        courts[`${key}:${landmark.id}`] = open;
      }
    }

    // Both courts are 6x6 = 36 tiles. Decorative scenery may stand in a court; a sealed
    // court cannot. The region is proved to be ONE walkable component above, so an open
    // court tile is by construction a reachable one.
    expect(courts).toEqual({
      "0,0:reclaimed-ruined-garden": 32,
      "0,2:settlement-ruined-garden": 35,
    });
  });

  it("blocks no road tile at all now that the wrap seams are open", () => {
    const initial = nirvanaRegionUnderTest();
    expect(initial).not.toBeNull();
    const identity = createRegionMapIdentity(401, regions[0]!, regions);
    const { collision } = createNirvanaRegionMapRecipe(identity).grid;

    const blockedRoads: string[] = [];
    for (const [key, chunk] of initial!.region.chunks) {
      const [chunkColumn, chunkRow] = key.split(",").map(Number);
      const originColumn = (chunkColumn ?? 0) * NIRVANA_CHUNK_COLUMNS;
      const originRow = (chunkRow ?? 0) * NIRVANA_CHUNK_ROWS;
      for (const { tile } of chunk.roadCells) {
        const column = originColumn + tile.column;
        const row = originRow + tile.row;
        if (column >= COLUMNS || row >= ROWS) continue;
        if (collision[row * COLUMNS + column] === 1) blockedRoads.push(`${column},${row}`);
      }
    }

    // This assertion used to read ["0,14", "84,0", "84,95", "95,14"] — the four wrap-seam
    // road connectors, the ONLY road tiles the blanket rim closure ever blocked. Topology
    // activation re-opens exactly those four, so the count is now zero: every authored
    // road tile in the region is walkable. That the two lists coincide exactly is the
    // strongest available evidence that the seams opened are the ports the road network
    // was authored to cross at, and nothing else.
    expect(blockedRoads.sort()).toEqual([]);
  });
});
